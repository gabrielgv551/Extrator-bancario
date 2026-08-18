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
const mapped = mapKlaviReportToLocal({
  productName: payload.productName,
  report: payload,
  institutionCode: '323',
  institutionName: 'Mercado Pago',
});

console.log('Accounts:', mapped.accounts.length);
console.log('Bank transactions:', mapped.bankTransactions.length);
console.log('Credit transactions:', mapped.creditTransactions.length);
console.log('Investments:', mapped.investments.length);
console.log('Debts:', mapped.debts.length);
if (mapped.creditTransactions.length > 0) {
  console.log('Sample credit tx:', JSON.stringify(mapped.creditTransactions[0], null, 2));
}
if (mapped.accounts.length > 0) {
  console.log('Sample account:', JSON.stringify(mapped.accounts[0], null, 2));
}

await pool.end();
