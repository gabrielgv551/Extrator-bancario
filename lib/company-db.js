// Helper de conexão dinâmica ao banco de uma empresa do Have Gestor.
// Lê as credenciais do banco central (tabela configuracoes) ou variáveis de ambiente legadas.

import pg from 'pg';

const { Pool } = pg;

const DEFAULT_PORT = 5432;
const DEFAULT_USER = 'postgres';

function requireEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  return value;
}

function getCentralConfig() {
  return {
    host: requireEnv('CENTRAL_DB_HOST', process.env.POSTGRES_HOST),
    port: parseInt(process.env.CENTRAL_DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.CENTRAL_DB_NAME || 'have_gestor',
    user: process.env.CENTRAL_DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: requireEnv('CENTRAL_DB_PASSWORD', process.env.POSTGRES_PASSWORD),
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
}

function getLegacyEnvConfig(empresa) {
  const key = empresa.trim().toUpperCase();
  const host = process.env[`${key}_HOST`];
  if (!host) return null;

  return {
    host,
    port: parseInt(process.env[`${key}_PORT`] || '5432', 10),
    database: process.env[`${key}_DB`] || empresa.trim().capitalize(),
    user: process.env[`${key}_USER`] || DEFAULT_USER,
    password: process.env[`${key}_PASSWORD`],
  };
}

async function getCompanyConfigFromCentral(empresa) {
  const central = getCentralConfig();
  const pool = new Pool({
    ...central,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  try {
    const { rows } = await pool.query(
      `
        SELECT c.chave, c.valor, c.criptografado
        FROM configuracoes c
        JOIN empresas e ON e.id = c.empresa_id
        WHERE e.slug = $1
          AND c.chave IN ('db_host', 'db_port', 'db_name', 'db_user', 'db_password')
      `,
      [empresa.toLowerCase().trim()]
    );

    if (!rows.length) return null;

    const cfg = {};
    for (const row of rows) {
      let valor = row.valor;
      if (valor && row.criptografado) {
        valor = decryptValue(valor);
      }
      cfg[row.chave] = valor;
    }

    if (!cfg.db_name) return null;

    return {
      host: cfg.db_host || central.host,
      port: parseInt(cfg.db_port || DEFAULT_PORT, 10),
      database: cfg.db_name,
      user: cfg.db_user || DEFAULT_USER,
      password: cfg.db_password || central.password,
    };
  } finally {
    await pool.end();
  }
}

function decryptValue(cipherText) {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error('CONFIG_ENCRYPTION_KEY não configurada');

  const crypto = require('crypto');
  const key = crypto.createHash('sha256').update(raw).digest();

  const parts = cipherText.split(':');
  if (parts.length !== 3) throw new Error('Formato de valor criptografado inválido');

  const iv = parts[0].length > 32 ? Buffer.from(parts[0], 'base64') : Buffer.from(parts[0], 'hex');
  const authTag = parts[1].length > 32 ? Buffer.from(parts[1], 'base64') : Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2].length > 32 ? Buffer.from(parts[2], 'base64') : Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function getDefaultConfig(empresa) {
  const central = getCentralConfig();
  return {
    host: central.host,
    port: central.port,
    database: `have_${empresa.toLowerCase().trim()}`,
    user: central.user,
    password: central.password,
  };
}

export async function getCompanyDbConfig(empresa) {
  if (!empresa || typeof empresa !== 'string') {
    throw new Error('empresa é obrigatória');
  }

  const slug = empresa.toLowerCase().trim();

  // 1) Tenta configurações no banco central
  try {
    const cfg = await getCompanyConfigFromCentral(slug);
    if (cfg) return cfg;
  } catch (err) {
    console.warn(`[company-db] falha ao ler config central para ${slug}:`, err.message);
  }

  // 2) Fallback para variáveis de ambiente legadas
  const legacy = getLegacyEnvConfig(slug);
  if (legacy && legacy.password) return legacy;

  // 3) Fallback padrão: banco have_{slug} no servidor central
  return getDefaultConfig(slug);
}

const pools = new Map();

export async function getCompanyPool(empresa) {
  const slug = empresa.toLowerCase().trim();
  if (pools.has(slug)) return pools.get(slug);

  const cfg = await getCompanyDbConfig(slug);
  const pool = new Pool({
    ...cfg,
    max: parseInt(process.env.PG_POOL_MAX || '5', 10),
    min: parseInt(process.env.PG_POOL_MIN || '1', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error(`[company-db] erro no pool ${slug}:`, err.message);
  });

  pools.set(slug, pool);
  return pool;
}

export async function closeCompanyPools() {
  for (const [slug, pool] of pools.entries()) {
    try {
      await pool.end();
    } catch (err) {
      console.error(`[company-db] erro ao fechar pool ${slug}:`, err.message);
    }
  }
  pools.clear();
}

export function sanitizeEmpresa(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
}

export function requireEmpresaFromHeader(request) {
  const raw = request.headers.get('x-extrator-empresa') || '';
  const empresa = sanitizeEmpresa(raw);
  if (!empresa) throw new Error('Empresa nao informada no header x-extrator-empresa');
  return empresa;
}

export async function listActiveCompanies() {
  const central = getCentralConfig();
  const pool = new Pool({ ...central, max: 2, connectionTimeoutMillis: 5000 });
  try {
    const { rows } = await pool.query(
      `SELECT slug FROM empresas WHERE status = 'ativo' ORDER BY slug`
    );
    return rows.map(r => r.slug);
  } finally {
    await pool.end();
  }
}

export async function forEachCompany(callback) {
  const companies = await listActiveCompanies();
  const results = [];
  for (const empresa of companies) {
    try {
      const pool = await getCompanyPool(empresa);
      results.push(await callback({ empresa, pool }));
    } catch (err) {
      console.error(`[company-db] erro processando empresa ${empresa}:`, err.message);
      results.push({ empresa, error: err.message });
    }
  }
  return results;
}
