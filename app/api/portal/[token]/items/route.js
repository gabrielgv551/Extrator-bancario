import { NextResponse } from 'next/server';
import { getClientByToken, getItemsByClientId, addItem, addKlaviItem } from '@/lib/storage';
import { getItem, getAccounts } from '@/lib/pluggy';
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
    const body = await request.json().catch(() => ({}));

    // Fluxo Klavi
    if (body.klaviLinkId || body.klaviConsentId) {
      const item = await addKlaviItem({
        id: uuidv4(),
        clientId: client.id,
        klaviLinkId: body.klaviLinkId || null,
        klaviConsentId: body.klaviConsentId || null,
        institutionCode: body.institutionCode || null,
        institutionName: body.institutionName || 'Banco conectado',
        institutionLogo: body.institutionLogo || null,
        accountNumbers: body.accountNumbers || null,
        businessTaxId: body.businessTaxId || null,
        personalTaxId: body.personalTaxId || null,
        status: body.status || 'WAITING_DATA',
      });
      return NextResponse.json(item, { status: 201 });
    }

    // Fluxo Pluggy legado
    const { pluggyItemId } = body;
    if (!pluggyItemId) return NextResponse.json({ error: 'pluggyItemId ou klaviLinkId obrigatório' }, { status: 400 });

    const pluggyItem = await getItem(pluggyItemId).catch(() => null);
    const institutionName = pluggyItem?.connector?.name ?? 'Banco desconhecido';
    const institutionLogo = pluggyItem?.connector?.imageUrl ?? null;

    const accounts = await getAccounts(pluggyItemId).catch(() => []);
    const nums = accounts
      .map((a) => a.bankData?.transferNumber || a.number || null)
      .filter(Boolean);
    const unique = [...new Set(nums)];
    const accountNumbers = unique.length > 0 ? unique.join(', ') : null;

    const item = await addItem({
      id: uuidv4(),
      clientId: client.id,
      pluggyItemId,
      institutionName,
      institutionLogo,
      accountNumbers,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
