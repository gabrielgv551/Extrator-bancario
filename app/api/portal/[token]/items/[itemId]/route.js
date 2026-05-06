import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId, removeItem } from '@/lib/storage';
import { deletePluggyItem } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function DELETE(_, { params }) {
  const { token, itemId } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(client.id);
  const item = items.find((i) => i.id === itemId);
  if (!item) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  try {
    await deletePluggyItem(item.pluggyItemId).catch(() => {});
    await removeItem(itemId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
