import { getClientById, getItemsByClientId, getTransactionsByClientId } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) return new Response('Cliente não encontrado', { status: 404 });

  const items = await getItemsByClientId(id);
  if (items.length === 0) return new Response('Nenhuma conta bancária conectada', { status: 400 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  try {
    const transactions = await getTransactionsByClientId(id, { from, to });

    const header = 'ID,Data,Descrição,Tipo,Valor (R$),Saldo,Categoria,Conta,Tipo de Conta,Banco,Razão Social,Origem,Status\n';
    const rows = transactions
      .map((tx) =>
        [
          tx.id,
          new Date(tx.date).toLocaleDateString('pt-BR'),
          `"${(tx.description || '').replace(/"/g, '""')}"`,
          tx.type === 'CREDIT' ? 'Entrada' : 'Saída',
          tx.amount,
          tx.balance ?? '',
          tx.category ?? '',
          `"${(tx.accountName || '').replace(/"/g, '""')}"`,
          tx.accountType ?? '',
          `"${(tx.institutionName || '').replace(/"/g, '""')}"`,
          `"${(tx.counterpartyName || '').replace(/"/g, '""')}"`,
          tx.source === 'credit' ? 'Cartão de Crédito' : 'Conta Bancária',
          tx.status,
        ].join(',')
      )
      .join('\n');

    const csv = '\ufeff' + header + rows;
    const safeName = client.name.replace(/[^a-zA-Z0-9\u00C0-\u024F ]/g, '_');
    const filename = `${safeName}_${from || 'historico'}_${to || 'atual'}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}
