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

const { rows: item } = await pool.query(
  `SELECT id, institution_name, status, account_numbers, sync_count FROM extrator_items WHERE id = '34718d1e-10a2-4737-a138-c4086074b9e4'`
);
const { rows: credit } = await pool.query(
  `SELECT count(*) as total FROM extrator_credit_transactions WHERE pluggy_item_id = '34718d1e-10a2-4737-a138-c4086074b9e4'`
);
const { rows: bank } = await pool.query(
  `SELECT count(*) as total FROM extrator_transactions WHERE pluggy_item_id = '34718d1e-10a2-4737-a138-c4086074b9e4'`
);
const { rows: samples } = await pool.query(
  `SELECT date, description, amount, type FROM extrator_credit_transactions WHERE pluggy_item_id = '34718d1e-10a2-4737-a138-c4086074b9e4' ORDER BY date DESC LIMIT 5`
);

console.log('Item Mercado Pago:', item[0]);
console.log('Transações cartão:', credit[0].total);
console.log('Transações conta:', bank[0].total);
console.log('Últimas transações:');
for (const t of samples) {
  console.log(`  ${t.date.toISOString().slice(0,10)} | ${t.description.slice(0,30).padEnd(30)} | ${t.type.padEnd(6)} | ${t.amount}`);
}

await pool.end();
