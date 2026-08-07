// Mapeamento central para resolver portal_token / link_id / consent_id / pluggy_item_id
// -> empresa_slug. Usado pelas rotas publicas do portal e pelos webhooks externos
// para descobrir em qual banco tenant os dados estao armazenados.
// As tabelas ficam no banco central (have_gestor).

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

export async function ensureItemLocationTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS extrator_item_locations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_slug  VARCHAR(50) NOT NULL,
      client_id     UUID NOT NULL,
      item_id       UUID NOT NULL,
      pluggy_item_id VARCHAR(255),
      klavi_link_id VARCHAR(255),
      klavi_consent_id VARCHAR(255),
      created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (item_id)
    )
  `);
  await getPool().query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_pluggy
      ON extrator_item_locations(pluggy_item_id)
      WHERE pluggy_item_id IS NOT NULL
  `);
  await getPool().query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_link
      ON extrator_item_locations(klavi_link_id)
      WHERE klavi_link_id IS NOT NULL
  `);
  await getPool().query(`
    CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_consent
      ON extrator_item_locations(klavi_consent_id)
      WHERE klavi_consent_id IS NOT NULL
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
  await ensureTokenMapTable();
  await getPool().query(`DELETE FROM extrator_portal_tokens WHERE portal_token = $1`, [token]);
}

export async function registerItemLocation(empresaSlug, { itemId, clientId, pluggyItemId, klaviLinkId, klaviConsentId }) {
  if (!empresaSlug || !itemId || !clientId) throw new Error('empresaSlug, itemId e clientId sao obrigatorios');
  await ensureItemLocationTable();
  await getPool().query(
    `INSERT INTO extrator_item_locations
       (empresa_slug, client_id, item_id, pluggy_item_id, klavi_link_id, klavi_consent_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (item_id) DO UPDATE SET
       empresa_slug = EXCLUDED.empresa_slug,
       client_id = EXCLUDED.client_id,
       pluggy_item_id = EXCLUDED.pluggy_item_id,
       klavi_link_id = EXCLUDED.klavi_link_id,
       klavi_consent_id = EXCLUDED.klavi_consent_id`,
    [
      empresaSlug.toLowerCase().trim(),
      clientId,
      itemId,
      pluggyItemId || null,
      klaviLinkId || null,
      klaviConsentId || null,
    ]
  );
}

export async function getEmpresaByItem({ pluggyItemId, klaviLinkId, klaviConsentId }) {
  await ensureItemLocationTable();
  const conditions = [];
  const values = [];
  let i = 1;
  if (pluggyItemId) { conditions.push(`pluggy_item_id = $${i++}`); values.push(pluggyItemId); }
  if (klaviLinkId) { conditions.push(`klavi_link_id = $${i++}`); values.push(klaviLinkId); }
  if (klaviConsentId) { conditions.push(`klavi_consent_id = $${i++}`); values.push(klaviConsentId); }
  if (conditions.length === 0) return null;

  const { rows } = await getPool().query(
    `SELECT empresa_slug FROM extrator_item_locations
     WHERE ${conditions.join(' OR ')}
     LIMIT 1`,
    values
  );
  return rows[0]?.empresa_slug || null;
}

export async function unregisterItemLocation(itemId) {
  if (!itemId) return;
  await ensureItemLocationTable();
  await getPool().query(`DELETE FROM extrator_item_locations WHERE item_id = $1`, [itemId]);
}
