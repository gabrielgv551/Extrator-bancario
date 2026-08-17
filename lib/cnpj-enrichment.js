// Enriquecimento de CNPJ para obter razão social da contraparte.
// Usa BrasilAPI (https://brasilapi.com.br/api/cnpj/v1/{cnpj}) por padrão.
// Pode ser desabilitado via CNPJ_ENRICHMENT_ENABLED=false.

const DEFAULT_BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1';
const CACHE = new Map();

function normalizeCnpj(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 14 ? digits : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchOne(cnpj, baseUrl, timeoutMs) {
  const url = `${baseUrl}/${cnpj}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'User-Agent': process.env.CNPJ_API_USER_AGENT || 'ExtratorBancario/1.0',
    'Accept': 'application/json',
  };
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (res.status === 404) return null;
    if (res.status === 429) {
      // Rate limit: aguarda 1s e tenta mais uma vez.
      await sleep(1000);
      const retry = await fetch(url, { signal: controller.signal, headers });
      if (!retry.ok) return null;
      const data = await retry.json();
      return data?.razao_social || data?.nome_fantasia || null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data?.razao_social || data?.nome_fantasia || null;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[cnpj-enrichment] erro ao consultar %s:', cnpj, err.message);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retorna a razão social de um CNPJ, usando cache em memória.
 * @param {string} rawCnpj - CNPJ com ou sem formatação.
 * @returns {Promise<string|null>}
 */
export async function fetchCompanyNameByCnpj(rawCnpj) {
  if (process.env.CNPJ_ENRICHMENT_ENABLED === 'false') return null;

  const cnpj = normalizeCnpj(rawCnpj);
  if (!cnpj) return null;
  if (CACHE.has(cnpj)) return CACHE.get(cnpj);

  const baseUrl = process.env.CNPJ_API_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = parseInt(process.env.CNPJ_API_TIMEOUT_MS || '5000', 10);

  const name = await fetchOne(cnpj, baseUrl, timeoutMs);
  CACHE.set(cnpj, name);
  return name;
}

/**
 * Recebe uma lista de transações e preenche counterpartyName a partir do CNPJ,
 * quando counterpartyName estiver vazio e counterpartyDocument for um CNPJ válido.
 * @param {Array<{counterpartyName?: string|null, counterpartyDocument?: string|null}>} transactions
 * @returns {Promise<Array>}
 */
export async function enrichTransactionsWithCompanyName(transactions) {
  if (!transactions?.length) return transactions;
  if (process.env.CNPJ_ENRICHMENT_ENABLED === 'false') return transactions;

  const uniqueCnpjs = new Set();
  for (const tx of transactions) {
    const cnpj = normalizeCnpj(tx.counterpartyDocument);
    if (cnpj && !tx.counterpartyName) uniqueCnpjs.add(cnpj);
  }

  if (uniqueCnpjs.size === 0) return transactions;

  console.log('[cnpj-enrichment] enriquecendo %d CNPJ(s) únicos', uniqueCnpjs.size);

  // Busca sequencial para respeitar rate limits da API pública.
  const delayMs = parseInt(process.env.CNPJ_API_DELAY_MS || '200', 10);
  const namesByCnpj = new Map();
  let found = 0;
  let notFound = 0;
  let index = 0;
  for (const cnpj of uniqueCnpjs) {
    const name = await fetchCompanyNameByCnpj(cnpj);
    if (name) {
      namesByCnpj.set(cnpj, name);
      found++;
    } else {
      notFound++;
    }
    index++;
    if (index < uniqueCnpjs.size && delayMs > 0) await sleep(delayMs);
  }
  console.log('[cnpj-enrichment] %d encontrado(s), %d não encontrado(s)', found, notFound);

  for (const tx of transactions) {
    const cnpj = normalizeCnpj(tx.counterpartyDocument);
    if (cnpj && !tx.counterpartyName && namesByCnpj.has(cnpj)) {
      tx.counterpartyName = namesByCnpj.get(cnpj);
    }
  }

  return transactions;
}
