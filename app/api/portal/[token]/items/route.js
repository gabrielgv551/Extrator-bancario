import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId, addItem } from '@/lib/storage';
import { getItem } from '@/lib/pluggy';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(client.id);
  return NextResponse.json(items);
}

export async function POST(request, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const { pluggyItemId } = await request.json();
    if (!pluggyItemId) return NextResponse.json({ error: 'pluggyItemId obrigatório' }, { status: 400 });

    const pluggyItem = await getItem(pluggyItemId).catch(() => null);
    const institutionName = pluggyItem?.connector?.name ?? 'Banco desconhecido';
    const institutionLogo = pluggyItem?.connector?.imageUrl ?? null;

    const item = await addItem({
      id: uuidv4(),
      clientId: client.id,
      pluggyItemId,
      institutionName,
      institutionLogo,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
