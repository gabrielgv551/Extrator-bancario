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

const C = `SELECT id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt", business_tax_id AS "businessTaxId", gestor_empresa AS "gestorEmpresa" FROM clients`;
const C_RETURNING = `id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt", business_tax_id AS "businessTaxId", gestor_empresa AS "gestorEmpresa"`;

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

export async function createClient({ id, name, portalToken, businessTaxId }) {
  const { rows } = await getPool().query(
    `INSERT INTO clients (id, name, portal_token, business_tax_id, last_sync, created_at)
     VALUES ($1, $2, $3, $4, NULL, NOW())
     RETURNING ${C_RETURNING}`,
    [id, name, portalToken, businessTaxId || null]
  );
  return rows[0];
}

export async function updateClient(id, updates) {
  const sets = [];
  const values = [];
  let i = 1;
  if (updates.name           !== undefined) { sets.push(`name             = $${i++}`); values.push(updates.name); }
  if (updates.lastSync       !== undefined) { sets.push(`last_sync        = $${i++}`); values.push(updates.lastSync); }
  if (updates.businessTaxId  !== undefined) { sets.push(`business_tax_id  = $${i++}`); values.push(updates.businessTaxId || null); }
  if (updates.gestorEmpresa  !== undefined) { sets.push(`gestor_empresa   = $${i++}`); values.push(updates.gestorEmpresa || null); }
  if (sets.length === 0) return getClientById(id);
  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING ${C_RETURNING}`,
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
           account_numbers AS "accountNumbers",
           provider,
           klavi_link_id AS "klaviLinkId", klavi_consent_id AS "klaviConsentId",
           business_tax_id AS "businessTaxId", personal_tax_id AS "personalTaxId", institution_code AS "institutionCode",
           status, execution_status AS "executionStatus", error_code AS "errorCode",
           error_message AS "errorMessage", last_updated_at AS "lastUpdatedAt",
           last_error_at AS "lastErrorAt", sync_count AS "syncCount",
           consecutive_errors AS "consecutiveErrors", requires_reconnect AS "requiresReconnect",
           deleted_at AS "deletedAt", consent_expires_at AS "consentExpiresAt",
           notification_sent_at AS "notificationSentAt",
           created_at AS "createdAt" FROM items`;
const I_RETURNING = `id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId",
           institution_name AS "institutionName", institution_logo AS "institutionLogo",
           account_numbers AS "accountNumbers",
           provider,
           klavi_link_id AS "klaviLinkId", klavi_consent_id AS "klaviConsentId",
           business_tax_id AS "businessTaxId", personal_tax_id AS "personalTaxId", institution_code AS "institutionCode",
           status, execution_status AS "executionStatus", error_code AS "errorCode",
           error_message AS "errorMessage", last_updated_at AS "lastUpdatedAt",
           last_error_at AS "lastErrorAt", sync_count AS "syncCount",
           consecutive_errors AS "consecutiveErrors", requires_reconnect AS "requiresReconnect",
           deleted_at AS "deletedAt", consent_expires_at AS "consentExpiresAt",
           notification_sent_at AS "notificationSentAt",
           created_at AS "createdAt"`;

export async function getItemsByClientId(clientId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await getPool().query(`${I} WHERE client_id = $1${deletedFilter} ORDER BY created_at ASC`, [clientId]);
  return rows;
}

export async function getItemById(id, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const sql = `${I} WHERE id::text = $1${deletedFilter}`;
  console.log('[storage getItemById] sql:', sql, 'param:', String(id));
  const { rows } = await getPool().query(sql, [String(id)]);
  console.log('[storage getItemById] rows:', rows.length);
  return rows[0] ?? null;
}

export async function addItem({ id, clientId, pluggyItemId, institutionName, institutionLogo, accountNumbers }) {
  const pool = getPool();

  // 1. Se já existe um item ativo com o mesmo pluggy_item_id, atualiza o registro.
  // Isso acontece em reconexões/updateItem pelo widget.
  const { rows: samePluggy } = await pool.query(
    `SELECT id FROM items WHERE client_id = $1 AND pluggy_item_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, pluggyItemId]
  );

  if (samePluggy.length > 0) {
    const { rows } = await pool.query(
      `UPDATE items
       SET institution_name = $1,
           institution_logo = $2,
           account_numbers = $3,
           deleted_at = NULL,
           requires_reconnect = FALSE,
           consecutive_errors = 0,
           error_code = NULL,
           error_message = NULL,
           status = NULL,
           updated_at = NOW()
       WHERE id = $4
       RETURNING ${I_RETURNING}`,
      [institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, samePluggy[0].id]
    );
    return rows[0];
  }

  // 2. Se existe um item ativo para a mesma instituição (mesmo nome), reaproveita o registro
  // interno, mas somente quando o pluggy_item_id é diferente. Isso evita duplicatas visuais
  // quando o cliente reconecta sem passar pelo updateItem.
  const { rows: existing } = await pool.query(
    `SELECT id FROM items WHERE client_id = $1 AND institution_name = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, institutionName ?? null]
  );

  if (existing.length > 0) {
    const { rows } = await pool.query(
      `UPDATE items
       SET pluggy_item_id = $1,
           institution_logo = $2,
           account_numbers = $3,
           requires_reconnect = FALSE,
           consecutive_errors = 0,
           error_code = NULL,
           error_message = NULL,
           status = NULL,
           updated_at = NOW()
       WHERE id = $4
       RETURNING ${I_RETURNING}`,
      [pluggyItemId, institutionLogo ?? null, accountNumbers ?? null, existing[0].id]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO items (id, client_id, pluggy_item_id, institution_name, institution_logo, account_numbers, provider, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pluggy', NOW())
     RETURNING ${I_RETURNING}`,
    [id, clientId, pluggyItemId, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null]
  );
  return rows[0];
}

export async function addKlaviItem({ id, clientId, klaviLinkId, klaviConsentId, institutionCode, institutionName, institutionLogo, accountNumbers, businessTaxId, personalTaxId, status = 'WAITING_DATA' }) {
  const pool = getPool();

  // 1. Se já existe um item ativo com o mesmo consent da Klavi, atualiza.
  const { rows: sameConsent } = await pool.query(
    `SELECT id FROM items WHERE client_id = $1 AND klavi_consent_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, klaviConsentId]
  );
  if (sameConsent.length > 0) {
    const { rows } = await pool.query(
      `UPDATE items
       SET klavi_link_id     = $1,
           institution_code  = $2,
           institution_name  = $3,
           institution_logo  = $4,
           account_numbers   = $5,
           business_tax_id   = $6,
           personal_tax_id   = $7,
           status            = $8,
           deleted_at        = NULL,
           requires_reconnect = FALSE,
           consecutive_errors = 0,
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $9
       RETURNING ${I_RETURNING}`,
      [klaviLinkId, institutionCode, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, status, sameConsent[0].id]
    );
    return rows[0];
  }

  // 2. Se existe item ativo para a mesma instituição, reaproveita o registro.
  const { rows: existing } = await pool.query(
    `SELECT id FROM items WHERE client_id = $1 AND institution_name = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, institutionName ?? null]
  );
  if (existing.length > 0) {
    const { rows } = await pool.query(
      `UPDATE items
       SET provider          = 'klavi',
           klavi_link_id     = $1,
           klavi_consent_id  = $2,
           institution_code  = $3,
           institution_logo  = $4,
           account_numbers   = $5,
           business_tax_id   = $6,
           personal_tax_id   = $7,
           status            = $8,
           requires_reconnect = FALSE,
           consecutive_errors = 0,
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $9
       RETURNING ${I_RETURNING}`,
      [klaviLinkId, klaviConsentId, institutionCode, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, status, existing[0].id]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO items (id, client_id, provider, klavi_link_id, klavi_consent_id, institution_code, institution_name, institution_logo, account_numbers, business_tax_id, personal_tax_id, status, created_at)
     VALUES ($1, $2, 'klavi', $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     RETURNING ${I_RETURNING}`,
    [id, clientId, klaviLinkId, klaviConsentId, institutionCode, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, status]
  );
  return rows[0];
}

export async function getItemByKlaviLinkId(klaviLinkId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await getPool().query(`${I} WHERE klavi_link_id = $1${deletedFilter}`, [klaviLinkId]);
  return rows[0] ?? null;
}

export async function getItemByKlaviConsentId(klaviConsentId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await getPool().query(`${I} WHERE klavi_consent_id = $1${deletedFilter}`, [klaviConsentId]);
  return rows[0] ?? null;
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

export async function updateItemStatus(id, {
  status,
  executionStatus,
  errorCode,
  errorMessage,
  lastUpdatedAt,
  lastErrorAt,
  requiresReconnect,
  consentExpiresAt,
  provider,
  klaviLinkId,
  klaviConsentId,
  businessTaxId,
  personalTaxId,
  institutionCode,
  incrementSyncCount = false,
  incrementConsecutiveErrors = false,
  resetConsecutiveErrors = false,
}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (status !== undefined) { sets.push(`status = $${i++}`); values.push(status); }
  if (executionStatus !== undefined) { sets.push(`execution_status = $${i++}`); values.push(executionStatus); }
  if (errorCode !== undefined) { sets.push(`error_code = $${i++}`); values.push(errorCode); }
  if (errorMessage !== undefined) { sets.push(`error_message = $${i++}`); values.push(errorMessage); }
  if (lastUpdatedAt !== undefined) { sets.push(`last_updated_at = $${i++}`); values.push(lastUpdatedAt); }
  if (lastErrorAt !== undefined) { sets.push(`last_error_at = $${i++}`); values.push(lastErrorAt); }
  if (requiresReconnect !== undefined) { sets.push(`requires_reconnect = $${i++}`); values.push(requiresReconnect); }
  if (consentExpiresAt !== undefined) { sets.push(`consent_expires_at = $${i++}`); values.push(consentExpiresAt); }
  if (provider !== undefined) { sets.push(`provider = $${i++}`); values.push(provider); }
  if (klaviLinkId !== undefined) { sets.push(`klavi_link_id = $${i++}`); values.push(klaviLinkId); }
  if (klaviConsentId !== undefined) { sets.push(`klavi_consent_id = $${i++}`); values.push(klaviConsentId); }
  if (businessTaxId !== undefined) { sets.push(`business_tax_id = $${i++}`); values.push(businessTaxId); }
  if (personalTaxId !== undefined) { sets.push(`personal_tax_id = $${i++}`); values.push(personalTaxId); }
  if (institutionCode !== undefined) { sets.push(`institution_code = $${i++}`); values.push(institutionCode); }
  if (incrementSyncCount) sets.push(`sync_count = sync_count + 1`);
  if (incrementConsecutiveErrors) sets.push(`consecutive_errors = consecutive_errors + 1`);
  if (resetConsecutiveErrors) sets.push(`consecutive_errors = 0`);

  if (sets.length === 0) return;
  values.push(id);
  await getPool().query(
    `UPDATE items SET ${sets.join(', ')} WHERE id = $${i}`,
    values
  );
}

export async function getItemByPluggyId(pluggyItemId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await getPool().query(`${I} WHERE pluggy_item_id = $1${deletedFilter}`, [pluggyItemId]);
  return rows[0] ?? null;
}

export async function softDeleteItem(id) {
  const { rowCount } = await getPool().query(
    `UPDATE items SET deleted_at = NOW(), status = 'DELETED', requires_reconnect = FALSE WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

export async function markItemNotified(id) {
  await getPool().query(`UPDATE items SET notification_sent_at = NOW() WHERE id = $1`, [id]);
}

export async function getItemsNeedingReconnect() {
  const { rows } = await getPool().query(
    `${I} WHERE deleted_at IS NULL AND requires_reconnect = TRUE ORDER BY last_error_at ASC`
  );
  return rows;
}

export async function getOutdatedItemsForRetry({ maxConsecutiveErrors = 5, minMinutesSinceLastError = 60 } = {}) {
  const { rows } = await getPool().query(
    `${I} WHERE deleted_at IS NULL
       AND status = 'OUTDATED'
       AND consecutive_errors < $1
       AND (last_error_at IS NULL OR last_error_at < NOW() - ($2 * INTERVAL '1 minute'))
     ORDER BY last_error_at ASC NULLS FIRST`,
    [maxConsecutiveErrors, minMinutesSinceLastError]
  );
  return rows;
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
         (id, client_id, pluggy_item_id, date, description, type, amount, balance, category, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (id) DO UPDATE SET
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         synced_at             = NOW()`,
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
        tx.accountNumber ?? null,
        toAccountTypePT(tx.accountType),
        tx.institutionName ?? null,
        tx.counterpartyName ?? null,
        tx.counterpartyDocument ?? null,
        tx.status ?? null,
        tx.dateTransacted ?? null,
      ]
    );
    count++;
  }
  return count;
}

export async function upsertTransactionsBatch(clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const pool = getPool();
  const CHUNK = 200;
  for (let c = 0; c < transactions.length; c += CHUNK) {
    const chunk = transactions.slice(c, c + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const tx of chunk) {
      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},NOW())`);
      params.push(tx.id, clientId, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.accountName ?? null,
        tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null);
      p += 17;
    }
    await pool.query(
      `INSERT INTO transactions
         (id, client_id, pluggy_item_id, date, description, type, amount, balance,
          category, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         synced_at             = NOW()`,
      params
    );
  }
  return transactions.length;
}

export async function upsertCreditTransactionsBatch(clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const pool = getPool();
  const CHUNK = 200;
  for (let c = 0; c < transactions.length; c += CHUNK) {
    const chunk = transactions.slice(c, c + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const tx of chunk) {
      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},NOW())`);
      params.push(tx.id, clientId, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.accountName ?? null,
        tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null);
      p += 17;
    }
    await pool.query(
      `INSERT INTO credit_transactions
         (id, client_id, pluggy_item_id, date, description, type, amount, balance,
          category, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         synced_at             = NOW()`,
      params
    );
  }
  return transactions.length;
}

export async function hasTransactions(clientId) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM transactions WHERE client_id = $1 LIMIT 1',
    [clientId]
  );
  return rows.length > 0;
}

export async function getTransactionsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId", date, description, type,
            amount, balance, category, account_name AS "accountName", account_number AS "accountNumber",
            account_type AS "accountType", institution_name AS "institutionName",
            counterparty_name AS "counterpartyName", counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", synced_at AS "syncedAt"
     FROM transactions WHERE id = ANY($1::text[])
     UNION ALL
     SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId", date, description, type,
            amount, balance, category, account_name AS "accountName", account_number AS "accountNumber",
            account_type AS "accountType", institution_name AS "institutionName",
            counterparty_name AS "counterpartyName", counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", synced_at AS "syncedAt"
     FROM credit_transactions WHERE id = ANY($1::text[])
     ORDER BY date DESC`,
    [ids]
  );
  return rows;
}

export async function deleteTransactionsByIds(ids) {
  if (!ids || ids.length === 0) return 0;
  const { rowCount: bank } = await getPool().query(
    'DELETE FROM transactions WHERE id = ANY($1::text[])',
    [ids]
  );
  const { rowCount: credit } = await getPool().query(
    'DELETE FROM credit_transactions WHERE id = ANY($1::text[])',
    [ids]
  );
  return bank + credit;
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
         (id, client_id, pluggy_item_id, date, description, type, amount, balance, category, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (id) DO UPDATE SET
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         synced_at             = NOW()`,
      [tx.id, clientId, pluggyItemId, tx.date, tx.description ?? '', tx.type,
       tx.amount, tx.balance ?? null, tx.category ?? null, tx.accountName ?? null,
       tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
       tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
       tx.dateTransacted ?? null]
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
         (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance          = EXCLUDED.balance,
         credit_limit     = EXCLUDED.credit_limit,
         institution_name = EXCLUDED.institution_name,
         synced_at        = NOW()`,
      [acc.id, clientId, pluggyItemId, acc.name ?? null, acc.type ?? null,
       acc.balance ?? null, acc.creditLimit ?? null, acc.institutionName ?? null]
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
       pluggy_item_id,
       institution_name
     FROM transactions
     WHERE client_id = $1
       AND description ~ '\\d+/\\d+'
       AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
            OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
     GROUP BY
       REGEXP_REPLACE(description, '\\s+\\d+/\\d+', ''),
       SUBSTRING(description FROM '\\d+/(\\d+)')::int,
       pluggy_item_id,
       institution_name`,
    [clientId]
  );

  let count = 0;
  for (const row of rows) {
    const seed = `${clientId}-${row.name}-${row.total_parcelas}`;
    const hash = createHash('md5').update(seed).digest('hex');
    const derivedId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const saldo = parseFloat(row.saldo_estimado ?? 0);
    const pago  = parseFloat(row.total_pago ?? 0);
    const totalValue = pago + saldo;
    await pool.query(
      `INSERT INTO debts
         (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at)
       VALUES ($1,$2,$3,$4,'LOAN',$5,$6,$7,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance          = EXCLUDED.balance,
         credit_limit     = EXCLUDED.credit_limit,
         institution_name = EXCLUDED.institution_name,
         synced_at        = NOW()`,
      [derivedId, clientId, row.pluggy_item_id, row.name,
       saldo, totalValue, row.institution_name ?? null]
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
            account_name AS "accountName", account_number AS "accountNumber", account_type AS "accountType",
            institution_name AS "institutionName",
            counterparty_name AS "counterpartyName",
            counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", synced_at AS "syncedAt", 'bank' AS source
     FROM transactions WHERE client_id = $1${df1}
     UNION ALL
     SELECT id, client_id AS "clientId", date, description, type,
            amount, balance, category,
            account_name AS "accountName", account_number AS "accountNumber", account_type AS "accountType",
            institution_name AS "institutionName",
            counterparty_name AS "counterpartyName",
            counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", synced_at AS "syncedAt", 'credit' AS source
     FROM credit_transactions WHERE client_id = $${ci2}${df2}
     ORDER BY date DESC`,
    values
  );
  return rows;
}

// ── Webhook events (idempotência) ────────────────────────────────────────────

export async function recordWebhookEvent({ eventId, event, itemId, payload }) {
  if (!eventId) return;
  try {
    await getPool().query(
      `INSERT INTO webhook_events (event_id, event, item_id, payload, received_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, event, itemId ?? null, JSON.stringify(payload ?? {})]
    );
  } catch (err) {
    console.error('[storage] erro ao registrar webhook event:', err.message);
  }
}

export async function hasWebhookEvent(eventId) {
  if (!eventId) return false;
  const { rows } = await getPool().query(
    'SELECT 1 FROM webhook_events WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  return rows.length > 0;
}

export async function getWebhookEventsForItem({ itemId, linkId, consentId, limit = 20 } = {}) {
  const { rows } = await getPool().query(
    `SELECT event_id AS "eventId", event, item_id AS "itemId", payload, received_at AS "receivedAt"
     FROM webhook_events
     WHERE item_id = ANY($1::text[])
     ORDER BY received_at DESC
     LIMIT $2`,
    [[itemId, linkId, consentId].filter(Boolean), limit]
  );
  return rows;
}

// ── Sync logs ────────────────────────────────────────────────────────────────

export async function createSyncLog({ clientId, itemId }) {
  const { rows } = await getPool().query(
    `INSERT INTO sync_logs (client_id, item_id, started_at, status)
     VALUES ($1, $2, NOW(), 'running')
     RETURNING id`,
    [clientId ?? null, itemId ?? null]
  );
  return rows[0].id;
}

export async function finishSyncLog(logId, { status, errorMessage, transactionsCount }) {
  await getPool().query(
    `UPDATE sync_logs
     SET finished_at = NOW(), status = $1, error_message = $2, transactions_count = $3
     WHERE id = $4`,
    [status, errorMessage ?? null, transactionsCount ?? 0, logId]
  );
}

// ── Sync locks ───────────────────────────────────────────────────────────────

const LOCK_OWNER = process.env.LOCK_OWNER || 'extrator-bancario';
const LOCK_TTL_MINUTES = 10;

export async function acquireSyncLock(owner = LOCK_OWNER, ttlMinutes = LOCK_TTL_MINUTES) {
  const pool = getPool();
  // Limpa locks expirados
  await pool.query(`DELETE FROM sync_locks WHERE expires_at < NOW()`);

  // Tenta inserir; se já existir ativo, falha
  try {
    const { rows } = await pool.query(
      `INSERT INTO sync_locks (owner, started_at, expires_at)
       VALUES ($1, NOW(), NOW() + INTERVAL '${ttlMinutes} minutes')
       RETURNING id`,
      [owner]
    );
    return { acquired: true, lockId: rows[0].id };
  } catch (err) {
    if (err.code === '23505') {
      const { rows } = await pool.query(
        `SELECT started_at, expires_at FROM sync_locks WHERE owner = $1`,
        [owner]
      );
      return { acquired: false, existing: rows[0] };
    }
    throw err;
  }
}

export async function refreshSyncLock(lockId) {
  await getPool().query(
    `UPDATE sync_locks SET expires_at = NOW() + INTERVAL '10 minutes' WHERE id = $1`,
    [lockId]
  );
}

export async function releaseSyncLock(lockId) {
  await getPool().query(`DELETE FROM sync_locks WHERE id = $1`, [lockId]);
}

export async function forceReleaseSyncLock(owner = LOCK_OWNER) {
  await getPool().query(`DELETE FROM sync_locks WHERE owner = $1`, [owner]);
}
