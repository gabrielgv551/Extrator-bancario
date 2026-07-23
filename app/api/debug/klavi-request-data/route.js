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
    if (!itemId) return NextResponse.json({ error: 'Informe itemId' }, { status: 400 });

    const item = await getItemById(itemId);
    if (!item) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });

    const result = await requestBusinessInstitutionData({
      businessTaxId: item.businessTaxId,
      institutionCode: item.institutionCode,
      linkId: item.klaviLinkId,
      consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
      products: DEFAULT_PRODUCTS,
      productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
    });

    return NextResponse.json({ success: true, itemId: item.id, klaviResponse: result });
  } catch (err) {
    console.error('[debug klavi-request-data] erro:', err);
    return NextResponse.json({
      success: false,
      error: err.message,
      code: err.code,
      body: err.body,
    }, { status: 502 });
  }
}
