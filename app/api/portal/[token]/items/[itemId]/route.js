import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId, removeItem } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { deletePluggyItem } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';

export async function DELETE(_, { params }) {
  const { token, itemId } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const items = await getItemsByClientId(pool, client.id);
  const item = items.find((i) => i.id === itemId);
  if (!item) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  try {
    // Se for item Pluggy legado, tenta deletar na Pluggy também.
    if (item.provider === 'pluggy' && item.pluggyItemId) {
      await deletePluggyItem(item.pluggyItemId).catch(() => {});
    }
    await removeItem(pool, itemId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
