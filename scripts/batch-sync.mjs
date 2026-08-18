#!/usr/bin/env node
/**
 * Sync standalone multi-tenant — roda fora da Vercel (ex: AWS Batch).
 *
 * Uso:
 *   node scripts/batch-sync.mjs
 *   node scripts/batch-sync.mjs <clientId>
 *   EMPRESA=marcon node scripts/batch-sync.mjs
 *
 * Variáveis de ambiente necessárias:
 *   CENTRAL_DB_HOST / POSTGRES_HOST
 *   CENTRAL_DB_PASSWORD / POSTGRES_PASSWORD
 *   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET
 *   KLAVI_ACCESS_KEY, KLAVI_SECRET_KEY
 *   KLAVI_WEBHOOK_URL (recomendado)
 *   CRON_SECRET / KLAVI_WEBHOOK_SECRET
 */

import { readFileSync } from 'fs';
import { forEachCompany, getCompanyPool, closeCompanyPools } from '../lib/company-db.js';
import { runMultiTenantSync } from '../lib/cron-sync.js';

// Carrega variáveis do .env.local / .env quando executado localmente.
for (const file of ['.env.local', '.env']) {
  try {
    readFileSync(file, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq < 1 || line.startsWith('#')) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    });
  } catch {}
}

async function main() {
  const filterClientId = process.argv[2] || null;
  const filterEmpresa = process.env.EMPRESA || null;

  console.log('[batch-sync] início', new Date().toISOString(), filterClientId ? `clientId=${filterClientId}` : '', filterEmpresa ? `empresa=${filterEmpresa}` : '');

  // Se filtrar por empresa, substitui forEachCompany para rodar somente ela.
  const runner = filterEmpresa
    ? async (callback) => {
        const pool = await getCompanyPool(filterEmpresa);
        return [await callback({ empresa: filterEmpresa, pool })];
      }
    : forEachCompany;

  const companyResults = await runMultiTenantSync({ filterClientId, forEachCompany: runner });

  console.log('[batch-sync] resumo:');
  console.log(JSON.stringify(companyResults, null, 2));

  const failed = companyResults.filter(r => r.error || (r.results && r.results.some(x => !x.success)));
  if (failed.length) {
    console.error(`[batch-sync] ${failed.length} empresa(s) com falha(s)`);
    await closeCompanyPools();
    process.exit(1);
  }

  console.log('[batch-sync] concluído com sucesso', new Date().toISOString());
  await closeCompanyPools();
}

main().catch(async err => {
  console.error('[batch-sync] erro fatal:', err);
  try { await closeCompanyPools(); } catch {}
  process.exit(1);
});
