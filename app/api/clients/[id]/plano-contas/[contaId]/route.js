import { NextResponse } from 'next/server';
import {
  getClientById,
  updatePlanoConta,
  deletePlanoConta,
} from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const { id, contaId } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const body = await request.json();
    const conta = await updatePlanoConta(pool, id, contaId, {
      nome: body.nome,
      ativo: body.ativo,
    });
    if (!conta) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

    return NextResponse.json({ conta });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id, contaId } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const removed = await deletePlanoConta(pool, id, contaId);
    if (!removed) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
