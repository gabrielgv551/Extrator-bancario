// Diagnóstico do C6 Bank para DG Financeira (empresa guilhen).
// Uso: node scripts/_diagnostico_guilhen_c6.mjs
//
// Mostra:
//   - Status do item/conexão C6 no banco local
//   - Consentimentos autorizados na Klavi e suas permissões
//   - Webhooks recentes e quais produtos/contas vieram
//   - Contagem de transações por tipo (débito/crédito)

import { readFileSync } from 'fs';
import pg from 'pg';
const { Pool } = pg;

for (const file of ['.env.local', '.env.production.pulled', '.env']) {
  try {
    const envFile = readFileSync(file, 'utf-8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && (!process.env[key] || !process.env[key].trim())) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Variável ${name} não definida`);
  return process.env[name];
}

const KLAVI_API_BASE = process.env.KLAVI_API_BASE || 'https://api.klavi.ai/data/v1';
const EMPRESA = 'guilhen';
const CLIENT_NAME = 'DG Financeira';

const centralPool = new Pool({
  host: requireEnv('CENTRAL_DB_HOST'),
  port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
  database: requireEnv('CENTRAL_DB_NAME'),
  user: requireEnv('CENTRAL_DB_USER'),
  password: requireEnv('CENTRAL_DB_PASSWORD'),
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const companyPool = new Pool({
  host: requireEnv('CENTRAL_DB_HOST'),
  port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
  database: `have_${EMPRESA}`,
  user: requireEnv('CENTRAL_DB_USER'),
  password: requireEnv('CENTRAL_DB_PASSWORD'),
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function getKlaviAccessToken() {
  const res = await fetch(`${KLAVI_API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessKey: requireEnv('KLAVI_ACCESS_KEY'),
      secretKey: requireEnv('KLAVI_SECRET_KEY'),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Klavi auth falhou: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function klaviGet(path, accessToken) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${KLAVI_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function inspectPayloadKeys(payload) {
  const keys = Object.keys(payload || {});
  const accountKeys = [];
  for (const key of keys) {
    const val = payload[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      accountKeys.push(`${key}(${val.length})`);
    }
  }
  return { keys, accountKeys };
}

async function main() {
  console.log('KLAVI_API_BASE:', KLAVI_API_BASE);
  console.log('Empresa:', EMPRESA);
  console.log('Cliente:', CLIENT_NAME);

  let accessToken = null;
  try {
    const auth = await getKlaviAccessToken();
    accessToken = auth.accessToken;
    console.log('\n✅ Klavi accessToken obtido');
  } catch (e) {
    console.log('\n⚠️ Não foi possível autenticar na Klavi:', e.message);
  }

  const { rows: clientRows } = await companyPool.query(
    `SELECT id, name, business_tax_id, gestor_empresa, last_sync, created_at
     FROM extrator_clients
     WHERE name ILIKE $1
     LIMIT 1`,
    [`%${CLIENT_NAME}%`]
  );

  console.log('\n=== CLIENTE ===');
  if (clientRows.length === 0) {
    console.log('❌ Cliente não encontrado');
    await centralPool.end();
    await companyPool.end();
    return;
  }
  const client = clientRows[0];
  console.log(JSON.stringify(client, null, 2));

  const { rows: items } = await companyPool.query(
    `SELECT id, provider, institution_name, institution_code, status, execution_status,
            error_code, error_message, last_updated_at, last_error_at, sync_count,
            consecutive_errors, requires_reconnect, klavi_link_id, klavi_consent_id,
            business_tax_id, personal_tax_id, tax_type, account_numbers, deleted_at,
            created_at
     FROM extrator_items
     WHERE client_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [client.id]
  );

  console.log('\n=== ITENS ===');
  const c6Items = items.filter(i =>
    (i.institution_name || '').toLowerCase().includes('c6')
  );

  if (c6Items.length === 0) {
    console.log('⚠️ Nenhum item com nome contendo "c6" encontrado. Mostrando todos os itens:');
    for (const item of items) {
      console.log(`- ${item.institution_name || '(sem nome)'} status=${item.status}`);
    }
  }

  for (const item of c6Items) {
    console.log(`\n--- C6 Item: ${item.institution_name} ---`);
    console.log(JSON.stringify(item, null, 2));

    if (accessToken && item.klavi_link_id) {
      try {
        const linkStatus = await klaviGet(`/links/${item.klavi_link_id}`, accessToken);
        console.log('\nLink status Klavi:', linkStatus.status);
        console.log(JSON.stringify(linkStatus.body, null, 2).slice(0, 1000));
      } catch (e) {
        console.log('Erro ao consultar link:', e.message);
      }
    }

    if (accessToken && item.klavi_consent_id) {
      try {
        const consentStatus = await klaviGet(`/consents/${item.klavi_consent_id}`, accessToken);
        console.log('\nConsent status Klavi:', consentStatus.status);
        console.log(JSON.stringify(consentStatus.body, null, 2).slice(0, 1200));
      } catch (e) {
        console.log('Erro ao consultar consent:', e.message);
      }
    }

    if (accessToken && (item.business_tax_id || item.personal_tax_id)) {
      try {
        const params = new URLSearchParams();
        if (item.business_tax_id) params.set('businessTaxId', item.business_tax_id);
        if (item.personal_tax_id) params.set('personalTaxId', item.personal_tax_id);
        if (item.klavi_link_id) params.set('linkId', item.klavi_link_id);
        const consents = await klaviGet(`/consents?${params.toString()}`, accessToken);
        console.log('\nTodos os consentimentos relacionados:');
        const list = Array.isArray(consents.body) ? consents.body : (consents.body?.consents || []);
        for (const c of list) {
          console.log(`  - ${c.consentId || c.consentid} | status=${c.status} | institution=${c.institutionCode || c.institution_code} | products=${(c.products || c.product || c.scope || c.scopes || []).join(',')}`);
        }
      } catch (e) {
        console.log('Erro ao listar consents:', e.message);
      }
    }
  }

  console.log('\n=== WEBHOOKS RECENTES (últimos 50) ===');
  const { rows: webhooks } = await companyPool.query(
    `SELECT event_id, event, item_id, received_at,
            payload->>'consentStatus' as consent_status,
            payload->>'event' as event_payload,
            payload->>'productName' as product_name,
            payload->>'productReportId' as product_report_id
     FROM extrator_webhook_events
     ORDER BY received_at DESC
     LIMIT 50`
  );
  for (const w of webhooks) {
    console.log(`${w.received_at} | ${w.event || 'n/a'} | item=${w.item_id?.slice(0, 8)} | product=${w.product_name || '-'} | consentStatus=${w.consent_status || '-'}`);
  }

  console.log('\n=== WEBHOOK DEBUG RECENTES (últimos 10 payloads completos para C6) ===');
  const { rows: debugs } = await companyPool.query(
    `SELECT received_at, event, link_id, consent_id, payload
     FROM extrator_klavi_webhook_debug
     ORDER BY received_at DESC
     LIMIT 50`
  );
  let shown = 0;
  for (const d of debugs) {
    const payloadStr = JSON.stringify(d.payload || {});
    const isC6Payload = payloadStr.toLowerCase().includes('c6') ||
      c6Items.some(i => i.klavi_link_id === d.link_id || i.klavi_consent_id === d.consent_id);
    if (!isC6Payload) continue;
    shown++;
    if (shown > 10) {
      console.log(`\n... e mais ${debugs.filter(x => {
        const s = JSON.stringify(x.payload || {});
        return s.toLowerCase().includes('c6') || c6Items.some(i => i.klavi_link_id === x.link_id || i.klavi_consent_id === x.consent_id);
      }).length - 10} payloads de C6`);
      break;
    }
    const { keys, accountKeys } = inspectPayloadKeys(d.payload);
    console.log(`\n${d.received_at} | event=${d.event || 'n/a'} | link=${d.link_id?.slice(0, 8)} | consent=${d.consent_id?.slice(0, 8)}`);
    console.log('  payload keys:', keys.join(', '));
    console.log('  arrays de contas:', accountKeys.join(', ') || 'nenhuma');
    if (d.payload?.checkingAccounts) {
      console.log('  checkingAccounts:', JSON.stringify(d.payload.checkingAccounts, null, 2).slice(0, 1200));
    }
    if (d.payload?.creditCardAccounts) {
      console.log('  creditCardAccounts:', JSON.stringify(d.payload.creditCardAccounts, null, 2).slice(0, 1200));
    }
  }
  if (shown === 0) console.log('Nenhum webhook debug de C6 encontrado.');

  console.log('\n=== TRANSAÇÕES POR ITEM ===');
  for (const item of c6Items) {
    const { rows: txCount } = await companyPool.query(
      `SELECT count(*) as total FROM extrator_transactions WHERE pluggy_item_id = $1`,
      [item.id]
    );
    const { rows: creditCount } = await companyPool.query(
      `SELECT count(*) as total FROM extrator_credit_transactions WHERE pluggy_item_id = $1`,
      [item.id]
    );
    console.log(`${item.institution_name}: ${txCount[0].total} conta corrente + ${creditCount[0].total} cartão de crédito`);
  }

  await centralPool.end();
  await companyPool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
