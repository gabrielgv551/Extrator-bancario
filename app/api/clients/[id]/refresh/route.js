import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, updateItemStatus } from '@/lib/storage';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getConsentList } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_PRODUCTS = ['all'];

export async function POST(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || null;

  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    if (!client.businessTaxId) {
      return NextResponse.json({ error: 'Cliente não possui CNPJ cadastrado' }, { status: 400 });
    }

    const items = await getItemsByClientId(id);
    const toProcess = itemId ? items.filter(i => i.id === itemId) : items;
    const klaviItems = toProcess.filter(i => i.provider === 'klavi' || i.klaviLinkId);

    const results = [];

    async function resolvePersonalTaxId(item) {
      if (item.personalTaxId) return item.personalTaxId;
      if (!item.klaviLinkId && !item.klaviConsentId) return null;
      try {
        const list = await getConsentList({
          linkId: item.klaviLinkId || undefined,
          businessTaxId: item.businessTaxId || undefined,
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

    for (const item of klaviItems) {
      if (!item.klaviLinkId || !item.businessTaxId || !item.institutionCode) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: 'Item Klavi incompleto (link, cnpj ou instituição faltando)',
        });
        continue;
      }

      try {
        const requestBody = {
          businessTaxId: item.businessTaxId,
          institutionCode: item.institutionCode,
          linkId: item.klaviLinkId,
          consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
          products: DEFAULT_PRODUCTS,
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
            const pfRequestBody = {
              personalTaxId: personalTaxId,
              institutionCode: item.institutionCode,
              linkId: item.klaviLinkId,
              consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
              products: DEFAULT_PRODUCTS,
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
            });
            continue;
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
