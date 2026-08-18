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
  `SELECT received_at, event, link_id, consent_id, payload->>'code' as code, payload->>'message' as message, payload->>'productName' as productName
   FROM extrator_klavi_webhook_debug ORDER BY received_at DESC LIMIT 50`
);
for (const r of rows) {
  console.log([r.received_at, r.event || 'n/a', (r.link_id || '').slice(0,8), r.code, (r.message || '').slice(0,30), r.productname].join(' | '));
}
await pool.end();
