#!/usr/bin/env node
/**
 * Verifica se transações recentes estão sendo salvas no PostgreSQL.
 * Uso: node scripts/check-recent-sync.mjs
 */

import { readFileSync } from 'fs';
import pg from 'pg';
const { Client } = pg;

for (const file of ['.env.local', '.env', '.sync.env']) {
  try {
    const envFile = readFileSync(file, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL é obrigatória');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('🔍 Verificando sincronizações recentes no PostgreSQL...\n');

  const days = parseInt(process.argv[2], 10) || 3;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Resumo geral
  const overall = await client.query(`
    SELECT
      (SELECT MAX(date) FROM transactions) as last_debit_date,
      (SELECT MAX(date) FROM credit_transactions) as last_credit_date,
      (SELECT MAX(synced_at) FROM transactions) as last_debit_insert,
      (SELECT MAX(synced_at) FROM credit_transactions) as last_credit_insert,
      (SELECT COUNT(*) FROM transactions WHERE date >= $1) as debit_recent,
      (SELECT COUNT(*) FROM credit_transactions WHERE date >= $1) as credit_recent
  `, [since.split('T')[0]]);

  const o = overall.rows[0];
  console.log(`📅 Última transação de débito/conta: ${o.last_debit_date ? new Date(o.last_debit_date).toLocaleString('pt-BR') : 'nenhuma'}`);
  console.log(`💳 Última transação de cartão: ${o.last_credit_date ? new Date(o.last_credit_date).toLocaleString('pt-BR') : 'nenhuma'}`);
  console.log(`🕐 Último insert de débito/conta: ${o.last_debit_insert ? new Date(o.last_debit_insert).toLocaleString('pt-BR') : 'nenhuma'}`);
  console.log(`🕐 Último insert de cartão: ${o.last_credit_insert ? new Date(o.last_credit_insert).toLocaleString('pt-BR') : 'nenhuma'}`);
  console.log(`📊 Transações dos últimos ${days} dias: ${o.debit_recent} débito/conta + ${o.credit_recent} cartão = ${Number(o.debit_recent) + Number(o.credit_recent)} total\n`);

  // Por cliente
  const byClient = await client.query(`
    SELECT
      c.id,
      c.name,
      c.last_sync,
      (SELECT MAX(t.date) FROM transactions t WHERE t.client_id = c.id) as last_debit_date,
      (SELECT MAX(ct.date) FROM credit_transactions ct WHERE ct.client_id = c.id) as last_credit_date,
      (SELECT COUNT(*) FROM transactions t WHERE t.client_id = c.id AND t.date >= $1) as debit_recent,
      (SELECT COUNT(*) FROM credit_transactions ct WHERE ct.client_id = c.id AND ct.date >= $1) as credit_recent
    FROM clients c
    ORDER BY c.name
  `, [since.split('T')[0]]);

  console.log('📁 Por cliente:');
  for (const row of byClient.rows) {
    const totalRecent = Number(row.debit_recent) + Number(row.credit_recent);
    const lastDebit = row.last_debit_date ? new Date(row.last_debit_date).toLocaleDateString('pt-BR') : '-';
    const lastCredit = row.last_credit_date ? new Date(row.last_credit_date).toLocaleDateString('pt-BR') : '-';
    const lastSync = row.last_sync ? new Date(row.last_sync).toLocaleString('pt-BR') : '-';
    const icon = totalRecent > 0 ? '✅' : '⚠️';
    console.log(`  ${icon} ${row.name}`);
    console.log(`     último sync (clients.last_sync): ${lastSync}`);
    console.log(`     última transação: débito ${lastDebit} | cartão ${lastCredit}`);
    console.log(`     transações dos últimos ${days} dias: ${row.debit_recent} débito + ${row.credit_recent} cartão`);
  }

  await client.end();
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
