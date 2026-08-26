import { NextResponse } from 'next/server';
import { getClientByToken, addKlaviItem, getItemByKlaviLinkId, getItemByKlaviConsentId, updateItemStatus } from '@/lib/storage-company';
import { getEmpresaByToken, registerItemLocation } from '@/lib/central-token-map';
import { getCompanyPool } from '@/lib/company-db';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getConsentList, isPlaceholderInstitutionName, resolveInstitutionNameByCode, DEFAULT_KLAVI_PRODUCTS } from '@/lib/klavi';
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

    // Sempre tenta consultar a API Klavi para preencher institutionCode/name/logo o quanto antes.
    // Mesmo sem consentId na URL, a lista de consentimentos pode trazer o consent vinculado ao linkId.
    const logMeta = { pool, source: 'portal', clientId: client.id, itemId: item.id, linkId, consentId };
    let resolvedConsentId = consentId || item.klaviConsentId || null;

    try {
      const listParams = {};
      const isPF = item.taxType === 'pf';
      const businessTaxId = item.businessTaxId || client.businessTaxId;
      const personalTaxId = item.personalTaxId || client.personalTaxId;
      if (!isPF && businessTaxId) listParams.businessTaxId = businessTaxId;
      if (personalTaxId) listParams.personalTaxId = personalTaxId;
      if (linkId) listParams.linkId = linkId;

      console.log('[portal callback] buscando consentimentos linkId=%s params=%j', linkId, listParams);
      const listData = await getConsentList(listParams, logMeta);
      const consents = Array.isArray(listData) ? listData : (listData?.consents || []);
      console.log('[portal callback] %d consentimento(s) encontrado(s)', consents.length);

      const consent = resolvedConsentId
        ? consents.find(c =>
            String(c.consentId || c.consentid || '').toLowerCase() === String(resolvedConsentId).toLowerCase() ||
            String(c.linkId || c.linkid || '').toLowerCase() === String(linkId).toLowerCase()
          )
        : consents.find(c =>
            String(c.linkId || c.linkid || '').toLowerCase() === String(linkId).toLowerCase() &&
            ['authorised', 'authorized'].includes(String(c.status).toLowerCase())
          );

      if (consent) {
        const institutionCode = consent.institutionCode || consent.institution_code || null;
        let institutionName = consent.institutionName || consent.institution_name || null;
        // Se a Klavi devolveu o código mas não o nome (caso SICOOB), resolve pelo fallback.
        // Também evita ficar preso em nomes genéricos tipo "Banco 6341".
        if ((!institutionName || isPlaceholderInstitutionName(institutionName)) && institutionCode) {
          institutionName = resolveInstitutionNameByCode(institutionCode) || institutionName;
        }
        const institutionLogo = consent.institutionLogo || consent.institution_logo || null;
        const foundConsentId = consent.consentId || consent.consentid || resolvedConsentId || null;

        // Tenta localizar item por consentId primeiro; isso cobre o cenário de
        // múltiplos consentimentos no mesmo link.
        let consentItem = foundConsentId ? await getItemByKlaviConsentId(pool, foundConsentId) : null;

        // Se não achou por consentId, o addKlaviItem decide se atualiza o item
        // placeholder por linkId ou cria um novo item quando o linkId já tem
        // outro consentId vinculado.
        consentItem = await addKlaviItem(pool, {
          id: consentItem ? consentItem.id : uuidv4(),
          clientId: client.id,
          klaviLinkId: linkId,
          klaviConsentId: foundConsentId,
          institutionCode,
          institutionName,
          institutionLogo,
          accountNumbers: null,
          businessTaxId: item.businessTaxId || client.businessTaxId || null,
          personalTaxId: item.personalTaxId || client.personalTaxId || null,
          taxType: item.taxType || null,
          status: 'UPDATING',
        });

        item = consentItem;
        if (foundConsentId) resolvedConsentId = foundConsentId;

        // Atualiza o mapeamento central com o consentId descoberto, para que webhooks futuros resolvam a empresa.
        await registerItemLocation(empresa, {
          itemId: item.id,
          clientId: client.id,
          klaviLinkId: linkId,
          klaviConsentId: foundConsentId,
        }).catch(err => console.error('[portal callback] falha ao re-registrar item location com consentId:', err.message));

        console.log('[portal callback] item=%s vinculado ao consentimento=%s banco=%s codigo=%s', item.id, foundConsentId, institutionName, institutionCode);
      } else {
        console.log('[portal callback] nenhum consentimento autorizado encontrado para linkId=%s consentId=%s', linkId, resolvedConsentId);
      }
    } catch (consentErr) {
      console.warn('[portal callback] falha ao buscar detalhes do consentimento (não crítica):', consentErr.message);
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
          consentIds: resolvedConsentId ? [resolvedConsentId] : [],
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
      console.log('[portal callback] institutionCode não disponível ainda; aguardando webhook. linkId=%s consentId=%s', linkId, resolvedConsentId);
    }

    await updateItemStatus(pool, item.id, { status: resolvedConsentId ? 'UPDATING' : 'WAITING_DATA', klaviConsentId: resolvedConsentId || item.klaviConsentId });

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
