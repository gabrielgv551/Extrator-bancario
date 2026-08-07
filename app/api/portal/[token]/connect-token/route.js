import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { getConnectToken } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const body = await request.json().catch(() => ({}));
    const webhookUrl = process.env.PLUGGY_WEBHOOK_URL || null;
    const connectToken = await getConnectToken(client.id, { itemId: body.itemId || undefined, webhookUrl });
    return NextResponse.json({ token: connectToken });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
