import { NextResponse } from 'next/server';
import { getClientById, getTransactionsByClientId } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getClientById(id);
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || '2025-01-01';
  const to = searchParams.get('to') || new Date().toISOString().split('T')[0];

  const transactions = await getTransactionsByClientId(id, { from, to });

  const rows = transactions.map((tx) => ({
    Data: new Date(tx.date).toLocaleDateString('pt-BR'),
    Descrição: tx.description ?? '',
    Tipo: tx.type === 'CREDIT' ? 'Entrada' : 'Saída',
    'Valor (R$)': Number(tx.amount),
    Saldo: tx.balance != null ? Number(tx.balance) : '',
    Categoria: tx.category ?? '',
    Conta: tx.accountName ?? '',
    Status: tx.status ?? '',
  }));

  return NextResponse.json({
    client: client.name,
    from,
    to,
    total: rows.length,
    rows,
  });
}
