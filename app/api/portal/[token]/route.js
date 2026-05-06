import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(client.id);
  return NextResponse.json({ client: { id: client.id, name: client.name }, items });
}
