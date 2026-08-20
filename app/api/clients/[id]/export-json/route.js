import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, getTransactionsByClientId } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '2025-01-01';
    const to = searchParams.get('to') || new Date().toISOString().split('T')[0];

    const transactions = await getTransactionsByClientId(pool, id, { from, to });
    const items = await getItemsByClientId(pool, id);
    const klaviItemIds = new Set(
      items.filter((i) => i.provider === 'klavi').map((i) => i.id)
    );

    const hasTime = (iso) => {
      const d = new Date(iso);
      return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
    };

    const rows = transactions.map((tx) => ({
      Data: new Date(tx.date).toLocaleDateString('pt-BR'),
      Hora: hasTime(tx.date)
        ? new Date(tx.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '',
      'Data/Hora UTC': hasTime(tx.date) ? new Date(tx.date).toISOString() : new Date(tx.date).toISOString().split('T')[0],
      Descrição: tx.description ?? '',
      Tipo: tx.type === 'CREDIT' ? 'Entrada' : 'Saída',
      'Valor (R$)': Number(tx.amount),
      Saldo:
        tx.balance != null
          ? Number(tx.balance)
          : klaviItemIds.has(tx.pluggyItemId)
            ? 'N/A (Klavi não informa saldo por transação)'
            : '',
      'Categoria L1': tx.categoryL1 ?? '',
      'Categoria L2': tx.categoryL2 ?? '',
      'Categoria L3': tx.categoryL3 ?? '',
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
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
