import { NextResponse } from 'next/server';
import { getClientById, updateClient } from '@/lib/storage';
import { getAllTransactions } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const client = getClientById(id);
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
  if (!client.itemId) {
    return NextResponse.json({ error: 'Conta bancária não conectada' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  try {
    const transactions = await getAllTransactions(client.itemId, { from, to });
    updateClient(id, { lastSync: new Date().toISOString() });
    return NextResponse.json({ transactions, total: transactions.length });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
