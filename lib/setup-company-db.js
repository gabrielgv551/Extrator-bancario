import pg from 'pg';

const { Client } = pg;

export async function ensureDatabaseExists(config, databaseName) {
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName]
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
      return true;
    }
    return false;
  } finally {
    await admin.end();
  }
}

export async function runCompanySetupQueries(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_clients (
      id           UUID PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      portal_token VARCHAR(64)  UNIQUE NOT NULL,
      last_sync    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`ALTER TABLE extrator_clients ADD COLUMN IF NOT EXISTS business_tax_id VARCHAR(14)`);
  await db.query(`ALTER TABLE extrator_clients ADD COLUMN IF NOT EXISTS gestor_empresa VARCHAR(255)`);
  await db.query(`ALTER TABLE extrator_clients ADD COLUMN IF NOT EXISTS portal_token VARCHAR(64) UNIQUE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_items (
      id               UUID PRIMARY KEY,
      client_id        UUID NOT NULL REFERENCES extrator_clients(id) ON DELETE CASCADE,
      pluggy_item_id   VARCHAR(255),
      institution_name VARCHAR(255),
      institution_logo TEXT,
      account_numbers  TEXT,
      status           VARCHAR(50),
      execution_status VARCHAR(100),
      error_code       VARCHAR(100),
      error_message    TEXT,
      last_updated_at  TIMESTAMPTZ,
      last_error_at    TIMESTAMPTZ,
      sync_count       INTEGER DEFAULT 0,
      consecutive_errors INTEGER DEFAULT 0,
      requires_reconnect BOOLEAN DEFAULT FALSE,
      deleted_at       TIMESTAMPTZ,
      consent_expires_at TIMESTAMPTZ,
      notification_sent_at TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ DEFAULT NOW(),
      provider         VARCHAR(20) DEFAULT 'pluggy',
      klavi_link_id    VARCHAR(255),
      klavi_consent_id VARCHAR(255),
      business_tax_id  VARCHAR(14),
      personal_tax_id  VARCHAR(11),
      tax_type         VARCHAR(10),
      institution_code VARCHAR(10),
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_transactions (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES extrator_clients(id) ON DELETE CASCADE,
      client_name    VARCHAR(255),
      pluggy_item_id VARCHAR(255) NOT NULL,
      date           TIMESTAMPTZ  NOT NULL,
      description  TEXT,
      type         VARCHAR(10),
      amount       NUMERIC(15,2),
      balance      NUMERIC(15,2),
      category     VARCHAR(255),
      category_l1  VARCHAR(255),
      category_l2  VARCHAR(255),
      category_l3  VARCHAR(255),
      account_name VARCHAR(255),
      account_number VARCHAR(100),
      account_type VARCHAR(50),
      institution_name VARCHAR(255),
      counterparty_name VARCHAR(255),
      counterparty_document VARCHAR(255),
      status       VARCHAR(50),
      date_transacted TIMESTAMPTZ,
      api_order    INTEGER,
      synced_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_transactions_client_date
    ON extrator_transactions(client_id, date DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_transactions_client_account_date_order
    ON extrator_transactions(client_id, account_number, date DESC, api_order ASC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_transactions_item
    ON extrator_transactions(pluggy_item_id)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_credit_transactions (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES extrator_clients(id) ON DELETE CASCADE,
      client_name    VARCHAR(255),
      pluggy_item_id VARCHAR(255) NOT NULL,
      date           TIMESTAMPTZ  NOT NULL,
      description    TEXT,
      type           VARCHAR(10),
      amount         NUMERIC(15,2),
      balance        NUMERIC(15,2),
      category       VARCHAR(255),
      category_l1    VARCHAR(255),
      category_l2    VARCHAR(255),
      category_l3    VARCHAR(255),
      account_name   VARCHAR(255),
      account_number VARCHAR(100),
      account_type   VARCHAR(50),
      institution_name VARCHAR(255),
      counterparty_name VARCHAR(255),
      counterparty_document VARCHAR(255),
      status         VARCHAR(50),
      date_transacted TIMESTAMPTZ,
      api_order      INTEGER,
      synced_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_credit_transactions_client_date
    ON extrator_credit_transactions(client_id, date DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_credit_transactions_client_account_date_order
    ON extrator_credit_transactions(client_id, account_number, date DESC, api_order ASC)
  `);

  // Garante api_order em bancos legados criados antes dessa coluna.
  await db.query(`ALTER TABLE extrator_transactions ADD COLUMN IF NOT EXISTS api_order INTEGER`);
  await db.query(`ALTER TABLE extrator_credit_transactions ADD COLUMN IF NOT EXISTS api_order INTEGER`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_investments (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES extrator_clients(id) ON DELETE CASCADE,
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
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_investments_client
    ON extrator_investments(client_id)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_debts (
      id             VARCHAR(255) PRIMARY KEY,
      client_id      UUID         NOT NULL REFERENCES extrator_clients(id) ON DELETE CASCADE,
      pluggy_item_id VARCHAR(255) NOT NULL,
      account_name   VARCHAR(255),
      type           VARCHAR(50),
      balance        NUMERIC(15,2),
      credit_limit   NUMERIC(15,2),
      institution_name VARCHAR(255),
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_debts_client
    ON extrator_debts(client_id)
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_items_provider ON extrator_items(provider)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_items_klavi_link ON extrator_items(klavi_link_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_items_klavi_consent ON extrator_items(klavi_consent_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_sync_logs (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id          UUID REFERENCES extrator_clients(id) ON DELETE CASCADE,
      item_id            UUID REFERENCES extrator_items(id) ON DELETE CASCADE,
      started_at         TIMESTAMPTZ DEFAULT NOW(),
      finished_at        TIMESTAMPTZ,
      status             VARCHAR(50),
      error_message      TEXT,
      transactions_count INTEGER DEFAULT 0
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_sync_logs_client_item ON extrator_sync_logs(client_id, item_id, started_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_sync_locks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner       VARCHAR(255) NOT NULL,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_sync_locks_expires ON extrator_sync_locks(expires_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_webhook_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     VARCHAR(255) NOT NULL UNIQUE,
      event        VARCHAR(100) NOT NULL,
      item_id      VARCHAR(255),
      payload      JSONB,
      received_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_webhook_events_item ON extrator_webhook_events(item_id, received_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_klavi_webhook_debug (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     VARCHAR(255),
      link_id      VARCHAR(255),
      consent_id   VARCHAR(255),
      event        VARCHAR(100),
      payload      JSONB NOT NULL,
      received_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_webhook_debug_received ON extrator_klavi_webhook_debug(received_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_webhook_debug_link ON extrator_klavi_webhook_debug(link_id, received_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS extrator_klavi_request_logs (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requested_at       TIMESTAMPTZ DEFAULT NOW(),
      source             VARCHAR(50),
      method             VARCHAR(10) NOT NULL,
      path               VARCHAR(255) NOT NULL,
      query              JSONB,
      request_body       JSONB,
      response_status    INTEGER,
      response_body      JSONB,
      duration_ms        INTEGER,
      link_id            VARCHAR(255),
      consent_id         VARCHAR(255),
      personal_tax_id    VARCHAR(11),
      business_tax_id    VARCHAR(14),
      institution_code   VARCHAR(10),
      error_message      TEXT,
      client_id          UUID REFERENCES extrator_clients(id) ON DELETE SET NULL,
      item_id            UUID REFERENCES extrator_items(id) ON DELETE SET NULL
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_req_logs_requested_at ON extrator_klavi_request_logs(requested_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_req_logs_link ON extrator_klavi_request_logs(link_id, requested_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_req_logs_consent ON extrator_klavi_request_logs(consent_id, requested_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_req_logs_client ON extrator_klavi_request_logs(client_id, requested_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_klavi_req_logs_path_status ON extrator_klavi_request_logs(path, response_status, requested_at DESC)`);

  await db.query(`DROP VIEW IF EXISTS extrator_all_transactions CASCADE`);
  await db.query(`
    CREATE VIEW extrator_all_transactions AS
    SELECT
      t.id, t.client_id, c.name AS client_name, t.pluggy_item_id, t.date, t.description, t.type,
      t.amount, t.balance, t.category, t.category_l1, t.category_l2, t.category_l3,
      t.account_name, t.account_number, t.account_type, t.institution_name,
      t.counterparty_name AS razao_social, t.counterparty_document,
      t.status, t.date_transacted, t.api_order, t.synced_at, 'bank' AS source
    FROM extrator_transactions t
    LEFT JOIN extrator_clients c ON c.id = t.client_id
    UNION ALL
    SELECT
      ct.id, ct.client_id, c.name AS client_name, ct.pluggy_item_id, ct.date, ct.description, ct.type,
      ct.amount, ct.balance, ct.category, ct.category_l1, ct.category_l2, ct.category_l3,
      ct.account_name, ct.account_number, ct.account_type, ct.institution_name,
      ct.counterparty_name AS razao_social, ct.counterparty_document,
      ct.status, ct.date_transacted, ct.api_order, ct.synced_at, 'credit' AS source
    FROM extrator_credit_transactions ct
    LEFT JOIN extrator_clients c ON c.id = ct.client_id
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_items_deleted_at ON extrator_items(deleted_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_items_status_error ON extrator_items(status, consecutive_errors) WHERE deleted_at IS NULL`);

  // View materializada usada pelo n8n / relatórios.
  await db.query(`DROP MATERIALIZED VIEW IF EXISTS extrator_mv_report_transactions CASCADE`);
  await db.query(`
    CREATE MATERIALIZED VIEW extrator_mv_report_transactions AS
    SELECT
      a.id,
      a.client_name AS cliente,
      to_char(a.date::date, 'DD/MM/YYYY') AS data_lancamento,
      to_char(a.date, 'HH24:MI:SS') AS hora_lancamento,
      to_char(a.date_transacted, 'DD/MM/YYYY') AS data_transacao,
      a.description AS descricao,
      CASE WHEN a.type = 'CREDIT' THEN 'Entrada' ELSE 'Saida' END AS tipo,
      replace(a.amount::text, '.', ',') AS valor_reais,
      replace(a.balance::text, '.', ',') AS saldo,
      a.category_l1 AS categoria_l1,
      a.category_l2 AS categoria_l2,
      a.category_l3 AS categoria_l3,
      a.account_name AS conta,
      a.account_number AS agencia_numero,
      a.account_type AS tipo_conta,
      a.institution_name AS banco,
      a.razao_social,
      CASE
        WHEN a.counterparty_document IS NULL THEN NULL
        WHEN length(a.counterparty_document) = 14
          THEN substring(a.counterparty_document, 1, 2) || '.' || substring(a.counterparty_document, 3, 3) || '.' || substring(a.counterparty_document, 6, 3) || '/' || substring(a.counterparty_document, 9, 4) || '-' || substring(a.counterparty_document, 13, 2)
        WHEN length(a.counterparty_document) = 11
          THEN substring(a.counterparty_document, 1, 3) || '.' || substring(a.counterparty_document, 4, 3) || '.' || substring(a.counterparty_document, 7, 3) || '-' || substring(a.counterparty_document, 10, 2)
        ELSE a.counterparty_document
      END AS cnpj_cpf,
      CASE WHEN a.source = 'credit' THEN 'Cartao de Credito' ELSE 'Conta Bancaria' END AS origem,
      a.status,
      a.api_order,
      a.date AS data_lancamento_raw
    FROM extrator_all_transactions a
    ORDER BY a.date DESC, a.api_order ASC
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_extrator_mv_report_transactions_date ON extrator_mv_report_transactions(data_lancamento_raw DESC)`);

  // View normal alternativa (sempre atualizada, sem precisar de REFRESH).
  await db.query(`DROP VIEW IF EXISTS extrator_v_report_transactions CASCADE`);
  await db.query(`
    CREATE VIEW extrator_v_report_transactions AS
    SELECT
      a.id,
      a.client_name AS cliente,
      a.date::date AS data_lancamento,
      to_char(a.date, 'HH24:MI:SS') AS hora_lancamento,
      to_char(a.date_transacted, 'DD/MM/YYYY') AS data_transacao,
      a.description AS descricao,
      CASE WHEN a.type = 'CREDIT' THEN 'Entrada' ELSE 'Saida' END AS tipo,
      replace(a.amount::text, '.', ',') AS valor_reais,
      replace(a.balance::text, '.', ',') AS saldo,
      a.category_l1 AS categoria_l1,
      a.category_l2 AS categoria_l2,
      a.category_l3 AS categoria_l3,
      a.account_name AS conta,
      a.account_number AS agencia_numero,
      a.account_type AS tipo_conta,
      a.institution_name AS banco,
      a.razao_social,
      CASE
        WHEN a.counterparty_document IS NULL THEN NULL
        WHEN length(a.counterparty_document) = 14
          THEN substring(a.counterparty_document, 1, 2) || '.' || substring(a.counterparty_document, 3, 3) || '.' || substring(a.counterparty_document, 6, 3) || '/' || substring(a.counterparty_document, 9, 4) || '-' || substring(a.counterparty_document, 13, 2)
        WHEN length(a.counterparty_document) = 11
          THEN substring(a.counterparty_document, 1, 3) || '.' || substring(a.counterparty_document, 4, 3) || '.' || substring(a.counterparty_document, 7, 3) || '-' || substring(a.counterparty_document, 10, 2)
        ELSE a.counterparty_document
      END AS cnpj_cpf,
      CASE WHEN a.source = 'credit' THEN 'Cartao de Credito' ELSE 'Conta Bancaria' END AS origem,
      a.status,
      a.api_order,
      a.date AS data_lancamento_raw
    FROM extrator_all_transactions a
    ORDER BY a.date DESC, a.api_order ASC
  `);
}

export async function resetCompanyDatabase(config, databaseName) {
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  try {
    // Termina conexões ativas no banco antes de dropar
    await admin.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `, [databaseName]);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }
  return setupCompanyDatabase(config, databaseName);
}

export async function setupCompanyDatabase(config, databaseName) {
  await ensureDatabaseExists(config, databaseName);

  const db = new Client({ ...config, database: databaseName });
  await db.connect();
  try {
    await runCompanySetupQueries(db);
  } finally {
    await db.end();
  }

  return databaseName;
}
