import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage';
import { createLink, createConsent, getConsentList, deleteConsent } from '@/lib/klavi';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    const body = await request.json().catch(() => ({}));
    const { institutionCode, businessTaxId, personalTaxId, linkId: existingLinkId, linkToken: existingLinkToken } = body;
    if (!institutionCode) {
      return NextResponse.json({ error: 'institutionCode obrigatório' }, { status: 400 });
    }
    if (!businessTaxId) {
      return NextResponse.json({ error: 'businessTaxId (CNPJ) obrigatório' }, { status: 400 });
    }
    if (!personalTaxId) {
      return NextResponse.json({ error: 'personalTaxId (CPF) obrigatório' }, { status: 400 });
    }

    const baseUrl = process.env.KLAVI_WEBHOOK_URL
      ? process.env.KLAVI_WEBHOOK_URL.replace('/api/webhooks/klavi', '')
      : `https://${request.headers.get('host')}`;
    const redirectUrl = `${baseUrl}/portal/${token}/callback`;

    // Verifica se já existe consentimento pendente para o mesmo CNPJ/CPF + instituição.
    // Evita atingir o limite de consentimentos da Klavi criando um novo a cada clique.
    let existingConsents = [];
    try {
      const listData = await getConsentList({ personalTaxId, businessTaxId });
      console.log('[portal consent] lista de consentimentos:', JSON.stringify(listData).slice(0, 2000));
      existingConsents = Array.isArray(listData) ? listData : (listData?.consents || []);
    } catch (err) {
      console.warn('[portal consent] falha ao listar consentimentos:', err.message);
    }

    const reusableStatuses = ['started', 'awaiting_authorisation', 'awaiting_lgpd_authorisation', 'authorised'];
    const existingConsent = existingConsents.find(
      c => c.institutionCode === institutionCode && reusableStatuses.includes(String(c.status).toLowerCase())
    );

    if (existingConsent && existingConsent.consentRedirectUrl) {
      console.log('[portal consent] reutilizando consentimento existente=%s status=%s', existingConsent.consentId, existingConsent.status);
      return NextResponse.json({
        linkId: existingConsent.linkId,
        consentId: existingConsent.consentId,
        consentRedirectUrl: existingConsent.consentRedirectUrl,
        expireAt: existingConsent.expireAt,
        reused: true,
      });
    }

    const productsCallbackUrl = process.env.KLAVI_WEBHOOK_URL || null;

    async function tryCreateConsent() {
      let linkId = existingLinkId;
      let linkToken = existingLinkToken;
      if (!linkId || !linkToken) {
        const link = await createLink({ personalTaxId, businessTaxId, redirectUrl, productsCallbackUrl });
        linkId = link.linkId;
        linkToken = link.linkToken;
      }

      const consent = await createConsent({
        linkToken,
        personalTaxId,
        businessTaxId,
        institutionCode,
        redirectUrl,
        productsCallbackUrl,
      });

      return {
        linkId,
        linkToken,
        consentId: consent.consentId,
        consentRedirectUrl: consent.consentRedirectUrl,
        expireAt: consent.expireAt,
      };
    }

    function isLimitError(error) {
      const msg = String(error.message || '').toLowerCase();
      const code = String(error.code || '').toLowerCase();
      const bodyMsg = String(error.body?.message || error.body?.error || '').toLowerCase();
      const bodyCode = String(error.body?.code || error.body?.errorCode || '').toLowerCase();
      return msg.includes('exceeds the limit')
        || code.includes('exceeds')
        || bodyMsg.includes('exceeds the limit')
        || bodyMsg.includes('limite')
        || bodyCode.includes('consent_limit')
        || bodyCode.includes('exceeds');
    }

    async function freeConsentSlot({ personalTaxId, businessTaxId, institutionCode }) {
      // O Open Finance Brasil limita consentimentos ativos por CPF/CNPJ por instituição.
      // Quando o limite é atingido, removemos consentimentos deletáveis e, se necessário,
      // revogamos o consentimento autorizado mais antigo da mesma instituição para liberar vaga.
      let allConsents = [];
      try {
        const listData = await getConsentList({ personalTaxId, businessTaxId });
        allConsents = Array.isArray(listData) ? listData : (listData?.consents || []);
      } catch (err) {
        console.warn('[portal consent] falha ao listar consentimentos para limpeza:', err.message);
        return { deleted: 0, authorisedDeleted: 0 };
      }

      const sameInstitution = allConsents.filter(c => c.institutionCode === institutionCode);
      const sortByDate = (a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (da && db) return da - db;
        // Fallback: consentId costuma ser crescente.
        return String(a.consentId || '').localeCompare(String(b.consentId || ''));
      };

      // 1) Remove consentimentos em status que não representam conta conectada ativa.
      const deletableStatuses = ['error', 'rejected', 'expired', 'revoked', 'deleted_by_user', 'started', 'awaiting_authorisation', 'awaiting_lgpd_authorisation'];
      const deletable = sameInstitution.filter(c => deletableStatuses.includes(String(c.status).toLowerCase()));
      let deleted = 0;
      for (const c of deletable.sort(sortByDate)) {
        try {
          await deleteConsent(c.consentId || c.consentid);
          deleted++;
        } catch (err) {
          console.warn('[portal consent] falha ao deletar consentimento=%s:', c.consentId || c.consentid, err.message);
        }
      }

      // 2) Se ainda não liberou vaga, revoga o consentimento autorizado mais antigo da mesma instituição.
      let authorisedDeleted = 0;
      const authorisedStatuses = ['authorised', 'authorized'];
      const authorised = sameInstitution
        .filter(c => authorisedStatuses.includes(String(c.status).toLowerCase()) && !deletable.find(d => (d.consentId || d.consentid) === (c.consentId || c.consentid)))
        .sort(sortByDate);
      if (authorised.length > 0) {
        const oldest = authorised[0];
        try {
          await deleteConsent(oldest.consentId || oldest.consentid);
          authorisedDeleted++;
        } catch (err) {
          console.warn('[portal consent] falha ao revogar consentimento autorizado=%s:', oldest.consentId || oldest.consentid, err.message);
        }
      }

      console.log('[portal consent] limpeza: deletaveis=%d autorizados_revogados=%d', deleted, authorisedDeleted);
      return { deleted, authorisedDeleted };
    }

    try {
      const result = await tryCreateConsent();
      return NextResponse.json(result);
    } catch (error) {
      if (!isLimitError(error)) throw error;

      console.warn('[portal consent] limite de consentimentos atingido (code=%s), limpando antigos...', error.code);
      const { deleted, authorisedDeleted } = await freeConsentSlot({ personalTaxId, businessTaxId, institutionCode });

      if (deleted === 0 && authorisedDeleted === 0) {
        return NextResponse.json({
          error: 'Limite de consentimentos atingido no banco. Acesse o internet banking do banco e revogue um consentimento antigo do Open Finance para continuar.',
          code: 'CONSENT_LIMIT_EXCEEDED',
        }, { status: 422 });
      }

      try {
        const result = await tryCreateConsent();
        return NextResponse.json({ ...result, cleaned: deleted, revoked: authorisedDeleted });
      } catch (retryError) {
        if (isLimitError(retryError)) {
          return NextResponse.json({
            error: 'Limite de consentimentos atingido no banco. Revogue consentimentos antigos diretamente no internet banking do banco e tente novamente.',
            code: 'CONSENT_LIMIT_EXCEEDED',
          }, { status: 422 });
        }
        throw retryError;
      }
    }
  } catch (error) {
    console.error('[portal consent] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
