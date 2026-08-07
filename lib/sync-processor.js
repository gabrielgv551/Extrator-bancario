// Processamento de sincronização de dados Pluggy para o banco local.
// Reutilizável entre cron, webhooks e scripts standalone.
// Agora aceita um pool opcional para operar no banco da empresa.

import {
  upsertTransactionsBatch, upsertCreditTransactionsBatch,
  upsertInvestments, upsertDebts, upsertDerivedDebts,
  deleteOrphanTransactions, updateItemStatus, updateItemInstitution,
  createSyncLog, finishSyncLog,
  getClientById,
} from './storage-company.js';
import {
  getItem, getAllTransactions, getInvestments, getLoanAccounts,
} from './pluggy.js';
import { buildItemStatusUpdates, isItemHealthy } from './status.js';

const FIRST_LOAD_FROM = '2026-05-01';

function resolvePool(poolArg) {
  if (!poolArg) throw new Error('pool é obrigatorio para sync-processor');
  return poolArg;
}

export async function fetchAndPersistTransactions(pool, clientId, pluggyItemId, { from, to, createdAtFrom } = {}) {
  pool = resolvePool(pool);
  const client = await getClientById(pool, clientId);
  const clientName = client?.name ?? null;
  const pluggyItem = await getItem(pluggyItemId);
  const institutionName = pluggyItem?.connector?.name ?? null;

  const allTx = (await getAllTransactions(pluggyItemId, { from, to, createdAtFrom }))
    .map(tx => ({ ...tx, institutionName }));

  const bankTx = allTx.filter(tx => tx.accountType !== 'CREDIT');
  const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

  const savedBank = await upsertTransactionsBatch(pool, clientId, clientName, pluggyItemId, bankTx);
  const savedCredit = await upsertCreditTransactionsBatch(pool, clientId, clientName, pluggyItemId, creditTx);

  // Só remove órfãs quando fizemos uma busca por período completo (from/to),
  // não quando processamos apenas transações novas via createdAtFrom.
  if (from && to) {
    await deleteOrphanTransactions(pool, pluggyItemId, from, to, allTx.map(t => t.id)).catch(() => {});
  }

  const investments = await getInvestments(pluggyItemId).catch(() => []);
  const savedInv = await upsertInvestments(pool, clientId, pluggyItemId, investments);

  const loanAccounts = await getLoanAccounts(pluggyItemId).catch(() => []);
  const savedDebts = await upsertDebts(pool, clientId, pluggyItemId, loanAccounts);

  await upsertDerivedDebts(pool, clientId).catch(() => {});

  return {
    clientId,
    pluggyItemId,
    institutionName,
    transactions: { bank: savedBank, credit: savedCredit, total: savedBank + savedCredit },
    investments: savedInv,
    debts: savedDebts,
    pluggyItem,
  };
}

export async function syncItemData(localItem, { fromOverride = null, toOverride = null, skipIfNotHealthy = true, pool = null } = {}) {
  pool = resolvePool(pool);
  const logId = await createSyncLog(pool, { clientId: localItem.clientId, itemId: localItem.id });

  try {
    const pluggyItem = await getItem(localItem.pluggyItemId);
    const institutionName = pluggyItem?.connector?.name ?? localItem.institutionName ?? null;
    const institutionLogo = pluggyItem?.connector?.imageUrl ?? localItem.institutionLogo ?? null;

    if (institutionName && institutionName !== localItem.institutionName) {
      await updateItemInstitution(pool, localItem.id, institutionName, institutionLogo).catch(() => {});
    }

    const normStatus = buildItemStatusUpdates(pluggyItem);

    if (skipIfNotHealthy && !isItemHealthy(normStatus.status) && normStatus.status !== 'OUTDATED') {
      await updateItemStatus(pool, localItem.id, normStatus);
      await finishSyncLog(pool, logId, {
        status: normStatus.status === 'LOGIN_ERROR' ? 'login_error' : 'error',
        errorMessage: normStatus.errorMessage || normStatus.errorCode,
      });
      return {
        success: false,
        itemId: localItem.id,
        pluggyItemId: localItem.pluggyItemId,
        status: normStatus.status,
        reason: normStatus.errorMessage || normStatus.errorCode,
      };
    }

    const to = toOverride || new Date().toISOString().split('T')[0];
    const from = fromOverride || FIRST_LOAD_FROM;

    const result = await fetchAndPersistTransactions(pool, localItem.clientId, localItem.pluggyItemId, { from, to });

    await updateItemStatus(pool, localItem.id, normStatus);
    await finishSyncLog(pool, logId, {
      status: 'ok',
      transactionsCount: result.transactions.total,
    });

    return {
      success: true,
      itemId: localItem.id,
      pluggyItemId: localItem.pluggyItemId,
      status: normStatus.status,
      ...result,
    };
  } catch (err) {
    await updateItemStatus(pool, localItem.id, buildItemStatusUpdates(null, { forceError: false }));
    await finishSyncLog(pool, logId, { status: 'error', errorMessage: err.message });
    return {
      success: false,
      itemId: localItem.id,
      pluggyItemId: localItem.pluggyItemId,
      status: 'ERROR',
      reason: err.message,
    };
  }
}

export async function syncTransactionsFromCreatedLink(localItem, { accountId, createdAtFrom, pool = null } = {}) {
  pool = resolvePool(pool);
  // Processa webhook transactions/created de forma incremental.
  // Se accountId for informado, sincroniza apenas essa conta.
  const result = await fetchAndPersistTransactions(pool, localItem.clientId, localItem.pluggyItemId, { createdAtFrom });

  return {
    success: true,
    itemId: localItem.id,
    pluggyItemId: localItem.pluggyItemId,
    accountId: accountId || null,
    ...result,
  };
}
