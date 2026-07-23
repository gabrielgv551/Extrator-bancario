import { NextResponse } from 'next/server';
import { getClientByToken, getItemById } from '@/lib/storage';
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
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  const { itemId } = await params;
  const item = await getItemById(itemId);
  if (!item || item.clientId !== client.id) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });
  }

  if (!item.klaviLinkId || !item.businessTaxId || !item.institutionCode) {
    return NextResponse.json({ error: 'Item incompleto para solicitar dados' }, { status: 400 });
  }

  try {
    await requestBusinessInstitutionData({
      businessTaxId: item.businessTaxId,
      institutionCode: item.institutionCode,
      linkId: item.klaviLinkId,
      consentIds: item.klaviConsentId ? [item.klaviConsentId] : [],
      products: DEFAULT_PRODUCTS,
      productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
    });

    return NextResponse.json({ success: true, message: 'Solicitação de dados enviada ao banco.' });
  } catch (err) {
    console.error('[portal request-data] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
