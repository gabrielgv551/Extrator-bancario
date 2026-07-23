import { NextResponse } from 'next/server';
import { getConsentList, deleteConsent } from '@/lib/klavi';

export const dynamic = 'force-dynamic';

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

export async function GET(request) {
  if (!await checkAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const personalTaxId = searchParams.get('personalTaxId') || undefined;
  const businessTaxId = searchParams.get('businessTaxId') || undefined;
  const linkId = searchParams.get('linkId') || undefined;

  try {
    const data = await getConsentList({ personalTaxId, businessTaxId, linkId });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[debug klavi-consents] erro ao listar:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!await checkAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { consentId, all, businessTaxId, personalTaxId } = body;

    if (consentId) {
      await deleteConsent(consentId);
      return NextResponse.json({ deleted: consentId });
    }

    if (all && (businessTaxId || personalTaxId)) {
      const list = await getConsentList({ businessTaxId, personalTaxId });
      const consents = Array.isArray(list) ? list : (list?.consents || []);
      const results = [];
      for (const c of consents) {
        try {
          await deleteConsent(c.consentId || c.consentid);
          results.push({ id: c.consentId || c.consentid, status: 'deleted' });
        } catch (err) {
          results.push({ id: c.consentId || c.consentid, status: 'error', error: err.message });
        }
      }
      return NextResponse.json({ deleted: results.length, results });
    }

    return NextResponse.json({ error: 'Informe consentId ou {all: true, businessTaxId/personalTaxId}' }, { status: 400 });
  } catch (error) {
    console.error('[debug klavi-consents] erro ao deletar:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
