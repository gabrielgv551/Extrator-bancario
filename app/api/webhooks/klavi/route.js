import { NextResponse } from 'next/server';
import {
  getItemByKlaviLinkId, getItemByKlaviConsentId, getClientById,
  updateItemStatus, recordWebhookEvent, hasWebhookEvent, recordKlaviWebhookDebug,
  upsertTransactionsBatch, upsertCreditTransactionsBatch,
  upsertInvestments, upsertDebts, upsertDerivedDebts,
  softDeleteItem, markItemNotified, deduplicateKlaviTransactions,
} from '@/lib/storage-company';
import { getEmpresaByItem } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { mapKlaviReportToLocal, normalizeKlaviStatus, isKlaviConsentAuthorised, isKlaviConsentRejected, requestBusinessInstitutionData, requestPersonalInstitutionData, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';
import { enrichTransactionsWithCompanyName } from '@/lib/cnpj-enrichment';
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

function extractConsentMetadata(payload) {
  const consent = payload?.consent || payload?.data || payload;
  const institutionCode = consent?.institutionCode || consent?.institution_code || payload?.institutionCode || payload?.institution_code || null;
  const institutionName = consent?.institutionName || consent?.institution_name || payload?.institutionName || payload?.institution_name || null;
  const institutionLogo = consent?.institutionLogo || consent?.institution_logo || payload?.institutionLogo || payload?.institution_logo || null;
  return { institutionCode, institutionName, institutionLogo };
}

async function findLocalItem(pool, { linkId, consentId }) {
  if (consentId) {
    const item = await getItemByKlaviConsentId(pool, consentId, { includeDeleted: true });
    if (item) return item;
  }
  if (linkId) {
    const item = await getItemByKlaviLinkId(pool, linkId, { includeDeleted: true });
    if (item) return item;
  }
  return null;
}

async function persistReport(pool, localItem, payload) {
  const { report, productName, institutionCode } = extractReportMetadata(payload);
  if (!report || !productName) {
    console.warn('[klavi webhook] payload não reconhecido como relatório:', Object.keys(payload));
    return;
  }

  // Debug: mostra estrutura bruta das transações e contas recebidas.
  try {
    const checking = report?.checkingAccounts || [];
    const savings = report?.savingsAccounts || [];
    const creditCards = report?.creditCardAccounts || [];
    const altCreditCards = report?.creditCards || [];
    const checkingNumbers = checking.map(a => [a.branchCode, a.number, a.checkDigit].filter(Boolean).join('-')).filter(Boolean);
    const savingsNumbers = savings.map(a => [a.branchCode, a.number, a.checkDigit].filter(Boolean).join('-')).filter(Boolean);
    const creditNumbers = creditCards.map(a => [a.branchCode, a.number, a.checkDigit].filter(Boolean).join('-')).filter(Boolean);
    const altCreditNumbers = altCreditCards.map(a => a.identificationNumber || a.paymentMethods?.[0]?.identificationNumber || a.number).filter(Boolean);

    console.log('[klavi webhook] contas recebidas item=%s checking=%d(%j) savings=%d(%j) creditCard=%d(%j) creditCardsAlt=%d(%j)',
      localItem.id, checking.length, checkingNumbers, savings.length, savingsNumbers, creditCards.length, creditNumbers, altCreditCards.length, altCreditNumbers);

    const firstChecking = checking?.[0]?.transactionDetails?.[0];
    const firstCredit = creditCards?.[0]?.transactionDetails?.[0];
    console.log('[klavi webhook] sample checking tx keys:', firstChecking ? Object.keys(firstChecking) : 'n/a');
    console.log('[klavi webhook] sample credit tx keys:', firstCredit ? Object.keys(firstCredit) : 'n/a');
    if (firstChecking) console.log('[klavi webhook] sample checking tx:', JSON.stringify(firstChecking, null, 2).slice(0, 800));
    if (firstCredit) console.log('[klavi webhook] sample credit tx:', JSON.stringify(firstCredit, null, 2).slice(0, 800));
  } catch (e) {
    console.error('[klavi webhook] erro no log de debug:', e.message);
  }

  const institutionName = localItem?.institutionName || report?.checkingAccounts?.[0]?.brandName || report?.creditCardAccounts?.[0]?.brandName || 'Banco';
  const client = await getClientById(pool, localItem.clientId).catch(() => null);
  const clientName = client?.name || localItem?.clientName || null;
  const mapped = mapKlaviReportToLocal({ productName, report, institutionCode, institutionName });

  // Enriquece CNPJ da contraparte com razão social via API externa.
  await enrichTransactionsWithCompanyName(mapped.bankTransactions);
  await enrichTransactionsWithCompanyName(mapped.creditTransactions);

  const savedBank = mapped.bankTransactions.length
    ? await upsertTransactionsBatch(pool, localItem.clientId, clientName, localItem.id, mapped.bankTransactions)
    : 0;
  const savedCredit = mapped.creditTransactions.length
    ? await upsertCreditTransactionsBatch(pool, localItem.clientId, clientName, localItem.id, mapped.creditTransactions)
    : 0;
  const savedInv = mapped.investments.length
    ? await upsertInvestments(pool, localItem.clientId, localItem.id, mapped.investments)
    : 0;
  const savedDebts = mapped.debts.length
    ? await upsertDebts(pool, localItem.clientId, localItem.id, mapped.debts)
    : 0;
  await upsertDerivedDebts(pool, localItem.clientId).catch(() => {});

  // A Klavi/Open Finance pode gerar IDs diferentes para a mesma transação quando ela
  // muda de PROCESSANDO/PENDING para EFETIVADA/POSTED. Remove duplicatas conservadoramente.
  const dedup = await deduplicateKlaviTransactions(pool, localItem.clientId).catch(err => {
    console.error('[klavi webhook] erro ao deduplicar transações item=%s:', localItem.id, err.message);
    return { removedPending: 0, removedInstallments: 0 };
  });

  const persistedAccountNumbers = mapped.accounts.map(a => a.number).filter(Boolean);
  const uniqueAccountNumbers = [...new Set(persistedAccountNumbers)].join(', ');
  console.log('[klavi webhook] relatório persistido item=%s product=%s bank=%d credit=%d inv=%d debts=%d dedup=%j accounts=%j',
    localItem.id, productName, savedBank, savedCredit, savedInv, savedDebts, dedup, uniqueAccountNumbers || null);

  // Atualiza números de conta para exibição no portal.
  if (uniqueAccountNumbers) {
    await updateItemStatus(pool, localItem.id, { accountNumbers: uniqueAccountNumbers || null }).catch(() => {});
  }
}

async function updateItemStatusFromPayload(pool, localItem, payload) {
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

  await updateItemStatus(pool, localItem.id, updates);

  if (updates.requiresReconnect) {
    scheduleAsync(maybeNotifyReconnection(pool, localItem), `notify ${localItem.id}`);
  }
}

async function maybeNotifyReconnection(pool, localItem) {
  if (!localItem) return;
  const alreadyNotified = localItem.notificationSentAt &&
    new Date(localItem.notificationSentAt).getTime() > Date.now() - 24 * 60 * 60 * 1000;
  if (alreadyNotified) return;
  await markItemNotified(pool, localItem.id);
  const client = await getClientById(pool, localItem.clientId).catch(() => null);
  console.log('[klavi webhook] notificação de reconexão registrada para cliente=%s item=%s', client?.name || localItem.clientId, localItem.id);
}

async function requestReportAfterConsent(pool, localItem) {
  try {
    if (!localItem.institutionCode) {
      console.log('[klavi webhook] institutionCode ainda não disponível; não solicitando relatório agora item=%s', localItem.id);
      return;
    }
    const client = await getClientById(pool, localItem.clientId).catch(() => null);
    const businessTaxId = localItem.businessTaxId || client?.businessTaxId;
    const personalTaxId = localItem.personalTaxId || client?.personalTaxId;

    if (localItem.taxType === 'pf' && personalTaxId) {
      console.log('[klavi webhook] solicitando relatório PF após consent item=%s institution=%s', localItem.id, localItem.institutionCode);
      await requestPersonalInstitutionData({
        personalTaxId,
        institutionCode: localItem.institutionCode,
        linkId: localItem.klaviLinkId,
        consentIds: localItem.klaviConsentId ? [localItem.klaviConsentId] : [],
        products: DEFAULT_KLAVI_PRODUCTS,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      });
    } else if (businessTaxId) {
      console.log('[klavi webhook] solicitando relatório PJ após consent item=%s institution=%s', localItem.id, localItem.institutionCode);
      await requestBusinessInstitutionData({
        businessTaxId,
        institutionCode: localItem.institutionCode,
        linkId: localItem.klaviLinkId,
        consentIds: localItem.klaviConsentId ? [localItem.klaviConsentId] : [],
        products: DEFAULT_KLAVI_PRODUCTS,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      });
    } else {
      console.log('[klavi webhook] CPF/CNPJ não disponível para solicitar relatório item=%s', localItem.id);
      return;
    }

    await updateItemStatus(pool, localItem.id, { status: 'UPDATING' });
  } catch (err) {
    console.error('[klavi webhook] erro ao solicitar relatório após consent item=%s:', localItem.id, err.message, err.status, err.code);
  }
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

  // Resolve empresa pelo item identificado no webhook.
  const empresa = await getEmpresaByItem({ klaviLinkId: linkId, klaviConsentId: consentId });
  if (!empresa) {
    console.warn('[klavi webhook] não foi possível resolver empresa para linkId=%s consentId=%s', linkId, consentId);
    // Retorna 200 para não fazer a Klavi reenviar; mas não processamos.
    return NextResponse.json({ received: true, unresolved: true });
  }

  let pool;
  try {
    pool = await getCompanyPool(empresa);
  } catch (err) {
    console.error('[klavi webhook] erro ao conectar no pool da empresa %s:', empresa, err.message);
    return NextResponse.json({ error: 'Erro ao conectar no banco da empresa' }, { status: 500 });
  }

  // Salva payload bruto para debug (não afeta idempotência).
  await recordKlaviWebhookDebug(pool, { eventId, event, linkId, consentId, payload });

  // Payloads de teste de conectividade da Klavi costumam não ter event/eventId.
  // Aceitamos e retornamos 200 para não quebrar o teste.
  if (!event && !eventId) {
    console.log('[klavi webhook] payload de teste recebido (sem event/eventId)');
    return NextResponse.json({ received: true, test: true });
  }

  // Idempotência: ignora eventos já processados.
  if (eventId && await hasWebhookEvent(pool, eventId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  await recordWebhookEvent(pool, { eventId, event, itemId: linkId || consentId, payload });

  console.log('[klavi webhook] empresa=%s event=%s eventId=%s linkId=%s consentId=%s', empresa, event, eventId, linkId, consentId);

  const localItem = await findLocalItem(pool, { linkId, consentId });

  try {
    const eventLower = String(event || '').toLowerCase();

    if (eventLower.includes('consent')) {
      if (localItem) {
        // Atualiza instituição se vier no payload de consentimento (fluxo widget-first).
        const { institutionCode, institutionName, institutionLogo } = extractConsentMetadata(payload);
        if (institutionCode || institutionName) {
          const updates = {};
          if (institutionCode && !localItem.institutionCode) updates.institutionCode = institutionCode;
          if (institutionName && !localItem.institutionName) updates.institutionName = institutionName;
          if (institutionLogo && !localItem.institutionLogo) updates.institutionLogo = institutionLogo;
          if (Object.keys(updates).length > 0) {
            await updateItemStatus(pool, localItem.id, updates);
            console.log('[klavi webhook] item=%s atualizado com instituição: %j', localItem.id, updates);
          }
        }

        await updateItemStatusFromPayload(pool, localItem, payload);
        if (isKlaviConsentAuthorised(payload?.consentStatus || payload?.status)) {
          // Consentimento autorizado: solicitação de relatório já deve ter sido feita no callback.
          // Se o webhook vier com dados completos, persistimos.
          if (payload?.report || payload?.checkingAccounts || payload?.creditCardAccounts) {
            scheduleAsync(persistReport(pool, localItem, payload), `persistReport ${localItem.id}`);
          } else {
            // Evita itens presos em UPDATING quando o callback não conseguiu solicitar
            // (ex: institutionCode ainda não disponível na hora do redirect).
            scheduleAsync(requestReportAfterConsent(pool, localItem), `requestReportAfterConsent ${localItem.id}`);
          }
        }
        if (isKlaviConsentRejected(payload?.consentStatus || payload?.status)) {
          await updateItemStatus(pool, localItem.id, { requiresReconnect: true });
        }
      }
    } else if (eventLower.includes('report') || payload?.productName || payload?.report) {
      // Relatório pronto
      if (localItem) {
        scheduleAsync(
          (async () => {
            await persistReport(pool, localItem, payload);
            await updateItemStatusFromPayload(pool, localItem, payload);
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
