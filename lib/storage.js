import pg from 'pg';
import { randomBytes } from 'crypto';

const { Pool } = pg;
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export function generatePortalToken() {
  return randomBytes(32).toString('hex');
}

// ── Clients ─────────────────────────────────────────────────────────────────

const C = `SELECT id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt" FROM clients`;

export async function getClients() {
  const { rows } = await getPool().query(`${C} ORDER BY created_at ASC`);
  return rows;
}

export async function getClientById(id) {
  const { rows } = await getPool().query(`${C} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getClientByToken(token) {
  const { rows } = await getPool().query(`${C} WHERE portal_token = $1`, [token]);
  return rows[0] ?? null;
}

export async function createClient({ id, name, portalToken }) {
  const { rows } = await getPool().query(
    `INSERT INTO clients (id, name, portal_token, last_sync, created_at)
     VALUES ($1, $2, $3, NULL, NOW())
     RETURNING id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt"`,
    [id, name, portalToken]
  );
  return rows[0];
}

export async function updateClient(id, updates) {
  const sets = [];
  const values = [];
  let i = 1;
  if (updates.name     !== undefined) { sets.push(`name      = $${i++}`); values.push(updates.name); }
  if (updates.lastSync !== undefined) { sets.push(`last_sync = $${i++}`); values.push(updates.lastSync); }
  if (sets.length === 0) return getClientById(id);
  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt"`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteClient(id) {
  const { rowCount } = await getPool().query('DELETE FROM clients WHERE id = $1', [id]);
  return rowCount > 0;
}

// ── Items ────────────────────────────────────────────────────────────────────

const I = `SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId",
           institution_name AS "institutionName", institution_logo AS "institutionLogo",
           created_at AS "createdAt" FROM items`;

export async function getItemsByClientId(clientId) {
  const { rows } = await getPool().query(`${I} WHERE client_id = $1 ORDER BY created_at ASC`, [clientId]);
  return rows;
}

export async function addItem({ id, clientId, pluggyItemId, institutionName, institutionLogo }) {
  const { rows } = await getPool().query(
    `INSERT INTO items (id, client_id, pluggy_item_id, institution_name, institution_logo, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId",
               institution_name AS "institutionName", institution_logo AS "institutionLogo", created_at AS "createdAt"`,
    [id, clientId, pluggyItemId, institutionName ?? null, institutionLogo ?? null]
  );
  return rows[0];
}

export async function removeItem(id) {
  const { rowCount } = await getPool().query('DELETE FROM items WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function getItemByPluggyId(pluggyItemId) {
  const { rows } = await getPool().query(`${I} WHERE pluggy_item_id = $1`, [pluggyItemId]);
  return rows[0] ?? null;
}
