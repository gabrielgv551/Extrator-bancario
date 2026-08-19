// Motor de sincronização multi-tenant do Extrator Bancário.
// Reutilizável entre a cron da Vercel, scripts standalone e jobs AWS Batch.
// Não depende de Next.js (somente de Node/pg + lógica de negócio).

import {
  getClients, getItemsByClientId, updateClient, updateItemStatus,
  acquireSyncLock, releaseSyncLock, refreshSyncLock,
} from './storage-company.js';
import { syncItemData } from './sync-processor.js';
import {
  requestBusinessInstitutionData, requestPersonalInstitutionData, getActiveKlaviConsent,
} from './klavi.js';

const DEFAULT_LOCK_TTL_MINUTES = 30;
const DEFAULT_CONCURRENCY = 5;

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  const executing = new Set();

  for (const [index, task] of tasks.entries()) {
    const promise = (async () => {
      try {
        return await task();
      } catch (err) {
        return { success: false, reason: err.message };
      }
    })().then(value => {
      results[index] = value;
      executing.delete(promise);
    });
    results[index] = null;
    executing.add(promise);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

async function syncLegacyPluggyItems({ empresa, pool, client, items, results, lockId }) {
  const legacyItems = items.filter(i => i.provider === 'pluggy' && i.pluggyItemId);

  for (const item of legacyItems) {
    const localItem = {
      id: item.id,
      clientId: item.clientId,
      pluggyItemId: item.pluggyItemId,
      institutionName: item.institutionName,
      institutionLogo: item.institutionLogo,
      accountNumbers: item.accountNumbers,
      status: item.status,
      executionStatus: item.executionStatus,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      lastUpdatedAt: item.lastUpdatedAt,
      lastErrorAt: item.lastErrorAt,
      syncCount: item.syncCount,
      consecutiveErrors: item.consecutiveErrors,
      requiresReconnect: item.requiresReconnect,
      deletedAt: item.deletedAt,
      consentExpiresAt: item.consentExpiresAt,
      notificationSentAt: item.notificationSentAt,
      createdAt: item.createdAt,
    };

    try {
      const result = await syncItemData(localItem, { skipIfNotHealthy: true, pool });
      results.push({
        empresa,
        client: client.name,
        bank: item.institutionName,
        success: result.success,
        status: result.status,
        transactions: result.transactions?.total ?? 0,
        reason: result.reason || null,
      });
    } catch (err) {
      console.error('[cron-sync] erro ao sincronizar item Pluggy empresa=%s cliente=%s item=%s:', empresa, client.name, item.id, err);
      results.push({
        empresa,
        client: client.name,
        bank: item.institutionName,
        success: false,
        reason: err.message,
      });
    }

    await refreshSyncLock(pool, lockId).catch(() => {});
  }
}

async function syncKlaviItems({ empresa, pool, client, items, results, lockId }) {
  const klaviItems = items.filter(i => i.provider === 'klavi' || i.klaviLinkId);

  for (const item of klaviItems) {
    const isPF = item.taxType === 'pf';
    const businessTaxId = item.businessTaxId || client.businessTaxId;

    if (!item.klaviLinkId || !item.institutionCode || (!isPF && !businessTaxId)) {
      results.push({
        empresa,
        client: client.name,
        bank: item.institutionName,
        success: false,
        reason: 'Item Klavi incompleto',
      });
      continue;
    }

    try {
      const activeConsent = await getActiveKlaviConsent({
        item,
        businessTaxId,
        personalTaxId: item.personalTaxId || undefined,
        pool,
        source: 'cron',
        clientId: client.id,
      });

      const consentUpdates = {};
      if (activeConsent.consentId && activeConsent.consentId !== item.klaviConsentId) consentUpdates.klaviConsentId = activeConsent.consentId;
      if (activeConsent.linkId && activeConsent.linkId !== item.klaviLinkId) consentUpdates.klaviLinkId = activeConsent.linkId;
      if (Object.keys(consentUpdates).length > 0) {
        await updateItemStatus(pool, item.id, consentUpdates);
        console.log('[cron-sync] empresa=%s item=%s atualizado com %j', empresa, item.id, consentUpdates);
      }

      if (!activeConsent.consentId) {
        results.push({
          empresa,
          client: client.name,
          bank: item.institutionName,
          success: false,
          reason: 'Nenhum consentimento ativo encontrado para este banco',
        });
        continue;
      }

      const requestBody = {
        institutionCode: item.institutionCode,
        linkId: activeConsent.linkId,
        consentIds: [activeConsent.consentId],
        products: activeConsent.products,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      };

      if (isPF) {
        if (!item.personalTaxId) {
          results.push({
            empresa,
            client: client.name,
            bank: item.institutionName,
            success: false,
            reason: 'CPF não encontrado para conta PF',
          });
          continue;
        }
        const logMeta = {
          pool,
          source: 'cron',
          clientId: client.id,
          itemId: item.id,
          linkId: activeConsent.linkId,
          consentId: activeConsent.consentId,
          personalTaxId: item.personalTaxId,
          institutionCode: item.institutionCode,
        };
        console.log('[cron-sync] solicitando dados Klavi PF empresa=%s cliente=%s item=%s body=%j', empresa, client.name, item.id, { ...requestBody, personalTaxId: item.personalTaxId });
        await requestPersonalInstitutionData({ ...requestBody, personalTaxId: item.personalTaxId }, logMeta);
      } else {
        const logMeta = {
          pool,
          source: 'cron',
          clientId: client.id,
          itemId: item.id,
          linkId: activeConsent.linkId,
          consentId: activeConsent.consentId,
          businessTaxId,
          institutionCode: item.institutionCode,
        };
        console.log('[cron-sync] solicitando dados Klavi PJ empresa=%s cliente=%s item=%s body=%j', empresa, client.name, item.id, { ...requestBody, businessTaxId });
        await requestBusinessInstitutionData({ ...requestBody, businessTaxId }, logMeta);
      }

      await updateItemStatus(pool, item.id, { status: 'UPDATING' }).catch(() => {});

      results.push({
        empresa,
        client: client.name,
        bank: item.institutionName,
        success: true,
        status: 'REQUESTED',
      });
    } catch (err) {
      console.error('[cron-sync] erro empresa=%s cliente=%s item=%s:', empresa, client.name, item.id, err);
      results.push({
        empresa,
        client: client.name,
        bank: item.institutionName,
        success: false,
        reason: err.message,
        klaviStatus: err.status,
        klaviCode: err.code,
      });
    }

    await refreshSyncLock(pool, lockId).catch(() => {});
  }
}

export async function syncCompany({ empresa, pool, filterClientId = null, lockId = null, lockTtlMinutes = DEFAULT_LOCK_TTL_MINUTES }) {
  const results = [];

  let clients = await getClients(pool);
  if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

  const clientItemsMap = new Map();
  await Promise.all(clients.map(async c => {
    clientItemsMap.set(c.id, await getItemsByClientId(pool, c.id));
  }));

  for (const client of clients) {
    const items = clientItemsMap.get(client.id) ?? [];

    // Klavi (Open Finance) — solicita relatórios via API; persistência via webhook.
    await syncKlaviItems({ empresa, pool, client, items, results, lockId });

    // Pluggy (legado) — busca e persiste transações diretamente.
    await syncLegacyPluggyItems({ empresa, pool, client, items, results, lockId });

    await updateClient(pool, client.id, { lastSync: new Date().toISOString() }).catch(() => {});
  }

  return { empresa, results };
}

export async function runMultiTenantSync({
  filterClientId = null,
  lockTtlMinutes = DEFAULT_LOCK_TTL_MINUTES,
  forEachCompany,
} = {}) {
  if (!forEachCompany) {
    throw new Error('forEachCompany é obrigatório para runMultiTenantSync');
  }

  return await forEachCompany(async ({ empresa, pool }) => {
    const lock = await acquireSyncLock(pool, `sync-cron-${empresa}`, lockTtlMinutes);
    if (!lock.acquired) {
      return { empresa, error: 'Sync já está em execução', existing: lock.existing };
    }

    try {
      return await syncCompany({ empresa, pool, filterClientId, lockId: lock.lockId, lockTtlMinutes });
    } finally {
      await releaseSyncLock(pool, lock.lockId).catch(() => {});
    }
  });
}
