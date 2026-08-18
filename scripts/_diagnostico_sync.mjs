// Diagnóstico rápido de sync por empresa
import {
  getCompanyPool,
  closeCompanyPools,
  listActiveCompanies,
} from '../lib/company-db.js';
import {
  getClients,
  getItemsByClientId,
  getWebhookEventsForItem,
} from '../lib/storage-company.js';
import pg from 'pg';
const { Pool } = pg;

const TARGETS = (process.argv[2] ? process.argv[2].split(',') : ['lanzi', 'thmz']).map(s => s.trim().toLowerCase());

async function diagnose(empresa) {
  console.log(`\n========== ${empresa.toUpperCase()} ==========`);
  let pool;
  try {
    pool = await getCompanyPool(empresa);
  } catch (err) {
    console.log('ERRO POOL:', err.message);
    return;
  }

  const clients = await getClients(pool);
  console.log(`Clientes: ${clients.length}`);

  for (const client of clients) {
    console.log(`\n-- Cliente: ${client.name} (id=${client.id}) lastSync=${client.lastSync || 'nunca'}`);
    const items = await getItemsByClientId(pool, client.id);
    if (!items.length) {
      console.log('   Nenhum item/conexão bancária.');
      continue;
    }

    for (const item of items) {
      console.log(`   Item: ${item.institutionName || '(sem nome)'}`);
      console.log(`      provider=${item.provider} status=${item.status} executionStatus=${item.executionStatus}`);
      console.log(`      requiresReconnect=${item.requiresReconnect} consecutiveErrors=${item.consecutiveErrors} syncCount=${item.syncCount}`);
      console.log(`      errorCode=${item.errorCode} errorMessage=${item.errorMessage}`);
      console.log(`      lastUpdatedAt=${item.lastUpdatedAt} lastErrorAt=${item.lastErrorAt}`);
      console.log(`      klaviLinkId=${item.klaviLinkId} klaviConsentId=${item.klaviConsentId} consentExpiresAt=${item.consentExpiresAt}`);
      console.log(`      pluggyItemId=${item.pluggyItemId} taxType=${item.taxType} deletedAt=${item.deletedAt}`);

      const events = await getWebhookEventsForItem(pool, {
        itemId: item.pluggyItemId,
        linkId: item.klaviLinkId,
        consentId: item.klaviConsentId,
        limit: 5,
      }).catch(() => []);

      if (events.length) {
        console.log('      Últimos webhooks:');
        for (const ev of events) {
          console.log(`         ${ev.receivedAt} ${ev.event} itemId=${ev.itemId}`);
        }
      }
    }
  }

  // Últimos sync logs
  console.log('\n-- Últimos sync logs:');
  try {
    const { rows: logs } = await pool.query(
      `SELECT id, client_id, item_id, started_at, finished_at, status, error_message, transactions_count
       FROM extrator_sync_logs
       WHERE started_at > NOW() - INTERVAL '7 days'
       ORDER BY started_at DESC LIMIT 20`
    );
    if (!logs.length) console.log('   Nenhum sync log nos últimos 7 dias.');
    for (const log of logs) {
      console.log(`   ${log.started_at} status=${log.status} tx=${log.transactions_count} err=${log.error_message || '-'}`);
    }
  } catch (err) {
    console.log('   ERRO sync logs:', err.message);
  }

  // Locks pendentes
  console.log('\n-- Locks de sync:');
  try {
    const { rows: locks } = await pool.query(`SELECT owner, started_at, expires_at FROM extrator_sync_locks ORDER BY started_at DESC LIMIT 5`);
    if (!locks.length) console.log('   Nenhum lock ativo.');
    for (const lock of locks) {
      console.log(`   owner=${lock.owner} started=${lock.started_at} expires=${lock.expires_at}`);
    }
  } catch (err) {
    console.log('   ERRO locks:', err.message);
  }
}

async function main() {
  const allCompanies = await listActiveCompanies().catch(() => []);
  console.log('Empresas ativas no banco central:', allCompanies.map(c => c.slug).join(', '));

  for (const empresa of TARGETS) {
    await diagnose(empresa);
  }

  await closeCompanyPools();
}

main().catch(err => {
  console.error('Falha no diagnóstico:', err);
  process.exit(1);
});
