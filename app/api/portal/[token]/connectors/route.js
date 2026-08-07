import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { getOpenFinanceConnectors } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const connectors = await getOpenFinanceConnectors();
    return NextResponse.json({ connectors });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
