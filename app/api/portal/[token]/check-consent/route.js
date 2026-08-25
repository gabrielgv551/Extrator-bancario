import { NextResponse } from 'next/server';
import { getClientByToken, getItemByKlaviLinkId, updateItemStatus } from '@/lib/storage-company';
import { getEmpresaByToken } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { getConsentList, isPlaceholderInstitutionName, resolveInstitutionNameByCode, DEFAULT_KLAVI_PRODUCTS, requestBusinessInstitutionData, requestPersonalInstitutionData } from '@/lib/klavi';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const linkId = body.linkId || body.link_id;
  if (!linkId) return NextResponse.json({ error: 'linkId obrigatório' }, { status: 400 });

  const item = await getItemByKlaviLinkId(pool, linkId);
  if (!item) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });

  try {
    const listParams = {};
    const isPF = item.taxType === 'pf';
    const businessTaxId = item.businessTaxId || client.businessTaxId;
    const personalTaxId = item.personalTaxId || client.personalTaxId;
    if (!isPF && businessTaxId) listParams.businessTaxId = businessTaxId;
    if (personalTaxId) listParams.personalTaxId = personalTaxId;
    listParams.linkId = linkId;

    const logMeta = { pool, source: 'portal', clientId: client.id, itemId: item.id, linkId };
    const listData = await getConsentList(listParams, logMeta);
    const consents = Array.isArray(listData) ? listData : (listData?.consents || []);

    const consent = consents.find(c =>
      String(c.linkId || c.linkid || '').toLowerCase() === String(linkId).toLowerCase() &&
      ['authorised', 'authorized'].includes(String(c.status).toLowerCase())
    );

    if (!consent) {
      return NextResponse.json({ found: false, status: 'WAITING_DATA', message: 'Consentimento ainda não autorizado' });
    }

    const institutionCode = consent.institutionCode || consent.institution_code || null;
    let institutionName = consent.institutionName || consent.institution_name || null;
    if (!institutionName && institutionCode) {
      institutionName = resolveInstitutionNameByCode(institutionCode);
    }
    const institutionLogo = consent.institutionLogo || consent.institution_logo || null;
    const consentId = consent.consentId || consent.consentid || item.klaviConsentId || null;

    const updates = {
      klaviConsentId: consentId,
      institutionCode,
      institutionName: institutionName || item.institutionName,
      institutionLogo: institutionLogo || item.institutionLogo,
      status: 'UPDATING',
    };
    await updateItemStatus(pool, item.id, updates);

    // Solicita relatório se tiver institutionCode e CPF/CNPJ
    if (institutionCode && (businessTaxId || personalTaxId)) {
      const requestBody = {
        institutionCode,
        linkId,
        consentIds: consentId ? [consentId] : [],
        products: DEFAULT_KLAVI_PRODUCTS,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      };
      try {
        if (isPF && personalTaxId) {
          await requestPersonalInstitutionData({ ...requestBody, personalTaxId }, { ...logMeta, consentId, institutionCode });
        } else if (businessTaxId) {
          await requestBusinessInstitutionData({ ...requestBody, businessTaxId }, { ...logMeta, consentId, institutionCode });
        }
      } catch (err) {
        console.error('[portal/check-consent] falha ao solicitar relatório:', err.message);
      }
    }

    return NextResponse.json({
      found: true,
      status: 'UPDATING',
      institutionCode,
      institutionName: updates.institutionName,
      message: 'Consentimento autorizado. Dados serão sincronizados.',
    });
  } catch (err) {
    console.error('[portal/check-consent] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
