import { NextResponse } from 'next/server';
import { getClientById, updateTransactionClassification } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { isValidClassificacao } from '@/lib/classification';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const { id, txId } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const body = await request.json();
    const classificacaoL1 = body.classificacaoL1 ?? null;
    const classificacaoL2 = body.classificacaoL2 ?? null;

    if (!isValidClassificacao(classificacaoL1, classificacaoL2)) {
      return NextResponse.json(
        { error: 'Classificação inválida. Use os grupos Receita/Despesa e uma categoria da lista.' },
        { status: 400 }
      );
    }

    const updated = await updateTransactionClassification(pool, id, txId, classificacaoL1, classificacaoL2);
    if (!updated) {
      return NextResponse.json({ error: 'Transação não encontrada para este cliente' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
