import { NextResponse } from 'next/server';
import { getClientByToken, addKlaviItem, getItemByKlaviLinkId, updateItemStatus } from '@/lib/storage';
import { requestBusinessInstitutionData } from '@/lib/klavi';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

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

export async function GET(request, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
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
    let item = await getItemByKlaviLinkId(linkId);
    if (!item) {
      item = await addKlaviItem({
        id: uuidv4(),
        clientId: client.id,
        klaviLinkId: linkId,
        klaviConsentId: null,
        institutionCode: null,
        institutionName: 'Banco conectado',
        institutionLogo: null,
        accountNumbers: null,
        businessTaxId: null,
        status: 'WAITING_DATA',
      });
    }

    // Solicita relatório. O webhook de consent/authorised também pode disparar, mas
    // fazemos a solicitação explícita aqui para garantir.
    const businessTaxId = item.businessTaxId || client.businessTaxId;
    if (businessTaxId && item.institutionCode) {
      await requestBusinessInstitutionData({
        businessTaxId,
        institutionCode: item.institutionCode,
        linkId,
        consentIds: consentId ? [consentId] : [],
        products: DEFAULT_PRODUCTS,
      }).catch(err => console.warn('[portal callback] falha ao solicitar relatório:', err.message));
    }

    await updateItemStatus(item.id, { status: 'WAITING_DATA', klaviConsentId: consentId || item.klaviConsentId });

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
