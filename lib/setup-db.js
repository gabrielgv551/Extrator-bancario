import pg from 'pg';

const { Client } = pg;

export function parseDatabaseUrl(url) {
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

export async function runSetupQueries(db) {
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
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS classificar_de DATE`);

  // Tabelas do motor de pré-classificação (regras + rastreio + catálogo).
  await db.query(`
    CREATE TABLE IF NOT EXISTS caixa_regras_classificacao (
      id SERIAL PRIMARY KEY,
      empresa VARCHAR(50) NOT NULL,
      descricao_padrao TEXT,
      tipo_padrao VARCHAR(50),
      categoria_l1 VARCHAR(100),
      categoria_l2 VARCHAR(100),
      categoria_l3 VARCHAR(100),
      razao_social_padrao TEXT,
      documento_padrao VARCHAR(50),
      banco_padrao VARCHAR(100),
      categoria_sugerida VARCHAR(100) NOT NULL,
      prioridade INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      origem VARCHAR(30) DEFAULT 'seed',
      aplicacao VARCHAR(50) NOT NULL DEFAULT 'extrato',
      criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_caixa_regras_classificacao_empresa ON caixa_regras_classificacao(empresa, ativo, prioridade DESC)`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS caixa_regras_classificacao_empresa_regra_idx
    ON caixa_regras_classificacao (
      empresa,
      COALESCE(aplicacao, ''),
      COALESCE(descricao_padrao, ''),
      COALESCE(tipo_padrao, ''),
      COALESCE(categoria_l1, ''),
      COALESCE(categoria_l2, ''),
      COALESCE(categoria_l3, ''),
      COALESCE(razao_social_padrao, ''),
      COALESCE(documento_padrao, ''),
      COALESCE(banco_padrao, '')
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS caixa_extrato_classificacoes (
      id SERIAL PRIMARY KEY,
      empresa TEXT NOT NULL,
      origem TEXT NOT NULL,
      transacao_id TEXT NOT NULL,
      categoria TEXT,
      sugerido_por TEXT,
      confirmado BOOLEAN DEFAULT FALSE,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE (empresa, origem, transacao_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_caixa_extrato_classificacoes_empresa ON caixa_extrato_classificacoes(empresa)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS caixa_categorias (
      empresa VARCHAR(50) NOT NULL,
      nome VARCHAR(100) NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'item',
      ordem INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (empresa, nome)
    )
  `);
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
      api_order    INTEGER,
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
      api_order      INTEGER,
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
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS company_cnpj VARCHAR(14)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS date_transacted TIMESTAMPTZ`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS date_transacted TIMESTAMPTZ`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS counterparty_document VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS company_cnpj VARCHAR(14)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_l1 VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_l2 VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_l3 VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS category_l1 VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS category_l2 VARCHAR(255)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS category_l3 VARCHAR(255)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS classificacao_l1 VARCHAR(100)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS classificacao_l2 VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS classificacao_l1 VARCHAR(100)`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS classificacao_l2 VARCHAR(100)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS api_order INTEGER`);
  await db.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS api_order INTEGER`);
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

  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'pluggy'`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS klavi_link_id VARCHAR(255)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS klavi_consent_id VARCHAR(255)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS business_tax_id VARCHAR(14)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS personal_tax_id VARCHAR(11)`);
  await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS tax_type VARCHAR(10)`);
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS klavi_webhook_debug (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     VARCHAR(255),
      link_id      VARCHAR(255),
      consent_id   VARCHAR(255),
      event        VARCHAR(100),
      payload      JSONB NOT NULL,
      received_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_klavi_webhook_debug_received ON klavi_webhook_debug(received_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_klavi_webhook_debug_link ON klavi_webhook_debug(link_id, received_at DESC)`);

  await db.query(`DROP VIEW IF EXISTS all_transactions CASCADE`);
  await db.query(`
    CREATE VIEW all_transactions AS
    SELECT
      t.id, t.client_id, c.name AS client_name, t.pluggy_item_id, t.date, t.description, t.type,
      t.amount, t.balance, t.category, t.category_l1, t.category_l2, t.category_l3,
      t.classificacao_l1, t.classificacao_l2,
      t.account_name, t.account_number, t.account_type, t.institution_name,
      t.counterparty_name AS razao_social, t.counterparty_document,
      t.company_name, t.company_cnpj,
      t.status, t.date_transacted, t.api_order, t.synced_at, 'bank' AS source
    FROM transactions t
    LEFT JOIN clients c ON c.id = t.client_id
    UNION ALL
    SELECT
      ct.id, ct.client_id, c.name AS client_name, ct.pluggy_item_id, ct.date, ct.description, ct.type,
      ct.amount, ct.balance, ct.category, ct.category_l1, ct.category_l2, ct.category_l3,
      ct.classificacao_l1, ct.classificacao_l2,
      ct.account_name, ct.account_number, ct.account_type, ct.institution_name,
      ct.counterparty_name AS razao_social, ct.counterparty_document,
      ct.company_name, ct.company_cnpj,
      ct.status, ct.date_transacted, ct.api_order, ct.synced_at, 'credit' AS source
    FROM credit_transactions ct
    LEFT JOIN clients c ON c.id = ct.client_id
  `);

  await db.query(`UPDATE transactions SET pluggy_item_id = '' WHERE pluggy_item_id IS NULL`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_client_date
    ON transactions(client_id, date DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_client_account_date_order
    ON transactions(client_id, account_number, date DESC, api_order ASC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_client_account_date_order
    ON credit_transactions(client_id, account_number, date DESC, api_order ASC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_item
    ON transactions(pluggy_item_id)
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_items_status_error ON items(status, consecutive_errors) WHERE deleted_at IS NULL`);

  // View materializada usada pelo n8n / relatórios.
  await db.query(`DROP MATERIALIZED VIEW IF EXISTS mv_report_transactions CASCADE`);
  await db.query(`
    CREATE MATERIALIZED VIEW mv_report_transactions AS
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
      a.company_name AS razao_social_titular,
      CASE
        WHEN a.company_cnpj IS NULL THEN NULL
        WHEN length(a.company_cnpj) = 14
          THEN substring(a.company_cnpj, 1, 2) || '.' || substring(a.company_cnpj, 3, 3) || '.' || substring(a.company_cnpj, 6, 3) || '/' || substring(a.company_cnpj, 9, 4) || '-' || substring(a.company_cnpj, 13, 2)
        ELSE a.company_cnpj
      END AS cnpj_titular,
      CASE WHEN a.source = 'credit' THEN 'Cartao de Credito' ELSE 'Conta Bancaria' END AS origem,
      a.status,
      a.api_order,
      a.date AS data_lancamento_raw
    FROM all_transactions a
    ORDER BY a.date DESC, a.api_order ASC
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mv_report_transactions_date ON mv_report_transactions(data_lancamento_raw DESC)`);

  // View normal alternativa (sempre atualizada, sem precisar de REFRESH).
  await db.query(`DROP VIEW IF EXISTS v_report_transactions CASCADE`);
  await db.query(`
    CREATE VIEW v_report_transactions AS
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
      a.company_name AS razao_social_titular,
      CASE
        WHEN a.company_cnpj IS NULL THEN NULL
        WHEN length(a.company_cnpj) = 14
          THEN substring(a.company_cnpj, 1, 2) || '.' || substring(a.company_cnpj, 3, 3) || '.' || substring(a.company_cnpj, 6, 3) || '/' || substring(a.company_cnpj, 9, 4) || '-' || substring(a.company_cnpj, 13, 2)
        ELSE a.company_cnpj
      END AS cnpj_titular,
      CASE WHEN a.source = 'credit' THEN 'Cartao de Credito' ELSE 'Conta Bancaria' END AS origem,
      a.status,
      a.api_order,
      a.date AS data_lancamento_raw
    FROM all_transactions a
    ORDER BY a.date DESC, a.api_order ASC
  `);

  // View de extrato com as colunas do relatório padrão (l1/l2/l3 = hierarquia de categoria).
  await db.query(`DROP VIEW IF EXISTS extrato CASCADE`);
  await db.query(`
    CREATE VIEW extrato AS
    SELECT
      a.id,
      a.client_name AS cliente,
      a.date::date AS data,
      a.description AS descricao,
      CASE WHEN a.type = 'CREDIT' THEN 'Entrada' ELSE 'Saída' END AS tipo,
      a.amount AS valor_reais,
      a.balance AS saldo,
      a.category_l1 AS l1,
      a.category_l2 AS l2,
      a.category_l3 AS l3,
      a.account_name AS conta,
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
      a.classificacao_l1,
      a.classificacao_l2,
      CASE WHEN a.source = 'credit' THEN 'Cartão de Crédito' ELSE 'Conta Bancária' END AS origem,
      a.status
    FROM all_transactions a
  `);

  // Backfill: preenche client_name nas transações existentes a partir de clients.
  await db.query(`
    UPDATE transactions t
    SET client_name = c.name
    FROM clients c
    WHERE t.client_id = c.id AND t.client_name IS NULL
  `);
  await db.query(`
    UPDATE credit_transactions ct
    SET client_name = c.name
    FROM clients c
    WHERE ct.client_id = c.id AND ct.client_name IS NULL
  `);
}

export async function setupDatabase() {
  const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!parsed) {
    throw new Error('DATABASE_URL não configurada');
  }

  const config = {
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
  };

  await ensureDatabaseExists(config, parsed.database);

  const db = new Client({ ...config, database: parsed.database });
  await db.connect();
  try {
    await runSetupQueries(db);
  } finally {
    await db.end();
  }

  return parsed.database;
}

export async function setupCompanyDatabase(config, databaseName) {
  await ensureDatabaseExists(config, databaseName);

  const db = new Client({ ...config, database: databaseName });
  await db.connect();
  try {
    await runSetupQueries(db);
  } finally {
    await db.end();
  }

  return databaseName;
}
