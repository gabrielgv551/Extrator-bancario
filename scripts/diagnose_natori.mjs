#!/usr/bin/env node
/**
 * Diagnóstico específico para Natori Food no portal Klavi.
 * Busca dados no banco central/tenant e testa a API Klavi para reproduzir o erro.
 */

import { readFileSync } from 'fs';
import pg from 'pg';

const { Pool, Client } = pg;

// Carrega variáveis de ambiente de produção (prioridade: .env.local, depois .env.production.pulled)
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

const KLAVI_API_BASE = process.env.KLAVI_API_BASE || 'https://api.klavi.ai/data/v1';

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Variável ${name} não definida`);
  return process.env[name];
}

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

async function createKlaviLink(accessToken, { personalTaxId, businessTaxId, redirectUrl }) {
  const body = {};
  if (personalTaxId) body.personalTaxId = personalTaxId;
  if (businessTaxId) body.businessTaxId = businessTaxId;
  if (redirectUrl) body.redirectURL = redirectUrl;

  const res = await fetch(`${KLAVI_API_BASE}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function getKlaviInstitutions(linkToken) {
  const res = await fetch(`${KLAVI_API_BASE}/links/institutions`, {
    headers: { Authorization: `Bearer ${linkToken}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function decodeLinkJwt(linkURL) {
  try {
    const url = new URL(linkURL);
    const v = url.searchParams.get('v');
    if (!v) return null;
    const payload = v.split('.')[1];
    if (!payload) return null;
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

async function createKlaviConsent(linkToken, { personalTaxId, businessTaxId, institutionCode, redirectUrl }) {
  const body = {
    institutionCode,
    externalTrackId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (personalTaxId) body.personalTaxId = personalTaxId;
  if (businessTaxId) body.businessTaxId = businessTaxId;
  if (redirectUrl) body.redirectURL = redirectUrl;

  const res = await fetch(`${KLAVI_API_BASE}/consents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${linkToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createKlaviConsentWithAccessToken(accessToken, { personalTaxId, businessTaxId, institutionCode, redirectUrl, linkToken }) {
  const body = {
    institutionCode,
    externalTrackId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (personalTaxId) body.personalTaxId = personalTaxId;
  if (businessTaxId) body.businessTaxId = businessTaxId;
  if (redirectUrl) body.redirectURL = redirectUrl;
  if (linkToken) body.linkToken = linkToken;

  const res = await fetch(`${KLAVI_API_BASE}/consents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function requestBusinessInstitutionData(accessToken, { businessTaxId, institutionCode, linkId, consentIds }) {
  const body = {
    taxId: businessTaxId,
    institutionCode,
    linkId,
    consentIds: Array.isArray(consentIds) ? consentIds : [consentIds],
    products: ['pj_categorized_checking_l3'],
  };

  const res = await fetch(`${KLAVI_API_BASE}/business/institution-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  console.log('🔍 Diagnóstico Natori Food - Klavi');
  console.log('API base:', KLAVI_API_BASE);

  // 1. Conecta ao banco central
  const centralPool = new Pool({
    host: requireEnv('CENTRAL_DB_HOST'),
    port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
    database: requireEnv('CENTRAL_DB_NAME'),
    user: requireEnv('CENTRAL_DB_USER'),
    password: requireEnv('CENTRAL_DB_PASSWORD'),
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const { rows: tokenRows } = await centralPool.query(
      `SELECT portal_token, client_id, empresa_slug
       FROM extrator_portal_tokens
       WHERE empresa_slug = 'natori'
       LIMIT 1`
    );

    if (!tokenRows.length) {
      console.log('⚠️ Nenhum portal_token encontrado para empresa natori no banco central.');
      return;
    }

    const { portal_token: portalToken, client_id: clientId, empresa_slug: empresaSlug } = tokenRows[0];
    console.log('Empresa:', empresaSlug);
    console.log('Client ID:', clientId);
    console.log('Portal token (truncado):', portalToken.slice(0, 8) + '...');

    // 2. Conecta ao banco da empresa (have_natori)
    const companyPool = new Pool({
      host: requireEnv('CENTRAL_DB_HOST'),
      port: parseInt(requireEnv('CENTRAL_DB_PORT'), 10),
      database: `have_${empresaSlug}`,
      user: requireEnv('CENTRAL_DB_USER'),
      password: requireEnv('CENTRAL_DB_PASSWORD'),
      ssl: { rejectUnauthorized: false },
      max: 2,
    });

    try {
      const { rows: clientRows } = await companyPool.query(
        `SELECT id, name, business_tax_id, gestor_empresa
         FROM extrator_clients
         WHERE id = $1
         LIMIT 1`,
        [clientId]
      );

      if (!clientRows.length) {
        console.log('⚠️ Cliente não encontrado no banco have_natori.');
        return;
      }

      const client = clientRows[0];
      console.log('Cliente:', client.name);
      console.log('CNPJ (business_tax_id) no have_natori:', client.business_tax_id || 'NÃO CADASTRADO');
      console.log('Gestor empresa:', client.gestor_empresa);

      // Tenta também buscar CNPJ no banco legado (extratos / Openfinance Klavi)
      let legacyCnpj = null;
      try {
        const legacyUrl = process.env.DATABASE_URL;
        if (legacyUrl) {
          const legacyClient = new Client({ connectionString: legacyUrl, ssl: { rejectUnauthorized: false } });
          await legacyClient.connect();
          const { rows: legacyRows } = await legacyClient.query(
            `SELECT business_tax_id, name FROM clients WHERE name ILIKE '%natori%' LIMIT 5`
          );
          if (legacyRows.length) {
            console.log('\nClientes legados (extratos) com nome natori:');
            for (const r of legacyRows) {
              console.log(`  Nome: ${r.name} | CNPJ: ${r.business_tax_id || '-'}`);
              if (r.business_tax_id && !legacyCnpj) legacyCnpj = r.business_tax_id;
            }
          }
          await legacyClient.end();
        }
      } catch (e) {
        console.log('⚠️ Não foi possível consultar banco legado:', e.message);
      }
      const { rows: itemRows } = await companyPool.query(
        `SELECT id, provider, pluggy_item_id, klavi_link_id, klavi_consent_id,
                institution_code, institution_name, status, error_code, error_message,
                business_tax_id, personal_tax_id, tax_type
         FROM extrator_items
         WHERE client_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [clientId]
      );

      console.log('\nItens ativos:', itemRows.length);
      for (const item of itemRows) {
        console.log(`\n  Item: ${item.id}`);
        console.log(`  Provider: ${item.provider}`);
        console.log(`  Banco: ${item.institution_name} (${item.institution_code})`);
        console.log(`  Status: ${item.status}`);
        console.log(`  Erro: ${item.error_code || '-'} — ${item.error_message || '-'}`);
        console.log(`  CNPJ/CPF no item: ${item.business_tax_id || '-'} / ${item.personal_tax_id || '-'}`);
        console.log(`  Pluggy item: ${item.pluggy_item_id || '-'} | Klavi link: ${item.klavi_link_id || '-'} | consent: ${item.klavi_consent_id || '-'}`);
      }

      // 3. Testa a API Klavi
      console.log('\n🧪 Testando autenticação na Klavi...');
      const auth = await getKlaviAccessToken();
      console.log('✅ Access token obtido. Expira em:', auth.expireIn, 'segundos');

      const businessTaxId = client.business_tax_id || legacyCnpj || '17375857000199'; // CNPJ de teste válido
      const personalTaxId = '00000000000'; // CPF genérico para teste
      const redirectUrl = 'https://localhost:3000/portal/callback';

      console.log('\n🧪 Testando criação de link com CNPJ:', businessTaxId);
      const link = await createKlaviLink(auth.accessToken, { businessTaxId, personalTaxId, redirectUrl });
      console.log('Status:', link.status);
      console.log('Resposta:', JSON.stringify(link.body, null, 2).slice(0, 1000));
      if (link.body?.linkURL) {
        const jwtPayload = decodeLinkJwt(link.body.linkURL);
        console.log('Payload do linkURL:', JSON.stringify(jwtPayload, null, 2).slice(0, 3000));
      }

      if (link.status === 200 && link.body?.linkToken) {
        console.log('\n🧪 Testando listagem de instituições...');
        const institutions = await getKlaviInstitutions(link.body.linkToken);
        console.log('Status:', institutions.status);
        console.log('Total instituições:', institutions.body?.length || 0);
        console.log('Tipo resposta:', typeof institutions.body, Array.isArray(institutions.body) ? 'array' : 'object');
        if (Array.isArray(institutions.body)) {
          const targetCodes = ['001', '077', '237', '341', '033', '748'];
          for (const inst of institutions.body) {
            if (targetCodes.includes(inst.institutionCode)) {
              console.log(`  ${inst.institutionCode} — ${inst.name}: outage=${inst.isOutage}, businessType=${inst.businessType}, resources=${inst.availableResources?.join(', ') || 'n/a'}`);
            }
          }
        }
        if (institutions.status !== 200) {
          console.log('Erro:', JSON.stringify(institutions.body, null, 2).slice(0, 1000));
        }

        // Tenta criar consentimento para o Inter (077)
        console.log('\n🧪 Testando criação de consentimento para Inter (077)...');
        const consentInter = await createKlaviConsent(link.body.linkToken, {
          businessTaxId,
          personalTaxId,
          institutionCode: '077',
          redirectUrl,
        });
        console.log('Status:', consentInter.status);
        console.log('Resposta:', JSON.stringify(consentInter.body, null, 2).slice(0, 1000));

        // Tenta criar consentimento para o Bradesco (237) para comparar
        console.log('\n🧪 Testando criação de consentimento para Bradesco (237)...');
        const consentBradesco = await createKlaviConsent(link.body.linkToken, {
          businessTaxId,
          personalTaxId,
          institutionCode: '237',
          redirectUrl,
        });
        console.log('Status:', consentBradesco.status);
        console.log('Resposta:', JSON.stringify(consentBradesco.body, null, 2).slice(0, 1000));

        // Tenta criar consentimento para o Banco do Brasil (001) para comparar
        console.log('\n🧪 Testando criação de consentimento para Banco do Brasil (001)...');
        const consentBB = await createKlaviConsent(link.body.linkToken, {
          businessTaxId,
          personalTaxId,
          institutionCode: '001',
          redirectUrl,
        });
        console.log('Status:', consentBB.status);
        console.log('Resposta:', JSON.stringify(consentBB.body, null, 2).slice(0, 1000));

        // Testa criar consentimento com accessToken (admin) em vez de linkToken
        console.log('\n🧪 Testando criação de consentimento para Banco do Brasil (001) com accessToken admin...');
        const consentBBAdmin = await createKlaviConsentWithAccessToken(auth.accessToken, {
          businessTaxId,
          personalTaxId,
          institutionCode: '001',
          redirectUrl,
          linkToken: link.body.linkToken,
        });
        console.log('Status:', consentBBAdmin.status);
        console.log('Resposta:', JSON.stringify(consentBBAdmin.body, null, 2).slice(0, 1000));

        if (consentInter.status === 200 && consentInter.body?.consentId) {
          console.log('\n🧪 Testando solicitação de dados (business/institution-data)...');
          const dataRequest = await requestBusinessInstitutionData(auth.accessToken, {
            businessTaxId,
            institutionCode: '077',
            linkId: link.body.linkId,
            consentIds: [consentInter.body.consentId],
          });
          console.log('Status:', dataRequest.status);
          console.log('Resposta:', JSON.stringify(dataRequest.body, null, 2).slice(0, 1000));
        }
      }
    } finally {
      await companyPool.end();
    }
  } finally {
    await centralPool.end();
  }
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
