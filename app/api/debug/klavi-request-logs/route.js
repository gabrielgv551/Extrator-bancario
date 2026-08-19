import { NextResponse } from 'next/server';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import { getKlaviRequestLogs, countKlaviRequestLogs } from '@/lib/storage-company';

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

  let pool;
  try {
    const empresa = requireEmpresaFromHeader(request);
    pool = await getCompanyPool(empresa);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);

  const filters = {
    clientId: searchParams.get('clientId') || undefined,
    itemId: searchParams.get('itemId') || undefined,
    linkId: searchParams.get('linkId') || undefined,
    consentId: searchParams.get('consentId') || undefined,
    personalTaxId: searchParams.get('personalTaxId') || undefined,
    businessTaxId: searchParams.get('businessTaxId') || undefined,
    institutionCode: searchParams.get('institutionCode') || undefined,
    method: searchParams.get('method') || undefined,
    path: searchParams.get('path') || undefined,
    status: searchParams.get('status') || undefined,
    source: searchParams.get('source') || undefined,
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
  };

  // Remove filtros vazios.
  for (const key of Object.keys(filters)) {
    if (!filters[key]) delete filters[key];
  }

  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const [logs, total] = await Promise.all([
    getKlaviRequestLogs(pool, filters, { limit, offset }),
    countKlaviRequestLogs(pool, filters),
  ]);

  return NextResponse.json({ logs, total, limit, offset });
}
