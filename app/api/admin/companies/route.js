import { NextResponse } from 'next/server';
import pg from 'pg';
import { listActiveCompanies, getCentralConfig, getCompanyPool } from '@/lib/company-db';
import { setupCompanyDatabase } from '@/lib/setup-db';

const { Pool } = pg;

function validSlug(value) {
  if (!value || typeof value !== 'string') return null;
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
  return slug || null;
}

function isGeral(request) {
  return request.cookies.get('extrator_empresa')?.value === '__geral__';
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const companies = await listActiveCompanies();
    return NextResponse.json(companies);
  } catch (err) {
    console.error('[admin/companies] erro GET:', err);
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!isGeral(request)) {
      return NextResponse.json({ error: 'Acesso restrito ao admin geral' }, { status: 403 });
    }

    const { slug, name } = await request.json();
    const empresaSlug = validSlug(slug);
    if (!empresaSlug) {
      return NextResponse.json({ error: 'Slug da empresa inválido' }, { status: 400 });
    }
    const empresaName = (name || empresaSlug).trim();

    const central = getCentralConfig();
    const centralPool = new Pool({ ...central, max: 2, connectionTimeoutMillis: 5000 });
    try {
      // Verifica se já existe
      const { rows: existing } = await centralPool.query(
        `SELECT 1 FROM empresas WHERE slug = $1`,
        [empresaSlug]
      );
      if (existing.length > 0) {
        return NextResponse.json({ error: 'Empresa já existe' }, { status: 409 });
      }

      await centralPool.query(
        `INSERT INTO empresas (slug, nome, status, db_env_key) VALUES ($1, $2, 'ativo', $3)`,
        [empresaSlug, empresaName, empresaSlug]
      );
    } finally {
      await centralPool.end();
    }

    // Cria o banco da empresa e roda o schema
    const dbName = `have_${empresaSlug}`;
    await setupCompanyDatabase(central, dbName);

    // Limpa o pool cache para a nova empresa
    try {
      const pool = await getCompanyPool(empresaSlug);
      if (pool) {
        await pool.end();
      }
    } catch {
      // ignora se o pool ainda não existia
    }

    return NextResponse.json({ success: true, slug: empresaSlug, name: empresaName });
  } catch (err) {
    console.error('[admin/companies] erro POST:', err);
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
