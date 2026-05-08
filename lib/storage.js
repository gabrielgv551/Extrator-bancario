import pg from 'pg';
import { randomBytes, createHash } from 'crypto';

const { Pool } = pg;

const ACCOUNT_TYPE_PT = {
  'BANK':       'Conta Bancária',
  'CREDIT':     'Cartão de Crédito',
  'LOAN':       'Empréstimo',
  'INVESTMENT': 'Investimento',
};
const toAccountTypePT = t => (t ? (ACCOUNT_TYPE_PT[t] ?? t) : null);
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

export async function updateItemInstitution(id, institutionName, institutionLogo) {
  await getPool().query(
    `UPDATE items SET institution_name = $1, institution_logo = $2 WHERE id = $3`,
    [institutionName ?? null, institutionLogo ?? null, id]
  );
}

export async function getItemByPluggyId(pluggyItemId) {
  const { rows } = await getPool().query(`${I} WHERE pluggy_item_id = $1`, [pluggyItemId]);
  return rows[0] ?? null;
}

// ── Transactions ─────────────────────────────────────────────────────────────

export async function deleteOrphanTransactions(pluggyItemId, from, to, currentIds) {
  if (!from || !to || !currentIds.length) return;
  const pool = getPool();
  await pool.query(
    `DELETE FROM transactions
     WHERE pluggy_item_id = $1
       AND date::date >= $2::date
       AND date::date <= $3::date
       AND id != ALL($4::text[])`,
    [pluggyItemId, from, to, currentIds]
  );
  await pool.query(
    `DELETE FROM credit_transactions
     WHERE pluggy_item_id = $1
       AND date::date >= $2::date
       AND date::date <= $3::date
       AND id != ALL($4::text[])`,
    [pluggyItemId, from, to, currentIds]
  );
}

export async function upsertTransactions(clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const pool = getPool();
  let count = 0;
  for (const tx of transactions) {
    await pool.query(
      `INSERT INTO transactions
         (id, client_id, pluggy_item_id, date, description, type, amount, balance, category, account_name, account_type, institution_name, counterparty_name, status, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (id) DO UPDATE SET
         description       = EXCLUDED.description,
         amount            = EXCLUDED.amount,
         balance           = EXCLUDED.balance,
         category          = EXCLUDED.category,
         institution_name  = EXCLUDED.institution_name,
         counterparty_name = EXCLUDED.counterparty_name,
         status            = EXCLUDED.status,
         synced_at         = NOW()`,
      [
        tx.id,
        clientId,
        pluggyItemId,
        tx.date,
        tx.description ?? '',
        tx.type,
        tx.amount,
        tx.balance ?? null,
        tx.category ?? null,
        tx.accountName ?? null,
        toAccountTypePT(tx.accountType),
        tx.institutionName ?? null,
        tx.counterpartyName ?? null,
        tx.status ?? null,
      ]
    );
    count++;
  }
  return count;
}

export async function hasTransactions(clientId) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM transactions WHERE client_id = $1 LIMIT 1',
    [clientId]
  );
  return rows.length > 0;
}

export async function hasTransactionsByItemId(pluggyItemId) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM transactions WHERE pluggy_item_id = $1 LIMIT 1',
    [pluggyItemId]
  );
  return rows.length > 0;
}

export async function upsertCreditTransactions(clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const pool = getPool();
  let count = 0;
  for (const tx of transactions) {
    await pool.query(
      `INSERT INTO credit_transactions
         (id, client_id, pluggy_item_id, date, description, type, amount, balance, category, account_name, account_type, institution_name, counterparty_name, status, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (id) DO UPDATE SET
         description       = EXCLUDED.description,
         amount            = EXCLUDED.amount,
         balance           = EXCLUDED.balance,
         category          = EXCLUDED.category,
         institution_name  = EXCLUDED.institution_name,
         counterparty_name = EXCLUDED.counterparty_name,
         status            = EXCLUDED.status,
         synced_at         = NOW()`,
      [tx.id, clientId, pluggyItemId, tx.date, tx.description ?? '', tx.type,
       tx.amount, tx.balance ?? null, tx.category ?? null, tx.accountName ?? null,
       toAccountTypePT(tx.accountType), tx.institutionName ?? null, tx.counterpartyName ?? null, tx.status ?? null]
    );
    count++;
  }
  return count;
}

export async function upsertInvestments(clientId, pluggyItemId, investments) {
  if (!investments.length) return 0;
  const pool = getPool();
  let count = 0;
  for (const inv of investments) {
    await pool.query(
      `INSERT INTO investments
         (id, client_id, pluggy_item_id, name, type, subtype, balance, value, quantity, due_date, issuer, status, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance   = EXCLUDED.balance,
         value     = EXCLUDED.value,
         quantity  = EXCLUDED.quantity,
         status    = EXCLUDED.status,
         synced_at = NOW()`,
      [inv.id, clientId, pluggyItemId, inv.name ?? null, inv.type ?? null, inv.subtype ?? null,
       inv.balance ?? null, inv.value ?? null, inv.quantity ?? null,
       inv.dueDate ?? null, inv.issuer ?? null, inv.status ?? null]
    );
    count++;
  }
  return count;
}

export async function upsertDebts(clientId, pluggyItemId, accounts) {
  if (!accounts.length) return 0;
  const pool = getPool();
  let count = 0;
  for (const acc of accounts) {
    await pool.query(
      `INSERT INTO debts
         (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance      = EXCLUDED.balance,
         credit_limit = EXCLUDED.credit_limit,
         synced_at    = NOW()`,
      [acc.id, clientId, pluggyItemId, acc.name ?? null, acc.type ?? null,
       acc.balance ?? null, acc.creditLimit ?? null]
    );
    count++;
  }
  return count;
}

export async function upsertDerivedDebts(clientId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       REGEXP_REPLACE(description, '\\s+\\d+/\\d+', '')        AS name,
       SUBSTRING(description FROM '\\d+/(\\d+)')::int          AS total_parcelas,
       MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)     AS ultima_parcela,
       ROUND(AVG(ABS(amount))::numeric, 2)                     AS valor_medio,
       ROUND(SUM(ABS(amount))::numeric, 2)                     AS total_pago,
       ROUND((AVG(ABS(amount)) *
         (SUBSTRING(description FROM '\\d+/(\\d+)')::int
          - MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)))::numeric, 2) AS saldo_estimado,
       pluggy_item_id
     FROM transactions
     WHERE client_id = $1
       AND description ~ '\\d+/\\d+'
       AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
            OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
     GROUP BY
       REGEXP_REPLACE(description, '\\s+\\d+/\\d+', ''),
       SUBSTRING(description FROM '\\d+/(\\d+)')::int,
       pluggy_item_id`,
    [clientId]
  );

  let count = 0;
  for (const row of rows) {
    const seed = `${clientId}-${row.name}-${row.total_parcelas}`;
    const hash = createHash('md5').update(seed).digest('hex');
    const derivedId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const totalValue = (row.total_pago ?? 0) + (row.saldo_estimado ?? 0);
    await pool.query(
      `INSERT INTO debts
         (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, synced_at)
       VALUES ($1,$2,$3,$4,'LOAN',$5,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance      = EXCLUDED.balance,
         credit_limit = EXCLUDED.credit_limit,
         synced_at    = NOW()`,
      [derivedId, clientId, row.pluggy_item_id, row.name,
       row.saldo_estimado ?? 0, totalValue]
    );
    count++;
  }
  return count;
}

export async function getTransactionsByClientId(clientId, { from, to } = {}) {
  const pool = getPool();
  const values = [clientId];
  let i = 2;
  let df1 = '';
  if (from) { df1 += ` AND date::date >= $${i++}`; values.push(from); }
  if (to)   { df1 += ` AND date::date <= $${i++}`; values.push(to); }
  values.push(clientId);
  const ci2 = i++;
  let df2 = '';
  if (from) { df2 += ` AND date::date >= $${i++}`; values.push(from); }
  if (to)   { df2 += ` AND date::date <= $${i++}`; values.push(to); }
  const { rows } = await pool.query(
    `SELECT id, client_id AS "clientId", date, description, type,
            amount, balance, category,
            account_name AS "accountName", account_type AS "accountType",
            institution_name AS "institutionName",
            counterparty_name AS "counterpartyName",
            status, synced_at AS "syncedAt", 'bank' AS source
     FROM transactions WHERE client_id = $1${df1}
     UNION ALL
     SELECT id, client_id AS "clientId", date, description, type,
            amount, balance, category,
            account_name AS "accountName", account_type AS "accountType",
            institution_name AS "institutionName",
            counterparty_name AS "counterpartyName",
            status, synced_at AS "syncedAt", 'credit' AS source
     FROM credit_transactions WHERE client_id = $${ci2}${df2}
     ORDER BY date DESC`,
    values
  );
  return rows;
}
