import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(pool, client.id);
  return NextResponse.json({ client: { id: client.id, name: client.name, businessTaxId: client.businessTaxId }, items });
}
