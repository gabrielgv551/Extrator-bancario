import { NextResponse } from 'next/server';
import { getItemById } from '@/lib/storage';
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

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { itemId } = body;
    console.log('[debug klavi-request-data] itemId recebido:', itemId, 'tipo:', typeof itemId);
    if (!itemId) return NextResponse.json({ error: 'Informe itemId' }, { status: 400 });

    let item;
    try {
      item = await getItemById(itemId);
    } catch (dbErr) {
      console.error('[debug klavi-request-data] erro ao buscar item:', dbErr);
      return NextResponse.json({ error: 'Erro ao buscar item no banco', detail: dbErr.message }, { status: 500 });
    }
    if (!item) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });

    console.log('[debug klavi-request-data] item encontrado:', item.id, item.institutionName, item.businessTaxId, item.klaviLinkId);

    let result;
    try {
      result = await requestBusinessInstitutionData({
        businessTaxId: item.businessTaxId,
        institutionCode: item.institutionCode,
        linkId: item.klaviLinkId,
        consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
        products: body.products || DEFAULT_PRODUCTS,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
        externalInfo: body.transactionPeriod ? { transactionPeriod: body.transactionPeriod } : undefined,
      });
    } catch (klaviErr) {
      console.error('[debug klavi-request-data] erro na Klavi:', klaviErr);
      return NextResponse.json({
        success: false,
        error: klaviErr.message,
        code: klaviErr.code,
        body: klaviErr.body,
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, itemId: item.id, klaviResponse: result });
  } catch (err) {
    console.error('[debug klavi-request-data] erro geral:', err);
    return NextResponse.json({ success: false, error: err.message, stack: err.stack }, { status: 500 });
  }
}
