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

    const fmtDoc = (doc) => {
      if (!doc) return '';
      if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      return doc;
    };

    const header = 'ID,Data Lançamento,Data Transação,Descrição,Tipo,Valor (R$),Saldo,Categoria,Conta,Agência/Número,Tipo de Conta,Banco,Razão Social,CNPJ/CPF,Origem,Status\n';
    const rows = transactions
      .map((tx) =>
        [
          tx.id,
          new Date(tx.date).toLocaleDateString('pt-BR'),
          tx.dateTransacted ? new Date(tx.dateTransacted).toLocaleDateString('pt-BR') : '',
          `"${(tx.description || '').replace(/"/g, '""')}"`,
          tx.type === 'CREDIT' ? 'Entrada' : 'Saída',
          tx.amount,
          tx.balance ?? '',
          tx.category ?? '',
          `"${(tx.accountName || '').replace(/"/g, '""')}"`,
          `"${(tx.accountNumber || '').replace(/"/g, '""')}"`,
          tx.accountType ?? '',
          `"${(tx.institutionName || '').replace(/"/g, '""')}"`,
          `"${(tx.counterpartyName || '').replace(/"/g, '""')}"`,
          fmtDoc(tx.counterpartyDocument),
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
