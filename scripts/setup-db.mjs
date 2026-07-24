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
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}

const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
if (!parsed) {
  console.error('❌ DATABASE_URL não configurada. Configure a variável de ambiente e tente novamente.');
  process.exit(1);
}

const DATABASE_NAME = parsed.database;

const CONFIG = {
  host: parsed.host,
  port: parsed.port,
  user: parsed.user,
  password: parsed.password,
};

async function setup() {
  console.log('🔌 Conectando ao PostgreSQL...');

  // Passo 1: criar o banco de destino se não existir
  const admin = new Client({ ...CONFIG, database: 'postgres' });
  await admin.connect();

  const { rows } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [DATABASE_NAME]
  );

  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE "${DATABASE_NAME.replace(/"/g, '""')}"`);
    console.log(`✅ Banco de dados "${DATABASE_NAME}" criado!`);
  } else {
    console.log(`ℹ️  Banco "${DATABASE_NAME}" já existe.`);
  }
  await admin.end();

  // Passo 2: criar tabelas dentro do banco de destino
  const db = new Client({ ...CONFIG, database: DATABASE_NAME });
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

  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_tax_id VARCHAR(14)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS gestor_empresa VARCHAR(255)`);

  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token VARCHAR(64) UNIQUE`);
  await db.query(`ALTER TABLE clients DROP COLUMN IF EXISTS item_id`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id               UUID PRIMARY KEY,
      client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id   VARCHAR(255),
      institution_name VARCHAR(255),
      institution_logo TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`ALTER TABLE items ALTER COLUMN pluggy_item_id DROP NOT NULL`);

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
      balance           NUMERIC(15,2),
      credit_limit      NUMERIC(15,2),
      institution_name  VARCHAR(255),
      synced_at         TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_debts_client
    ON debts(client_id)
  `);

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pluggy_item_id VARCHAR(255)`);
  await db.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS account_type VARCHAR(50)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS counterparty_document VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS date_transacted TIMESTAMPTZ`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS date_transacted TIMESTAMPTZ`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS counterparty_document VARCHAR(255)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS account_numbers TEXT`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS status VARCHAR(50)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS execution_status VARCHAR(100)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS error_code VARCHAR(100)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS error_message TEXT`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS sync_count INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS requires_reconnect BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS consent_expires_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  // Campos para suporte ao provedor Klavi (migração Pluggy → Klavi)
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'pluggy'`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS klavi_link_id VARCHAR(255)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS klavi_consent_id VARCHAR(255)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS business_tax_id VARCHAR(14)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS personal_tax_id VARCHAR(11)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS institution_code VARCHAR(10)`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_provider ON items(provider)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_klavi_link ON items(klavi_link_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_klavi_consent ON items(klavi_consent_id)`);

  await db.query(`
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
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sync_logs_client_item ON sync_logs(client_id, item_id, started_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sync_locks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner       VARCHAR(255) NOT NULL,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sync_locks_expires ON sync_locks(expires_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     VARCHAR(255) NOT NULL UNIQUE,
      event        VARCHAR(100) NOT NULL,
      item_id      VARCHAR(255),
      payload      JSONB,
      received_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_item ON webhook_events(item_id, received_at DESC)`);

  await db.query(`DROP VIEW IF EXISTS all_transactions`);
  await db.query(`
    CREATE VIEW all_transactions AS
    SELECT
      t.id, t.client_id, t.pluggy_item_id, t.date, t.description, t.type,
      t.amount, t.balance, t.category,
      t.account_name, t.account_number, t.account_type, t.institution_name,
      t.counterparty_name AS razao_social, t.counterparty_document,
      t.status, t.date_transacted, t.synced_at, 'bank' AS source
    FROM transactions t
    UNION ALL
    SELECT
      ct.id, ct.client_id, ct.pluggy_item_id, ct.date, ct.description, ct.type,
      ct.amount, ct.balance, ct.category,
      ct.account_name, ct.account_number, ct.account_type, ct.institution_name,
      ct.counterparty_name AS razao_social, ct.counterparty_document,
      ct.status, ct.date_transacted, ct.synced_at, 'credit' AS source
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

  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_status_error ON items(status, consecutive_errors) WHERE deleted_at IS NULL`);

  console.log('✅ Tabelas criadas/atualizadas no banco "' + DATABASE_NAME + '"!');
  console.log('\n📋 DATABASE_URL atual:');
  console.log(process.env.DATABASE_URL);
  console.log('\n📋 Adicione ao Vercel:');
  console.log('ADMIN_PASSWORD=sua_senha_admin\n');

  await db.end();
}

setup().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
