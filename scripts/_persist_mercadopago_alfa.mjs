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
  } catch { }
}

const pool = new Pool({
  host: process.env.CENTRAL_DB_HOST,
  port: parseInt(process.env.CENTRAL_DB_PORT),
  database: 'have_alfadistribuidora',
  user: process.env.CENTRAL_DB_USER,
  password: process.env.CENTRAL_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const { rows } = await pool.query(
  `SELECT payload FROM extrator_klavi_webhook_debug WHERE link_id = '43ccd561-f0d5-43e8-b2f3-cc9b0bdfd911' ORDER BY received_at DESC LIMIT 1`
);
const payload = rows[0].payload;

const { mapKlaviReportToLocal } = await import('../lib/klavi.js');
const {
  getClientById,
  getItemById,
  upsertCreditTransactionsBatch,
  updateItemStatus,
} = await import('../lib/storage-company.js');

const itemId = '34718d1e-10a2-4737-a138-c4086074b9e4';
const item = await getItemById(pool, itemId);
const client = await getClientById(pool, item.clientId);

const mapped = mapKlaviReportToLocal({
  productName: payload.productName,
  report: payload,
  institutionCode: item.institutionCode,
  institutionName: item.institutionName,
});

console.log('Mapped:', mapped.creditTransactions.length, 'credit transactions');

if (mapped.creditTransactions.length > 0) {
  const saved = await upsertCreditTransactionsBatch(pool, item.clientId, client.name, item.id, mapped.creditTransactions);
  console.log('Saved:', saved);
}

const accountNumbers = mapped.accounts.map(a => a.number).filter(Boolean);
const uniqueAccountNumbers = [...new Set(accountNumbers)].join(', ');
await updateItemStatus(pool, item.id, {
  status: 'UPDATED',
  accountNumbers: uniqueAccountNumbers || null,
});
console.log('Item atualizado para UPDATED, accounts:', uniqueAccountNumbers);

await pool.end();
