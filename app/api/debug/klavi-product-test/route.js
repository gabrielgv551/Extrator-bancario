import { NextResponse } from 'next/server';
import { getItemById } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { requestBusinessInstitutionData, requestPersonalInstitutionData } from '@/lib/klavi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SALT = 'pluggy-admin-2024';

async function sessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(password));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isAdmin(request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const session = request.cookies.get('admin_session')?.value;
  if (!session) return false;
  const expected = await sessionToken(password);
  return session === expected;
}

function hasCronSecret(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${secret}`;
}

async function checkAuth(request) {
  if (hasCronSecret(request)) return true;
  return isAdmin(request);
}

// Produtos institution-level PJ disponíveis na documentação da Klavi.
const DEFAULT_BUSINESS_PRODUCTS = [
  'pj_checking_account',
  'pj_savings_account',
  'pj_credit_card',
  'pj_balance',
  'pj_loans',
  'pj_financing',
  'pj_unarranged_account_overdraft',
  'pj_invoice_financing',
  'pj_bank_fixed_incomes',
  'pj_credit_fixed_incomes',
  'pj_variable_incomes',
  'pj_treasure_titles',
  'pj_funds',
  'pj_categorized_checking_l2',
  'pj_categorized_savings_l2',
  'pj_categorized_creditcard_l2',
  'pj_categorized_checking_l3',
  'pj_categorized_savings_l3',
  'pj_categorized_creditcard_l3',
];

const DEFAULT_PERSONAL_PRODUCTS = [
  'pf_checking_account',
  'pf_savings_account',
  'pf_credit_card',
  'pf_balance',
  'pf_loans',
  'pf_financing',
  'pf_unarranged_account_overdraft',
  'pf_invoice_financing',
  'pf_bank_fixed_incomes',
  'pf_credit_fixed_incomes',
  'pf_variable_incomes',
  'pf_treasure_titles',
  'pf_funds',
  'pf_categorized_checking_l2',
  'pf_categorized_savings_l2',
  'pf_categorized_creditcard_l2',
  'pf_categorized_checking_l3',
  'pf_categorized_savings_l3',
  'pf_categorized_creditcard_l3',
];

export async function POST(request) {
  if (!await checkAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const body = await request.json().catch(() => ({}));
    const { itemId, products, mode = 'business' } = body;

    if (!itemId) return NextResponse.json({ error: 'Informe itemId' }, { status: 400 });

    const item = await getItemById(pool, itemId);
    if (!item) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });

    const isBusiness = mode === 'business';
    const taxId = isBusiness ? item.businessTaxId : item.personalTaxId;
    if (!taxId) {
      return NextResponse.json({ error: `TaxId não encontrado para mode=${mode}` }, { status: 400 });
    }
    if (!item.institutionCode) {
      return NextResponse.json({ error: 'Item não possui institutionCode' }, { status: 400 });
    }

    const productsToTest = Array.isArray(products) && products.length > 0
      ? products
      : (isBusiness ? DEFAULT_BUSINESS_PRODUCTS : DEFAULT_PERSONAL_PRODUCTS);

    const results = [];
    for (const product of productsToTest) {
      const requestBody = {
        [isBusiness ? 'businessTaxId' : 'personalTaxId']: taxId,
        institutionCode: item.institutionCode,
        linkId: item.klaviLinkId || undefined,
        consentIds: item.klaviConsentId ? [item.klaviConsentId] : undefined,
        products: [product],
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      };

      const startedAt = Date.now();
      try {
        const response = isBusiness
          ? await requestBusinessInstitutionData(requestBody)
          : await requestPersonalInstitutionData(requestBody);
        results.push({
          product,
          success: true,
          response,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        results.push({
          product,
          success: false,
          error: err.message,
          status: err.status,
          code: err.code,
          body: err.body,
          durationMs: Date.now() - startedAt,
        });
      }
    }

    const successful = results.filter(r => r.success).map(r => r.product);

    return NextResponse.json({
      itemId: item.id,
      mode,
      institutionCode: item.institutionCode,
      institutionName: item.institutionName,
      businessTaxId: item.businessTaxId,
      personalTaxId: item.personalTaxId,
      tested: productsToTest.length,
      successfulCount: successful.length,
      successfulProducts: successful,
      results,
    });
  } catch (error) {
    console.error('[debug klavi-product-test] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
