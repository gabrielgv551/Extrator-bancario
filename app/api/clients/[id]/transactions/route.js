import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, getTransactionsByClientId, updateClient } from '@/lib/storage';
import { isItemHealthy } from '@/lib/status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  console.log('[tx] buscando transações locais id=%s from=%s to=%s', id, from, to);
  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    const diagnostics = items.map(item => ({
      bank: item.institutionName,
      status: item.status || 'PENDING',
      executionStatus: item.executionStatus || null,
      errorCode: item.errorCode || null,
      errorMessage: item.errorMessage || null,
      lastUpdatedAt: item.lastUpdatedAt || null,
      requiresReconnect: item.requiresReconnect || item.status === 'LOGIN_ERROR',
      isHealthy: isItemHealthy(item.status),
      provider: item.provider || 'pluggy',
    }));

    const transactions = await getTransactionsByClientId(id, { from, to });
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ transactions, total: transactions.length, diagnostics });
  } catch (error) {
    console.error('[transactions] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
