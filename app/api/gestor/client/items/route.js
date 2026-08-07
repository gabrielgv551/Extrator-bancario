import { NextResponse } from 'next/server';
import { getClientByGestorEmpresa, getItemsByClientId } from '@/lib/storage-company';
import { getCompanyPool } from '@/lib/company-db';
import { isItemHealthy } from '@/lib/status';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
}

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function verifyToken(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const expected = process.env.GESTOR_API_TOKEN || '';
  if (!expected) {
    console.error('[gestor/client/items] GESTOR_API_TOKEN não configurado');
    return false;
  }
  return token === expected;
}

function sanitizeEmpresa(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
}

export async function GET(request) {
  if (!verifyToken(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const empresa = sanitizeEmpresa(searchParams.get('empresa'));
  if (!empresa) return badRequest('empresa é obrigatória');

  try {
    const pool = await getCompanyPool(empresa);
    const client = await getClientByGestorEmpresa(pool, empresa);
    if (!client) {
      return NextResponse.json({ client: null, items: [], diagnostics: [] });
    }

    const items = await getItemsByClientId(pool, client.id);
    const diagnostics = items.map(item => ({
      id: item.id,
      bank: item.institutionName,
      institutionCode: item.institutionCode,
      status: item.status || 'PENDING',
      executionStatus: item.executionStatus || null,
      errorCode: item.errorCode || null,
      errorMessage: item.errorMessage || null,
      lastUpdatedAt: item.lastUpdatedAt || null,
      requiresReconnect: item.requiresReconnect || item.status === 'LOGIN_ERROR',
      isHealthy: isItemHealthy(item.status),
      provider: item.provider || 'pluggy',
      accountNumbers: item.accountNumbers || null,
    }));

    return NextResponse.json({
      client: { id: client.id, name: client.name, businessTaxId: client.businessTaxId },
      items,
      diagnostics,
    });
  } catch (error) {
    console.error('[gestor/client/items] GET erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
