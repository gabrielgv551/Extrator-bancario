#!/usr/bin/env node
/**
 * Diagnóstico avançado — compara Pluggy vs Banco em detalhes.
 * Mostra EXATAMENTE onde estão as divergências: IDs faltantes,
 * divergências de valor/descrição/data, e estatísticas por conta.
 *
 * Uso:
 *   node scripts/diagnose.mjs <clientId> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *   node scripts/diagnose.mjs --all                    # todos os clientes
 *
 * Variáveis de ambiente:
 *   DATABASE_URL, PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET
 */

import pg from 'pg';
const { Pool } = pg;

const PLUGGY_BASE = 'https://api.pluggy.ai';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isAll = args.includes('--all');
const clientId = isAll ? null : args[0];
const fromArg = getFlag('--from') || '2026-05-01';
const toArg   = getFlag('--to')   || new Date().toISOString().split('T')[0];

function getFlag(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

if (!clientId && !isAll) {
  console.error('Uso: node scripts/diagnose.mjs <clientId> [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
  console.error('   ou: node scripts/diagnose.mjs --all');
  process.exit(1);
}

// ── Pool PostgreSQL ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Pluggy auth ───────────────────────────────────────────────────────────────

let _cachedApiKey = null;
let _cacheExpiry = 0;

async function getApiKey() {
  if (_cachedApiKey && Date.now() < _cacheExpiry) return _cachedApiKey;
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Pluggy auth falhou: ${res.status}`);
  const data = await res.json();
  _cachedApiKey = data.apiKey;
  _cacheExpiry = Date.now() + 25 * 60 * 1000;
  return _cachedApiKey;
}

async function pluggyGet(path) {
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_BASE}${path}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Pluggy error ${res.status} em ${path}`);
  }
  return res.json();
}

// ── Buscar transações da Pluggy ───────────────────────────────────────────────

async function getPluggyTransactions(itemId, { from, to }) {
  const accountsData = await pluggyGet(`/accounts?itemId=${itemId}`);
  const accounts = accountsData?.results ?? [];

  const allTxs = [];
  for (const account of accounts) {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      let url = `/transactions?accountId=${account.id}&page=${page}&pageSize=500`;
      if (from) url += `&from=${from}`;
      if (to)   url += `&to=${to}`;
      const data = await pluggyGet(url);
      totalPages = data.totalPages;
      for (const tx of data.results) {
        allTxs.push({
          id: tx.id,
          date: tx.date,
          description: tx.description ?? '',
          type: tx.type,
          amount: tx.amount,
          status: tx.status ?? null,
          accountId: account.id,
          accountName: account.name ?? null,
          accountType: account.type ?? null,
        });
      }
      page++;
    }
  }
  return allTxs;
}

// ── Buscar transações do banco ────────────────────────────────────────────────

async function getDbTransactions(clientId, { from, to }) {
  const bank = await pool.query(
    `SELECT id, date::date as date, description, type, amount, status,
            account_name, account_type
     FROM transactions
     WHERE client_id = $1 AND date::date >= $2::date AND date::date <= $3::date`,
    [clientId, from, to]
  );
  const credit = await pool.query(
    `SELECT id, date::date as date, description, type, amount, status,
            account_name, account_type
     FROM credit_transactions
     WHERE client_id = $1 AND date::date >= $2::date AND date::date <= $3::date`,
    [clientId, from, to]
  );
  return [...bank.rows, ...credit.rows].map(r => ({
    ...r,
    source: r.account_type === 'CREDIT' ? 'credit' : 'bank',
  }));
}

// ── Comparar ──────────────────────────────────────────────────────────────────

function compareTransactions(pluggyTxs, dbTxs) {
  const pluggyMap = new Map(pluggyTxs.map(t => [t.id, t]));
  const dbMap     = new Map(dbTxs.map(t => [t.id, t]));

  const missingInDb = [];   // na Pluggy, não no banco
  const missingInPluggy = []; // no banco, não na Pluggy
  const divergences = [];   // mesmo ID, dados diferentes

  // IDs na Pluggy mas não no banco
  for (const [id, ptx] of pluggyMap) {
    if (!dbMap.has(id)) {
      missingInDb.push(ptx);
    } else {
      const dtx = dbMap.get(id);
      const diffs = [];
      if (ptx.date !== dtx.date?.toISOString?.()?.split('T')[0]) {
        diffs.push(`data: ${ptx.date} vs ${dtx.date}`);
      }
      if (Math.abs(ptx.amount - dtx.amount) > 0.01) {
        diffs.push(`valor: ${ptx.amount} vs ${dtx.amount}`);
      }
      if (ptx.description !== dtx.description) {
        const pd = ptx.description.slice(0, 40);
        const dd = (dtx.description || '').slice(0, 40);
        diffs.push(`desc: "${pd}" vs "${dd}"`);
      }
      if (ptx.type !== dtx.type) {
        diffs.push(`tipo: ${ptx.type} vs ${dtx.type}`);
      }
      if (diffs.length > 0) {
        divergences.push({ id, diffs, pluggy: ptx, db: dtx });
      }
    }
  }

  // IDs no banco mas não na Pluggy
  for (const [id, dtx] of dbMap) {
    if (!pluggyMap.has(id)) {
      missingInPluggy.push(dtx);
    }
  }

  return { missingInDb, missingInPluggy, divergences };
}

// ── Diagnóstico de um cliente ─────────────────────────────────────────────────

async function diagnoseClient(client) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 Cliente: ${client.name} (${client.id})`);
  console.log(`📅 Período: ${fromArg} → ${toArg}`);
  console.log(`${'='.repeat(70)}`);

  const { rows: items } = await pool.query(
    `SELECT id, pluggy_item_id, institution_name, last_sync FROM items WHERE client_id = $1`,
    [client.id]
  );

  if (!items.length) {
    console.log('  ⚠️  Nenhum item Pluggy vinculado');
    return;
  }

  let totalPluggy = 0;
  let totalDb = 0;
  let totalMissingDb = 0;
  let totalMissingPluggy = 0;
  let totalDivergences = 0;

  for (const item of items) {
    console.log(`\n  🏦 ${item.institution_name} (item: ${item.pluggy_item_id.slice(0, 12)}...)`);
    console.log(`     Último sync: ${item.last_sync || 'NUNCA'}`);

    // Status do item na Pluggy
    let pluggyItem;
    try {
      pluggyItem = await pluggyGet(`/items/${item.pluggy_item_id}`);
      console.log(`     Status Pluggy: ${pluggyItem.status} (execution: ${pluggyItem.executionStatus || 'N/A'})`);
    } catch (e) {
      console.log(`     ❌ Erro ao buscar item: ${e.message}`);
      continue;
    }

    if (pluggyItem.status === 'UPDATING') {
      console.log(`     ⏳ Item está syncando agora — dados podem estar incompletos`);
    }

    // Buscar transações
    let pluggyTxs;
    try {
      pluggyTxs = await getPluggyTransactions(item.pluggy_item_id, { from: fromArg, to: toArg });
    } catch (e) {
      console.log(`     ❌ Erro ao buscar transações: ${e.message}`);
      continue;
    }

    const dbTxs = await getDbTransactions(client.id, { from: fromArg, to: toArg });
    // Filtrar apenas transações deste item
    const dbTxsForItem = dbTxs.filter(t => {
      // O banco não guarda pluggy_item_id nas tabelas de transação, então
      // usamos todas as transações do cliente no período
      return true;
    });

    console.log(`     Pluggy: ${pluggyTxs.length} transações`);
    console.log(`     Banco:  ${dbTxsForItem.length} transações (total do cliente)`);

    const { missingInDb, missingInPluggy, divergences } = compareTransactions(pluggyTxs, dbTxsForItem);

    totalPluggy += pluggyTxs.length;
    totalDb += dbTxsForItem.length;
    totalMissingDb += missingInDb.length;
    totalMissingPluggy += missingInPluggy.length;
    totalDivergences += divergences.length;

    // Mostrar faltantes no banco
    if (missingInDb.length > 0) {
      console.log(`\n     ❌ ${missingInDb.length} transações NA PLUGGY mas NÃO NO BANCO:`);
      for (const tx of missingInDb.slice(0, 5)) {
        console.log(`        ${tx.date} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 50)}`);
      }
      if (missingInDb.length > 5) {
        console.log(`        ... e mais ${missingInDb.length - 5}`);
      }
    }

    // Mostrar órfãos no banco
    if (missingInPluggy.length > 0) {
      console.log(`\n     🗑️  ${missingInPluggy.length} transações NO BANCO mas NÃO NA PLUGGY (órfãs):`);
      for (const tx of missingInPluggy.slice(0, 5)) {
        console.log(`        ${tx.date} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${(tx.description || '').slice(0, 50)}`);
      }
      if (missingInPluggy.length > 5) {
        console.log(`        ... e mais ${missingInPluggy.length - 5}`);
      }
    }

    // Mostrar divergências
    if (divergences.length > 0) {
      console.log(`\n     ⚠️  ${divergences.length} transações com DIVERGÊNCIAS:`);
      for (const d of divergences.slice(0, 5)) {
        console.log(`        ${d.id.slice(0, 20)}...`);
        for (const diff of d.diffs) {
          console.log(`           → ${diff}`);
        }
      }
      if (divergences.length > 5) {
        console.log(`        ... e mais ${divergences.length - 5}`);
      }
    }

    if (missingInDb.length === 0 && missingInPluggy.length === 0 && divergences.length === 0) {
      console.log(`     ✅ Perfeito — sem divergências`);
    }
  }

  // Resumo do cliente
  console.log(`\n  📋 RESUMO ${client.name}:`);
  console.log(`     Total Pluggy: ${totalPluggy} | Total Banco: ${totalDb}`);
  console.log(`     Faltantes no banco: ${totalMissingDb}`);
  console.log(`     Órfãos no banco: ${totalMissingPluggy}`);
  console.log(`     Divergências: ${totalDivergences}`);

  return {
    clientId: client.id,
    clientName: client.name,
    totalPluggy,
    totalDb,
    missingInDb: totalMissingDb,
    missingInPluggy: totalMissingPluggy,
    divergences: totalDivergences,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔍 Diagnóstico Pluggy vs Banco de Dados`);
  console.log(`📅 Período: ${fromArg} → ${toArg}`);

  let clients;
  if (isAll) {
    const { rows } = await pool.query(`SELECT id, name FROM clients ORDER BY name`);
    clients = rows;
  } else {
    const { rows } = await pool.query(`SELECT id, name FROM clients WHERE id = $1`, [clientId]);
    if (!rows.length) {
      console.error(`❌ Cliente ${clientId} não encontrado`);
      await pool.end();
      process.exit(1);
    }
    clients = rows;
  }

  console.log(`👥 ${clients.length} cliente(s) para analisar\n`);

  const results = [];
  for (const client of clients) {
    try {
      const result = await diagnoseClient(client);
      if (result) results.push(result);
    } catch (e) {
      console.error(`\n❌ Erro ao diagnosticar ${client.name}: ${e.message}`);
    }
  }

  // Resumo global
  if (results.length > 1) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 RESUMO GLOBAL`);
    console.log(`${'='.repeat(70)}`);
    const totalP = results.reduce((s, r) => s + r.totalPluggy, 0);
    const totalD = results.reduce((s, r) => s + r.totalDb, 0);
    const totalMissDb = results.reduce((s, r) => s + r.missingInDb, 0);
    const totalMissPg = results.reduce((s, r) => s + r.missingInPluggy, 0);
    const totalDiv = results.reduce((s, r) => s + r.divergences, 0);

    console.log(`Total Pluggy: ${totalP}`);
    console.log(`Total Banco:  ${totalD}`);
    console.log(`Faltantes no banco: ${totalMissDb}`);
    console.log(`Órfãos no banco: ${totalMissPg}`);
    console.log(`Divergências: ${totalDiv}`);

    if (totalMissDb === 0 && totalMissPg === 0 && totalDiv === 0) {
      console.log(`\n✅ TUDO PERFEITO!`);
    } else {
      console.log(`\n⚠️  HÁ DIVERGÊNCIAS — verifique os detalhes acima`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
