/**
 * Migra um cliente do banco central do Extrator para o banco tenant de uma empresa.
 * Usado quando um cliente antigo (criado no extrator central) precisa ser
 * visualizado no dashboard filtrado por empresa do Have Gestor.
 *
 * Uso:
 *   node scripts/migrate-client-to-company.mjs <empresa> <nome_cliente_central>
 *
 * Exemplo:
 *   node scripts/migrate-client-to-company.mjs guilhen Guilhen
 */

import pg from 'pg';
import { getCompanyPool, getCentralConfig } from '../lib/company-db.js';
import { registerToken, registerItemLocation } from '../lib/central-token-map.js';

function getCentralPool() {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

async function getClientCentral(pool, name) {
  const { rows } = await pool.query(
    `SELECT id, name, portal_token, last_sync, created_at, business_tax_id, gestor_empresa
     FROM clients WHERE LOWER(name) = LOWER($1)`,
    [name]
  );
  return rows[0] ?? null;
}

async function getClientCompany(pool, empresa) {
  const { rows } = await pool.query(
    `SELECT id, name, portal_token, last_sync, created_at, business_tax_id, gestor_empresa
     FROM extrator_clients WHERE gestor_empresa = $1 ORDER BY created_at ASC LIMIT 1`,
    [empresa]
  );
  return rows[0] ?? null;
}

const ITEM_COLUMNS = [
  'id', 'client_id', 'pluggy_item_id', 'institution_name', 'institution_logo', 'account_numbers',
  'provider', 'klavi_link_id', 'klavi_consent_id', 'business_tax_id', 'personal_tax_id', 'tax_type',
  'institution_code', 'status', 'execution_status', 'error_code', 'error_message', 'last_updated_at',
  'last_error_at', 'sync_count', 'consecutive_errors', 'requires_reconnect', 'deleted_at',
  'consent_expires_at', 'notification_sent_at', 'created_at', 'updated_at'
];

async function migrateItems(central, company, oldClientId, newClientId) {
  const CHUNK = 500;
  let migrated = 0;

  while (true) {
    const { rows } = await central.query(
      `SELECT ${ITEM_COLUMNS.join(', ')}
       FROM items
       WHERE client_id = $1
       ORDER BY id
       LIMIT $2
       OFFSET $3`,
      [oldClientId, CHUNK, migrated]
    );
    if (rows.length === 0) break;

    const placeholders = [];
    const values = [];
    let p = 1;
    for (const row of rows) {
      placeholders.push(`(${ITEM_COLUMNS.map(() => `$${p++}`).join(',')})`);
      for (const col of ITEM_COLUMNS) {
        values.push(col === 'client_id' ? newClientId : (row[col] ?? null));
      }
    }

    console.log(`  [itens] migrando lote de ${rows.length} itens...`);
    await company.query(
      `INSERT INTO extrator_items (${ITEM_COLUMNS.join(', ')})
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         pluggy_item_id = EXCLUDED.pluggy_item_id,
         institution_name = EXCLUDED.institution_name,
         institution_logo = EXCLUDED.institution_logo,
         account_numbers = EXCLUDED.account_numbers,
         status = EXCLUDED.status,
         execution_status = EXCLUDED.execution_status,
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         last_updated_at = EXCLUDED.last_updated_at,
         last_error_at = EXCLUDED.last_error_at,
         sync_count = EXCLUDED.sync_count,
         consecutive_errors = EXCLUDED.consecutive_errors,
         requires_reconnect = EXCLUDED.requires_reconnect,
         deleted_at = EXCLUDED.deleted_at,
         consent_expires_at = EXCLUDED.consent_expires_at,
         notification_sent_at = EXCLUDED.notification_sent_at,
         updated_at = EXCLUDED.updated_at`,
      values
    );
    migrated += rows.length;
    console.log(`  [itens] total migrado: ${migrated}`);
  }
  return migrated;
}

async function migrateTable(central, company, table, oldClientId, newClientId, columns) {
  const select = columns.map(c => `t.${c}`).join(', ');
  const insert = columns.join(', ');
  const CHUNK = 1000;
  let migrated = 0;

  while (true) {
    console.log(`  [${table}] lendo lote de ${CHUNK} registros (offset ${migrated})...`);
    const { rows } = await central.query(
      `SELECT ${select} FROM ${table} t WHERE t.client_id = $1 ORDER BY t.id LIMIT $2 OFFSET $3`,
      [oldClientId, CHUNK, migrated]
    );
    if (rows.length === 0) break;

    const placeholders = [];
    const values = [];
    let p = 1;
    for (const row of rows) {
      placeholders.push(`(${columns.map(() => `$${p++}`).join(',')})`);
      for (const col of columns) {
        values.push(col === 'client_id' ? newClientId : (row[col] ?? null));
      }
    }

    console.log(`  [${table}] inserindo ${rows.length} registros...`);
    await company.query(
      `INSERT INTO extrator_${table} (${insert}) VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         client_name = EXCLUDED.client_name,
         pluggy_item_id = EXCLUDED.pluggy_item_id,
         date = EXCLUDED.date,
         description = EXCLUDED.description,
         type = EXCLUDED.type,
         amount = EXCLUDED.amount,
         balance = EXCLUDED.balance,
         category = EXCLUDED.category,
         category_l1 = EXCLUDED.category_l1,
         category_l2 = EXCLUDED.category_l2,
         category_l3 = EXCLUDED.category_l3,
         account_name = EXCLUDED.account_name,
         account_number = EXCLUDED.account_number,
         account_type = EXCLUDED.account_type,
         institution_name = EXCLUDED.institution_name,
         counterparty_name = EXCLUDED.counterparty_name,
         counterparty_document = EXCLUDED.counterparty_document,
         status = EXCLUDED.status,
         date_transacted = EXCLUDED.date_transacted,
         synced_at = EXCLUDED.synced_at`,
      values
    );
    migrated += rows.length;
    console.log(`  [${table}] total migrado: ${migrated}`);
  }
  return migrated;
}

async function updateClientCompany(company, clientId, { portalToken, lastSync, createdAt }) {
  await company.query(
    `UPDATE extrator_clients
     SET portal_token = $1, last_sync = $2, created_at = $3
     WHERE id = $4`,
    [portalToken, lastSync, createdAt, clientId]
  );
}

async function removeClientCentral(central, clientId) {
  await central.query(`DELETE FROM items WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM transactions WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM credit_transactions WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM investments WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM debts WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM sync_logs WHERE client_id = $1`, [clientId]);
  await central.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
}

async function main() {
  const [,, empresa, nomeCliente] = process.argv;
  if (!empresa || !nomeCliente) {
    console.log('Uso: node scripts/migrate-client-to-company.mjs <empresa> <nome_cliente_central>');
    process.exit(1);
  }

  const empresaSlug = empresa.toLowerCase().trim();
  const central = getCentralPool();
  const company = await getCompanyPool(empresaSlug);

  try {
    const oldClient = await getClientCentral(central, nomeCliente);
    if (!oldClient) {
      console.log(`❌ Cliente "${nomeCliente}" não encontrado no banco central.`);
      process.exit(1);
    }

    if (oldClient.gestor_empresa && oldClient.gestor_empresa !== empresaSlug) {
      console.log(`⚠️ Cliente já vinculado a empresa "${oldClient.gestor_empresa}". Continuar?`);
      // Não bloqueia, apenas avisa.
    }

    const newClient = await getClientCompany(company, empresaSlug);
    if (!newClient) {
      console.log(`❌ Empresa "${empresaSlug}" não possui cliente no banco tenant. Crie primeiro via /api/gestor/client.`);
      process.exit(1);
    }

    console.log(`\nCliente central: ${oldClient.name} (${oldClient.id})`);
    console.log(`Cliente empresa: ${newClient.name} (${newClient.id})`);
    console.log(`Portal token será mantido: ${oldClient.portal_token}`);

    // 1. Atualiza dados do cliente na empresa
    await updateClientCompany(company, newClient.id, {
      portalToken: oldClient.portal_token,
      lastSync: oldClient.last_sync,
      createdAt: oldClient.created_at,
    });
    console.log('✅ Dados do cliente atualizados no banco da empresa.');

    // 2. Migra itens
    const itemsCount = await migrateItems(central, company, oldClient.id, newClient.id);
    console.log(`✅ ${itemsCount} itens migrados.`);

    // 2.1 Registra localização dos itens no mapa central para webhooks
    const { rows: migratedItems } = await company.query(
      `SELECT id, client_id, pluggy_item_id, klavi_link_id, klavi_consent_id
       FROM extrator_items WHERE client_id = $1`,
      [newClient.id]
    );
    for (const item of migratedItems) {
      try {
        await registerItemLocation(empresaSlug, {
          itemId: item.id,
          clientId: item.client_id,
          pluggyItemId: item.pluggy_item_id,
          klaviLinkId: item.klavi_link_id,
          klaviConsentId: item.klavi_consent_id,
        });
      } catch (err) {
        console.warn(`⚠️ Falha ao registrar localização do item ${item.id}: ${err.message}`);
      }
    }
    console.log(`✅ ${migratedItems.length} localizações de item registradas no mapa central.`);

    // 3. Migra transações
    const txColumns = [
      'id', 'client_id', 'client_name', 'pluggy_item_id', 'date', 'description', 'type',
      'amount', 'balance', 'category', 'category_l1', 'category_l2', 'category_l3',
      'account_name', 'account_number', 'account_type', 'institution_name',
      'counterparty_name', 'counterparty_document', 'status', 'date_transacted', 'synced_at'
    ];
    const txCount = await migrateTable(central, company, 'transactions', oldClient.id, newClient.id, txColumns);
    console.log(`✅ ${txCount} transações migradas.`);

    const ctxCount = await migrateTable(central, company, 'credit_transactions', oldClient.id, newClient.id, txColumns);
    console.log(`✅ ${ctxCount} transações de crédito migradas.`);

    // 4. Registra token no mapa central
    try {
      await registerToken(oldClient.portal_token, empresaSlug, newClient.id);
      console.log('✅ Portal token registrado no mapa central.');
    } catch (err) {
      console.warn(`⚠️ Falha ao registrar token no mapa central: ${err.message}`);
    }

    // 5. Remove dados antigos do central
    await removeClientCentral(central, oldClient.id);
    console.log('✅ Cliente antigo removido do banco central.');

    console.log(`\n🎉 Migração concluída. O cliente "${nomeCliente}" agora está no banco da empresa ${empresaSlug}.`);
  } finally {
    await central.end();
    await company.end();
  }
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
