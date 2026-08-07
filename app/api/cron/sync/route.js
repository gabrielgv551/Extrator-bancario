import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient, updateItemStatus,
  acquireSyncLock, releaseSyncLock, refreshSyncLock,
} from '@/lib/storage-company';
import { forEachCompany } from '@/lib/company-db';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getActiveKlaviConsent } from '@/lib/klavi';
import { syncItemData } from '@/lib/sync-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_TTL_MINUTES = 30;

export async function GET(request) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const hasSecret = secret && authHeader === `Bearer ${secret}`;
  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterClientId = searchParams.get('clientId') || null;

  const companyResults = await forEachCompany(async ({ empresa, pool }) => {
    // Lock distribuído por empresa
    const lock = await acquireSyncLock(pool, `sync-cron-${empresa}`, LOCK_TTL_MINUTES);
    if (!lock.acquired) {
      return { empresa, error: 'Sync já está em execução', existing: lock.existing };
    }

    try {
      let clients = await getClients(pool);
      if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

      const clientItemsMap = new Map();
      await Promise.all(clients.map(async c => {
        clientItemsMap.set(c.id, await getItemsByClientId(pool, c.id));
      }));

      const results = [];
      for (const client of clients) {
        const items = (clientItemsMap.get(client.id) ?? []).filter(i =>
          i.provider === 'klavi' || i.klaviLinkId
        );

        for (const item of items) {
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
            });

            // Mantém item local sincronizado com o consentimento/link ativo.
            const consentUpdates = {};
            if (activeConsent.consentId && activeConsent.consentId !== item.klaviConsentId) consentUpdates.klaviConsentId = activeConsent.consentId;
            if (activeConsent.linkId && activeConsent.linkId !== item.klaviLinkId) consentUpdates.klaviLinkId = activeConsent.linkId;
            if (Object.keys(consentUpdates).length > 0) {
              await updateItemStatus(pool, item.id, consentUpdates);
              console.log('[cron/sync] empresa=%s item=%s atualizado com %j', empresa, item.id, consentUpdates);
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
              console.log('[cron/sync] solicitando dados Klavi PF empresa=%s cliente=%s item=%s body=%j', empresa, client.name, item.id, { ...requestBody, personalTaxId: item.personalTaxId });
              await requestPersonalInstitutionData({ ...requestBody, personalTaxId: item.personalTaxId });
            } else {
              console.log('[cron/sync] solicitando dados Klavi PJ empresa=%s cliente=%s item=%s body=%j', empresa, client.name, item.id, { ...requestBody, businessTaxId });
              await requestBusinessInstitutionData({ ...requestBody, businessTaxId });
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
            console.error('[cron/sync] erro empresa=%s cliente=%s item=%s:', empresa, client.name, item.id, err);
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

          await refreshSyncLock(pool, lock.lockId).catch(() => {});
        }

        // Itens legados Pluggy também são sincronizados (se houver pluggyItemId).
        const legacyItems = (clientItemsMap.get(client.id) ?? []).filter(i =>
          i.provider === 'pluggy' && i.pluggyItemId
        );
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
            console.error('[cron/sync] erro ao sincronizar item Pluggy empresa=%s cliente=%s item=%s:', empresa, client.name, item.id, err);
            results.push({
              empresa,
              client: client.name,
              bank: item.institutionName,
              success: false,
              reason: err.message,
            });
          }
          await refreshSyncLock(pool, lock.lockId).catch(() => {});
        }

        await updateClient(pool, client.id, { lastSync: new Date().toISOString() }).catch(() => {});
      }

      return { empresa, results };
    } finally {
      await releaseSyncLock(pool, lock.lockId).catch(() => {});
    }
  });

  return NextResponse.json({ synced_at: new Date().toISOString(), companies: companyResults });
}
