#!/usr/bin/env node
/**
 * Migração: adiciona colunas de status/erro em items e cria tabelas de log/lock.
 * Uso: node scripts/migrate-items-status.mjs
 */

import pg from 'pg';
const { Client } = pg;

function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port || '5432', 10),
      user: u.username,
      password: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
if (!parsed) {
  console.error('❌ DATABASE_URL não configurada');
  process.exit(1);
}

const client = new Client({ ...parsed, database: 'extratos' });

async function run() {
  await client.connect();
  console.log('🔌 Conectado ao banco extratos');

  const alters = [
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS status VARCHAR(50)`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS execution_status VARCHAR(100)`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS error_code VARCHAR(100)`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS error_message TEXT`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS sync_count INTEGER DEFAULT 0`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER DEFAULT 0`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS requires_reconnect BOOLEAN DEFAULT FALSE`,
  ];

  for (const sql of alters) {
    await client.query(sql);
    console.log('✅', sql);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id          UUID REFERENCES clients(id) ON DELETE CASCADE,
      item_id            UUID REFERENCES items(id) ON DELETE CASCADE,
      started_at         TIMESTAMPTZ DEFAULT NOW(),
      finished_at        TIMESTAMPTZ,
      status             VARCHAR(50),
      error_message      TEXT,
      transactions_count INTEGER DEFAULT 0
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_logs_client_item ON sync_logs(client_id, item_id, started_at DESC)`);
  console.log('✅ Tabela sync_logs criada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_locks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner       VARCHAR(255) NOT NULL,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_locks_expires ON sync_locks(expires_at)`);
  console.log('✅ Tabela sync_locks criada');

  await client.end();
  console.log('🎉 Migração concluída');
}

run().catch(err => {
  console.error('❌ Erro na migração:', err);
  process.exit(1);
});
