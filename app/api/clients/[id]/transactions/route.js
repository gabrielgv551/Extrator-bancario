import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, upsertTransactions, upsertCreditTransactions, upsertDebts, upsertDerivedDebts, updateItemInstitution, deleteOrphanTransactions } from '@/lib/storage';
import { getAllTransactions, getItem, getAccounts, getLoanAccounts } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  console.log('[tx] iniciando id=%s from=%s to=%s', id, from, to);
  try {
    const client = await getClientById(id);
    console.log('[tx] client:', client?.id ?? 'não encontrado');
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    console.log('[tx] items:', items.length);
    if (items.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta bancária conectada' }, { status: 400 });
    }
    const allTx = [];
    const diagnostics = [];

    for (const item of items) {
      console.log('[tx] item pluggyId:', item.pluggyItemId);
      const pluggyItem = await getItem(item.pluggyItemId).catch(() => null);
      console.log('[tx] pluggyItem status:', pluggyItem?.status);
      const itemStatus = pluggyItem?.status ?? 'UNKNOWN';
      const lastUpdatedAt = pluggyItem?.lastUpdatedAt ?? null;
      const accounts = await getAccounts(item.pluggyItemId).catch(() => []);

      const institutionName = item.institutionName ?? pluggyItem?.connector?.name ?? null;
      if (!item.institutionName && institutionName) {
        await updateItemInstitution(item.id, institutionName, pluggyItem?.connector?.imageUrl ?? null).catch(() => {});
      }

      const connectorProducts = pluggyItem?.connector?.products ?? [];
      const connectorName     = pluggyItem?.connector?.name ?? institutionName;

      if (itemStatus !== 'UPDATED' && itemStatus !== 'PARTIAL_SUCCESS') {
        diagnostics.push({
          bank: institutionName, status: itemStatus, lastUpdatedAt,
          accounts: 0, transactions: 0,
          connectorProducts,
        });
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
        bank: institutionName, status: itemStatus, lastUpdatedAt,
        accounts: accounts.length, transactions: txs.length,
        accountTypes: allAccountTypes,
        loanAccountsFound: loanAccounts.map(a => ({ name: a.name, type: a.type, subtype: a.subtype })),
        connectorProducts,
        byMonth,
      });
    }

    await upsertDerivedDebts(id);
    allTx.sort((a, b) => new Date(b.date) - new Date(a.date));
    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ transactions: allTx, total: allTx.length, diagnostics });
  } catch (error) {
    console.error('[transactions] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
