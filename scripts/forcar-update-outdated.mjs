#!/usr/bin/env node
/**
 * Tenta forcar o update (PATCH) de todos os itens OUTDATED e sincroniza os dados.
 * Uso: node scripts/forcar-update-outdated.mjs
 */

import { readFileSync } from 'fs';
import pg from 'pg';
import { updatePluggyItem, waitForItemUpdate, getItem } from '../lib/pluggy.js';
import { syncItemData } from '../lib/sync-processor.js';

const { Client } = pg;

for (const file of ['.env.local', '.env', '.sync.env']) {
  try {
    const envFile = readFileSync(file, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL é obrigatória');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('🔄 Verificando itens OUTDATED...\n');

  const items = (await client.query(`
    SELECT i.id, i.client_id, i.pluggy_item_id, i.institution_name, c.name as client_name
    FROM items i
    JOIN clients c ON c.id = i.client_id
    WHERE i.deleted_at IS NULL
    ORDER BY c.name, i.institution_name
  `)).rows;

  await client.end();

  if (items.length === 0) {
    console.log('Nenhum item encontrado.');
    return;
  }

  const outdated = [];
  for (const item of items) {
    try {
      const pluggyItem = await getItem(item.pluggy_item_id);
      if (pluggyItem.status === 'OUTDATED') {
        outdated.push({ ...item, errorCode: pluggyItem.error?.code, errorMessage: pluggyItem.error?.message });
      }
    } catch (err) {
      console.log(`⚠️  ${item.client_name} → ${item.institution_name}: erro ao consultar Pluggy (${err.message})`);
    }
  }

  if (outdated.length === 0) {
    console.log('🎉 Nenhum item está OUTDATED no momento.');
    return;
  }

  console.log(`🔧 ${outdated.length} item(s) OUTDATED encontrado(s). Tentando atualizar...\n`);

  for (const item of outdated) {
    console.log(`\n🏢 ${item.client_name} → ${item.institution_name}`);
    if (item.errorCode) console.log(`   Erro atual: ${item.errorCode} — ${item.errorMessage}`);

    try {
      console.log('   📡 Enviando PATCH...');
      const patchResult = await updatePluggyItem(item.pluggy_item_id);
      console.log(`   Status após PATCH: ${patchResult?.status || 'unknown'}`);

      if (patchResult?.status === 'UPDATING') {
        console.log('   ⏳ Aguardando atualização...');
        const updated = await waitForItemUpdate(item.pluggy_item_id, { timeoutMs: 120_000, intervalMs: 3000 });
        console.log(`   Status final: ${updated?.status || 'unknown'}`);

        if (updated?.status === 'UPDATED') {
          console.log('   💾 Sincronizando transações...');
          const syncResult = await syncItemData(item, { skipIfNotHealthy: false });
          console.log(`   ✅ Sync concluído: ${syncResult.success ? 'sucesso' : 'falha'} — ${syncResult.reason || ''}`);
        } else {
          console.log(`   ⚠️  Item não ficou UPDATED. Provavelmente precisa reconectar.`);
        }
      } else if (patchResult?.status === 'UPDATED') {
        console.log('   💾 Sincronizando transações...');
        const syncResult = await syncItemData(item, { skipIfNotHealthy: false });
        console.log(`   ✅ Sync concluído: ${syncResult.success ? 'sucesso' : 'falha'} — ${syncResult.reason || ''}`);
      } else {
        console.log(`   ⚠️  PATCH retornou status inesperado: ${patchResult?.status}. Pode precisar reconectar.`);
      }
    } catch (err) {
      console.log(`   ❌ Erro durante update: ${err.message}`);
    }
  }

  console.log('\n🏁 Processo finalizado.');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
