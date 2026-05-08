import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient,
  upsertTransactions, upsertCreditTransactions, upsertInvestments, upsertDebts, upsertDerivedDebts,
  hasTransactionsByItemId, updateItemInstitution,
} from '@/lib/storage';
import { getAllTransactions, getItem, getInvestments, getLoanAccounts } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  const to = new Date().toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  let clients = await getClients();
  if (filterClientId) clients = clients.filter(c => c.id === filterClientId);
  const results = [];

  for (const client of clients) {
    const items = await getItemsByClientId(client.id);
    if (items.length === 0) continue;

    const filteredItems = filterItemId ? items.filter(i => i.pluggyItemId === filterItemId) : items;
    let totalSaved = 0;
    let hasError = false;
    for (const item of filteredItems) {
      try {
        const firstLoad = !(await hasTransactionsByItemId(item.pluggyItemId));
        const from = firstLoad ? '2026-01-01' : twoDaysAgo;

        let institutionName = item.institutionName;
        if (!institutionName) {
          const pluggyItem = await getItem(item.pluggyItemId).catch(() => null);
          institutionName = pluggyItem?.connector?.name ?? null;
          if (institutionName) {
            await updateItemInstitution(item.id, institutionName, pluggyItem?.connector?.imageUrl ?? null).catch(() => {});
          }
        }

        const allTx = (await getAllTransactions(item.pluggyItemId, { from, to }))
          .map(tx => ({ ...tx, institutionName }));

        const bankTx   = allTx.filter(tx => tx.accountType !== 'CREDIT');
        const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

        const savedBank   = await upsertTransactions(client.id, item.pluggyItemId, bankTx);
        const savedCredit = await upsertCreditTransactions(client.id, item.pluggyItemId, creditTx);

        const investments = await getInvestments(item.pluggyItemId).catch(() => []);
        const savedInv    = await upsertInvestments(client.id, item.pluggyItemId, investments);

        const loanAccounts = await getLoanAccounts(item.pluggyItemId).catch(() => []);
        const savedDebts   = await upsertDebts(client.id, item.pluggyItemId, loanAccounts);

        totalSaved += savedBank + savedCredit + savedInv + savedDebts;

        results.push({
          client: client.name, bank: item.institutionName, from, firstLoad,
          synced: { bank: savedBank, credit: savedCredit, investments: savedInv, debts: savedDebts },
          status: 'ok',
        });
      } catch (err) {
        hasError = true;
        results.push({ client: client.name, bank: item.institutionName, status: 'error', message: err.message });
      }
    }

    await upsertDerivedDebts(client.id).catch(() => {});
    if (!hasError) {
      await updateClient(client.id, { lastSync: new Date().toISOString() });
    }
  }

  return NextResponse.json({ synced_at: new Date().toISOString(), results });
}
