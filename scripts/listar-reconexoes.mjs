#!/usr/bin/env node
/**
 * Lista todos os itens que precisam de reconexao, buscando o status real da Pluggy.
 * Uso: node scripts/listar-reconexoes.mjs
 * Opcoes:
 *   --format=table    → formato de tabela (padrao)
 *   --format=links    → lista com links do portal
 *   --save= arquivo   → salva em arquivo
 */

import { readFileSync, writeFileSync } from 'fs';
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
const BASE_URL = process.env.PORTAL_BASE_URL || 'https://extrator-bancario.vercel.app';

if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) {
  console.error('❌ PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET são obrigatórios');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL é obrigatória');
  process.exit(1);
}

const args = process.argv.slice(2);
const format = args.find(a => a.startsWith('--format='))?.split('=')[1] || 'table';
const saveFile = args.find(a => a.startsWith('--save='))?.split('=')[1];

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

function needsReconnect(status, errorCode) {
  if (status === 'LOGIN_ERROR') return true;
  if (status === 'OUTDATED') return true;
  if (['INVALID_CREDENTIALS', 'USER_AUTHORIZATION_REVOKED', 'CONSENT_EXPIRED', 'CONSENT_REVOKED'].includes(errorCode)) return true;
  return false;
}

function formatAccountNumbers(accountNumbers) {
  if (!accountNumbers) return '-';
  const raw = String(accountNumbers).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(', ');
    return String(parsed);
  } catch {
    return raw.replace(/^\{|\}$/g, '').replace(/"/g, '');
  }
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const items = (await client.query(`
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      c.portal_token,
      i.id AS item_id,
      i.pluggy_item_id,
      i.institution_name,
      i.account_numbers
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

  const apiKey = await getApiKey();
  const problems = [];

  for (const item of items) {
    try {
      const pluggyItem = await getPluggyItem(apiKey, item.pluggy_item_id);
      const status = pluggyItem.status;
      const errorCode = pluggyItem.error?.code;
      const errorMessage = pluggyItem.error?.message;

      if (!needsReconnect(status, errorCode)) continue;

      problems.push({
        clientName: item.client_name,
        institutionName: item.institution_name.replace(' Empresas', ''),
        status,
        errorCode,
        errorMessage,
        accountNumbers: formatAccountNumbers(item.account_numbers),
        lastUpdatedAt: pluggyItem.lastUpdatedAt
          ? new Date(pluggyItem.lastUpdatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
          : '-',
        portalLink: `${BASE_URL}/portal/${item.portal_token}`,
      });
    } catch (err) {
      console.error(`Erro ao consultar ${item.client_name} → ${item.institution_name}:`, err.message);
    }
  }

  if (problems.length === 0) {
    console.log('🎉 Nenhum item precisa de reconexão.');
    return;
  }

  let output = '';

  if (format === 'links') {
    let currentClient = null;
    for (const p of problems) {
      if (currentClient !== p.clientName) {
        currentClient = p.clientName;
        output += `\n🏢 ${p.clientName}\n`;
        output += `   🔗 Link do portal: ${p.portalLink}\n`;
      }
      output += `\n   🏦 ${p.institutionName}\n`;
      output += `      Status: ${p.status}\n`;
      output += `      Conta(s): ${p.accountNumbers}\n`;
      output += `      Última atualização: ${p.lastUpdatedAt}\n`;
      if (p.errorCode) output += `      Erro: ${p.errorCode} — ${p.errorMessage}\n`;
    }
  } else {
    // table format
    const header = 'Empresa           | Banco     | Conta(s)                                     | Status      | Atualizado';
    const separator = '------------------|-----------|----------------------------------------------|-------------|------------';
    const lines = problems.map(p => {
      const empresa = p.clientName.padEnd(17).slice(0, 17);
      const banco = p.institutionName.padEnd(9).slice(0, 9);
      const conta = p.accountNumbers.padEnd(44).slice(0, 44);
      const status = p.status.padEnd(11).slice(0, 11);
      return `${empresa}| ${banco} | ${conta} | ${status} | ${p.lastUpdatedAt}`;
    });
    output = [header, separator, ...lines].join('\n');
  }

  output += `\n\n📊 Total de itens com problema: ${problems.length}\n`;

  if (saveFile) {
    writeFileSync(saveFile, output, 'utf-8');
    console.log(`✅ Lista salva em: ${saveFile}\n`);
  }

  console.log(output);
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
