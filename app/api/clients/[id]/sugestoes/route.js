import { NextResponse } from 'next/server';
import { getClientById, getTransactionsByClientId } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { garantirSchema, sugerirLote } from '@/lib/regras-classificacao';

export const dynamic = 'force-dynamic';

// GET /api/clients/[id]/sugestoes?from=YYYY-MM-DD&to=YYYY-MM-DD
// Retorna { sugestoes: { [transacaoId]: { l1, l2, confianca, origem } | null } }
// calculadas pelo motor de pré-classificação (regras da empresa + fallbacks).
export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    await garantirSchema(pool, empresa);
    const transactions = await getTransactionsByClientId(pool, id, { from, to });
    const lote = await sugerirLote(pool, empresa, transactions);

    const sugestoes = {};
    for (const [txId, sug] of lote.entries()) sugestoes[txId] = sug;
    return NextResponse.json({ sugestoes });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
