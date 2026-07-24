import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, updateItemStatus } from '@/lib/storage';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getConsentList } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_PRODUCTS = ['pj_checking_account'];

// Mapeia produtos retornados pelo consentimento da Klavi (nomenclatura Open Finance)
// para os nomes aceitos pelo endpoint /business/institution-data.
const CONSENT_PRODUCT_MAP = {
  'ACCOUNTS_ALL': ['pj_checking_account', 'pj_savings_account'],
  'CREDIT_CARDS_ALL': ['pj_credit_card'],
  'CREDIT_OPERATIONS_LOANS': ['pj_loans'],
  'CREDIT_OPERATIONS_FINANCINGS': ['pj_financings'],
  'CREDIT_OPERATIONS_UNARRANGED_ACCOUNTS_OVERDRAFT': ['pj_unarranged_accounts_overdraft'],
  'CREDIT_OPERATIONS_INVOICE_FINANCINGS': ['pj_invoice_financings'],
  'INVESTMENTS_BANK_FIXED_INCOMES': ['pj_investments_bank_fixed_incomes'],
  'INVESTMENTS_CREDIT_FIXED_INCOMES': ['pj_investments_credit_fixed_incomes'],
  'INVESTMENTS_VARIABLE_INCOMES': ['pj_investments_variable_incomes'],
  'INVESTMENTS_FUNDS': ['pj_investments_funds'],
  'INVESTMENTS_TREASURE_TITLES': ['pj_investments_treasure_titles'],
};

function mapConsentProducts(consentProducts) {
  if (!Array.isArray(consentProducts) || consentProducts.length === 0) return DEFAULT_PRODUCTS;
  const mapped = new Set();
  for (const p of consentProducts) {
    const key = String(p).toUpperCase();
    if (CONSENT_PRODUCT_MAP[key]) {
      CONSENT_PRODUCT_MAP[key].forEach(m => mapped.add(m));
    }
  }
  return mapped.size > 0 ? [...mapped] : DEFAULT_PRODUCTS;
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || null;

  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    const toProcess = itemId ? items.filter(i => i.id === itemId) : items;
    const klaviItems = toProcess.filter(i => i.provider === 'klavi' || i.klaviLinkId);

    // Se o cliente ainda não tem CNPJ cadastrado, tenta usar o CNPJ dos itens Klavi PJ.
    let clientBusinessTaxId = client.businessTaxId;
    if (!clientBusinessTaxId) {
      const itemCnpjs = [...new Set(klaviItems.map(i => i.businessTaxId).filter(Boolean))];
      if (itemCnpjs.length === 1) {
        clientBusinessTaxId = itemCnpjs[0];
        await updateClient(id, { businessTaxId: clientBusinessTaxId });
        console.log('[refresh] CNPJ do cliente preenchido a partir do item:', clientBusinessTaxId);
      } else if (itemCnpjs.length > 1) {
        return NextResponse.json({ error: 'Itens conectados usam CNPJs diferentes. Cadastre o CNPJ correto no cliente.' }, { status: 400 });
      }
    }
    if (!clientBusinessTaxId) {
      return NextResponse.json({ error: 'Cliente não possui CNPJ cadastrado' }, { status: 400 });
    }

    const results = [];

    async function resolvePersonalTaxId(item) {
      if (item.personalTaxId) return item.personalTaxId;
      if (!item.klaviLinkId && !item.klaviConsentId) return null;
      try {
        const list = await getConsentList({
          linkId: item.klaviLinkId || undefined,
          businessTaxId: item.businessTaxId || clientBusinessTaxId || undefined,
        });
        const consents = Array.isArray(list) ? list : (list?.consents || []);
        const match = consents.find(c =>
          c.consentId === item.klaviConsentId ||
          c.consentid === item.klaviConsentId ||
          c.institutionCode === item.institutionCode
        );
        if (match?.personalTaxId || match?.personaltaxid) {
          const cpf = match.personalTaxId || match.personaltaxid;
          console.log('[refresh] CPF resolvido via getConsentList:', cpf);
          await updateItemStatus(item.id, { personalTaxId: cpf });
          return cpf;
        }
      } catch (err) {
        console.warn('[refresh] falha ao buscar CPF via getConsentList:', err.message);
      }
      return null;
    }

    async function resolveActiveConsent(item) {
      if (!item.klaviLinkId && !item.klaviConsentId) return null;
      const filters = [
        { linkId: item.klaviLinkId || undefined, businessTaxId: item.businessTaxId || clientBusinessTaxId || undefined, personalTaxId: item.personalTaxId || undefined },
        { businessTaxId: item.businessTaxId || clientBusinessTaxId || undefined, personalTaxId: item.personalTaxId || undefined },
      ];
      try {
        for (const params of filters) {
          const list = await getConsentList(params);
          const consents = Array.isArray(list) ? list : (list?.consents || []);
          console.log('[refresh] consentimentos encontrados para item=%s via %j: count=%d', item.id, params, consents.length);
          // Consentimentos autorizados para a mesma instituição, do mais recente ao mais antigo.
          const authorised = consents
            .filter(c =>
              String(c.institutionCode).toLowerCase() === String(item.institutionCode).toLowerCase() &&
              ['authorised', 'authorized'].includes(String(c.status).toLowerCase())
            )
            .sort((a, b) => {
              const da = a.updatedAt || a.createdAt || a.consentId;
              const db = b.updatedAt || b.createdAt || b.consentId;
              return String(db).localeCompare(String(da));
            });
          if (authorised.length > 0) {
            const chosen = authorised[0];
            const consentId = chosen.consentId || chosen.consentid;
            const linkId = chosen.linkId || chosen.linkid || item.klaviLinkId;
            const consentProducts = chosen.products || chosen.product || chosen.scope || chosen.scopes;
            const products = mapConsentProducts(consentProducts);
            console.log('[refresh] consentimento autorizado escolhido para item=%s: consentId=%s linkId=%s products=%j rawProducts=%j', item.id, consentId, linkId, products, consentProducts);
            const updates = {};
            if (consentId && consentId !== item.klaviConsentId) updates.klaviConsentId = consentId;
            if (linkId && linkId !== item.klaviLinkId) updates.klaviLinkId = linkId;
            if (Object.keys(updates).length > 0) {
              await updateItemStatus(item.id, updates);
              console.log('[refresh] item=%s atualizado com %j', item.id, updates);
            }
            return { consentId, linkId, products };
          }
        }
      } catch (err) {
        console.warn('[refresh] falha ao buscar consentimentos ativos:', err.message);
      }
      return { consentId: item.klaviConsentId || null, linkId: item.klaviLinkId || null };
    }

    for (const item of klaviItems) {
      const isPF = item.taxType === 'pf';
      const itemBusinessTaxId = item.businessTaxId || clientBusinessTaxId;
      if (!item.klaviLinkId || !item.institutionCode || (!isPF && !itemBusinessTaxId)) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: 'Item Klavi incompleto (link, cnpj/cpf ou instituição faltando)',
        });
        continue;
      }

      const activeConsent = await resolveActiveConsent(item);
      const activeConsentId = activeConsent.consentId;
      const activeLinkId = activeConsent.linkId;
      const activeProducts = activeConsent.products || DEFAULT_PRODUCTS;

      if (isPF) {
        const personalTaxId = item.personalTaxId || await resolvePersonalTaxId(item);
        if (!personalTaxId) {
          results.push({
            itemId: item.id,
            bank: item.institutionName,
            success: false,
            reason: 'CPF não encontrado para conta PF. Reconecte pelo portal informando o CPF.',
          });
          continue;
        }
        if (!activeConsentId) {
          results.push({
            itemId: item.id,
            bank: item.institutionName,
            success: false,
            reason: 'Nenhum consentimento ativo encontrado para este banco. Reconecte pelo portal.',
          });
          continue;
        }
        try {
          const pfRequestBody = {
            personalTaxId,
            institutionCode: item.institutionCode,
            linkId: activeLinkId,
            consentIds: [activeConsentId],
            products: activeProducts,
            productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
          };
          console.log('[refresh] solicitando dados Klavi PF:', JSON.stringify(pfRequestBody));
          await requestPersonalInstitutionData(pfRequestBody);
          await updateItemStatus(item.id, { status: 'UPDATING' });
          results.push({
            itemId: item.id,
            bank: item.institutionName,
            success: true,
            status: 'REQUESTED_PF',
            message: 'Solicitação de relatório PF enviada. Dados chegarão via webhook.',
          });
        } catch (err) {
          console.error('[refresh] erro ao solicitar dados PF:', err);
          results.push({
            itemId: item.id,
            bank: item.institutionName,
            success: false,
            reason: err.message,
            klaviStatus: err.status,
            klaviCode: err.code,
            klaviBody: err.body,
          });
        }
        continue;
      }

      if (!activeConsentId) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: 'Nenhum consentimento ativo encontrado para este banco. Reconecte pelo portal.',
        });
        continue;
      }

      try {
        const requestBody = {
          businessTaxId: itemBusinessTaxId,
          institutionCode: item.institutionCode,
          linkId: activeLinkId,
          consentIds: [activeConsentId],
          products: activeProducts,
          productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
        };
        console.log('[refresh] solicitando dados Klavi PJ:', JSON.stringify(requestBody));
        await requestBusinessInstitutionData(requestBody);

        await updateItemStatus(item.id, { status: 'UPDATING' });

        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: true,
          status: 'REQUESTED',
          message: 'Solicitação de relatório PJ enviada. Dados chegarão via webhook.',
        });
      } catch (err) {
        console.error('[refresh] erro ao solicitar dados PJ:', err);
        console.error('[refresh] body do erro:', err.body, 'status:', err.status, 'code:', err.code);

        // Fallback para PF: MEI/contas pessoais podem retornar 4002 no endpoint business.
        const isInvalidProduct = err.status === 416 && err.body?.statusCode === 4002;
        console.log('[refresh] avaliando fallback:', { isInvalidProduct, status: err.status, statusCode: err.body?.statusCode, hasPersonal: !!item.personalTaxId });
        if (isInvalidProduct) {
          const personalTaxId = await resolvePersonalTaxId(item);
          if (personalTaxId) {
            try {
              const pfRequestBody = {
                personalTaxId: personalTaxId,
                institutionCode: item.institutionCode,
                linkId: activeLinkId,
                consentIds: [activeConsentId],
                products: activeProducts,
                productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
              };
              console.log('[refresh] tentando fallback PF:', JSON.stringify(pfRequestBody));
              await requestPersonalInstitutionData(pfRequestBody);
              await updateItemStatus(item.id, { status: 'UPDATING' });
              results.push({
                itemId: item.id,
                bank: item.institutionName,
                success: true,
                status: 'REQUESTED_PF',
                message: 'Solicitação de relatório PF enviada. Dados chegarão via webhook.',
              });
              continue;
            } catch (pfErr) {
              console.error('[refresh] erro também no fallback PF:', pfErr);
              results.push({
                itemId: item.id,
                bank: item.institutionName,
                success: false,
                reason: pfErr.message,
                klaviStatus: pfErr.status,
                klaviCode: pfErr.code,
                klaviBody: pfErr.body,
                attempted: 'PF fallback',
                debug: {
                  activeConsentId,
                  activeLinkId,
                  itemLinkId: item.klaviLinkId,
                  itemConsentId: item.klaviConsentId,
                  businessError: { status: err.status, statusCode: err.body?.statusCode, message: err.message },
                  pfRequestBody: {
                    personalTaxId,
                    institutionCode: item.institutionCode,
                    linkId: activeLinkId,
                    consentIds: [activeConsentId],
                    products: activeProducts,
                  },
                },
              });
              continue;
            }
          }
        }

        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: err.message,
          klaviStatus: err.status,
          klaviCode: err.code,
          klaviBody: err.body,
          debug: {
            activeConsentId,
            activeLinkId,
            itemLinkId: item.klaviLinkId,
            itemConsentId: item.klaviConsentId,
            requestBody: {
              businessTaxId: itemBusinessTaxId,
              institutionCode: item.institutionCode,
              linkId: activeLinkId,
              consentIds: [activeConsentId],
              products: activeProducts,
            },
          },
        });
      }
    }

    // Itens legados Pluggy não são mais atualizados; avisamos no resultado.
    const legacyItems = toProcess.filter(i => i.provider === 'pluggy' && i.pluggyItemId);
    for (const item of legacyItems) {
      results.push({
        itemId: item.id,
        bank: item.institutionName,
        success: false,
        reason: 'Item Pluggy legado. Reconecte pelo portal para usar Klavi.',
      });
    }

    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ refreshed_at: new Date().toISOString(), results });
  } catch (error) {
    console.error('[refresh] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
