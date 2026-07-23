import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient, updateItemStatus,
  acquireSyncLock, releaseSyncLock, refreshSyncLock,
} from '@/lib/storage';
import { requestBusinessInstitutionData } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_TTL_MINUTES = 30;

const DEFAULT_PRODUCTS = [
  'pj_checking_account',
  'pj_savings_account',
  'pj_credit_card',
  'pj_loans',
  'pj_financings',
  'pj_investments_bank_fixed_incomes',
  'pj_investments_credit_fixed_incomes',
  'pj_investments_variable_incomes',
  'pj_investments_funds',
];

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

  // Lock distribuído
  const lock = await acquireSyncLock('sync-cron', LOCK_TTL_MINUTES);
  if (!lock.acquired) {
    return NextResponse.json({ error: 'Sync já está em execução', existing: lock.existing }, { status: 423 });
  }

  try {
    let clients = await getClients();
    if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

    const clientItemsMap = new Map();
    await Promise.all(clients.map(async c => {
      clientItemsMap.set(c.id, await getItemsByClientId(c.id));
    }));

    const results = [];
    for (const client of clients) {
      const items = (clientItemsMap.get(client.id) ?? []).filter(i =>
        i.provider === 'klavi' || i.klaviLinkId
      );

      for (const item of items) {
        if (!item.klaviLinkId || !item.businessTaxId || !item.institutionCode) {
          results.push({
            client: client.name,
            bank: item.institutionName,
            success: false,
            reason: 'Item Klavi incompleto',
          });
          continue;
        }

        try {
          await requestBusinessInstitutionData({
            businessTaxId: item.businessTaxId,
            institutionCode: item.institutionCode,
            linkId: item.klaviLinkId,
            consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
            products: DEFAULT_PRODUCTS,
            productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
          });

          await updateItemStatus(item.id, { status: 'UPDATING' }).catch(() => {});

          results.push({
            client: client.name,
            bank: item.institutionName,
            success: true,
            status: 'REQUESTED',
          });
        } catch (err) {
          results.push({
            client: client.name,
            bank: item.institutionName,
            success: false,
            reason: err.message,
          });
        }

        await refreshSyncLock(lock.lockId).catch(() => {});
      }

      await updateClient(client.id, { lastSync: new Date().toISOString() }).catch(() => {});
    }

    return NextResponse.json({ synced_at: new Date().toISOString(), results });
  } finally {
    await releaseSyncLock(lock.lockId).catch(() => {});
  }
}
