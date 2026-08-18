#!/usr/bin/env node
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

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

const u = new URL(process.env.DATABASE_URL);
const c = new Client({
  host: u.hostname,
  port: u.port,
  database: decodeURIComponent(u.pathname.slice(1)),
  user: u.username,
  password: decodeURIComponent(u.password),
  ssl: false,
});

await c.connect();
const { rows } = await c.query('SELECT id, name, business_tax_id FROM clients ORDER BY name');
console.log('Total clientes:', rows.length);
for (const r of rows) {
  if (r.name.toLowerCase().includes('natori') || r.name.toLowerCase().includes('nator')) {
    console.log('>>>', r.id, '|', r.name, '|', r.business_tax_id || '-');
  } else {
    console.log(r.id, '|', r.name, '|', r.business_tax_id || '-');
  }
}
await c.end();
