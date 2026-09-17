import { NextResponse } from 'next/server';
import {
  getClientById,
  listPlanoContas,
  seedPlanoContasIfEmpty,
  createPlanoConta,
} from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    await seedPlanoContasIfEmpty(pool, id);
    const plano = await listPlanoContas(pool, id);
    return NextResponse.json({ plano });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);

    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const body = await request.json();
    const conta = await createPlanoConta(pool, id, {
      nome: body.nome,
      parentId: body.parentId || null,
    });
    return NextResponse.json({ conta }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
