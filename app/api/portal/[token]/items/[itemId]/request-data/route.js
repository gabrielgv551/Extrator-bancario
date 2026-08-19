import { NextResponse } from 'next/server';
import { getClientByToken, getItemById } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const { itemId } = await params;
  const item = await getItemById(pool, itemId);
  if (!item || item.clientId !== client.id) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });
  }

  if (!item.klaviLinkId || !item.institutionCode || (item.taxType !== 'pf' && !item.businessTaxId)) {
    return NextResponse.json({ error: 'Item incompleto para solicitar dados' }, { status: 400 });
  }

  const logMeta = {
    pool,
    source: 'portal',
    clientId: client.id,
    itemId: item.id,
    linkId: item.klaviLinkId,
    consentId: item.klaviConsentId,
    institutionCode: item.institutionCode,
  };

  try {
    if (item.taxType === 'pf') {
      if (!item.personalTaxId) {
        return NextResponse.json({ error: 'CPF não encontrado para conta PF' }, { status: 400 });
      }
      await requestPersonalInstitutionData({
        personalTaxId: item.personalTaxId,
        institutionCode: item.institutionCode,
        linkId: item.klaviLinkId,
        consentIds: item.klaviConsentId ? [item.klaviConsentId] : [],
        products: DEFAULT_KLAVI_PRODUCTS,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      }, { ...logMeta, personalTaxId: item.personalTaxId });
      return NextResponse.json({ success: true, message: 'Solicitação de dados PF enviada ao banco.' });
    }

    await requestBusinessInstitutionData({
      businessTaxId: item.businessTaxId,
      institutionCode: item.institutionCode,
      linkId: item.klaviLinkId,
      consentIds: item.klaviConsentId ? [item.klaviConsentId] : [],
      products: DEFAULT_KLAVI_PRODUCTS,
      productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
    }, { ...logMeta, businessTaxId: item.businessTaxId });

    return NextResponse.json({ success: true, message: 'Solicitação de dados enviada ao banco.' });
  } catch (err) {
    console.error('[portal request-data] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
