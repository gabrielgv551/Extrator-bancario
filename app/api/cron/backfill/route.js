import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient,
  upsertTransactions, upsertCreditTransactions,
} from '@/lib/storage';
import { getAllTransactions } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || '2025-01-01';
  const to   = searchParams.get('to')   || new Date().toISOString().split('T')[0];
  const filterClientId = searchParams.get('clientId') || null;

  let clients = await getClients();
  if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

  const results = [];

  for (const client of clients) {
    const items = await getItemsByClientId(client.id);
    if (items.length === 0) continue;

    for (const item of items) {
      try {
        const allTx = (await getAllTransactions(item.pluggyItemId, { from, to }))
          .map(tx => ({ ...tx, institutionName: item.institutionName ?? null }));

        const bankTx   = allTx.filter(tx => tx.accountType !== 'CREDIT');
        const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

        const savedBank   = await upsertTransactions(client.id, item.pluggyItemId, bankTx);
        const savedCredit = await upsertCreditTransactions(client.id, item.pluggyItemId, creditTx);

        results.push({
          client: client.name,
          bank: item.institutionName,
          from, to,
          synced: { bank: savedBank, credit: savedCredit },
          status: 'ok',
        });
      } catch (err) {
        results.push({ client: client.name, bank: item.institutionName, status: 'error', message: err.message });
      }
    }

    await updateClient(client.id, { lastSync: new Date().toISOString() });
  }

  return NextResponse.json({ synced_at: new Date().toISOString(), results });
}
