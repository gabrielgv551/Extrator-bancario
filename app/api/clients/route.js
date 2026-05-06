import { NextResponse } from 'next/server';
import { getClients, createClient } from '@/lib/storage';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET() {
  const clients = getClients();
  return NextResponse.json(clients);
}

export async function POST(request) {
  try {
    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 });
    }
    const client = createClient({ id: uuidv4(), name: name.trim() });
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
