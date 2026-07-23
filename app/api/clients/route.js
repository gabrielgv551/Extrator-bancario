import { NextResponse } from 'next/server';
import { getClients, createClient, generatePortalToken, getItemsByClientId } from '@/lib/storage';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const clients = await getClients();
    const enriched = await Promise.all(clients.map(async (client) => {
      const items = await getItemsByClientId(client.id);
      return { ...client, items };
    }));
    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, businessTaxId } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    }
    const rawCnpj = businessTaxId ? businessTaxId.replace(/\D/g, '') : '';
    if (rawCnpj && rawCnpj.length !== 14) {
      return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
    }
    const client = await createClient({ id: uuidv4(), name: name.trim(), portalToken: generatePortalToken(), businessTaxId: rawCnpj || null });
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
