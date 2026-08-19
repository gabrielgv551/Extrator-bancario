import { NextResponse } from 'next/server';
import { getClientByToken, addKlaviItem, getItemByKlaviLinkId, updateItemStatus } from '@/lib/storage-company';
import { getEmpresaByToken, registerItemLocation } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getConsentList, isPlaceholderInstitutionName, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';
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
        institutionName: 'Banco em conexão',
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

    // Se recebemos consentId, consulta a API Klavi para preencher institutionCode/name/logo o quanto antes.
    const logMeta = { pool, source: 'portal', clientId: client.id, itemId: item.id, linkId, consentId };

    if (consentId) {
      try {
        const listParams = {};
        const isPF = item.taxType === 'pf';
        const businessTaxId = item.businessTaxId || client.businessTaxId;
        const personalTaxId = item.personalTaxId || client.personalTaxId;
        if (!isPF && businessTaxId) listParams.businessTaxId = businessTaxId;
        if (personalTaxId) listParams.personalTaxId = personalTaxId;
        if (linkId) listParams.linkId = linkId;

        const listData = await getConsentList(listParams, logMeta);
        const consents = Array.isArray(listData) ? listData : (listData?.consents || []);
        const consent = consents.find(c =>
          String(c.consentId || c.consentid || '').toLowerCase() === String(consentId).toLowerCase() ||
          String(c.linkId || c.linkid || '').toLowerCase() === String(linkId).toLowerCase()
        );

        if (consent) {
          const institutionCode = consent.institutionCode || consent.institution_code || null;
          const institutionName = consent.institutionName || consent.institution_name || null;
          const institutionLogo = consent.institutionLogo || consent.institution_logo || null;
          const updates = {};
          const shouldUpdateInstitution = isPlaceholderInstitutionName(item.institutionName) ||
            isPlaceholderInstitutionName(item.institutionCode);

          if (institutionCode && (!item.institutionCode || shouldUpdateInstitution)) updates.institutionCode = institutionCode;
          if (institutionName && (!item.institutionName || isPlaceholderInstitutionName(item.institutionName))) updates.institutionName = institutionName;
          if (institutionLogo && (!item.institutionLogo || isPlaceholderInstitutionName(item.institutionName))) updates.institutionLogo = institutionLogo;

          if (Object.keys(updates).length > 0) {
            await updateItemStatus(pool, item.id, updates);
            item = { ...item, ...updates };
            console.log('[portal callback] item=%s atualizado com dados do consentimento: %j', item.id, updates);
          }
        }
      } catch (consentErr) {
        console.warn('[portal callback] falha ao buscar detalhes do consentimento (não crítica):', consentErr.message);
      }
    }

    // Solicita relatório. O webhook de consent/authorised também pode disparar, mas
    // fazemos a solicitação explícita aqui para garantir.
    // No fluxo widget-first, a instituição pode não ser conhecida ainda (item criado sem institutionCode).
    const businessTaxId = item.businessTaxId || client.businessTaxId;
    const personalTaxId = item.personalTaxId || client.personalTaxId;
    if (item.institutionCode && (businessTaxId || personalTaxId)) {
      try {
        const requestBody = {
          institutionCode: item.institutionCode,
          linkId,
          consentIds: consentId ? [consentId] : [],
          products: DEFAULT_KLAVI_PRODUCTS,
          productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
        };
        if (item.taxType === 'pf' && personalTaxId) {
          await requestPersonalInstitutionData({ ...requestBody, personalTaxId }, { ...logMeta, personalTaxId, institutionCode: item.institutionCode });
        } else if (businessTaxId) {
          await requestBusinessInstitutionData({ ...requestBody, businessTaxId }, { ...logMeta, businessTaxId, institutionCode: item.institutionCode });
        } else {
          console.log('[portal callback] CPF/CNPJ não disponíveis para solicitar relatório. linkId=%s', linkId);
        }
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
