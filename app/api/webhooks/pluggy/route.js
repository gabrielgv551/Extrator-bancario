import { NextResponse } from 'next/server';
import {
  getItemByPluggyId, updateItemStatus, recordWebhookEvent, hasWebhookEvent,
  softDeleteItem, markItemNotified, getClientById, deleteTransactionsByIds,
} from '@/lib/storage-company';
import { getEmpresaByItem } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { getItem } from '@/lib/pluggy';
import { buildItemStatusUpdates, isItemHealthy } from '@/lib/status';
import { syncItemData, syncTransactionsFromCreatedLink } from '@/lib/sync-processor';

export const dynamic = 'force-dynamic';

const PLUGGY_WEBHOOK_IP = '52.67.145.81';

function isAuthorized(request) {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET || process.env.CRON_SECRET;
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const remoteIp = forwardedFor.split(',')[0].trim();

  // Se a requisição vem do IP oficial da Pluggy, autoriza mesmo sem secret.
  // Webhooks configurados no nível da aplicação (dashboard) nem sempre enviam secret.
  if (remoteIp === PLUGGY_WEBHOOK_IP) return true;

  if (!secret) return false;
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const pluggySecret = request.headers.get('x-pluggy-secret') || '';
  return pluggySecret === secret;
}

async function persistItemStatusByPluggyId(pool, pluggyItemId, pluggyItem, { forceError = false } = {}) {
  const localItem = await getItemByPluggyId(pool, pluggyItemId);
  if (!localItem) return null;
  const updates = buildItemStatusUpdates(pluggyItem, { forceError });
  await updateItemStatus(pool, localItem.id, updates);
  return localItem;
}

function scheduleAsync(promise, label) {
  // Fire-and-forget: responde o webhook imediatamente e processa em background.
  promise.catch(err => console.error(`[webhook] erro em ${label}:`, err));
}

async function handleItemUpdated(pool, itemId) {
  let pluggyItem;
  try {
    pluggyItem = await getItem(itemId);
  } catch (err) {
    console.warn('[webhook] não foi possível buscar item atualizado:', err.message);
    return;
  }

  const localItem = await persistItemStatusByPluggyId(pool, itemId, pluggyItem);
  if (!localItem) return;

  if (isItemHealthy(pluggyItem?.status)) {
    // Sincroniza dados em background após item/updated de sucesso.
    scheduleAsync(syncItemData(localItem, { skipIfNotHealthy: true, pool }), `syncItemData ${itemId}`);
  }
}

async function handleItemDeleted(pool, itemId) {
  const localItem = await getItemByPluggyId(pool, itemId, { includeDeleted: true });
  if (localItem && !localItem.deletedAt) {
    await softDeleteItem(pool, localItem.id);
    console.log('[webhook] item marcado como deletado localmente:', itemId);
  }
}

async function handleTransactionsCreated(pool, itemId, payload) {
  const localItem = await getItemByPluggyId(pool, itemId);
  if (!localItem) return;

  // Sempre atualiza o status do item para garantir consistência.
  let pluggyItem;
  try {
    pluggyItem = await getItem(itemId);
    await updateItemStatus(pool, localItem.id, buildItemStatusUpdates(pluggyItem));
  } catch (err) {
    console.warn('[webhook] falha ao buscar item para transactions/created:', err.message);
  }

  if (payload.createdTransactionsLink || payload.createdAtFrom) {
    scheduleAsync(
      syncTransactionsFromCreatedLink(localItem, {
        accountId: payload.accountId || null,
        createdAtFrom: payload.createdAtFrom || null,
        pool,
      }),
      `syncTransactionsFromCreatedLink ${itemId}`
    );
  }
}

async function handleTransactionsUpdated(pool, itemId, payload) {
  const localItem = await getItemByPluggyId(pool, itemId);
  if (!localItem) return;

  // Para transações atualizadas, fazemos um sync curto dos últimos 7 dias.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to = new Date().toISOString().split('T')[0];

  scheduleAsync(
    syncItemData(localItem, { fromOverride: sevenDaysAgo, toOverride: to, skipIfNotHealthy: true, pool }),
    `syncItemData updated ${itemId}`
  );
}

async function handleTransactionsDeleted(pool, itemId, payload) {
  const transactionIds = payload.transactionIds;
  if (!Array.isArray(transactionIds) || transactionIds.length === 0) return;
  // A função deleteTransactionsByIds já remove de transactions e credit_transactions.
  await deleteTransactionsByIds(pool, transactionIds);
  console.log('[webhook] transações removidas:', transactionIds.length);
}

async function maybeNotifyReconnection(pool, localItem) {
  if (!localItem) return;
  const alreadyNotified = localItem.notificationSentAt &&
    new Date(localItem.notificationSentAt).getTime() > Date.now() - 24 * 60 * 60 * 1000;
  if (alreadyNotified) return;

  // Aqui pode ser inserido envio real de e-mail/SMS/WhatsApp no futuro.
  // Por enquanto, marcamos que a notificação foi "enviada" para evitar spam.
  await markItemNotified(pool, localItem.id);

  const client = await getClientById(pool, localItem.clientId).catch(() => null);
  console.log('[webhook] notificação de reconexão registrada para cliente=%s item=%s', client?.name || localItem.clientId, localItem.pluggyItemId);
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const event = payload.event;
  const itemId = payload.itemId;
  const eventId = payload.eventId;

  if (!event || !itemId) {
    return NextResponse.json({ error: 'event/itemId obrigatórios' }, { status: 400 });
  }

  // Resolve empresa pelo pluggy_item_id.
  const empresa = await getEmpresaByItem({ pluggyItemId: itemId });
  if (!empresa) {
    console.warn('[webhook] não foi possível resolver empresa para pluggyItemId=%s', itemId);
    return NextResponse.json({ received: true, unresolved: true });
  }

  let pool;
  try {
    pool = await getCompanyPool(empresa);
  } catch (err) {
    console.error('[webhook] erro ao conectar no pool da empresa %s:', empresa, err.message);
    return NextResponse.json({ error: 'Erro ao conectar no banco da empresa' }, { status: 500 });
  }

  // Idempotência: ignora eventos já processados.
  if (eventId && await hasWebhookEvent(pool, eventId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  await recordWebhookEvent(pool, { eventId, event, itemId, payload });

  console.log('[webhook] empresa=%s event=%s itemId=%s eventId=%s', empresa, event, itemId, eventId);

  try {
    switch (event) {
      case 'item/created':
      case 'item/login_succeeded': {
        const pluggyItem = await getItem(itemId).catch(() => null);
        await persistItemStatusByPluggyId(pool, itemId, pluggyItem);
        break;
      }
      case 'item/updated': {
        scheduleAsync(handleItemUpdated(pool, itemId), `item/updated ${itemId}`);
        break;
      }
      case 'item/error':
      case 'item/login_error': {
        const localItem = await persistItemStatusByPluggyId(pool, itemId, null, { forceError: true });
        if (localItem) {
          scheduleAsync(maybeNotifyReconnection(pool, localItem), `notify ${itemId}`);
        }
        break;
      }
      case 'item/waiting_user_input':
      case 'item/waiting_user_action': {
        const pluggyItem = await getItem(itemId).catch(() => null);
        const localItem = await persistItemStatusByPluggyId(pool, itemId, pluggyItem);
        if (localItem) {
          scheduleAsync(maybeNotifyReconnection(pool, localItem), `notify waiting ${itemId}`);
        }
        break;
      }
      case 'item/deleted': {
        await handleItemDeleted(pool, itemId);
        break;
      }
      case 'transactions/created': {
        scheduleAsync(handleTransactionsCreated(pool, itemId, payload), `transactions/created ${itemId}`);
        break;
      }
      case 'transactions/updated': {
        scheduleAsync(handleTransactionsUpdated(pool, itemId, payload), `transactions/updated ${itemId}`);
        break;
      }
      case 'transactions/deleted': {
        scheduleAsync(handleTransactionsDeleted(pool, itemId, payload), `transactions/deleted ${itemId}`);
        break;
      }
      case 'connector/status_updated': {
        console.log('[webhook] connector %s status %s', payload.connectorId, payload.data?.status);
        break;
      }
      default:
        console.log('[webhook] evento não tratado:', event);
    }
  } catch (err) {
    console.error('[webhook] erro ao processar:', err);
  }

  return NextResponse.json({ received: true });
}
