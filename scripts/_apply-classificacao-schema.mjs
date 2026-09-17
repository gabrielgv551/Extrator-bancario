#!/usr/bin/env node
/**
 * Aplica SOMENTE o schema de classificação manual (classificacao_l1/l2)
 * nos bancos de todas as empresas ativas, sem rodar o setup completo.
 *
 * Uso: node scripts/_apply-classificacao-schema.mjs
 */

import { readFileSync } from 'fs';
import pg from 'pg';
import { listActiveCompanies, getCompanyDbConfig } from '../lib/company-db.js';

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

const { Client } = pg;

const VIEW_SQL = `
  CREATE VIEW extrator_all_transactions AS
  SELECT
    t.id, t.client_id, c.name AS client_name, t.pluggy_item_id, t.date, t.description, t.type,
    t.amount, t.balance, t.category, t.category_l1, t.category_l2, t.category_l3,
    t.classificacao_l1, t.classificacao_l2,
    t.account_name, t.account_number, t.account_type, t.institution_name,
    t.counterparty_name AS razao_social, t.counterparty_document,
    t.company_name, t.company_cnpj,
    t.status, t.date_transacted, t.api_order, t.synced_at, 'bank' AS source
  FROM extrator_transactions t
  LEFT JOIN extrator_clients c ON c.id = t.client_id
  UNION ALL
  SELECT
    ct.id, ct.client_id, c.name AS client_name, ct.pluggy_item_id, ct.date, ct.description, ct.type,
    ct.amount, ct.balance, ct.category, ct.category_l1, ct.category_l2, ct.category_l3,
    ct.classificacao_l1, ct.classificacao_l2,
    ct.account_name, ct.account_number, ct.account_type, ct.institution_name,
    ct.counterparty_name AS razao_social, ct.counterparty_document,
    ct.company_name, ct.company_cnpj,
    ct.status, ct.date_transacted, ct.api_order, ct.synced_at, 'credit' AS source
  FROM extrator_credit_transactions ct
  LEFT JOIN extrator_clients c ON c.id = ct.client_id
`;

async function applyToCompany(slug) {
  const cfg = await getCompanyDbConfig(slug);
  const db = new Client({ ...cfg, connectionTimeoutMillis: 10000 });
  try {
    await db.connect();
    for (const t of ['extrator_transactions', 'extrator_credit_transactions']) {
      await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS classificacao_l1 VARCHAR(100)`);
      await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS classificacao_l2 VARCHAR(100)`);
    }
    await db.query('DROP VIEW IF EXISTS extrator_all_transactions CASCADE');
    await db.query(VIEW_SQL);
    console.log(`✅ ${slug} (${cfg.database})`);
  } finally {
    await db.end().catch(() => {});
  }
}

async function main() {
  const companies = await listActiveCompanies();
  console.log(`Aplicando schema de classificação em ${companies.length} empresa(s)...\n`);
  for (const { slug, name } of companies) {
    try {
      await applyToCompany(slug);
    } catch (err) {
      console.error(`❌ ${slug} (${name || slug}): ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
