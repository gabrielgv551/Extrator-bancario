// Corrige itens Klavi que ficaram com nome placeholder ("Banco em conexão" etc.)
// para o nome real do banco baseado no institutionCode.
// Uso:
//   node scripts/corrigir-nomes-bancos.mjs jomana
//   node scripts/corrigir-nomes-bancos.mjs --all

import { getCompanyPool } from '../lib/company-db.js';
import { resolveInstitutionNameByCode, isPlaceholderInstitutionName } from '../lib/institution-names.js';
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
  console.log(`[corrige] processando empresa: ${empresa}`);
  let pool;
  try {
    pool = await getCompanyPool(empresa);
  } catch (err) {
    console.error(`[corrige] erro ao conectar no banco da empresa ${empresa}:`, err.message);
    return { fixed: 0, errors: 1 };
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
        console.log(`[corrige] ${empresa} item=${item.id} codigo=${item.institutionCode} -> ${resolved}`);
        fixed++;
      } else {
        console.log(`[corrige] ${empresa} item=${item.id} codigo=${item.institutionCode} NAO RESOLVIDO (nome="${item.institutionName}")`);
        unchanged++;
      }
    }

    if (items.length === 0) {
      console.log(`[corrige] ${empresa}: nenhum item placeholder encontrado`);
    } else {
      console.log(`[corrige] ${empresa}: ${fixed} corrigido(s), ${unchanged} sem resolução`);
    }

    return { fixed, unchanged, errors: 0 };
  } catch (err) {
    console.error(`[corrige] erro ao processar ${empresa}:`, err.message);
    return { fixed: 0, errors: 1 };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const empresaArg = args.find(a => !a.startsWith('--'));

  if (!all && !empresaArg) {
    console.error('Uso: node scripts/corrigir-nomes-bancos.mjs [empresa|--all]');
    process.exit(1);
  }

  const empresas = all ? await listEmpresas() : [empresaArg];
  const totals = { fixed: 0, unchanged: 0, errors: 0 };

  for (const empresa of empresas) {
    const result = await corrigirEmpresa(empresa);
    totals.fixed += result.fixed;
    totals.unchanged += result.unchanged;
    totals.errors += result.errors;
  }

  console.log('[corrige] resumo:', totals);
}

main().catch(err => {
  console.error('[corrige] erro fatal:', err);
  process.exit(1);
});
