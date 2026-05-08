import pg from 'pg';

const { Client } = pg;

const CONFIG = {
  host: '37.60.236.200',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD ?? '131105Gv',
};

async function setup() {
  console.log('🔌 Conectando ao PostgreSQL...');

  // Passo 1: criar o banco "extratos" se não existir
  const admin = new Client({ ...CONFIG, database: 'postgres' });
  await admin.connect();

  const { rows } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'extratos'"
  );

  if (rows.length === 0) {
    await admin.query('CREATE DATABASE extratos');
    console.log('✅ Banco de dados "extratos" criado!');
  } else {
    console.log('ℹ️  Banco "extratos" já existe.');
  }
  await admin.end();

  // Passo 2: criar tabela clients dentro de "extratos"
  const db = new Client({ ...CONFIG, database: 'extratos' });
  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id           UUID PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      portal_token VARCHAR(64)  UNIQUE NOT NULL,
      last_sync    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token VARCHAR(64) UNIQUE`);
  await db.query(`ALTER TABLE clients DROP COLUMN IF EXISTS item_id`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id               UUID PRIMARY KEY,
      client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id   VARCHAR(255) NOT NULL,
      institution_name VARCHAR(255),
      institution_logo TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id VARCHAR(255) NOT NULL,
      date           TIMESTAMPTZ  NOT NULL,
      description  TEXT,
      type         VARCHAR(10),
      amount       NUMERIC(15,2),
      balance      NUMERIC(15,2),
      category     VARCHAR(255),
      account_name VARCHAR(255),
      account_type VARCHAR(50),
      status       VARCHAR(50),
      synced_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id VARCHAR(255) NOT NULL,
      date           TIMESTAMPTZ  NOT NULL,
      description    TEXT,
      type           VARCHAR(10),
      amount         NUMERIC(15,2),
      balance        NUMERIC(15,2),
      category       VARCHAR(255),
      account_name   VARCHAR(255),
      status         VARCHAR(50),
      synced_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_client_date
    ON credit_transactions(client_id, date DESC)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS investments (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id VARCHAR(255) NOT NULL,
      name           VARCHAR(255),
      type           VARCHAR(100),
      subtype        VARCHAR(100),
      balance        NUMERIC(15,2),
      value          NUMERIC(15,2),
      quantity       NUMERIC(20,8),
      due_date       TIMESTAMPTZ,
      issuer         VARCHAR(255),
      status         VARCHAR(50),
      synced_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_investments_client
    ON investments(client_id)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS debts (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id VARCHAR(255) NOT NULL,
      account_name   VARCHAR(255),
      type           VARCHAR(50),
      balance        NUMERIC(15,2),
      credit_limit   NUMERIC(15,2),
      synced_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_debts_client
    ON debts(client_id)
  `);

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pluggy_item_id VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS account_type VARCHAR(50)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(255)`);

  await db.query(`DROP VIEW IF EXISTS all_transactions`);
  await db.query(`
    CREATE VIEW all_transactions AS
    SELECT
      t.id, t.client_id, t.pluggy_item_id, t.date, t.description, t.type,
      t.amount, t.balance, t.category,
      t.account_name, t.account_type, t.institution_name,
      t.counterparty_name AS razao_social,
      t.status, t.synced_at, 'bank' AS source
    FROM transactions t
    UNION ALL
    SELECT
      ct.id, ct.client_id, ct.pluggy_item_id, ct.date, ct.description, ct.type,
      ct.amount, ct.balance, ct.category,
      ct.account_name, ct.account_type, ct.institution_name,
      ct.counterparty_name AS razao_social,
      ct.status, ct.synced_at, 'credit' AS source
    FROM credit_transactions ct
  `);
  console.log('✅ View "all_transactions" criada/atualizada!');
  await db.query(`UPDATE transactions SET pluggy_item_id = '' WHERE pluggy_item_id IS NULL`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_client_date
    ON transactions(client_id, date DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_item
    ON transactions(pluggy_item_id)
  `);

  console.log('✅ Tabelas "clients", "items" e "transactions" criadas/atualizadas!');
  console.log('\n📋 Adicione ao seu .env.local e ao Vercel:');
  console.log('DATABASE_URL=postgresql://postgres:****@37.60.236.200:5432/extratos');
  console.log('ADMIN_PASSWORD=sua_senha_admin\n');

  await db.end();
}

setup().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
