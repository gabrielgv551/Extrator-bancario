#!/usr/bin/env node
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
  } catch { /* ignore */ }
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Variável ${name} não definida`);
  return process.env[name];
}

const pool = new Pool({
  host: requireEnv('CENTRAL_DB_HOST'),
  port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
  database: 'have_natori',
  user: requireEnv('CENTRAL_DB_USER'),
  password: requireEnv('CENTRAL_DB_PASSWORD'),
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function main() {
  console.log('Banco: have_natori');

  const { rows: clients } = await pool.query('SELECT * FROM extrator_clients ORDER BY created_at');
  console.log('\nClientes:', clients.length);
  for (const c of clients) {
    console.log(JSON.stringify(c, null, 2));
  }

  const { rows: items } = await pool.query('SELECT * FROM extrator_items ORDER BY created_at');
  console.log('\nItens (incluindo deletados):', items.length);
  for (const i of items) {
    console.log(JSON.stringify(i, null, 2).slice(0, 1000));
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
