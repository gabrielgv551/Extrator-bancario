import { NextResponse } from 'next/server';
import { getClientByToken, addKlaviItem, getItemByKlaviLinkId, updateItemStatus } from '@/lib/storage-company';
import { getEmpresaByToken, registerItemLocation } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { requestBusinessInstitutionData, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) {
    return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });
  }

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) {
    return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const linkId = searchParams.get('link_id') || searchParams.get('linkId') || null;
  const consentId = searchParams.get('consent_id') || searchParams.get('consentId') || null;
  const error = searchParams.get('error') || null;
  const errorDescription = searchParams.get('error_description') || null;

  if (error) {
    console.error('[portal callback] erro no consentimento:', error, errorDescription);
    return NextResponse.json({
      success: false,
      error,
      errorDescription: errorDescription || 'Autorização não concluída no banco.',
    }, { status: 400 });
  }

  if (!linkId) {
    return NextResponse.json({ error: 'link_id não informado' }, { status: 400 });
  }

  try {
    // O item pode já ter sido criado pelo portal antes do redirect; se não, criamos um placeholder.
    let item = await getItemByKlaviLinkId(pool, linkId);
    if (!item) {
      const itemId = uuidv4();
      item = await addKlaviItem(pool, {
        id: itemId,
        clientId: client.id,
        klaviLinkId: linkId,
        klaviConsentId: null,
        institutionCode: null,
        institutionName: 'Banco conectado',
        institutionLogo: null,
        accountNumbers: null,
        businessTaxId: null,
        status: 'WAITING_DATA',
      });
      await registerItemLocation(empresa, {
        itemId,
        clientId: client.id,
        klaviLinkId: linkId,
      }).catch(err => console.error('[portal/callback] falha ao registrar item location:', err.message));
    }

    // Solicita relatório. O webhook de consent/authorised também pode disparar, mas
    // fazemos a solicitação explícita aqui para garantir.
    // No fluxo widget-first, a instituição pode não ser conhecida ainda (item criado sem institutionCode).
    const businessTaxId = item.businessTaxId || client.businessTaxId;
    if (businessTaxId && item.institutionCode) {
      try {
        await requestBusinessInstitutionData({
          businessTaxId,
          institutionCode: item.institutionCode,
          linkId,
          consentIds: consentId ? [consentId] : [],
          products: DEFAULT_KLAVI_PRODUCTS,
          productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
        });
      } catch (err) {
        console.error('[portal callback] falha ao solicitar relatório (não crítica):', err);
        // Não retorna erro: o webhook pode completar o processo.
      }
    } else {
      console.log('[portal callback] institutionCode não disponível ainda; aguardando webhook. linkId=%s consentId=%s', linkId, consentId);
    }

    await updateItemStatus(pool, item.id, { status: consentId ? 'UPDATING' : 'WAITING_DATA', klaviConsentId: consentId || item.klaviConsentId });

    return NextResponse.json({
      success: true,
      linkId,
      itemId: item.id,
      message: 'Autorização recebida. Os dados serão processados em breve.',
    });
  } catch (err) {
    console.error('[portal callback] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
