import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage';
import { getOpenFinanceConnectors } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const connectors = await getOpenFinanceConnectors();
    return NextResponse.json({ connectors });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
