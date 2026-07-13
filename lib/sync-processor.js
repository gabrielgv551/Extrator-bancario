// Processamento de sincronização de dados Pluggy para o banco local.
// Reutilizável entre cron, webhooks e scripts standalone.

import {
  upsertTransactionsBatch, upsertCreditTransactionsBatch,
  upsertInvestments, upsertDebts, upsertDerivedDebts,
  deleteOrphanTransactions, updateItemStatus, updateItemInstitution,
  createSyncLog, finishSyncLog,
} from './storage.js';
import {
  getItem, getAllTransactions, getInvestments, getLoanAccounts,
} from './pluggy.js';
import { buildItemStatusUpdates, isItemHealthy } from './status.js';

const FIRST_LOAD_FROM = '2026-05-01';

export async function fetchAndPersistTransactions(clientId, pluggyItemId, { from, to, createdAtFrom } = {}) {
  const pluggyItem = await getItem(pluggyItemId);
  const institutionName = pluggyItem?.connector?.name ?? null;

  const allTx = (await getAllTransactions(pluggyItemId, { from, to, createdAtFrom }))
    .map(tx => ({ ...tx, institutionName }));

  const bankTx = allTx.filter(tx => tx.accountType !== 'CREDIT');
  const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

  const savedBank = await upsertTransactionsBatch(clientId, pluggyItemId, bankTx);
  const savedCredit = await upsertCreditTransactionsBatch(clientId, pluggyItemId, creditTx);

  // Só remove órfãs quando fizemos uma busca por período completo (from/to),
  // não quando processamos apenas transações novas via createdAtFrom.
  if (from && to) {
    await deleteOrphanTransactions(pluggyItemId, from, to, allTx.map(t => t.id)).catch(() => {});
  }

  const investments = await getInvestments(pluggyItemId).catch(() => []);
  const savedInv = await upsertInvestments(clientId, pluggyItemId, investments);

  const loanAccounts = await getLoanAccounts(pluggyItemId).catch(() => []);
  const savedDebts = await upsertDebts(clientId, pluggyItemId, loanAccounts);

  await upsertDerivedDebts(clientId).catch(() => {});

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

export async function syncItemData(localItem, { fromOverride = null, toOverride = null, skipIfNotHealthy = true } = {}) {
  const logId = await createSyncLog({ clientId: localItem.clientId, itemId: localItem.id });

  try {
    const pluggyItem = await getItem(localItem.pluggyItemId);
    const institutionName = pluggyItem?.connector?.name ?? localItem.institutionName ?? null;
    const institutionLogo = pluggyItem?.connector?.imageUrl ?? localItem.institutionLogo ?? null;

    if (institutionName && institutionName !== localItem.institutionName) {
      await updateItemInstitution(localItem.id, institutionName, institutionLogo).catch(() => {});
    }

    const normStatus = buildItemStatusUpdates(pluggyItem);

    if (skipIfNotHealthy && !isItemHealthy(normStatus.status) && normStatus.status !== 'OUTDATED') {
      await updateItemStatus(localItem.id, normStatus);
      await finishSyncLog(logId, {
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

    const result = await fetchAndPersistTransactions(localItem.clientId, localItem.pluggyItemId, { from, to });

    await updateItemStatus(localItem.id, normStatus);
    await finishSyncLog(logId, {
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
    await updateItemStatus(localItem.id, buildItemStatusUpdates(null, { forceError: false }));
    await finishSyncLog(logId, { status: 'error', errorMessage: err.message });
    return {
      success: false,
      itemId: localItem.id,
      pluggyItemId: localItem.pluggyItemId,
      status: 'ERROR',
      reason: err.message,
    };
  }
}

export async function syncTransactionsFromCreatedLink(localItem, { accountId, createdAtFrom } = {}) {
  // Processa webhook transactions/created de forma incremental.
  // Se accountId for informado, sincroniza apenas essa conta.
  const result = await fetchAndPersistTransactions(localItem.clientId, localItem.pluggyItemId, { createdAtFrom });

  return {
    success: true,
    itemId: localItem.id,
    pluggyItemId: localItem.pluggyItemId,
    accountId: accountId || null,
    ...result,
  };
}
