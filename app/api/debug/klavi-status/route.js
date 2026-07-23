import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, getWebhookEventsForItem } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Informe o id do cliente' }, { status: 400 });

    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    const klaviItems = items.filter(i => i.provider === 'klavi' || i.klaviLinkId);

    const events = [];
    for (const item of klaviItems) {
      const itemEvents = await getWebhookEventsForItem({
        itemId: item.id,
        linkId: item.klaviLinkId,
        consentId: item.klaviConsentId,
        limit: 10,
      });
      events.push(...itemEvents);
    }
    events.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    return NextResponse.json({
      client: { id: client.id, name: client.name, businessTaxId: client.businessTaxId },
      items: klaviItems.map(i => ({
        id: i.id,
        institutionName: i.institutionName,
        institutionCode: i.institutionCode,
        status: i.status,
        klaviLinkId: i.klaviLinkId,
        klaviConsentId: i.klaviConsentId,
        businessTaxId: i.businessTaxId,
        accountNumbers: i.accountNumbers,
        updatedAt: i.updatedAt,
      })),
      webhookEvents: events,
      env: {
        klaviWebhookUrl: process.env.KLAVI_WEBHOOK_URL || null,
      },
    });
  } catch (err) {
    console.error('[debug klavi-status] erro:', err);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
