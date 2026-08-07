import { NextResponse } from 'next/server';
import { getClients, createClient, generatePortalToken, getItemsByClientId } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { registerToken } from '@/lib/central-token-map';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const clients = await getClients(pool);
    const enriched = await Promise.all(clients.map(async (client) => {
      const items = await getItemsByClientId(pool, client.id);
      return { ...client, items };
    }));
    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const { name, businessTaxId } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    }
    const rawCnpj = businessTaxId ? businessTaxId.replace(/\D/g, '') : '';
    if (rawCnpj && rawCnpj.length !== 14) {
      return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
    }
    const pool = await getCompanyPool(empresa);
    const portalToken = generatePortalToken();
    const client = await createClient(pool, {
      id: uuidv4(),
      name: name.trim(),
      portalToken,
      businessTaxId: rawCnpj || null,
      gestorEmpresa: empresa,
    });
    try {
      await registerToken(portalToken, empresa, client.id);
    } catch (err) {
      console.error('[clients] falha ao registrar token no mapa central:', err.message);
    }
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
