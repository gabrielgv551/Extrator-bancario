import { NextResponse } from 'next/server';
import { getCompanyPool } from '@/lib/company-db';
import { resolveInstitutionNameByCode, isPlaceholderInstitutionName } from '@/lib/institution-names';
import pg from 'pg';

const { Pool } = pg;

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  return value;
}

function getCentralConfig() {
  return {
    host: requireEnv('CENTRAL_DB_HOST', process.env.POSTGRES_HOST),
    port: parseInt(process.env.CENTRAL_DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.CENTRAL_DB_NAME || 'have_gestor',
    user: process.env.CENTRAL_DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: requireEnv('CENTRAL_DB_PASSWORD', process.env.POSTGRES_PASSWORD),
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
}

async function listEmpresas() {
  const pool = new Pool({ ...getCentralConfig(), max: 2 });
  try {
    const { rows } = await pool.query(`SELECT slug FROM empresas WHERE ativo = true ORDER BY slug`);
    return rows.map(r => r.slug);
  } finally {
    await pool.end();
  }
}

async function corrigirEmpresa(empresa) {
  let pool;
  try {
    pool = await getCompanyPool(empresa);
  } catch (err) {
    return { empresa, fixed: 0, unchanged: 0, error: err.message };
  }

  try {
    const { rows: items } = await pool.query(
      `SELECT id, institution_code AS "institutionCode", institution_name AS "institutionName"
       FROM extrator_items
       WHERE provider = 'klavi'
         AND (institution_name IS NULL OR institution_name IN ('Banco em conexão', 'Banco conectado', 'Banco', 'Banco desconhecido', 'Banco selecionado no widget Klavi'))`
    );

    let fixed = 0;
    let unchanged = 0;
    for (const item of items) {
      const resolved = resolveInstitutionNameByCode(item.institutionCode);
      if (resolved) {
        await pool.query(
          `UPDATE extrator_items SET institution_name = $1, updated_at = NOW() WHERE id = $2`,
          [resolved, item.id]
        );
        fixed++;
      } else {
        unchanged++;
      }
    }

    return { empresa, fixed, unchanged, total: items.length };
  } catch (err) {
    return { empresa, fixed: 0, unchanged: 0, error: err.message };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const empresa = searchParams.get('empresa');
    const all = searchParams.get('all') === '1';

    if (!empresa && !all) {
      return NextResponse.json({ error: 'Informe empresa=slug ou all=1' }, { status: 400 });
    }

    const empresas = all ? await listEmpresas() : [empresa];
    const results = [];
    for (const e of empresas) {
      results.push(await corrigirEmpresa(e));
    }

    const totalFixed = results.reduce((s, r) => s + (r.fixed || 0), 0);
    const totalUnchanged = results.reduce((s, r) => s + (r.unchanged || 0), 0);
    const errors = results.filter(r => r.error);

    return NextResponse.json({ success: true, totalFixed, totalUnchanged, errors: errors.length, results });
  } catch (err) {
    console.error('[admin/corrigir-nomes] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
