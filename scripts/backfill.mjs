import pg from 'pg';
import { readFileSync } from 'fs';

// Carrega variáveis do .env.local
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

const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host:     '37.60.236.200',
      port:     5432,
      user:     'postgres',
      password: process.env.DB_PASSWORD ?? '131105Gv',
      database: 'extratos',
    });

const PLUGGY_API_BASE = 'https://api.pluggy.ai';
const FROM = process.argv[2] || '2025-01-01';
const TO   = process.argv[3] || new Date().toISOString().split('T')[0];

async function getApiKey() {
  const res = await fetch(`${PLUGGY_API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
  });
  const data = await res.json();
  return data.apiKey;
}

async function getAccounts(itemId, apiKey) {
  const res = await fetch(`${PLUGGY_API_BASE}/accounts?itemId=${itemId}`, { headers: { 'X-API-KEY': apiKey } });
  const data = await res.json();
  return data.results ?? [];
}

async function getAllTransactions(itemId, institutionName, apiKey) {
  const accounts = await getAccounts(itemId, apiKey);
  const allTx = [];
  for (const account of accounts) {
    let page = 1, totalPages = 1;
    while (page <= totalPages) {
      const res = await fetch(
        `${PLUGGY_API_BASE}/transactions?accountId=${account.id}&page=${page}&pageSize=500&from=${FROM}&to=${TO}`,
        { headers: { 'X-API-KEY': apiKey } }
      );
      const data = await res.json();
      totalPages = data.totalPages ?? 1;
      for (const tx of data.results ?? []) {
        const counterpartyName =
          tx.type === 'DEBIT'
            ? (tx.paymentData?.receiver?.name ?? tx.merchant?.businessName ?? tx.merchant?.name ?? null)
            : (tx.paymentData?.payer?.name ?? null);
        allTx.push({ ...tx, accountName: account.name, accountType: account.type, institutionName, counterpartyName });
      }
      page++;
    }
  }
  return allTx;
}

async function upsert(table, tx, clientId, itemId) {
  await pool.query(
    `INSERT INTO ${table}
       (id, client_id, pluggy_item_id, date, description, type, amount, balance, category,
        account_name, account_type, institution_name, counterparty_name, status, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (id) DO UPDATE SET
       description       = EXCLUDED.description,
       amount            = EXCLUDED.amount,
       balance           = EXCLUDED.balance,
       category          = EXCLUDED.category,
       institution_name  = EXCLUDED.institution_name,
       counterparty_name = EXCLUDED.counterparty_name,
       status            = EXCLUDED.status,
       synced_at         = NOW()`,
    [tx.id, clientId, itemId, tx.date, tx.description ?? '', tx.type, tx.amount,
     tx.balance ?? null, tx.category ?? null, tx.accountName ?? null, tx.accountType ?? null,
     tx.institutionName ?? null, tx.counterpartyName ?? null, tx.status ?? null]
  );
}

async function run() {
  console.log(`🔄 Backfill de ${FROM} até ${TO}`);
  const apiKey = await getApiKey();

  const { rows: clients } = await pool.query('SELECT id, name FROM clients ORDER BY name');
  for (const client of clients) {
    const { rows: items } = await pool.query('SELECT id, pluggy_item_id, institution_name FROM items WHERE client_id = $1', [client.id]);
    console.log(`\n👤 ${client.name} — ${items.length} banco(s)`);
    for (const item of items) {
      console.log(`  🏦 ${item.institution_name}...`);
      try {
        const accounts = await getAccounts(item.pluggy_item_id, apiKey);
        console.log(`     📂 ${accounts.length} conta(s) encontrada(s): ${accounts.map(a => `${a.name}(${a.type})`).join(', ')}`);
        const txs = await getAllTransactions(item.pluggy_item_id, item.institution_name, apiKey);
        const bank   = txs.filter(t => t.accountType !== 'CREDIT');
        const credit = txs.filter(t => t.accountType === 'CREDIT');
        for (const tx of bank)   await upsert('transactions',        tx, client.id, item.pluggy_item_id);
        for (const tx of credit) await upsert('credit_transactions', tx, client.id, item.pluggy_item_id);
        console.log(`     ✅ ${bank.length} bancárias + ${credit.length} crédito`);
      } catch (err) {
        console.error(`     ❌ Erro: ${err.message}`);
      }
    }
  }

  console.log('\n✅ Backfill concluído!');
  await pool.end();
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
