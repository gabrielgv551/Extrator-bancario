import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const envContent = fs.readFileSync('.sync.env', 'utf8');
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length > 0 && !key.startsWith('#')) {
    process.env[key.trim()] = rest.join('=').trim();
  }
}

const PLUGGY_API_BASE = 'https://api.pluggy.ai';

async function fetchPluggy(path, options = {}) {
  const res = await fetch(`${PLUGGY_API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Pluggy API error ${res.status} em ${path}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getApiKey() {
  const data = await fetchPluggy('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  return data.apiKey;
}

async function getItem(apiKey, itemId) {
  return fetchPluggy(`/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const items = await client.query(`
    SELECT c.id as client_id, c.name as client_name, c.last_sync,
           i.id as local_item_id, i.pluggy_item_id, i.institution_name, i.account_numbers,
           i.created_at as local_created_at
    FROM clients c
    JOIN items i ON c.id = i.client_id
    WHERE i.institution_name ILIKE '%bradesco%'
    ORDER BY c.name, i.created_at
  `);

  console.log(`Total de itens Bradesco: ${items.rows.length}\n`);

  const apiKey = await getApiKey();
  const results = [];

  for (const row of items.rows) {
    try {
      const item = await getItem(apiKey, row.pluggy_item_id);
      results.push({
        ...row,
        status: item.status,
        execution_status: item.executionStatus,
        connector_id: item.connector?.id,
        connector_name: item.connector?.name,
        connector_type: item.connector?.type,
        has_mfa: item.connector?.hasMFA,
        is_open_finance: item.connector?.isOpenFinance,
        pluggy_created_at: item.createdAt,
        pluggy_last_updated: item.lastUpdatedAt,
        error: item.error,
      });
    } catch (e) {
      results.push({
        ...row,
        status: `ERRO: ${e.message}`,
      });
    }
  }

  // Agrupar por cliente
  const byClient = {};
  for (const r of results) {
    if (!byClient[r.client_name]) byClient[r.client_name] = [];
    byClient[r.client_name].push(r);
  }

  for (const [clientName, clientItems] of Object.entries(byClient)) {
    console.log(`\n=== ${clientName} ===`);
    console.log(`last_sync: ${clientItems[0].last_sync}`);
    for (const item of clientItems) {
      console.log(`  item: ${item.pluggy_item_id}`);
      console.log(`    status: ${item.status} | execution: ${item.execution_status || 'n/a'}`);
      console.log(`    connector: ${item.connector_name} (id:${item.connector_id}, type:${item.connector_type}, MFA:${item.has_mfa}, OF:${item.is_open_finance})`);
      console.log(`    criado: ${item.pluggy_created_at || item.local_created_at} | atualizado: ${item.pluggy_last_updated}`);
      if (item.error) console.log(`    erro: ${JSON.stringify(item.error)}`);
      console.log(`    contas: ${item.account_numbers}`);
    }
  }

  // Verificar últimas transações por cliente
  console.log('\n\n=== Últimas transações por cliente Bradesco ===');
  const txs = await client.query(`
    SELECT c.name, MAX(t.date) as ultima_transacao, COUNT(*) as total_tx
    FROM clients c
    JOIN items i ON c.id = i.client_id
    LEFT JOIN transactions t ON t.client_id = c.id
    WHERE i.institution_name ILIKE '%bradesco%'
    GROUP BY c.id, c.name
    ORDER BY c.name
  `);
  for (const row of txs.rows) {
    console.log(`${row.name}: última transação = ${row.ultima_transacao || 'nenhuma'}, total = ${row.total_tx}`);
  }

  await client.end();
}

main().catch(console.error);
