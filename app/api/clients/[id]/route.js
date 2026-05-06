import { NextResponse } from 'next/server';
import { getClientById, updateClient, deleteClient } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { id } = await params;
  const client = getClientById(id);
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
  return NextResponse.json(client);
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const updated = updateClient(id, updates);
    if (!updated) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_, { params }) {
  const { id } = await params;
  const ok = deleteClient(id);
  if (!ok) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
  return NextResponse.json({ success: true });
}
