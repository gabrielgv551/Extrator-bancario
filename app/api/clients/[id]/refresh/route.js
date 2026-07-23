import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, updateItemStatus } from '@/lib/storage';
import { requestBusinessInstitutionData } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_PRODUCTS = [
  'pj_checking_account',
  'pj_savings_account',
  'pj_credit_card',
  'pj_loans',
  'pj_financings',
  'pj_investments_bank_fixed_incomes',
  'pj_investments_credit_fixed_incomes',
  'pj_investments_variable_incomes',
  'pj_investments_funds',
];

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
        await requestBusinessInstitutionData({
          businessTaxId: item.businessTaxId,
          institutionCode: item.institutionCode,
          linkId: item.klaviLinkId,
          consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
          products: DEFAULT_PRODUCTS,
          productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
        });

        await updateItemStatus(item.id, { status: 'UPDATING' });

        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: true,
          status: 'REQUESTED',
          message: 'Solicitação de relatório enviada. Dados chegarão via webhook.',
        });
      } catch (err) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: err.message,
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
