#!/usr/bin/env node
/**
 * Verifica se o auto-sync da Pluggy está ativo para todos os itens conectados.
 * Uso: node scripts/check-autosync.mjs
 *
 * Requer as variáveis PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no ambiente
 * (carrega automaticamente de .env.local, .env ou .sync.env).
 */

import { readFileSync } from 'fs';
import pg from 'pg';
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

const PLUGGY_CLIENT_ID = process.env.PLUGGY_CLIENT_ID;
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) {
  console.error('❌ PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET são obrigatórios');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL é obrigatória');
  process.exit(1);
}

async function getApiKey() {
  const res = await fetch('https://api.pluggy.ai/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Falha na autenticação Pluggy: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.apiKey;
}

async function getPluggyItem(apiKey, itemId) {
  const res = await fetch(`https://api.pluggy.ai/items/${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!res.ok) throw new Error(`Falha ao buscar item ${itemId}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('🔍 Verificando auto-sync dos itens...\n');

  const clients = (await client.query('SELECT id, name FROM clients ORDER BY name')).rows;
  const items = (await client.query(`
    SELECT i.id, i.client_id, i.pluggy_item_id, i.institution_name, c.name as client_name
    FROM items i
    JOIN clients c ON c.id = i.client_id
    WHERE i.deleted_at IS NULL
    ORDER BY c.name, i.institution_name
  `)).rows;

  if (items.length === 0) {
    console.log('Nenhum item encontrado no banco de dados.');
    await client.end();
    return;
  }

  const apiKey = await getApiKey();

  let total = 0;
  let withAutoSync = 0;
  let withoutAutoSync = 0;

  for (const item of items) {
    total++;
    try {
      const pluggyItem = await getPluggyItem(apiKey, item.pluggy_item_id);
      const nextSync = pluggyItem.nextAutoSyncAt;
      const status = pluggyItem.status;

      if (nextSync) {
        withAutoSync++;
        console.log(`✅ ${item.client_name} → ${item.institution_name} | status: ${status} | próximo auto-sync: ${new Date(nextSync).toLocaleString('pt-BR')}`);
      } else {
        withoutAutoSync++;
        console.log(`⚠️  ${item.client_name} → ${item.institution_name} | status: ${status} | auto-sync: NÃO ATIVO`);
      }
    } catch (err) {
      withoutAutoSync++;
      console.log(`❌ ${item.client_name} → ${item.institution_name} | erro: ${err.message}`);
    }
  }

  await client.end();

  console.log(`\n📊 Total: ${total} | Com auto-sync: ${withAutoSync} | Sem auto-sync: ${withoutAutoSync}`);

  if (withoutAutoSync > 0) {
    console.log('\n⚠️  Itens sem auto-sync podem estar em Development ou o app não foi promovido corretamente.');
    process.exit(1);
  }
  console.log('\n🎉 Todos os itens têm auto-sync ativo!');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
