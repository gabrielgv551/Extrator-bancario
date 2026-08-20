// Camada de persistência do Extrator Bancário por empresa.
// Recebe um pool de conexão como primeiro parâmetro (ex: pool da empresa via getCompanyPool).
// Schema: tabelas prefixadas com extrator_ (extrator_clients, extrator_items, etc.).

import { randomBytes, createHash } from 'crypto';

const ACCOUNT_TYPE_PT = {
  'BANK':       'Conta Bancária',
  'CREDIT':     'Cartão de Crédito',
  'LOAN':       'Empréstimo',
  'INVESTMENT': 'Investimento',
};
const toAccountTypePT = t => (t ? (ACCOUNT_TYPE_PT[t] ?? t) : null);

export function generatePortalToken() {
  return randomBytes(32).toString('hex');
}

// ── Clients ─────────────────────────────────────────────────────────────────

const C = `SELECT id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt", business_tax_id AS "businessTaxId", gestor_empresa AS "gestorEmpresa" FROM extrator_clients`;
const C_RETURNING = `id, name, portal_token AS "portalToken", last_sync AS "lastSync", created_at AS "createdAt", business_tax_id AS "businessTaxId", gestor_empresa AS "gestorEmpresa"`;

export async function getClients(pool) {
  const { rows } = await pool.query(`${C} ORDER BY created_at ASC`);
  return rows;
}

export async function getClientById(pool, id) {
  const { rows } = await pool.query(`${C} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getClientByToken(pool, token) {
  const { rows } = await pool.query(`${C} WHERE portal_token = $1`, [token]);
  return rows[0] ?? null;
}

export async function getClientByGestorEmpresa(pool, empresa) {
  const { rows } = await pool.query(`${C} WHERE gestor_empresa = $1 ORDER BY created_at ASC LIMIT 1`, [empresa]);
  return rows[0] ?? null;
}

export async function createClient(pool, { id, name, portalToken, businessTaxId, gestorEmpresa }) {
  const { rows } = await pool.query(
    `INSERT INTO extrator_clients (id, name, portal_token, business_tax_id, gestor_empresa, last_sync, created_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NOW())
     RETURNING ${C_RETURNING}`,
    [id, name, portalToken, businessTaxId || null, gestorEmpresa || null]
  );
  return rows[0];
}

export async function updateClient(pool, id, updates) {
  const sets = [];
  const values = [];
  let i = 1;
  if (updates.name           !== undefined) { sets.push(`name             = $${i++}`); values.push(updates.name); }
  if (updates.lastSync       !== undefined) { sets.push(`last_sync        = $${i++}`); values.push(updates.lastSync); }
  if (updates.businessTaxId  !== undefined) { sets.push(`business_tax_id  = $${i++}`); values.push(updates.businessTaxId || null); }
  if (updates.gestorEmpresa  !== undefined) { sets.push(`gestor_empresa   = $${i++}`); values.push(updates.gestorEmpresa || null); }
  if (sets.length === 0) return getClientById(pool, id);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE extrator_clients SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING ${C_RETURNING}`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteClient(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM extrator_clients WHERE id = $1', [id]);
  return rowCount > 0;
}

// ── Items ────────────────────────────────────────────────────────────────────

const I = `SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId",
           institution_name AS "institutionName", institution_logo AS "institutionLogo",
           account_numbers AS "accountNumbers",
           provider,
           klavi_link_id AS "klaviLinkId", klavi_consent_id AS "klaviConsentId",
           business_tax_id AS "businessTaxId", personal_tax_id AS "personalTaxId", tax_type AS "taxType", institution_code AS "institutionCode",
           status, execution_status AS "executionStatus", error_code AS "errorCode",
           error_message AS "errorMessage", last_updated_at AS "lastUpdatedAt",
           last_error_at AS "lastErrorAt", sync_count AS "syncCount",
           consecutive_errors AS "consecutiveErrors", requires_reconnect AS "requiresReconnect",
           deleted_at AS "deletedAt", consent_expires_at AS "consentExpiresAt",
           notification_sent_at AS "notificationSentAt",
           created_at AS "createdAt" FROM extrator_items`;
const I_RETURNING = `id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId",
           institution_name AS "institutionName", institution_logo AS "institutionLogo",
           account_numbers AS "accountNumbers",
           provider,
           klavi_link_id AS "klaviLinkId", klavi_consent_id AS "klaviConsentId",
           business_tax_id AS "businessTaxId", personal_tax_id AS "personalTaxId", tax_type AS "taxType", institution_code AS "institutionCode",
           status, execution_status AS "executionStatus", error_code AS "errorCode",
           error_message AS "errorMessage", last_updated_at AS "lastUpdatedAt",
           last_error_at AS "lastErrorAt", sync_count AS "syncCount",
           consecutive_errors AS "consecutiveErrors", requires_reconnect AS "requiresReconnect",
           deleted_at AS "deletedAt", consent_expires_at AS "consentExpiresAt",
           notification_sent_at AS "notificationSentAt",
           created_at AS "createdAt"`;

export async function getItemsByClientId(pool, clientId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await pool.query(`${I} WHERE client_id = $1${deletedFilter} ORDER BY created_at ASC`, [clientId]);
  return rows;
}

export async function getItemById(pool, id, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const sql = `${I} WHERE id::text = $1${deletedFilter}`;
  const { rows } = await pool.query(sql, [String(id)]);
  return rows[0] ?? null;
}

export async function addItem(pool, { id, clientId, pluggyItemId, institutionName, institutionLogo, accountNumbers }) {
  // Só faz upsert pelo ID real da Pluggy. O nome da instituição não é um identificador
  // único: um mesmo cliente pode ter várias contas no mesmo banco.
  const { rows: samePluggy } = await pool.query(
    `SELECT id FROM extrator_items WHERE client_id = $1 AND pluggy_item_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, pluggyItemId]
  );

  if (samePluggy.length > 0) {
    const { rows } = await pool.query(
      `UPDATE extrator_items
       SET institution_name = $1, institution_logo = $2, account_numbers = $3, deleted_at = NULL,
           requires_reconnect = FALSE, consecutive_errors = 0, error_code = NULL, error_message = NULL,
           status = NULL, updated_at = NOW()
       WHERE id = $4 RETURNING ${I_RETURNING}`,
      [institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, samePluggy[0].id]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO extrator_items (id, client_id, pluggy_item_id, institution_name, institution_logo, account_numbers, provider, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pluggy', NOW()) RETURNING ${I_RETURNING}`,
    [id, clientId, pluggyItemId, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null]
  );
  return rows[0];
}

export async function addKlaviItem(pool, { id, clientId, klaviLinkId, klaviConsentId, institutionCode, institutionName, institutionLogo, accountNumbers, businessTaxId, personalTaxId, taxType, status = 'WAITING_DATA' }) {
  // Upsert apenas pelos identificadores reais da Klavi (consent ou link).
  // Nunca pelo nome da instituição, para permitir várias contas no mesmo banco.
  if (klaviConsentId) {
    const { rows: sameConsent } = await pool.query(
      `SELECT id FROM extrator_items WHERE client_id = $1 AND klavi_consent_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [clientId, klaviConsentId]
    );
    if (sameConsent.length > 0) {
      const { rows } = await pool.query(
        `UPDATE extrator_items
         SET klavi_link_id = $1, institution_code = $2, institution_name = $3, institution_logo = $4,
             account_numbers = $5, business_tax_id = $6, personal_tax_id = $7, tax_type = $8, status = $9,
             deleted_at = NULL, requires_reconnect = FALSE, consecutive_errors = 0, error_code = NULL, error_message = NULL, updated_at = NOW()
         WHERE id = $10 RETURNING ${I_RETURNING}`,
        [klaviLinkId, institutionCode, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, taxType ?? null, status, sameConsent[0].id]
      );
      return rows[0];
    }
  }

  if (klaviLinkId) {
    const { rows: sameLink } = await pool.query(
      `SELECT id FROM extrator_items WHERE client_id = $1 AND klavi_link_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [clientId, klaviLinkId]
    );
    if (sameLink.length > 0) {
      const { rows } = await pool.query(
        `UPDATE extrator_items
         SET klavi_consent_id = $1, institution_code = $2, institution_name = $3, institution_logo = $4,
             account_numbers = $5, business_tax_id = $6, personal_tax_id = $7, tax_type = $8, status = $9,
             deleted_at = NULL, requires_reconnect = FALSE, consecutive_errors = 0, error_code = NULL, error_message = NULL, updated_at = NOW()
         WHERE id = $10 RETURNING ${I_RETURNING}`,
        [klaviConsentId, institutionCode, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, taxType ?? null, status, sameLink[0].id]
      );
      return rows[0];
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO extrator_items (id, client_id, provider, klavi_link_id, klavi_consent_id, institution_code, institution_name, institution_logo, account_numbers, business_tax_id, personal_tax_id, tax_type, status, created_at)
     VALUES ($1, $2, 'klavi', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) RETURNING ${I_RETURNING}`,
    [id, clientId, klaviLinkId, klaviConsentId, institutionCode, institutionName ?? null, institutionLogo ?? null, accountNumbers ?? null, businessTaxId ?? null, personalTaxId ?? null, taxType ?? null, status]
  );
  return rows[0];
}

export async function removeItem(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM extrator_items WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function softDeleteItem(pool, id) {
  const { rowCount } = await pool.query(
    `UPDATE extrator_items SET deleted_at = NOW(), status = 'DELETED', requires_reconnect = FALSE WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

export async function updateItemStatus(pool, id, updates) {
  const sets = [];
  const values = [];
  let i = 1;

  if (updates.status !== undefined) { sets.push(`status = $${i++}`); values.push(updates.status); }
  if (updates.executionStatus !== undefined) { sets.push(`execution_status = $${i++}`); values.push(updates.executionStatus); }
  if (updates.errorCode !== undefined) { sets.push(`error_code = $${i++}`); values.push(updates.errorCode); }
  if (updates.errorMessage !== undefined) { sets.push(`error_message = $${i++}`); values.push(updates.errorMessage); }
  if (updates.lastUpdatedAt !== undefined) { sets.push(`last_updated_at = $${i++}`); values.push(updates.lastUpdatedAt); }
  if (updates.lastErrorAt !== undefined) { sets.push(`last_error_at = $${i++}`); values.push(updates.lastErrorAt); }
  if (updates.requiresReconnect !== undefined) { sets.push(`requires_reconnect = $${i++}`); values.push(updates.requiresReconnect); }
  if (updates.consentExpiresAt !== undefined) { sets.push(`consent_expires_at = $${i++}`); values.push(updates.consentExpiresAt); }
  if (updates.provider !== undefined) { sets.push(`provider = $${i++}`); values.push(updates.provider); }
  if (updates.klaviLinkId !== undefined) { sets.push(`klavi_link_id = $${i++}`); values.push(updates.klaviLinkId); }
  if (updates.klaviConsentId !== undefined) { sets.push(`klavi_consent_id = $${i++}`); values.push(updates.klaviConsentId); }
  if (updates.businessTaxId !== undefined) { sets.push(`business_tax_id = $${i++}`); values.push(updates.businessTaxId); }
  if (updates.personalTaxId !== undefined) { sets.push(`personal_tax_id = $${i++}`); values.push(updates.personalTaxId); }
  if (updates.taxType !== undefined) { sets.push(`tax_type = $${i++}`); values.push(updates.taxType); }
  if (updates.institutionCode !== undefined) { sets.push(`institution_code = $${i++}`); values.push(updates.institutionCode); }
  if (updates.institutionName !== undefined) { sets.push(`institution_name = $${i++}`); values.push(updates.institutionName); }
  if (updates.institutionLogo !== undefined) { sets.push(`institution_logo = $${i++}`); values.push(updates.institutionLogo); }
  if (updates.accountNumbers !== undefined) { sets.push(`account_numbers = $${i++}`); values.push(updates.accountNumbers); }
  if (updates.incrementSyncCount) sets.push(`sync_count = sync_count + 1`);
  if (updates.incrementConsecutiveErrors) sets.push(`consecutive_errors = consecutive_errors + 1`);
  if (updates.resetConsecutiveErrors) sets.push(`consecutive_errors = 0`);

  if (sets.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE extrator_items SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

export async function getItemByPluggyId(pool, pluggyItemId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await pool.query(`${I} WHERE pluggy_item_id = $1${deletedFilter}`, [pluggyItemId]);
  return rows[0] ?? null;
}

export async function getItemByKlaviLinkId(pool, klaviLinkId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await pool.query(`${I} WHERE klavi_link_id = $1${deletedFilter}`, [klaviLinkId]);
  return rows[0] ?? null;
}

export async function getItemByKlaviConsentId(pool, klaviConsentId, { includeDeleted = false } = {}) {
  const deletedFilter = includeDeleted ? '' : ' AND deleted_at IS NULL';
  const { rows } = await pool.query(`${I} WHERE klavi_consent_id = $1${deletedFilter}`, [klaviConsentId]);
  return rows[0] ?? null;
}

export async function markItemNotified(pool, id) {
  await pool.query(`UPDATE extrator_items SET notification_sent_at = NOW() WHERE id = $1`, [id]);
}

export async function getItemsNeedingReconnect(pool) {
  const { rows } = await pool.query(`${I} WHERE deleted_at IS NULL AND requires_reconnect = TRUE ORDER BY last_error_at ASC`);
  return rows;
}

export async function getOutdatedItemsForRetry(pool, { maxConsecutiveErrors = 5, minMinutesSinceLastError = 60 } = {}) {
  const { rows } = await pool.query(
    `${I} WHERE deleted_at IS NULL AND status = 'OUTDATED' AND consecutive_errors < $1
       AND (last_error_at IS NULL OR last_error_at < NOW() - ($2 * INTERVAL '1 minute'))
     ORDER BY last_error_at ASC NULLS FIRST`,
    [maxConsecutiveErrors, minMinutesSinceLastError]
  );
  return rows;
}

// ── Transactions ─────────────────────────────────────────────────────────

export async function upsertTransactionsBatch(pool, clientId, clientName, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const CHUNK = 200;
  for (let c = 0; c < transactions.length; c += CHUNK) {
    const chunk = transactions.slice(c, c + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const tx of chunk) {
      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},$${p+17},$${p+18},$${p+19},$${p+20},$${p+21},NOW())`);
      params.push(tx.id, clientId, clientName ?? null, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.categoryL1 ?? null, tx.categoryL2 ?? null, tx.categoryL3 ?? null,
        tx.accountName ?? null, tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null, tx.apiOrder ?? null);
      p += 22;
    }
    await pool.query(
      `INSERT INTO extrator_transactions
         (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance,
          category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, api_order, synced_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         client_name           = EXCLUDED.client_name,
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         category_l1           = EXCLUDED.category_l1,
         category_l2           = EXCLUDED.category_l2,
         category_l3           = EXCLUDED.category_l3,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         api_order             = EXCLUDED.api_order,
         synced_at             = NOW()`,
      params
    );
  }
  return transactions.length;
}

export async function upsertCreditTransactionsBatch(pool, clientId, clientName, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const CHUNK = 200;
  for (let c = 0; c < transactions.length; c += CHUNK) {
    const chunk = transactions.slice(c, c + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const tx of chunk) {
      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},$${p+17},$${p+18},$${p+19},$${p+20},$${p+21},NOW())`);
      params.push(tx.id, clientId, clientName ?? null, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.categoryL1 ?? null, tx.categoryL2 ?? null, tx.categoryL3 ?? null,
        tx.accountName ?? null, tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null, tx.apiOrder ?? null);
      p += 22;
    }
    await pool.query(
      `INSERT INTO extrator_credit_transactions
         (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance,
          category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, api_order, synced_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         client_name           = EXCLUDED.client_name,
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         category_l1           = EXCLUDED.category_l1,
         category_l2           = EXCLUDED.category_l2,
         category_l3           = EXCLUDED.category_l3,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         api_order             = EXCLUDED.api_order,
         synced_at             = NOW()`,
      params
    );
  }
  return transactions.length;
}

export async function deleteOrphanTransactions(pool, pluggyItemId, from, to, currentIds) {
  if (!from || !to || !currentIds.length) return;
  await pool.query(
    `DELETE FROM extrator_transactions
     WHERE pluggy_item_id = $1 AND date::date >= $2::date AND date::date <= $3::date AND id != ALL($4::text[])`,
    [pluggyItemId, from, to, currentIds]
  );
  await pool.query(
    `DELETE FROM extrator_credit_transactions
     WHERE pluggy_item_id = $1 AND date::date >= $2::date AND date::date <= $3::date AND id != ALL($4::text[])`,
    [pluggyItemId, from, to, currentIds]
  );
}

export async function getTransactionsByClientId(pool, clientId, { from, to } = {}) {
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
    `SELECT t.id, t.client_id AS "clientId", c.name AS "clientName", t.pluggy_item_id AS "pluggyItemId", t.date, t.description, t.type,
            t.amount, t.balance, t.category, t.category_l1 AS "categoryL1", t.category_l2 AS "categoryL2", t.category_l3 AS "categoryL3",
            t.account_name AS "accountName", t.account_number AS "accountNumber", t.account_type AS "accountType",
            t.institution_name AS "institutionName", t.counterparty_name AS "counterpartyName",
            t.counterparty_document AS "counterpartyDocument", t.status, t.date_transacted AS "dateTransacted", t.api_order AS "apiOrder", t.synced_at AS "syncedAt", 'bank' AS source
     FROM extrator_transactions t LEFT JOIN extrator_clients c ON c.id = t.client_id WHERE t.client_id = $1${df1}
     UNION ALL
     SELECT ct.id, ct.client_id AS "clientId", c.name AS "clientName", ct.pluggy_item_id AS "pluggyItemId", ct.date, ct.description, ct.type,
            ct.amount, ct.balance, ct.category, ct.category_l1 AS "categoryL1", ct.category_l2 AS "categoryL2", ct.category_l3 AS "categoryL3",
            ct.account_name AS "accountName", ct.account_number AS "accountNumber", ct.account_type AS "accountType",
            ct.institution_name AS "institutionName", ct.counterparty_name AS "counterpartyName",
            ct.counterparty_document AS "counterpartyDocument", ct.status, ct.date_transacted AS "dateTransacted", ct.api_order AS "apiOrder", ct.synced_at AS "syncedAt", 'credit' AS source
     FROM extrator_credit_transactions ct LEFT JOIN extrator_clients c ON c.id = ct.client_id WHERE ct.client_id = $${ci2}${df2}
     ORDER BY date DESC, "apiOrder" ASC NULLS LAST`,
    values
  );
  return rows;
}

export async function upsertTransactions(pool, clientId, clientName, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  let count = 0;
  for (const tx of transactions) {
    await pool.query(
      `INSERT INTO extrator_transactions
         (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, api_order, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
       ON CONFLICT (id) DO UPDATE SET
         client_name           = EXCLUDED.client_name,
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         category_l1           = EXCLUDED.category_l1,
         category_l2           = EXCLUDED.category_l2,
         category_l3           = EXCLUDED.category_l3,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         api_order             = EXCLUDED.api_order,
         synced_at             = NOW()`,
      [
        tx.id, clientId, clientName ?? null, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.categoryL1 ?? null, tx.categoryL2 ?? null, tx.categoryL3 ?? null,
        tx.accountName ?? null, tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null, tx.apiOrder ?? null,
      ]
    );
    count++;
  }
  return count;
}

export async function upsertCreditTransactions(pool, clientId, clientName, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  let count = 0;
  for (const tx of transactions) {
    await pool.query(
      `INSERT INTO extrator_credit_transactions
         (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, api_order, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
       ON CONFLICT (id) DO UPDATE SET
         client_name           = EXCLUDED.client_name,
         description           = EXCLUDED.description,
         amount                = EXCLUDED.amount,
         balance               = EXCLUDED.balance,
         category              = EXCLUDED.category,
         category_l1           = EXCLUDED.category_l1,
         category_l2           = EXCLUDED.category_l2,
         category_l3           = EXCLUDED.category_l3,
         account_number        = EXCLUDED.account_number,
         institution_name      = EXCLUDED.institution_name,
         counterparty_name     = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status                = EXCLUDED.status,
         date_transacted       = EXCLUDED.date_transacted,
         api_order             = EXCLUDED.api_order,
         synced_at             = NOW()`,
      [
        tx.id, clientId, clientName ?? null, pluggyItemId, tx.date, tx.description ?? '', tx.type,
        tx.amount, tx.balance ?? null, tx.category ?? null, tx.categoryL1 ?? null, tx.categoryL2 ?? null, tx.categoryL3 ?? null,
        tx.accountName ?? null, tx.accountNumber ?? null, toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null, tx.status ?? null,
        tx.dateTransacted ?? null, tx.apiOrder ?? null,
      ]
    );
    count++;
  }
  return count;
}

export async function hasTransactions(pool, clientId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM extrator_transactions WHERE client_id = $1 LIMIT 1',
    [clientId]
  );
  return rows.length > 0;
}

export async function getTransactionsByIds(pool, ids) {
  if (!ids || ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId", date, description, type,
            amount, balance, category, category_l1 AS "categoryL1", category_l2 AS "categoryL2", category_l3 AS "categoryL3",
            account_name AS "accountName", account_number AS "accountNumber",
            account_type AS "accountType", institution_name AS "institutionName",
            counterparty_name AS "counterpartyName", counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", api_order AS "apiOrder", synced_at AS "syncedAt"
     FROM extrator_transactions WHERE id = ANY($1::text[])
     UNION ALL
     SELECT id, client_id AS "clientId", pluggy_item_id AS "pluggyItemId", date, description, type,
            amount, balance, category, category_l1 AS "categoryL1", category_l2 AS "categoryL2", category_l3 AS "categoryL3",
            account_name AS "accountName", account_number AS "accountNumber",
            account_type AS "accountType", institution_name AS "institutionName",
            counterparty_name AS "counterpartyName", counterparty_document AS "counterpartyDocument",
            status, date_transacted AS "dateTransacted", api_order AS "apiOrder", synced_at AS "syncedAt"
     FROM extrator_credit_transactions WHERE id = ANY($1::text[])
     ORDER BY date DESC, "apiOrder" ASC NULLS LAST`,
    [ids]
  );
  return rows;
}

export async function deleteTransactionsByIds(pool, ids) {
  if (!ids || ids.length === 0) return 0;
  const { rowCount: bank } = await pool.query(
    'DELETE FROM extrator_transactions WHERE id = ANY($1::text[])',
    [ids]
  );
  const { rowCount: credit } = await pool.query(
    'DELETE FROM extrator_credit_transactions WHERE id = ANY($1::text[])',
    [ids]
  );
  return bank + credit;
}

export async function hasTransactionsByItemId(pool, pluggyItemId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM extrator_transactions WHERE pluggy_item_id = $1 LIMIT 1',
    [pluggyItemId]
  );
  return rows.length > 0;
}

// ── Deduplicação de transações Klavi (Open Finance) ──────────────────────────

const STATUS_RANK = {
  'LANCAMENTO_FUTURO': 1,
  'PENDING': 2,
  'PROCESSANDO': 2,
  'TRANSACAO_PROCESSANDO': 2,
  'TRANSACAO_EFETIVADA': 3,
  'POSTED': 3,
  'EFETIVADA': 3,
};

function statusRank(status) {
  return STATUS_RANK[status] ?? 0;
}

function normalizeDescription(desc) {
  return (desc || '')
    .toString()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isInstallmentDescription(desc) {
  const normalized = normalizeDescription(desc);
  // Parcelas costumam ter "06/48", "1/12" etc.
  if (!/\b\d+\/\d+\b/.test(normalized)) return false;
  // Só deduplica como parcela quando a descrição indica pagamento recorrente/contratado.
  const keywords = ['PARCELA', 'DEBITO', 'SEGURO', 'EMPREST', 'FINANC', 'CONTRATO', 'MENSALIDADE'];
  return keywords.some(k => normalized.includes(k));
}

/**
 * Remove duplicatas geradas pela Klavi/Open Finance quando uma transação muda de ID
 * ao sair de LANCAMENTO_FUTURO -> PROCESSANDO/PENDING -> EFETIVADA/POSTED.
 * Também deduplica parcelas efetivadas repetidas (mesma descrição + valor + conta),
 * mantendo a de data mais recente.
 */
export async function deduplicateKlaviTransactions(pool, clientId) {
  if (!clientId) return { removedByStatus: 0, removedInstallments: 0 };

  // 1) Mantém apenas a transação de maior "status" dentro de cada grupo
  //    (conta + valor + descrição normalizada + mês). Hierarquia:
  //    LANCAMENTO_FUTURO < PROCESSANDO/PENDING < EFETIVADA/POSTED.
  //    Em caso de empate, mantém a de data mais recente.
  const statusDedupBankSql = `
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, account_number, amount,
            UPPER(REGEXP_REPLACE(TRIM(description), '\\s+', ' ', 'g')),
            DATE_TRUNC('month', date)
          ORDER BY CASE status
            WHEN 'TRANSACAO_EFETIVADA' THEN 3
            WHEN 'POSTED' THEN 3
            WHEN 'EFETIVADA' THEN 3
            WHEN 'TRANSACAO_PROCESSANDO' THEN 2
            WHEN 'PROCESSANDO' THEN 2
            WHEN 'PENDING' THEN 2
            WHEN 'LANCAMENTO_FUTURO' THEN 1
            ELSE 0
          END DESC,
          date DESC,
          synced_at DESC
        ) AS rn
      FROM extrator_transactions
      WHERE client_id = $1
    )
    DELETE FROM extrator_transactions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `;
  const { rowCount: removedByStatusBank } = await pool.query(statusDedupBankSql, [clientId]);

  const statusDedupCreditSql = `
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, account_number, amount,
            UPPER(REGEXP_REPLACE(TRIM(description), '\\s+', ' ', 'g')),
            DATE_TRUNC('month', date)
          ORDER BY CASE status
            WHEN 'TRANSACAO_EFETIVADA' THEN 3
            WHEN 'POSTED' THEN 3
            WHEN 'EFETIVADA' THEN 3
            WHEN 'TRANSACAO_PROCESSANDO' THEN 2
            WHEN 'PROCESSANDO' THEN 2
            WHEN 'PENDING' THEN 2
            WHEN 'LANCAMENTO_FUTURO' THEN 1
            ELSE 0
          END DESC,
          date DESC,
          synced_at DESC
        ) AS rn
      FROM extrator_credit_transactions
      WHERE client_id = $1
    )
    DELETE FROM extrator_credit_transactions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `;
  const { rowCount: removedByStatusCredit } = await pool.query(statusDedupCreditSql, [clientId]);

  // 2) Para parcelas já efetivadas, mantém apenas a mais recente quando houver
  //    múltiplas entradas com mesma conta, valor e descrição no mesmo mês.
  //    Restrito a descrições que claramente indicam parcela/débito recorrente.
  const POSTED_LIKE_STATUSES = ['TRANSACAO_EFETIVADA', 'POSTED', 'EFETIVADA'];
  const installmentSql = `
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, account_number, amount,
            UPPER(REGEXP_REPLACE(TRIM(description), '\\s+', ' ', 'g')),
            DATE_TRUNC('month', date)
          ORDER BY date DESC, synced_at DESC
        ) AS rn
      FROM extrator_transactions
      WHERE client_id = $1
        AND status = ANY($2::text[])
        AND (
          UPPER(description) ~* '\\m(PARCELA|DEBITO\\s+SEGURO|SEGURO|EMPREST|FINANC|CONTRATO|MENSALIDADE)\\M'
          OR UPPER(description) ~* '\\mPARCELA\\s+GIRO\\M'
        )
    )
    DELETE FROM extrator_transactions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `;
  const { rowCount: removedInstallmentsBank } = await pool.query(installmentSql, [
    clientId, POSTED_LIKE_STATUSES,
  ]);

  const installmentCreditSql = `
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, account_number, amount,
            UPPER(REGEXP_REPLACE(TRIM(description), '\\s+', ' ', 'g')),
            DATE_TRUNC('month', date)
          ORDER BY date DESC, synced_at DESC
        ) AS rn
      FROM extrator_credit_transactions
      WHERE client_id = $1
        AND status = ANY($2::text[])
        AND (
          UPPER(description) ~* '\\m(PARCELA|DEBITO\\s+SEGURO|SEGURO|EMPREST|FINANC|CONTRATO|MENSALIDADE)\\M'
          OR UPPER(description) ~* '\\mPARCELA\\s+GIRO\\M'
        )
    )
    DELETE FROM extrator_credit_transactions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `;
  const { rowCount: removedInstallmentsCredit } = await pool.query(installmentCreditSql, [
    clientId, POSTED_LIKE_STATUSES,
  ]);

  return {
    removedByStatus: removedByStatusBank + removedByStatusCredit,
    removedInstallments: removedInstallmentsBank + removedInstallmentsCredit,
  };
}

export async function upsertInvestments(pool, clientId, pluggyItemId, investments) {
  if (!investments.length) return 0;
  let count = 0;
  for (const inv of investments) {
    await pool.query(
      `INSERT INTO extrator_investments
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

export async function upsertDebts(pool, clientId, pluggyItemId, accounts) {
  if (!accounts.length) return 0;
  let count = 0;
  for (const acc of accounts) {
    await pool.query(
      `INSERT INTO extrator_debts
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

export async function upsertDerivedDebts(pool, clientId) {
  const { rows } = await pool.query(
    `SELECT
       REGEXP_REPLACE(description, '\\s+\\d+/\\d+', '')        AS name,
       SUBSTRING(description FROM '\\d+/(\\d+)')::int          AS total_parcelas,
       MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)     AS ultima_parcela,
       ROUND(AVG(ABS(amount))::numeric, 2)                    AS valor_medio,
       ROUND(SUM(ABS(amount))::numeric, 2)                    AS total_pago,
       ROUND((AVG(ABS(amount)) *
         (SUBSTRING(description FROM '\\d+/(\\d+)')::int
          - MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)))::numeric, 2) AS saldo_estimado,
       pluggy_item_id,
       institution_name
     FROM extrator_transactions
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
      `INSERT INTO extrator_debts
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

export async function updateItemInstitution(pool, id, institutionName, institutionLogo) {
  await pool.query(
    `UPDATE extrator_items SET institution_name = $1, institution_logo = $2 WHERE id = $3`,
    [institutionName ?? null, institutionLogo ?? null, id]
  );
}

// ── Webhook events ───────────────────────────────────────────────────────────

export async function recordWebhookEvent(pool, { eventId, event, itemId, payload }) {
  if (!eventId) return;
  try {
    await pool.query(
      `INSERT INTO extrator_webhook_events (event_id, event, item_id, payload, received_at)
       VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, event ?? 'UNKNOWN', itemId ?? null, JSON.stringify(payload ?? {})]
    );
  } catch (err) {
    console.error('[storage-company] erro ao registrar webhook event:', err.message);
  }
}

export async function hasWebhookEvent(pool, eventId) {
  if (!eventId) return false;
  const { rows } = await pool.query('SELECT 1 FROM extrator_webhook_events WHERE event_id = $1 LIMIT 1', [eventId]);
  return rows.length > 0;
}

export async function getWebhookEventsForItem(pool, { itemId, linkId, consentId, limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT event_id AS "eventId", event, item_id AS "itemId", payload, received_at AS "receivedAt"
     FROM extrator_webhook_events
     WHERE item_id = ANY($1::text[])
     ORDER BY received_at DESC
     LIMIT $2`,
    [[itemId, linkId, consentId].filter(Boolean), limit]
  );
  return rows;
}

export async function recordKlaviWebhookDebug(pool, { eventId, event, linkId, consentId, payload }) {
  try {
    await pool.query(
      `INSERT INTO extrator_klavi_webhook_debug (event_id, event, link_id, consent_id, payload, received_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [eventId ?? null, event ?? null, linkId ?? null, consentId ?? null, JSON.stringify(payload ?? {})]
    );
  } catch (err) {
    console.error('[storage-company] erro ao registrar debug de webhook:', err.message);
  }
}

// ── Sync logs ─────────────────────────────────────────────────────────────────

export async function createSyncLog(pool, { clientId, itemId }) {
  const { rows } = await pool.query(
    `INSERT INTO extrator_sync_logs (client_id, item_id, started_at, status)
     VALUES ($1, $2, NOW(), 'running') RETURNING id`,
    [clientId ?? null, itemId ?? null]
  );
  return rows[0].id;
}

export async function finishSyncLog(pool, logId, { status, errorMessage, transactionsCount }) {
  await pool.query(
    `UPDATE extrator_sync_logs
     SET finished_at = NOW(), status = $1, error_message = $2, transactions_count = $3 WHERE id = $4`,
    [status, errorMessage ?? null, transactionsCount ?? 0, logId]
  );
}

// ── Sync locks ───────────────────────────────────────────────────────────────

const LOCK_OWNER = process.env.LOCK_OWNER || 'extrator-bancario';
const LOCK_TTL_MINUTES = 10;

export async function acquireSyncLock(pool, owner = LOCK_OWNER, ttlMinutes = LOCK_TTL_MINUTES) {
  await pool.query(`DELETE FROM extrator_sync_locks WHERE expires_at < NOW()`);
  try {
    const { rows } = await pool.query(
      `INSERT INTO extrator_sync_locks (owner, started_at, expires_at)
       VALUES ($1, NOW(), NOW() + INTERVAL '${ttlMinutes} minutes') RETURNING id`,
      [owner]
    );
    return { acquired: true, lockId: rows[0].id };
  } catch (err) {
    if (err.code === '23505') {
      const { rows } = await pool.query(`SELECT started_at, expires_at FROM extrator_sync_locks WHERE owner = $1`, [owner]);
      return { acquired: false, existing: rows[0] };
    }
    throw err;
  }
}

export async function refreshSyncLock(pool, lockId) {
  await pool.query(
    `UPDATE extrator_sync_locks SET expires_at = NOW() + INTERVAL '10 minutes' WHERE id = $1`,
    [lockId]
  );
}

export async function releaseSyncLock(pool, lockId) {
  await pool.query(`DELETE FROM extrator_sync_locks WHERE id = $1`, [lockId]);
}

export async function forceReleaseSyncLock(pool, owner = LOCK_OWNER) {
  await pool.query(`DELETE FROM extrator_sync_locks WHERE owner = $1`, [owner]);
}

// ── Klavi request logs ───────────────────────────────────────────────────────

export async function recordKlaviRequestLog(pool, {
  source,
  method,
  path,
  query,
  requestBody,
  responseStatus,
  responseBody,
  durationMs,
  linkId,
  consentId,
  personalTaxId,
  businessTaxId,
  institutionCode,
  errorMessage,
  clientId,
  itemId,
}) {
  if (!pool) return;
  try {
    const safeRequestBody = sanitizeForLog(requestBody);
    const safeResponseBody = sanitizeForLog(responseBody);
    const safeQuery = sanitizeForLog(query);
    await pool.query(
      `INSERT INTO extrator_klavi_request_logs
         (source, method, path, query, request_body, response_status, response_body, duration_ms,
          link_id, consent_id, personal_tax_id, business_tax_id, institution_code, error_message,
          client_id, item_id, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
      [
        source ?? null,
        method,
        path,
        safeQuery,
        safeRequestBody,
        responseStatus ?? null,
        safeResponseBody,
        durationMs ?? null,
        linkId ?? null,
        consentId ?? null,
        personalTaxId ?? null,
        businessTaxId ?? null,
        institutionCode ?? null,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
        clientId ?? null,
        itemId ?? null,
      ]
    );
  } catch (err) {
    console.error('[storage-company] erro ao registrar log de requisição Klavi:', err.message);
  }
}

function sanitizeForLog(value) {
  if (value === undefined || value === null) return null;
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length > 50_000) {
    text = text.slice(0, 50_000) + '...[truncado]';
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const redactKeys = ['accessKey', 'secretKey', 'authorization', 'accessToken', 'linkToken', 'Authorization'];
      return redactSensitive(parsed, redactKeys);
    }
    return parsed;
  } catch {
    return text;
  }
}

function redactSensitive(obj, keys) {
  if (Array.isArray(obj)) {
    return obj.map(v => (v && typeof v === 'object' ? redactSensitive(v, keys) : v));
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (keys.includes(k)) {
        out[k] = '***';
      } else if (v && typeof v === 'object') {
        out[k] = redactSensitive(v, keys);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return obj;
}

export async function getKlaviRequestLogs(pool, filters = {}, { limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (filters.clientId) {
    conditions.push(`client_id = $${i++}`);
    values.push(filters.clientId);
  }
  if (filters.itemId) {
    conditions.push(`item_id = $${i++}`);
    values.push(filters.itemId);
  }
  if (filters.linkId) {
    conditions.push(`link_id = $${i++}`);
    values.push(filters.linkId);
  }
  if (filters.consentId) {
    conditions.push(`consent_id = $${i++}`);
    values.push(filters.consentId);
  }
  if (filters.personalTaxId) {
    conditions.push(`personal_tax_id = $${i++}`);
    values.push(filters.personalTaxId);
  }
  if (filters.businessTaxId) {
    conditions.push(`business_tax_id = $${i++}`);
    values.push(filters.businessTaxId);
  }
  if (filters.institutionCode) {
    conditions.push(`institution_code = $${i++}`);
    values.push(filters.institutionCode);
  }
  if (filters.method) {
    conditions.push(`method = $${i++}`);
    values.push(filters.method.toUpperCase());
  }
  if (filters.path) {
    conditions.push(`path ILIKE $${i++}`);
    values.push(`%${filters.path}%`);
  }
  if (filters.status) {
    conditions.push(`response_status = $${i++}`);
    values.push(parseInt(filters.status, 10));
  }
  if (filters.source) {
    conditions.push(`source = $${i++}`);
    values.push(filters.source);
  }
  if (filters.from) {
    conditions.push(`requested_at >= $${i++}`);
    values.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`requested_at <= $${i++}`);
    values.push(filters.to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT id, requested_at AS "requestedAt", source, method, path, query, request_body AS "requestBody",
            response_status AS "responseStatus", response_body AS "responseBody", duration_ms AS "durationMs",
            link_id AS "linkId", consent_id AS "consentId", personal_tax_id AS "personalTaxId",
            business_tax_id AS "businessTaxId", institution_code AS "institutionCode",
            error_message AS "errorMessage", client_id AS "clientId", item_id AS "itemId"
     FROM extrator_klavi_request_logs
     ${where}
     ORDER BY requested_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    values
  );
  return rows;
}

export async function countKlaviRequestLogs(pool, filters = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (filters.clientId) { conditions.push(`client_id = $${i++}`); values.push(filters.clientId); }
  if (filters.itemId) { conditions.push(`item_id = $${i++}`); values.push(filters.itemId); }
  if (filters.linkId) { conditions.push(`link_id = $${i++}`); values.push(filters.linkId); }
  if (filters.consentId) { conditions.push(`consent_id = $${i++}`); values.push(filters.consentId); }
  if (filters.personalTaxId) { conditions.push(`personal_tax_id = $${i++}`); values.push(filters.personalTaxId); }
  if (filters.businessTaxId) { conditions.push(`business_tax_id = $${i++}`); values.push(filters.businessTaxId); }
  if (filters.institutionCode) { conditions.push(`institution_code = $${i++}`); values.push(filters.institutionCode); }
  if (filters.method) { conditions.push(`method = $${i++}`); values.push(filters.method.toUpperCase()); }
  if (filters.path) { conditions.push(`path ILIKE $${i++}`); values.push(`%${filters.path}%`); }
  if (filters.status) { conditions.push(`response_status = $${i++}`); values.push(parseInt(filters.status, 10)); }
  if (filters.source) { conditions.push(`source = $${i++}`); values.push(filters.source); }
  if (filters.from) { conditions.push(`requested_at >= $${i++}`); values.push(filters.from); }
  if (filters.to) { conditions.push(`requested_at <= $${i++}`); values.push(filters.to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM extrator_klavi_request_logs ${where}`, values);
  return rows[0]?.total ?? 0;
}
