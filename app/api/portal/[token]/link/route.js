import { NextResponse } from 'next/server';
import { getClientByToken, addKlaviItem, getItemsByClientId } from '@/lib/storage-company';
import { getEmpresaByToken, registerItemLocation } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { createLink, getConsentList, getInstitutions, requestBusinessInstitutionData, requestPersonalInstitutionData, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { token } = await params;

  const empresa = await getEmpresaByToken(token);
  if (!empresa) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const pool = await getCompanyPool(empresa);
  const client = await getClientByToken(pool, token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  let body = {};
  let taxType, businessTaxId, personalTaxId;

  try {
    body = await request.json().catch(() => ({}));
    ({ businessTaxId, personalTaxId, taxType } = body);
    const isPF = taxType === 'pf';

    if (!personalTaxId) {
      return NextResponse.json({ error: 'personalTaxId (CPF) obrigatório' }, { status: 400 });
    }
    if (!isPF && !businessTaxId) {
      return NextResponse.json({ error: 'businessTaxId (CNPJ) obrigatório para PJ' }, { status: 400 });
    }

    const baseUrl = process.env.KLAVI_WEBHOOK_URL
      ? process.env.KLAVI_WEBHOOK_URL.replace('/api/webhooks/klavi', '')
      : `https://${request.headers.get('host')}`;
    const redirectUrl = `${baseUrl}/portal/${token}/callback`;
    const productsCallbackUrl = process.env.KLAVI_WEBHOOK_URL || null;

    const linkParams = {
      personalTaxId,
      redirectUrl,
      productsCallbackUrl,
    };
    if (!isPF && businessTaxId) linkParams.businessTaxId = businessTaxId;

    console.log('[portal link] criando link com params:', JSON.stringify(linkParams));
    const link = await createLink(linkParams);
    console.log('[portal link] link criado:', link?.linkId);

    // Busca nomes das instituições para preencher corretamente quando o consentimento não traz nome.
    let institutionsByCode = {};
    try {
      const institutions = await getInstitutions(link.linkToken);
      const list = Array.isArray(institutions) ? institutions : (institutions?.institutions || []);
      institutionsByCode = Object.fromEntries(
        list.map(i => [String(i.institutionCode || i.code || '').toLowerCase(), i.name || i.institutionName || null])
      );
    } catch (instErr) {
      console.warn('[portal link] falha ao buscar instituições:', instErr.message);
    }

    // Verifica se já existem consentimentos autorizados para reutilizar.
    // Isso evita o erro de "limite de consentimentos atingido" no widget.
    try {
      const listParams = { personalTaxId };
      if (!isPF && businessTaxId) listParams.businessTaxId = businessTaxId;
      const listData = await getConsentList(listParams);
      const existingConsents = Array.isArray(listData) ? listData : (listData?.consents || []);

      // Ignora consentimentos que já estão conectados localmente; senão o portal
      // fica reutilizando os mesmos bancos e nunca abre o widget para adicionar um novo.
      const localItems = await getItemsByClientId(pool, client.id);
      const localConsentIds = new Set(
        localItems.map(i => String(i.klaviConsentId || '').toLowerCase()).filter(Boolean)
      );
      const localLinkIds = new Set(
        localItems.map(i => String(i.klaviLinkId || '').toLowerCase()).filter(Boolean)
      );

      const authorised = existingConsents.filter(
        c => ['authorised', 'authorized'].includes(String(c.status).toLowerCase()) &&
          // Garante que o consentimento pertence ao CNPJ atual (PJ) ou ao CPF atual (PF).
          // A Klavi pode retornar consentimentos de outros CNPJs vinculados ao mesmo CPF.
          (!businessTaxId || String(c.businessTaxId || c.businesstaxid || '') === String(businessTaxId)) &&
          // Evita reaproveitar consentimentos que já existem no dashboard.
          !localConsentIds.has(String(c.consentId || c.consentid || '').toLowerCase()) &&
          !localLinkIds.has(String(c.linkId || c.linkid || '').toLowerCase())
      );

      if (authorised.length > 0) {
        console.log('[portal link] %d consentimento(s) autorizado(s) encontrado(s); reutilizando...', authorised.length);
        const reusedItems = [];
        for (const consent of authorised) {
          try {
            const itemId = uuidv4();
            const institutionCode = consent.institutionCode || consent.institution_code;
            const institutionName = consent.institutionName || consent.institution_name ||
              institutionsByCode[String(institutionCode).toLowerCase()] ||
              `Banco ${institutionCode}`;
            const item = await addKlaviItem(pool, {
              id: itemId,
              clientId: client.id,
              klaviLinkId: consent.linkId || consent.linkid || link.linkId,
              klaviConsentId: consent.consentId || consent.consentid,
              institutionCode,
              institutionName,
              institutionLogo: consent.institutionLogo || consent.institution_logo || null,
              accountNumbers: null,
              businessTaxId: isPF ? null : (businessTaxId || null),
              personalTaxId,
              taxType: isPF ? 'pf' : 'pj',
              status: 'UPDATING',
            });
            await registerItemLocation(empresa, {
              itemId,
              clientId: client.id,
              klaviLinkId: item.klaviLinkId,
              klaviConsentId: item.klaviConsentId,
            }).catch(err => console.error('[portal link] falha ao registrar item location:', err.message));

            // Solicita dados usando o consentimento existente.
            const requestBody = {
              institutionCode,
              linkId: item.klaviLinkId,
              consentIds: [item.klaviConsentId],
              products: DEFAULT_KLAVI_PRODUCTS,
              productsCallbackUrl,
            };
            if (isPF) {
              await requestPersonalInstitutionData({ ...requestBody, personalTaxId });
            } else {
              await requestBusinessInstitutionData({ ...requestBody, businessTaxId });
            }

            reusedItems.push({ itemId: item.id, institutionCode, institutionName });
            console.log('[portal link] consentimento reutilizado item=%s banco=%s', item.id, institutionName);
          } catch (reuseErr) {
            console.error('[portal link] erro ao reutilizar consentimento=%s:', consent.consentId || consent.consentid, reuseErr.message);
          }
        }

        if (reusedItems.length > 0) {
          return NextResponse.json({
            autoConnected: true,
            linkId: link.linkId,
            reusedItems,
            message: `${reusedItems.length} banco(s) já autorizado(s) foram conectados automaticamente.`,
          });
        }
      }
    } catch (listErr) {
      console.warn('[portal link] falha ao listar consentimentos:', listErr.message);
    }

    return NextResponse.json({
      linkId: link.linkId,
      linkURL: link.linkURL,
      redirectUrl,
    });
  } catch (error) {
    console.error('[portal link] erro:', error);
    console.error('[portal link] detalhes:', {
      message: error.message,
      status: error.status,
      code: error.code,
      body: error.body,
      stack: error.stack,
      taxType,
      hasBusinessTaxId: !!businessTaxId,
      hasPersonalTaxId: !!personalTaxId,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
