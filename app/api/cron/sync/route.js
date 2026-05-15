import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient,
  upsertTransactionsBatch, upsertCreditTransactionsBatch,
  upsertInvestments, upsertDebts, upsertDerivedDebts,
  hasTransactionsByItemId, updateItemInstitution,
} from '@/lib/storage';
import { getAllTransactions, getItem, getInvestments, getLoanAccounts, updatePluggyItem } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FIRST_LOAD_FROM = '2026-05-01';
const CONCURRENCY = 20;

async function processItem(client, item, sevenDaysAgo, to, fromOverride = null) {
  const firstLoad = !(await hasTransactionsByItemId(item.pluggyItemId));
  const from = fromOverride ?? (firstLoad ? FIRST_LOAD_FROM : sevenDaysAgo);

  const pluggyItem = await getItem(item.pluggyItemId).catch(() => null);
  const itemStatus = pluggyItem?.status ?? 'UNKNOWN';

  let institutionName = item.institutionName;
  if (!institutionName) {
    institutionName = pluggyItem?.connector?.name ?? null;
    if (institutionName) {
      await updateItemInstitution(item.id, institutionName, pluggyItem?.connector?.imageUrl ?? null).catch(() => {});
    }
  }

  if (!['UPDATED', 'PARTIAL_SUCCESS', 'UPDATING'].includes(itemStatus)) {
    return { client: client.name, bank: institutionName, status: 'skipped', reason: itemStatus };
  }

  const allTx = (await getAllTransactions(item.pluggyItemId, { from, to }))
    .map(tx => ({ ...tx, institutionName }));

  const bankTx   = allTx.filter(tx => tx.accountType !== 'CREDIT');
  const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

  const savedBank   = await upsertTransactionsBatch(client.id, item.pluggyItemId, bankTx);
  const savedCredit = await upsertCreditTransactionsBatch(client.id, item.pluggyItemId, creditTx);

  const investments  = await getInvestments(item.pluggyItemId).catch(() => []);
  const savedInv     = await upsertInvestments(client.id, item.pluggyItemId, investments);

  const loanAccounts = await getLoanAccounts(item.pluggyItemId).catch(() => []);
  const savedDebts   = await upsertDebts(client.id, item.pluggyItemId, loanAccounts);

  return {
    client: client.name, bank: institutionName, from, firstLoad,
    synced: { bank: savedBank, credit: savedCredit, investments: savedInv, debts: savedDebts },
    status: 'ok',
  };
}

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
  const filterItemId   = searchParams.get('itemId')   || null;
  const fromOverride   = searchParams.get('from')     || null;

  const to          = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  let clients = await getClients();
  if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

  // Mapear itens por cliente em paralelo
  const clientItemsMap = new Map();
  await Promise.all(clients.map(async c => {
    clientItemsMap.set(c.id, await getItemsByClientId(c.id));
  }));

  // Montar lista de trabalho (client, item)
  const work = [];
  for (const client of clients) {
    const items = clientItemsMap.get(client.id) ?? [];
    const filtered = filterItemId ? items.filter(i => i.pluggyItemId === filterItemId) : items;
    for (const item of filtered) work.push({ client, item });
  }

  // Disparar PATCH em todos os itens em paralelo
  await Promise.allSettled(work.map(({ item }) => updatePluggyItem(item.pluggyItemId)));
  await new Promise(r => setTimeout(r, 3000));

  // Processar em lotes paralelos de CONCURRENCY
  const results = [];
  for (let i = 0; i < work.length; i += CONCURRENCY) {
    const batch = work.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(({ client, item }) => processItem(client, item, sevenDaysAgo, to, fromOverride))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ status: 'error', message: r.reason?.message });
    }
  }

  // Pós-processamento por cliente em paralelo
  const syncedClientIds = [...new Set(work.map(({ client }) => client.id))];
  await Promise.allSettled(syncedClientIds.map(async clientId => {
    await upsertDerivedDebts(clientId);
    await updateClient(clientId, { lastSync: new Date().toISOString() });
  }));

  return NextResponse.json({ synced_at: new Date().toISOString(), results });
}
