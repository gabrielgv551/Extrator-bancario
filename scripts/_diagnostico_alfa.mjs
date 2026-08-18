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
const EMPRESA = 'alfadistribuidora';
const CLIENT_ID = '0c007a39-ad94-4688-be01-fe333b113231';

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
  const res = await fetch(`${KLAVI_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function klaviGetWithTimeout(path, accessToken, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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

async function main() {
  console.log('KLAVI_API_BASE:', KLAVI_API_BASE);

  let accessToken = null;
  try {
    const auth = await getKlaviAccessToken();
    accessToken = auth.accessToken;
    console.log('Klavi accessToken obtido:', accessToken.slice(0, 12) + '...');
  } catch (e) {
    console.log('⚠️ Não foi possível autenticar na Klavi:', e.message);
  }

  // Cliente
  const { rows: clientRows } = await companyPool.query(
    `SELECT id, name, business_tax_id, gestor_empresa, last_sync, created_at
     FROM extrator_clients WHERE id = $1 LIMIT 1`,
    [CLIENT_ID]
  );
  console.log('\n=== CLIENTE ===');
  console.log(clientRows[0] || 'Não encontrado');

  // Itens
  const { rows: items } = await companyPool.query(
    `SELECT id, provider, institution_name, institution_code, status, execution_status,
            error_code, error_message, last_updated_at, last_error_at, sync_count,
            consecutive_errors, requires_reconnect, klavi_link_id, klavi_consent_id,
            business_tax_id, personal_tax_id, tax_type, account_numbers, deleted_at,
            created_at
     FROM extrator_items
     WHERE client_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [CLIENT_ID]
  );
  console.log('\n=== ITENS ===');
  for (const item of items) {
    console.log('\n--- Item:', item.institution_name, '---');
    console.log(JSON.stringify(item, null, 2));

    // Status na Klavi
    if (accessToken && item.klavi_link_id) {
      try {
        const linkStatus = await klaviGetWithTimeout(`/links/${item.klavi_link_id}`, accessToken);
        console.log('Link status Klavi:', linkStatus.status, JSON.stringify(linkStatus.body, null, 2).slice(0, 800));
      } catch (e) {
        console.log('Erro ao consultar link:', e.message);
      }
    }
    if (accessToken && item.klavi_consent_id) {
      try {
        const consentStatus = await klaviGetWithTimeout(`/consents/${item.klavi_consent_id}`, accessToken);
        console.log('Consent status Klavi:', consentStatus.status, JSON.stringify(consentStatus.body, null, 2).slice(0, 800));
      } catch (e) {
        console.log('Erro ao consultar consent:', e.message);
      }
    }

    // Consentimentos por CPF/CNPJ do item
    if (accessToken && (item.business_tax_id || item.personal_tax_id)) {
      try {
        const params = new URLSearchParams();
        if (item.business_tax_id) params.set('businessTaxId', item.business_tax_id);
        if (item.personal_tax_id) params.set('personalTaxId', item.personal_tax_id);
        if (item.klavi_link_id) params.set('linkId', item.klavi_link_id);
        const consents = await klaviGetWithTimeout(`/consents?${params.toString()}`, accessToken);
        console.log('Consentimentos relacionados:', JSON.stringify(consents.body, null, 2).slice(0, 1000));
      } catch (e) {
        console.log('Erro ao listar consents:', e.message);
      }
    }
  }

  // Webhooks recentes
  const { rows: webhooks } = await companyPool.query(
    `SELECT event_id, event, item_id, received_at,
            payload->'consentStatus' as consent_status,
            payload->'event' as event_payload,
            payload->'productName' as product_name
     FROM extrator_webhook_events
     ORDER BY received_at DESC
     LIMIT 50`
  );
  console.log('\n=== WEBHOOKS RECENTES (últimos 50) ===');
  for (const w of webhooks) {
    console.log(`${w.received_at} | ${w.event || 'n/a'} | item=${w.item_id?.slice(0,8)} | consentStatus=${w.consent_status} | productName=${w.product_name}`);
  }

  // Webhook debug recentes
  const { rows: debugs } = await companyPool.query(
    `SELECT received_at, event, link_id, consent_id, payload
     FROM extrator_klavi_webhook_debug
     ORDER BY received_at DESC
     LIMIT 20`
  );
  console.log('\n=== WEBHOOK DEBUG RECENTES (últimos 20) ===');
  for (const d of debugs) {
    console.log(`${d.created_at} | ${d.event || 'n/a'} | link=${d.link_id?.slice(0,8)} | consent=${d.consent_id?.slice(0,8)}`);
    const keys = Object.keys(d.payload || {});
    console.log('  payload keys:', keys.join(', '));
  }

  // Transações por item
  console.log('\n=== TRANSAÇÕES POR ITEM ===');
  for (const item of items) {
    const { rows: txCount } = await companyPool.query(
      `SELECT count(*) as total FROM extrator_transactions WHERE item_id = $1`,
      [item.id]
    );
    const { rows: creditCount } = await companyPool.query(
      `SELECT count(*) as total FROM extrator_credit_transactions WHERE item_id = $1`,
      [item.id]
    );
    console.log(`${item.institution_name}: ${txCount[0].total} débito + ${creditCount[0].total} crédito`);
  }

  await centralPool.end();
  await companyPool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
