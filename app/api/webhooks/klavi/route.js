import { NextResponse } from 'next/server';
import {
  getItemByKlaviLinkId, getItemByKlaviConsentId, getClientById,
  updateItemStatus, recordWebhookEvent, hasWebhookEvent,
  upsertTransactionsBatch, upsertCreditTransactionsBatch,
  upsertInvestments, upsertDebts, upsertDerivedDebts,
  softDeleteItem, markItemNotified,
} from '@/lib/storage';
import { mapKlaviReportToLocal, normalizeKlaviStatus, isKlaviConsentAuthorised, isKlaviConsentRejected } from '@/lib/klavi';
import { buildItemStatusUpdates } from '@/lib/status';

export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const secret = process.env.KLAVI_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader) {
    // A Klavi pode enviar eventos sem header de autenticação (eventos de produto),
    // enquanto o teste de conectividade usa Authorization. Permitimos se não houver header,
    // mas validamos quando houver.
    console.warn('[klavi webhook] requisição sem header Authorization; permitindo evento');
    return true;
  }
  return authHeader === `Bearer ${secret}`;
}

function scheduleAsync(promise, label) {
  promise.catch(err => console.error(`[klavi webhook] erro em ${label}:`, err));
}

function extractReportMetadata(payload) {
  // A Klavi pode enviar o relatório diretamente no payload ou dentro de um campo data/report.
  const report = payload?.report || payload?.data || payload;
  const productName = payload?.productName || payload?.product_name || report?.productName || report?.productname || null;
  const productReportId = payload?.productReportId || payload?.product_report_id || report?.productReportId || report?.productreportid || null;
  const linkId = payload?.linkId || payload?.link_id || report?.links?.[0]?.linkId || null;
  const consentId = payload?.consentId || payload?.consent_id || report?.links?.[0]?.consents?.[0]?.consentId || null;
  const institutionCode = payload?.institutionCode || payload?.institution_code || report?.links?.[0]?.institutionCode || null;
  const event = payload?.event || null;
  const eventId = payload?.eventId || payload?.event_id || productReportId || `${event}|${linkId}|${consentId}`;
  return { report, productName, productReportId, linkId, consentId, institutionCode, event, eventId };
}

async function findLocalItem({ linkId, consentId }) {
  if (consentId) {
    const item = await getItemByKlaviConsentId(consentId, { includeDeleted: true });
    if (item) return item;
  }
  if (linkId) {
    const item = await getItemByKlaviLinkId(linkId, { includeDeleted: true });
    if (item) return item;
  }
  return null;
}

async function persistReport(localItem, payload) {
  const { report, productName, institutionCode } = extractReportMetadata(payload);
  if (!report || !productName) {
    console.warn('[klavi webhook] payload não reconhecido como relatório:', Object.keys(payload));
    return;
  }

  const institutionName = localItem?.institutionName || report?.checkingAccounts?.[0]?.brandName || report?.creditCardAccounts?.[0]?.brandName || 'Banco';
  const mapped = mapKlaviReportToLocal({ productName, report, institutionCode, institutionName });

  const savedBank = mapped.bankTransactions.length
    ? await upsertTransactionsBatch(localItem.clientId, localItem.id, mapped.bankTransactions)
    : 0;
  const savedCredit = mapped.creditTransactions.length
    ? await upsertCreditTransactionsBatch(localItem.clientId, localItem.id, mapped.creditTransactions)
    : 0;
  const savedInv = mapped.investments.length
    ? await upsertInvestments(localItem.clientId, localItem.id, mapped.investments)
    : 0;
  const savedDebts = mapped.debts.length
    ? await upsertDebts(localItem.clientId, localItem.id, mapped.debts)
    : 0;
  await upsertDerivedDebts(localItem.clientId).catch(() => {});

  console.log('[klavi webhook] relatório persistido item=%s product=%s bank=%d credit=%d inv=%d debts=%d',
    localItem.id, productName, savedBank, savedCredit, savedInv, savedDebts);

  // Atualiza números de conta para exibição no portal.
  const accountNumbers = mapped.accounts.map(a => a.number).filter(Boolean);
  const uniqueAccountNumbers = [...new Set(accountNumbers)].join(', ');
  if (uniqueAccountNumbers) {
    await updateItemStatus(localItem.id, { accountNumbers: uniqueAccountNumbers || null }).catch(() => {});
  }
}

async function updateItemStatusFromPayload(localItem, payload) {
  const { event, report } = extractReportMetadata(payload);
  const consentStatus = payload?.consentStatus || payload?.status || payload?.consent_status || null;
  const norm = normalizeKlaviStatus(report, consentStatus);
  const updates = buildItemStatusUpdates(null);

  updates.status = norm.status;
  if (norm.errorCode) updates.errorCode = norm.errorCode;
  if (norm.errorMessage) updates.errorMessage = norm.errorMessage;
  if (isKlaviConsentRejected(consentStatus) || norm.status === 'LOGIN_ERROR') {
    updates.requiresReconnect = true;
    updates.lastErrorAt = new Date().toISOString();
  }
  if (isKlaviConsentAuthorised(consentStatus) || norm.status === 'UPDATED') {
    updates.resetConsecutiveErrors = true;
  }
  if (event || consentStatus) {
    updates.lastUpdatedAt = new Date().toISOString();
  }

  await updateItemStatus(localItem.id, updates);

  if (updates.requiresReconnect) {
    scheduleAsync(maybeNotifyReconnection(localItem), `notify ${localItem.id}`);
  }
}

async function maybeNotifyReconnection(localItem) {
  if (!localItem) return;
  const alreadyNotified = localItem.notificationSentAt &&
    new Date(localItem.notificationSentAt).getTime() > Date.now() - 24 * 60 * 60 * 1000;
  if (alreadyNotified) return;
  await markItemNotified(localItem.id);
  const client = await getClientById(localItem.clientId).catch(() => null);
  console.log('[klavi webhook] notificação de reconexão registrada para cliente=%s item=%s', client?.name || localItem.clientId, localItem.id);
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    // A Klavi pode enviar um POST vazio no teste de conectividade.
    payload = {};
  }

  const { event, eventId, linkId, consentId } = extractReportMetadata(payload);

  // Payloads de teste de conectividade da Klavi costumam não ter event/eventId.
  // Aceitamos e retornamos 200 para não quebrar o teste.
  if (!event && !eventId) {
    console.log('[klavi webhook] payload de teste recebido (sem event/eventId)');
    return NextResponse.json({ received: true, test: true });
  }

  // Idempotência: ignora eventos já processados.
  if (eventId && await hasWebhookEvent(eventId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  await recordWebhookEvent({ eventId, event, itemId: linkId || consentId, payload });

  console.log('[klavi webhook] event=%s eventId=%s linkId=%s consentId=%s', event, eventId, linkId, consentId);

  const localItem = await findLocalItem({ linkId, consentId });

  try {
    const eventLower = String(event || '').toLowerCase();

    if (eventLower.includes('consent')) {
      if (localItem) {
        await updateItemStatusFromPayload(localItem, payload);
        if (isKlaviConsentAuthorised(payload?.consentStatus || payload?.status)) {
          // Consentimento autorizado: solicitação de relatório já deve ter sido feita no callback.
          // Se o webhook vier com dados completos, persistimos.
          if (payload?.report || payload?.checkingAccounts || payload?.creditCardAccounts) {
            scheduleAsync(persistReport(localItem, payload), `persistReport ${localItem.id}`);
          }
        }
        if (isKlaviConsentRejected(payload?.consentStatus || payload?.status)) {
          await updateItemStatus(localItem.id, { requiresReconnect: true });
        }
      }
    } else if (eventLower.includes('report') || payload?.productName || payload?.report) {
      // Relatório pronto
      if (localItem) {
        scheduleAsync(
          (async () => {
            await persistReport(localItem, payload);
            await updateItemStatusFromPayload(localItem, payload);
          })(),
          `report ${eventId}`
        );
      } else {
        console.warn('[klavi webhook] relatório recebido sem item local linkId=%s consentId=%s', linkId, consentId);
      }
    } else {
      console.log('[klavi webhook] evento não tratado:', event);
    }
  } catch (err) {
    console.error('[klavi webhook] erro ao processar:', err);
  }

  return NextResponse.json({ received: true });
}
