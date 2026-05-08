import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, upsertTransactions, upsertCreditTransactions, upsertDebts, updateItemInstitution, deleteOrphanTransactions } from '@/lib/storage';
import { getAllTransactions, getItem, getAccounts, getLoanAccounts } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    if (items.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta bancária conectada' }, { status: 400 });
    }
    const allTx = [];
    const diagnostics = [];

    for (const item of items) {
      const pluggyItem = await getItem(item.pluggyItemId).catch(() => null);
      const itemStatus = pluggyItem?.status ?? 'UNKNOWN';
      const accounts = await getAccounts(item.pluggyItemId).catch(() => []);

      const institutionName = item.institutionName ?? pluggyItem?.connector?.name ?? null;
      if (!item.institutionName && institutionName) {
        await updateItemInstitution(item.id, institutionName, pluggyItem?.connector?.imageUrl ?? null).catch(() => {});
      }

      if (itemStatus !== 'UPDATED' && itemStatus !== 'PARTIAL_SUCCESS') {
        diagnostics.push({ bank: institutionName, status: itemStatus, accounts: 0, transactions: 0 });
        continue;
      }

      const txs = (await getAllTransactions(item.pluggyItemId, { from, to }))
        .map(tx => ({ ...tx, institutionName }));
      const bankTx   = txs.filter(tx => tx.accountType !== 'CREDIT');
      const creditTx = txs.filter(tx => tx.accountType === 'CREDIT');
      await upsertTransactions(id, item.pluggyItemId, bankTx);
      await upsertCreditTransactions(id, item.pluggyItemId, creditTx);
      await deleteOrphanTransactions(item.pluggyItemId, from, to, txs.map(t => t.id)).catch(() => {});
      const loanAccounts = await getLoanAccounts(item.pluggyItemId).catch(() => []);
      await upsertDebts(id, item.pluggyItemId, loanAccounts).catch(() => {});
      allTx.push(...txs);
      const byMonth = txs.reduce((acc, t) => {
        const m = t.date?.slice(0, 7) ?? 'unknown';
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      }, {});
      const allAccountTypes = accounts.map(a => ({ name: a.name, type: a.type, subtype: a.subtype }));
      diagnostics.push({
        bank: institutionName, status: itemStatus,
        accounts: accounts.length, transactions: txs.length,
        accountTypes: allAccountTypes,
        loanAccountsFound: loanAccounts.map(a => ({ name: a.name, type: a.type, subtype: a.subtype })),
        byMonth,
      });
    }

    allTx.sort((a, b) => new Date(b.date) - new Date(a.date));
    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ transactions: allTx, total: allTx.length, diagnostics });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
