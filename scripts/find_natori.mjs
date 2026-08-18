#!/usr/bin/env node
/**
 * Busca a Natori em todos os bancos de dados do servidor PostgreSQL.
 */

import { readFileSync } from 'fs';
import pg from 'pg';

const { Client, Pool } = pg;

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

const centralConfig = {
  host: requireEnv('CENTRAL_DB_HOST'),
  port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
  database: 'postgres', // banco de catálogo
  user: requireEnv('CENTRAL_DB_USER'),
  password: requireEnv('CENTRAL_DB_PASSWORD'),
  ssl: { rejectUnauthorized: false },
};

async function listDatabases() {
  const client = new Client(centralConfig);
  await client.connect();
  const { rows } = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`);
  await client.end();
  return rows.map(r => r.datname);
}

async function searchInDatabase(database, searchTerm) {
  const client = new Client({ ...centralConfig, database });
  try {
    await client.connect();
    // Tenta descobrir tabelas que parecem ter clientes
    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ILIKE ANY(ARRAY['%name%', '%client%', '%nome%', '%empresa%', '%business%'])
      GROUP BY table_name
      ORDER BY table_name
    `);

    const results = [];
    for (const { table_name } of tables) {
      try {
        const { rows } = await client.query(`
          SELECT * FROM "${table_name}"
          WHERE ${['name', 'nome', 'client_name', 'nome_cliente', 'empresa', 'business_name', 'company_name']
            .filter(col => col !== table_name)
            .map(col => `"${col}" ILIKE $1`).join(' OR ') || 'FALSE'}
          LIMIT 10
        `, [`%${searchTerm}%`]);
        if (rows.length) {
          results.push({ table: table_name, rows });
        }
      } catch (e) {
        // ignora tabelas sem as colunas esperadas
      }
    }
    return results;
  } catch (e) {
    return [{ error: e.message }];
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  console.log('🔍 Buscando Natori em todos os bancos...');
  const databases = await listDatabases();
  console.log(`Total de bancos: ${databases.length}`);
  console.log(databases.join(', '));
  console.log();

  const searchTerms = ['natori', 'natori food', 'food', 'nator'];

  for (const db of databases) {
    if (db.startsWith('pg_') || db === 'postgres') continue;
    for (const term of searchTerms) {
      const results = await searchInDatabase(db, term);
      if (results.length && !results[0]?.error) {
        console.log(`\n✅ Banco ${db} — termo "${term}":`);
        for (const r of results) {
          console.log(`  Tabela: ${r.table}`);
          for (const row of r.rows) {
            console.log(`    ${JSON.stringify(row).slice(0, 300)}`);
          }
        }
      }
    }
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  console.error(err.stack);
  process.exit(1);
});
