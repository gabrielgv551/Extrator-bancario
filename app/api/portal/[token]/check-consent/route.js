import { NextResponse } from 'next/server';
import { getClientByToken, getItemByKlaviLinkId, getItemByKlaviConsentId, addKlaviItem, updateItemStatus } from '@/lib/storage-company';
import { getEmpresaByToken, registerItemLocation } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { getConsentList, isPlaceholderInstitutionName, resolveInstitutionNameByCode, DEFAULT_KLAVI_PRODUCTS, requestBusinessInstitutionData, requestPersonalInstitutionData } from '@/lib/klavi';
import { v4 as uuidv4 } from 'uuid';

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

    const authorised = consents.filter(c =>
      String(c.linkId || c.linkid || '').toLowerCase() === String(linkId).toLowerCase() &&
      ['authorised', 'authorized'].includes(String(c.status).toLowerCase())
    );

    if (authorised.length === 0) {
      return NextResponse.json({ found: false, status: 'WAITING_DATA', message: 'Consentimento ainda não autorizado' });
    }

    // Processa TODOS os consentimentos autorizados do link. Um link pode gerar
    // múltiplos consentimentos (usuário autoriza vários bancos no mesmo widget).
    const results = [];
    for (const consent of authorised) {
      const institutionCode = consent.institutionCode || consent.institution_code || null;
      let institutionName = consent.institutionName || consent.institution_name || null;
      if ((!institutionName || isPlaceholderInstitutionName(institutionName)) && institutionCode) {
        institutionName = resolveInstitutionNameByCode(institutionCode) || institutionName;
      }
      const institutionLogo = consent.institutionLogo || consent.institution_logo || null;
      const consentId = consent.consentId || consent.consentid || null;

      // Localiza item por consentId primeiro, depois deixa o addKlaviItem decidir
      // se atualiza o placeholder por linkId ou cria um novo item.
      let existing = consentId ? await getItemByKlaviConsentId(pool, consentId) : null;
      const consentItem = await addKlaviItem(pool, {
        id: existing ? existing.id : uuidv4(),
        clientId: client.id,
        klaviLinkId: linkId,
        klaviConsentId: consentId,
        institutionCode,
        institutionName,
        institutionLogo,
        accountNumbers: null,
        businessTaxId: item.businessTaxId || client.businessTaxId || null,
        personalTaxId: item.personalTaxId || client.personalTaxId || null,
        taxType: item.taxType || null,
        status: 'UPDATING',
      });

      await registerItemLocation(empresa, {
        itemId: consentItem.id,
        clientId: client.id,
        klaviLinkId: linkId,
        klaviConsentId: consentId,
      }).catch(err => console.error('[portal/check-consent] falha ao registrar item location:', err.message));

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
            await requestPersonalInstitutionData({ ...requestBody, personalTaxId }, { ...logMeta, itemId: consentItem.id, consentId, institutionCode });
          } else if (businessTaxId) {
            await requestBusinessInstitutionData({ ...requestBody, businessTaxId }, { ...logMeta, itemId: consentItem.id, consentId, institutionCode });
          }
        } catch (err) {
          console.error('[portal/check-consent] falha ao solicitar relatório:', err.message);
        }
      }

      results.push({ itemId: consentItem.id, institutionCode, institutionName });
      console.log('[portal/check-consent] consentimento=%s item=%s banco=%s codigo=%s', consentId, consentItem.id, institutionName, institutionCode);
    }

    return NextResponse.json({
      found: true,
      status: 'UPDATING',
      results,
      institutionCode: results[0].institutionCode,
      institutionName: results[0].institutionName,
      message: `${results.length} consentimento(s) autorizado(s). Dados serão sincronizados.`,
    });
  } catch (err) {
    console.error('[portal/check-consent] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
