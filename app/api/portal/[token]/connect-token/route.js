import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage';
import { getConnectToken } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function POST(_, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const connectToken = await getConnectToken(client.id);
    return NextResponse.json({ token: connectToken });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
