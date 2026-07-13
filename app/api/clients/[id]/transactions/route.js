import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, getTransactionsByClientId, updateClient } from '@/lib/storage';
import { getItem } from '@/lib/pluggy';
import { buildItemStatusUpdates, isItemHealthy, requiresReconnectFromError } from '@/lib/status';

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
    const diagnostics = [];

    for (const item of items) {
      let pluggyItem = null;
      let status = item.status || 'UNKNOWN';
      let executionStatus = item.executionStatus || null;
      let errorCode = item.errorCode || null;
      let errorMessage = item.errorMessage || null;
      let lastUpdatedAt = item.lastUpdatedAt || null;

      try {
        pluggyItem = await getItem(item.pluggyItemId);
        const updates = buildItemStatusUpdates(pluggyItem);
        status = updates.status;
        executionStatus = updates.executionStatus;
        errorCode = updates.errorCode;
        errorMessage = updates.errorMessage;
        lastUpdatedAt = updates.lastUpdatedAt;
      } catch (err) {
        console.warn('[tx] falha ao buscar status do item na Pluggy:', err.message);
      }

      const requiresReconnect = requiresReconnectFromError(errorCode) || status === 'LOGIN_ERROR';
      diagnostics.push({
        bank: item.institutionName,
        status,
        executionStatus,
        errorCode,
        errorMessage,
        lastUpdatedAt,
        requiresReconnect,
        isHealthy: isItemHealthy(status),
      });
    }

    const transactions = await getTransactionsByClientId(id, { from, to });
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ transactions, total: transactions.length, diagnostics });
  } catch (error) {
    console.error('[transactions] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
