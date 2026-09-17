#!/usr/bin/env node
/**
 * Cria as tabelas caixa_* (motor de pré-classificação) em todos os bancos de
 * empresas ativas + banco principal (extratos), sem rodar o setup completo.
 * O seed do catálogo de categorias acontece em runtime (lib/regras-classificacao.js).
 *
 * Variáveis de ambiente necessárias:
 *   CENTRAL_DB_HOST / POSTGRES_HOST
 *   CENTRAL_DB_PASSWORD / POSTGRES_PASSWORD
 *   CENTRAL_DB_NAME (padrão: have_gestor)
 *   DATABASE_URL (banco principal, opcional)
 */

import { readFileSync } from 'fs';
import pg from 'pg';
import { listActiveCompanies, getCompanyDbConfig, getCentralConfig } from '../lib/company-db.js';
import { garantirSchema } from '../lib/regras-classificacao.js';

const { Client } = pg;

for (const file of ['.env.local', '.env']) {
  try {
    readFileSync(file, 'utf8').split('\n').forEach((line) => {
      const eq = line.indexOf('=');
      if (eq < 1 || line.startsWith('#')) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    });
  } catch {
    // ignora arquivos inexistentes
  }
}

async function applyOnDatabase(config, database, empresa) {
  const db = new Client({ ...config, database });
  await db.connect();
  try {
    await garantirSchema(db, empresa);
  } finally {
    await db.end();
  }
}

async function main() {
  const companies = await listActiveCompanies();
  console.log(`Aplicando schema caixa_* em ${companies.length} empresas + banco principal...\n`);

  for (const { slug, name } of companies) {
    try {
      const cfg = await getCompanyDbConfig(slug);
      await applyOnDatabase(cfg, cfg.database, slug);
      console.log(`✅ ${slug} (${name || slug}) -> ${cfg.database}`);
    } catch (err) {
      console.error(`❌ ${slug} (${name || slug}): ${err.message}`);
    }
  }

  // Banco principal (single-tenant legado): usa empresa 'default'.
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const mainCfg = typeof getCentralConfig === 'function' ? getCentralConfig() : null;
      const parsed = new URL(dbUrl);
      const mainDbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      await applyOnDatabase(
        {
          host: parsed.hostname,
          port: Number(parsed.port || 5432),
          user: decodeURIComponent(parsed.username || 'postgres'),
          password: decodeURIComponent(parsed.password || ''),
          ...(mainCfg?.ssl ? { ssl: mainCfg.ssl } : {}),
        },
        mainDbName,
        'default'
      );
      console.log(`✅ principal -> ${mainDbName}`);
    } catch (err) {
      console.error(`❌ principal: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
