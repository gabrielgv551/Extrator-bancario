// Mapeamento central portal_token -> empresa_slug.
// Usado pelas rotas publicas do portal para descobrir em qual banco tenant
// os dados do cliente estao armazenados.
// A tabela extrator_portal_tokens fica no banco central (have_gestor).

import pg from 'pg';

const { Pool } = pg;

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Variavel de ambiente obrigatoria nao definida: ${name}`);
  return value;
}

function getCentralConfig() {
  return {
    host: requireEnv('CENTRAL_DB_HOST', process.env.POSTGRES_HOST),
    port: parseInt(process.env.CENTRAL_DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.CENTRAL_DB_NAME || 'have_gestor',
    user: process.env.CENTRAL_DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: requireEnv('CENTRAL_DB_PASSWORD', process.env.POSTGRES_PASSWORD),
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ ...getCentralConfig(), max: 5 });
    pool.on('error', (err) => console.error('[central-token-map] erro no pool:', err.message));
  }
  return pool;
}

export async function ensureTokenMapTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS extrator_portal_tokens (
      portal_token VARCHAR(64) PRIMARY KEY,
      empresa_slug VARCHAR(50) NOT NULL,
      client_id UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await getPool().query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_portal_tokens_empresa
      ON extrator_portal_tokens(empresa_slug)
  `);
}

export async function getEmpresaByToken(token) {
  if (!token) return null;
  await ensureTokenMapTable();
  const { rows } = await getPool().query(
    `SELECT empresa_slug FROM extrator_portal_tokens WHERE portal_token = $1 LIMIT 1`,
    [token]
  );
  return rows[0]?.empresa_slug || null;
}

export async function registerToken(token, empresaSlug, clientId) {
  if (!token || !empresaSlug || !clientId) throw new Error('token, empresaSlug e clientId sao obrigatorios');
  await ensureTokenMapTable();
  await getPool().query(
    `INSERT INTO extrator_portal_tokens (portal_token, empresa_slug, client_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (portal_token) DO UPDATE SET
       empresa_slug = EXCLUDED.empresa_slug,
       client_id = EXCLUDED.client_id`,
    [token, empresaSlug.toLowerCase().trim(), clientId]
  );
}

export async function unregisterToken(token) {
  if (!token) return;
  await getPool().query(`DELETE FROM extrator_portal_tokens WHERE portal_token = $1`, [token]);
}
