import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient } from '@/lib/storage';
import { getAllTransactions } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(id);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Nenhuma conta bancária conectada' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  try {
    const allTx = [];
    for (const item of items) {
      const txs = await getAllTransactions(item.pluggyItemId, { from, to });
      allTx.push(...txs);
    }
    allTx.sort((a, b) => new Date(b.date) - new Date(a.date));
    await updateClient(id, { lastSync: new Date().toISOString() });
    return NextResponse.json({ transactions: allTx, total: allTx.length });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
