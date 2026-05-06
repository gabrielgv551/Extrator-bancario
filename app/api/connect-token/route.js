import { NextResponse } from 'next/server';
import { getConnectToken } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { clientUserId } = await request.json();
    if (!clientUserId) {
      return NextResponse.json({ error: 'clientUserId obrigatório' }, { status: 400 });
    }
    const token = await getConnectToken(clientUserId);
    return NextResponse.json({ token });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
