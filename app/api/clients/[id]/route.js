import { NextResponse } from 'next/server';
import { getClientById, updateClient, deleteClient } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { unregisterToken } from '@/lib/central-token-map';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const { id } = await params;
    const pool = await getCompanyPool(empresa);
    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    return NextResponse.json(client);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const { id } = await params;
    const updates = await request.json();
    const pool = await getCompanyPool(empresa);
    const updated = await updateClient(pool, id, updates);
    if (!updated) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const { id } = await params;
    const pool = await getCompanyPool(empresa);
    const client = await getClientById(pool, id);
    if (client?.portalToken) {
      try {
        await unregisterToken(client.portalToken);
      } catch (err) {
        console.error('[clients/delete] falha ao remover token do mapa central:', err.message);
      }
    }
    const ok = await deleteClient(pool, id);
    if (!ok) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
