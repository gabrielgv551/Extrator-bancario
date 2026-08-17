#!/usr/bin/env node
/**
 * Sync por empresa (tenant) — Klavi e Pluggy legado.
 * Uso: node scripts/sync-company.mjs <empresa-slug>|--all [--reprocess] [clientId]
 *
 * --all       : processa todas as empresas ativas do banco central.
 * --reprocess : reprocessa o último webhook/receipt salvo de cada item Klavi
 *               usando o mapKlaviReportToLocal atual (útil para testar mudanças
 *               no mapeamento sem esperar novo webhook).
 */

import { readFileSync } from 'fs';
import pg from 'pg';
const { Pool } = pg;

for (const file of ['.env.local', '.env.production.pulled', '.env']) {
  try {
    const envFile = readFileSync(file, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && (!process.env[key] || !process.env[key].trim())) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

const runAll = process.argv.includes('--all');
const empresaSlug = runAll ? null : process.argv[2];
const shouldReprocess = process.argv.includes('--reprocess');
const filterClientId = process.argv.find((a, i) => i > 2 && !a.startsWith('--') && a !== '--all') || null;

if (!runAll && (!empresaSlug || empresaSlug.startsWith('--'))) {
  console.error('Uso: node scripts/sync-company.mjs <empresa-slug>|--all [--reprocess] [clientId]');
  process.exit(1);
}

async function listActiveCompanies() {
  const { getCentralConfig } = await import('../lib/company-db.js');
  const central = new Pool({ ...getCentralConfig(), max: 2 });
  try {
    const { rows } = await central.query(`SELECT slug FROM empresas WHERE status = 'ativo' ORDER BY slug`);
    return rows.map(r => r.slug);
  } finally {
    await central.end();
  }
}

async function processCompany(slug) {
  const { getCompanyPool } = await import('../lib/company-db.js');
  const pool = await getCompanyPool(slug);

  try {
    const { getClients, getItemsByClientId, updateItemStatus, upsertTransactionsBatch, upsertCreditTransactionsBatch } = await import('../lib/storage-company.js');
    const { requestBusinessInstitutionData, requestPersonalInstitutionData, getActiveKlaviConsent, mapKlaviReportToLocal, DEFAULT_KLAVI_PRODUCTS } = await import('../lib/klavi.js');
    const { enrichTransactionsWithCompanyName } = await import('../lib/cnpj-enrichment.js');

    let clients = await getClients(pool);
    if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

    console.log(`[sync-company] empresa=${slug} clientes=${clients.length} reprocess=${shouldReprocess}`);

    for (const client of clients) {
      const items = await getItemsByClientId(pool, client.id);
      const klaviItems = items.filter(i => i.provider === 'klavi' || i.klaviLinkId);

      for (const item of klaviItems) {
        console.log(`\n[sync-company] cliente=${client.name} banco=${item.institutionName || item.institutionCode}`);

        // Reprocessa último webhook salvo (útil para testar novo mapeamento)
        if (shouldReprocess) {
          const { rows } = await pool.query(
            `SELECT payload FROM extrator_klavi_webhook_debug
             WHERE link_id = $1 OR consent_id = $2
             ORDER BY received_at DESC LIMIT 1`,
            [item.klaviLinkId, item.klaviConsentId]
          );
          if (rows.length) {
            const payload = rows[0].payload;
            const report = payload?.report || payload?.data || payload;
            const productName = payload?.productName || payload?.product_name || report?.productName || report?.productname || null;
            if (report && productName) {
              const mapped = mapKlaviReportToLocal({
                productName,
                report,
                institutionCode: item.institutionCode,
                institutionName: item.institutionName,
              });

              // Enriquece CNPJ da contraparte com razão social.
              await enrichTransactionsWithCompanyName(mapped.bankTransactions);
              await enrichTransactionsWithCompanyName(mapped.creditTransactions);

              console.log(`  ↳ reprocessando webhook: bank=${mapped.bankTransactions.length} credit=${mapped.creditTransactions.length}`);
              if (mapped.bankTransactions.length) {
                const saved = await upsertTransactionsBatch(pool, client.id, client.name, item.id, mapped.bankTransactions);
                console.log(`  ✓ bank transactions persistidas: ${saved}`);
              }
              if (mapped.creditTransactions.length) {
                const saved = await upsertCreditTransactionsBatch(pool, client.id, client.name, item.id, mapped.creditTransactions);
                console.log(`  ✓ credit transactions persistidas: ${saved}`);
              }

              // Mostra amostra de razão social
              const sample = mapped.bankTransactions[0] || mapped.creditTransactions[0];
              if (sample) {
                console.log(`  📋 sample: counterpartyName="${sample.counterpartyName}" counterpartyDocument="${sample.counterpartyDocument}"`);
              }
            } else {
              console.log(`  ⚠ webhook salvo não contém relatório reconhecível`);
            }
          } else {
            console.log(`  ⚠ nenhum webhook salvo para reprocessar`);
          }
        }

        // Solicita novo relatório
        const isPF = item.taxType === 'pf';
        const businessTaxId = item.businessTaxId || client.businessTaxId;
        if (!item.klaviLinkId || !item.institutionCode || (!isPF && !businessTaxId)) {
          console.log(`  ⚠ item incompleto, pulando request`);
          continue;
        }

        try {
          const activeConsent = await getActiveKlaviConsent({ item, businessTaxId, personalTaxId: item.personalTaxId || undefined });
          const consentUpdates = {};
          if (activeConsent.consentId && activeConsent.consentId !== item.klaviConsentId) consentUpdates.klaviConsentId = activeConsent.consentId;
          if (activeConsent.linkId && activeConsent.linkId !== item.klaviLinkId) consentUpdates.klaviLinkId = activeConsent.linkId;
          if (Object.keys(consentUpdates).length > 0) {
            await updateItemStatus(pool, item.id, consentUpdates);
            console.log(`  ↳ consent/link atualizado:`, consentUpdates);
          }

          if (!activeConsent.consentId) {
            console.log(`  ⚠ nenhum consentimento ativo`);
            continue;
          }

          const requestBody = {
            institutionCode: item.institutionCode,
            linkId: activeConsent.linkId,
            consentIds: [activeConsent.consentId],
            products: activeConsent.products?.length ? activeConsent.products : DEFAULT_KLAVI_PRODUCTS,
            productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
          };

          if (isPF) {
            if (!item.personalTaxId) {
              console.log(`  ⚠ CPF não encontrado para PF`);
              continue;
            }
            console.log(`  🔄 solicitando relatório PF...`);
            await requestPersonalInstitutionData({ ...requestBody, personalTaxId: item.personalTaxId });
          } else {
            console.log(`  🔄 solicitando relatório PJ...`);
            await requestBusinessInstitutionData({ ...requestBody, businessTaxId });
          }

          await updateItemStatus(pool, item.id, { status: 'UPDATING' });
          console.log(`  ✓ solicitação enviada (dados chegam via webhook)`);
        } catch (err) {
          console.error(`  ✗ erro ao solicitar:`, err.message, err.status, err.code);
        }
      }
    }
  } finally {
    // Não fecha o pool aqui porque ele é cacheado pelo company-db.
  }
}

async function main() {
  const companies = runAll ? await listActiveCompanies() : [empresaSlug];
  console.log(`[sync-company] empresas a processar: ${companies.join(', ')}`);

  for (const slug of companies) {
    try {
      await processCompany(slug);
    } catch (err) {
      console.error(`[sync-company] erro na empresa ${slug}:`, err.message);
    }
  }

  const { closeCompanyPools } = await import('../lib/company-db.js');
  await closeCompanyPools();
}

main().catch(async err => {
  console.error('[sync-company] erro fatal:', err);
  try {
    const { closeCompanyPools } = await import('../lib/company-db.js');
    await closeCompanyPools();
  } catch {}
  process.exit(1);
});
