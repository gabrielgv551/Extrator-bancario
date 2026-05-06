import pg from 'pg';

const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

const SELECT = `
  SELECT id, name, item_id AS "itemId", last_sync AS "lastSync", created_at AS "createdAt"
  FROM clients
`;

export async function getClients() {
  const { rows } = await getPool().query(`${SELECT} ORDER BY created_at ASC`);
  return rows;
}

export async function getClientById(id) {
  const { rows } = await getPool().query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createClient({ id, name }) {
  const { rows } = await getPool().query(
    `INSERT INTO clients (id, name, item_id, last_sync, created_at)
     VALUES ($1, $2, NULL, NULL, NOW())
     RETURNING id, name, item_id AS "itemId", last_sync AS "lastSync", created_at AS "createdAt"`,
    [id, name]
  );
  return rows[0];
}

export async function updateClient(id, updates) {
  const sets = [];
  const values = [];
  let i = 1;

  if (updates.itemId   !== undefined) { sets.push(`item_id   = $${i++}`); values.push(updates.itemId); }
  if (updates.name     !== undefined) { sets.push(`name      = $${i++}`); values.push(updates.name); }
  if (updates.lastSync !== undefined) { sets.push(`last_sync = $${i++}`); values.push(updates.lastSync); }

  if (sets.length === 0) return getClientById(id);

  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, name, item_id AS "itemId", last_sync AS "lastSync", created_at AS "createdAt"`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteClient(id) {
  const { rowCount } = await getPool().query('DELETE FROM clients WHERE id = $1', [id]);
  return rowCount > 0;
}
