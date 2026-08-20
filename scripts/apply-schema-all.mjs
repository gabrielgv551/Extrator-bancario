#!/usr/bin/env node
/**
 * Aplica o schema completo do Extrator em todos os bancos de empresas ativas.
 * Usar sempre que novas tabelas/colunas/views forem adicionados ao schema.
 *
 * Variáveis de ambiente necessárias:
 *   CENTRAL_DB_HOST / POSTGRES_HOST
 *   CENTRAL_DB_PASSWORD / POSTGRES_PASSWORD
 *   CENTRAL_DB_NAME (padrão: have_gestor)
 */

import { readFileSync } from 'fs';
import { listActiveCompanies, getCompanyDbConfig } from '../lib/company-db.js';
import { setupCompanyDatabase } from '../lib/setup-company-db.js';

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

async function main() {
  const companies = await listActiveCompanies();
  console.log(`Aplicando schema em ${companies.length} empresas...\n`);

  for (const { slug, name } of companies) {
    try {
      const cfg = await getCompanyDbConfig(slug);
      await setupCompanyDatabase(cfg, cfg.database);
      console.log(`✅ ${slug} (${name || slug}) -> ${cfg.database}`);
    } catch (err) {
      console.error(`❌ ${slug} (${name || slug}): ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
