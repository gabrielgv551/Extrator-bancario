import { NextResponse } from 'next/server';
import {
  getClientByGestorEmpresa,
  createClient,
  updateClient,
  generatePortalToken,
} from '@/lib/storage-company';
import { getCompanyPool } from '@/lib/company-db';
import { v4 as uuidv4 } from 'uuid';

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
    console.error('[gestor/client] GESTOR_API_TOKEN não configurado');
    return false;
  }
  return token === expected;
}

function sanitizeEmpresa(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
}

function sanitizeNome(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
}

function sanitizeCnpj(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 14 ? digits : null;
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
      return NextResponse.json({ client: null, portalUrl: null }, { status: 200 });
    }
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      client,
      portalUrl: `${origin}/portal/${client.portalToken}`,
    });
  } catch (error) {
    console.error('[gestor/client] GET erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!verifyToken(request)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('JSON inválido');
  }

  const empresa = sanitizeEmpresa(body.empresa);
  const nome = sanitizeNome(body.nome);
  const businessTaxId = sanitizeCnpj(body.businessTaxId);

  if (!empresa) return badRequest('empresa é obrigatória');
  if (!nome) return badRequest('nome é obrigatório');

  try {
    const pool = await getCompanyPool(empresa);
    let client = await getClientByGestorEmpresa(pool, empresa);

    if (client) {
      const updates = {};
      if (nome && nome !== client.name) updates.name = nome;
      if (businessTaxId !== undefined && businessTaxId !== client.businessTaxId) {
        updates.businessTaxId = businessTaxId;
      }
      if (Object.keys(updates).length > 0) {
        client = await updateClient(pool, client.id, updates);
      }
    } else {
      client = await createClient(pool, {
        id: uuidv4(),
        name: nome,
        portalToken: generatePortalToken(),
        businessTaxId,
        gestorEmpresa: empresa,
      });
    }

    const origin = new URL(request.url).origin;
    return NextResponse.json({
      client,
      portalUrl: `${origin}/portal/${client.portalToken}`,
    }, { status: client ? 200 : 201 });
  } catch (error) {
    console.error('[gestor/client] POST erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
