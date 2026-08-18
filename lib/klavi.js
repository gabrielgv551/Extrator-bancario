// Cliente HTTP para API Klavi Conecte (Open Finance Brasil) — PJ.
// Documentação: https://docs.klavi.ai/connect

const KLAVI_API_BASE = process.env.KLAVI_API_BASE || 'https://api.klavi.ai/data/v1';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

let _cachedAccessToken = null;
let _cacheExpiry = 0;
let _authPromise = null;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryable(status) {
  return status === 429 || status >= 500 || status === 0;
}

async function parseErrorBody(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text().catch(() => '');
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text || `Klavi API error ${res.status}` };
    }
  }
  return { message: text ? text.slice(0, 200) : `Klavi API error ${res.status}` };
}

async function fetchKlaviRaw(path, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = MAX_RETRIES, accessToken = null } = {}) {
  const url = `${KLAVI_API_BASE}${path}`;
  let lastError;

  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);

      if (res.ok) {
        if (res.status === 204 || res.headers.get('content-length') === '0') return { ok: true, data: null };
        const data = await res.json();
        return { ok: true, data };
      }

      const errBody = await parseErrorBody(res);
      lastError = new Error(errBody.message || `Klavi API error ${res.status} em ${path}`);
      lastError.status = res.status;
      lastError.code = errBody.code;
      lastError.body = errBody;

      if (res.status === 401 && _cachedAccessToken) {
        // Token pode ter expirado antecipadamente; invalida e deixa retry refazer auth
        _cachedAccessToken = null;
        _cacheExpiry = 0;
      }

      if (!isRetryable(res.status)) {
        console.error('[klavi] erro não retryable:', {
          path,
          status: res.status,
          code: errBody.code,
          body: errBody,
          message: lastError.message,
        });
        throw lastError;
      }

      let delay = BASE_RETRY_DELAY_MS * 2 ** attempt;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        delay = Math.max(delay, parseInt(retryAfter, 10) * 1000);
      }

      if (attempt < retries) {
        console.warn(`[klavi] retry ${attempt + 1}/${retries} para ${path}: ${res.status} — aguardando ${delay}ms`);
        await sleep(delay);
      }
    } catch (err) {
      console.error('[klavi] fetch error em', path, ':', err.name, err.message, err.code, err.cause);
      console.error('[klavi] fetch stack:', err.stack);
      if (err.name === 'AbortError') {
        lastError = new Error(`Timeout (${timeoutMs}ms) em ${path}`);
        lastError.status = 0;
      } else {
        lastError = err;
      }
      if (!isRetryable(lastError.status)) throw lastError;
      if (attempt < retries) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** attempt;
        console.warn(`[klavi] retry ${attempt + 1}/${retries} para ${path}: ${lastError.message}`);
        await sleep(delay);
      }
    }
  }

  console.error('[klavi] erro final após retries:', {
    path,
    status: lastError.status,
    code: lastError.code,
    body: lastError.body,
    message: lastError.message,
  });
  throw lastError;
}

async function fetchKlavi(path, options = {}, retryOptions = {}) {
  const { data } = await fetchKlaviRaw(path, options, retryOptions);
  return data;
}

export async function getAccessToken() {
  if (_cachedAccessToken && Date.now() < _cacheExpiry) return _cachedAccessToken;
  if (_authPromise) return _authPromise;

  _authPromise = (async () => {
    try {
      const data = await fetchKlavi('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessKey: process.env.KLAVI_ACCESS_KEY,
          secretKey: process.env.KLAVI_SECRET_KEY,
        }),
      }, { retries: 2 });
      _cachedAccessToken = data.accessToken;
      // Expira 60s antes do prazo oficial para margem de segurança.
      const ttlMs = (data.expireIn ? data.expireIn * 1000 : 30 * 60 * 1000) - 60_000;
      _cacheExpiry = Date.now() + Math.max(ttlMs, 60_000);
      return _cachedAccessToken;
    } finally {
      _authPromise = null;
    }
  })();

  return _authPromise;
}

export async function refreshAccessToken() {
  _cachedAccessToken = null;
  _cacheExpiry = 0;
  return getAccessToken();
}

// ── Links ────────────────────────────────────────────────────────────────────

export async function createLink({ personalTaxId, businessTaxId, redirectUrl, productsCallbackUrl, externalInfo } = {}) {
  const accessToken = await getAccessToken();
  const body = {};
  if (personalTaxId) body.personalTaxId = personalTaxId;
  if (businessTaxId) body.businessTaxId = businessTaxId;
  if (redirectUrl) body.redirectURL = redirectUrl; // API Klavi usa redirectURL (URL maiúsculo)
  if (productsCallbackUrl) body.productsCallbackUrl = productsCallbackUrl;
  if (externalInfo) body.externalInfo = externalInfo;

  return fetchKlavi('/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export async function getInstitutions(linkToken) {
  return fetchKlavi('/links/institutions', {
    headers: { Authorization: `Bearer ${linkToken}` },
  });
}

// ── Consents ─────────────────────────────────────────────────────────────────

export async function createConsent({ linkToken, personalTaxId, businessTaxId, institutionCode, redirectUrl, externalTrackId, email, phone } = {}) {
  const body = { institutionCode, externalTrackId: externalTrackId || `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  if (personalTaxId) body.personalTaxId = personalTaxId;
  if (businessTaxId) body.businessTaxId = businessTaxId;
  if (redirectUrl) body.redirectURL = redirectUrl;
  if (email) body.email = email;
  if (phone) body.phone = phone;

  return fetchKlavi('/consents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${linkToken}` },
    body: JSON.stringify(body),
  });
}

export async function getConsentList({ personalTaxId, businessTaxId, linkId } = {}) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams();
  if (personalTaxId) params.set('personalTaxId', personalTaxId);
  if (businessTaxId) params.set('businessTaxId', businessTaxId);
  if (linkId) params.set('linkId', linkId);
  const query = params.toString() ? `?${params.toString()}` : '';

  return fetchKlavi(`/consents${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function deleteConsent(consentId) {
  const accessToken = await getAccessToken();
  return fetchKlavi(`/consents/${consentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Business institution data (relatório de dados por instituição) ────────────

export async function requestBusinessInstitutionData({
  businessTaxId,
  institutionCode,
  linkId,
  consentIds,
  products,
  productsCallbackUrl,
  externalInfo,
} = {}) {
  const accessToken = await getAccessToken();
  const body = { taxId: businessTaxId };
  if (institutionCode) body.institutionCode = institutionCode;
  if (linkId) body.linkId = linkId;
  if (consentIds) body.consentIds = Array.isArray(consentIds) ? consentIds : [consentIds];
  if (products) body.products = Array.isArray(products) ? products : [products];
  if (productsCallbackUrl) body.productsCallbackUrl = { all: productsCallbackUrl };
  if (externalInfo) body.externalInfo = externalInfo;

  console.log('[klavi] POST /business/institution-data body:', JSON.stringify(body));
  return fetchKlavi('/business/institution-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export async function requestPersonalInstitutionData({
  personalTaxId,
  institutionCode,
  linkId,
  consentIds,
  products,
  productsCallbackUrl,
  externalInfo,
} = {}) {
  const accessToken = await getAccessToken();
  const body = { taxId: personalTaxId };
  if (institutionCode) body.institutionCode = institutionCode;
  if (linkId) body.linkId = linkId;
  if (consentIds) body.consentIds = Array.isArray(consentIds) ? consentIds : [consentIds];
  if (products) body.products = Array.isArray(products) ? products : [products];
  if (productsCallbackUrl) body.productsCallbackUrl = { all: productsCallbackUrl };
  if (externalInfo) body.externalInfo = externalInfo;

  return fetchKlavi('/personal/institution-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

// ── Consentimentos e produtos ────────────────────────────────────────────────

// Mapeia produtos retornados pelo consentimento da Klavi (nomenclatura Open Finance)
// para os nomes EXATOS aceitos pelo endpoint /business/institution-data.
// Ver: https://docs.klavi.ai/connect/overview
export const CONSENT_PRODUCT_MAP = {
  'ACCOUNTS_ALL': ['pj_categorized_checking_l3'],
  'CREDIT_CARDS_ALL': ['pj_categorized_creditcard_l3'],
  'CREDIT_OPERATIONS_LOANS': ['pj_loans'],
  'CREDIT_OPERATIONS_FINANCINGS': ['pj_financing'],
  'CREDIT_OPERATIONS_UNARRANGED_ACCOUNTS_OVERDRAFT': ['pj_unarranged_account_overdraft'],
  'CREDIT_OPERATIONS_INVOICE_FINANCINGS': ['pj_invoice_financing'],
  'INVESTMENTS_BANK_FIXED_INCOMES': ['pj_bank_fixed_incomes'],
  'INVESTMENTS_CREDIT_FIXED_INCOMES': ['pj_credit_fixed_incomes'],
  'INVESTMENTS_VARIABLE_INCOMES': ['pj_variable_incomes'],
  'INVESTMENTS_FUNDS': ['pj_funds'],
  'INVESTMENTS_TREASURE_TITLES': ['pj_treasure_titles'],
};

export const DEFAULT_KLAVI_PRODUCTS = ['pj_categorized_checking_l3', 'pj_categorized_creditcard_l3'];

export function mapConsentProducts(consentProducts) {
  if (!Array.isArray(consentProducts) || consentProducts.length === 0) return DEFAULT_KLAVI_PRODUCTS;
  const mapped = new Set();
  for (const p of consentProducts) {
    const key = String(p).toUpperCase();
    if (CONSENT_PRODUCT_MAP[key]) {
      CONSENT_PRODUCT_MAP[key].forEach(m => mapped.add(m));
    }
  }
  return mapped.size > 0 ? [...mapped] : DEFAULT_KLAVI_PRODUCTS;
}

export async function getActiveKlaviConsent({ item, businessTaxId, personalTaxId }) {
  const filters = [];
  if (item.klaviLinkId) filters.push({ linkId: item.klaviLinkId, businessTaxId, personalTaxId });
  filters.push({ businessTaxId, personalTaxId });

  for (const params of filters) {
    const list = await getConsentList(params);
    const consents = Array.isArray(list) ? list : (list?.consents || []);
    const authorised = consents
      .filter(c =>
        String(c.institutionCode).toLowerCase() === String(item.institutionCode).toLowerCase() &&
        ['authorised', 'authorized'].includes(String(c.status).toLowerCase())
      )
      .sort((a, b) => {
        const da = a.updatedAt || a.createdAt || a.consentId;
        const db = b.updatedAt || b.createdAt || b.consentId;
        return String(db).localeCompare(String(da));
      });

    if (authorised.length > 0) {
      const chosen = authorised[0];
      return {
        consentId: chosen.consentId || chosen.consentid,
        linkId: chosen.linkId || chosen.linkid || item.klaviLinkId,
        products: mapConsentProducts(chosen.products || chosen.product || chosen.scope || chosen.scopes),
        rawConsent: chosen,
      };
    }
  }

  return { consentId: item.klaviConsentId || null, linkId: item.klaviLinkId || null, products: DEFAULT_KLAVI_PRODUCTS };
}

// ── Mapeamento de relatórios para o schema local ────────────────────────────

const PRODUCT_CHECKING = 'pj_checking_account';
const PRODUCT_SAVINGS = 'pj_savings_account';
const PRODUCT_CREDIT_CARD = 'pj_credit_card';
// Nomes exatos dos produtos institution-level PJ na Klavi.
// Ver: https://docs.klavi.ai/connect/overview
const LOAN_PRODUCTS = ['pj_loans', 'pj_financing', 'pj_unarranged_account_overdraft', 'pj_invoice_financing'];
const INVESTMENT_PRODUCTS = ['pj_bank_fixed_incomes', 'pj_credit_fixed_incomes', 'pj_variable_incomes', 'pj_treasure_titles', 'pj_funds'];

function parseMoney(money) {
  if (!money) return null;
  if (typeof money.amount === 'string') return parseFloat(money.amount.replace(/\s+/, ''));
  return money.amount ?? null;
}

function parseTransactionBalance(balance) {
  if (balance === null || balance === undefined || balance === '') return null;
  if (typeof balance === 'number') return balance;
  if (typeof balance === 'string') return parseFloat(balance.replace(/\s+/, ''));
  if (typeof balance?.amount === 'string') return parseFloat(balance.amount.replace(/\s+/, ''));
  return balance?.amount ?? null;
}

function parseCreditDebitType(creditDebitType) {
  if (!creditDebitType) return 'DEBIT';
  const t = String(creditDebitType).toLowerCase();
  if (t.includes('credito') || t.includes('credit')) return 'CREDIT';
  return 'DEBIT';
}

function buildTransactionId(productName, institutionCode, accountNumber, transactionId) {
  // IDs da Klavi podem ser reutilizados entre produtos; prefixamos para evitar colisões.
  const parts = [productName, institutionCode, accountNumber, transactionId].filter(Boolean);
  return parts.join('|').slice(0, 255);
}

export function mapKlaviReportToLocal({ productName, report, institutionCode, institutionName }) {
  const bankTransactions = [];
  const creditTransactions = [];
  const investments = [];
  const debts = [];
  const accounts = [];

  const name = institutionName || report?.checkingAccounts?.[0]?.brandName || 'Banco';

  // Conta corrente / poupança
  const checkingAccounts = report?.checkingAccounts || [];
  const savingsAccounts = report?.savingsAccounts || [];
  for (const acc of [...checkingAccounts, ...savingsAccounts]) {
    const accountNumber = [acc.branchCode, acc.number, acc.checkDigit].filter(Boolean).join('-');
    accounts.push({
      id: `${institutionCode || acc.compeCode}|${accountNumber}`,
      name: acc.brandName || name,
      type: 'BANK',
      accountType: 'Conta Corrente',
      number: accountNumber,
      balance: parseMoney(acc.balances?.availableAmount),
    });

    for (const tx of acc.transactionDetails || []) {
      const type = parseCreditDebitType(tx.creditDebitType);
      const amount = parseMoney(tx.transactionAmount);
      bankTransactions.push({
        id: buildTransactionId(productName, institutionCode || acc.compeCode, accountNumber, tx.transactionId),
        date: tx.transactionDate ? `${tx.transactionDate}T00:00:00.000Z` : null,
        dateTransacted: tx.transactionDateTime ? new Date(tx.transactionDateTime).toISOString() : null,
        description: tx.transactionName || tx.type || '',
        type,
        amount: type === 'CREDIT' ? Math.abs(amount) : -Math.abs(amount),
        balance: parseTransactionBalance(tx.postTransactionBalance ?? tx.transactionBalance ?? tx.balance),
        category: tx.type || null,
        categoryL1: tx.type || null,
        categoryL2: tx.category || null,
        categoryL3: tx.subcategory || null,
        accountName: acc.brandName || 'Conta Corrente',
        accountNumber,
        accountType: 'BANK',
        institutionName: name,
        counterpartyName: null,
        counterpartyDocument: tx.partieCnpjCpf || null,
        status: tx.completedAuthorisedPaymentType || null,
      });
    }
  }
  console.log('[mapKlaviReportToLocal] bankTransactions sample:', bankTransactions[0] ? JSON.stringify(bankTransactions[0], null, 2).slice(0, 600) : 'nenhuma');

  // Cartão de crédito
  const creditCardAccounts = report?.creditCardAccounts || [];
  for (const acc of creditCardAccounts) {
    const accountNumber = [acc.branchCode, acc.number, acc.checkDigit].filter(Boolean).join('-');
    accounts.push({
      id: `${institutionCode || acc.compeCode}|${accountNumber}`,
      name: acc.brandName || name,
      type: 'CREDIT',
      accountType: 'Cartão de Crédito',
      number: accountNumber,
      balance: parseMoney(acc.balances?.availableAmount),
    });

    for (const tx of acc.transactionDetails || []) {
      const type = parseCreditDebitType(tx.creditDebitType);
      const amount = parseMoney(tx.transactionAmount);
      creditTransactions.push({
        id: buildTransactionId(productName, institutionCode || acc.compeCode, accountNumber, tx.transactionId),
        date: tx.transactionDate ? `${tx.transactionDate}T00:00:00.000Z` : null,
        dateTransacted: tx.transactionDateTime ? new Date(tx.transactionDateTime).toISOString() : null,
        description: tx.transactionName || tx.type || '',
        type,
        amount: type === 'CREDIT' ? Math.abs(amount) : -Math.abs(amount),
        balance: parseTransactionBalance(tx.postTransactionBalance ?? tx.transactionBalance ?? tx.balance),
        category: tx.type || null,
        categoryL1: tx.type || null,
        categoryL2: tx.category || null,
        categoryL3: tx.subcategory || null,
        accountName: acc.brandName || 'Cartão de Crédito',
        accountNumber,
        accountType: 'CREDIT',
        institutionName: name,
        counterpartyName: null,
        counterpartyDocument: tx.partieCnpjCpf || null,
        status: tx.completedAuthorisedPaymentType || null,
      });
    }
  }

  // Cartão de crédito (formato alternativo usado por instituições de pagamento, ex: Mercado Pago)
  const creditCards = report?.creditCards || [];
  for (const card of creditCards) {
    const firstNumber = card.paymentMethods?.[0]?.identificationNumber || card.identificationNumber || '0';
    const accountNumber = firstNumber;
    accounts.push({
      id: `${institutionCode || 'credit'}|${accountNumber}`,
      name: card.brandName || card.name || name,
      type: 'CREDIT',
      accountType: 'Cartão de Crédito',
      number: accountNumber,
      balance: parseMoney(card.limits?.availableAmount),
    });

    const statements = [
      ...(card.openStatement?.transactionDetails ? [{ ...card.openStatement, dueDate: card.openStatement.dueDate || '' }] : []),
      ...(card.closedStatements || []),
    ];
    for (const stmt of statements) {
      for (const tx of stmt.transactionDetails || []) {
        const type = parseCreditDebitType(tx.creditDebitType);
        const amount = parseMoney(tx.transactionAmount || tx.brazilianAmount);
        creditTransactions.push({
          id: buildTransactionId(productName, institutionCode, accountNumber, tx.transactionId),
          date: tx.transactionDate ? `${tx.transactionDate}T00:00:00.000Z` : null,
          dateTransacted: tx.transactionDateTime ? new Date(tx.transactionDateTime).toISOString() : null,
          description: tx.transactionName || tx.transactionType || '',
          type,
          amount: type === 'CREDIT' ? Math.abs(amount) : -Math.abs(amount),
          balance: parseTransactionBalance(tx.postTransactionBalance ?? tx.transactionBalance ?? tx.balance),
          category: tx.transactionType || null,
          categoryL1: tx.transactionType || null,
          categoryL2: tx.type || null,
          categoryL3: tx.feeType || null,
          accountName: card.brandName || card.name || 'Cartão de Crédito',
          accountNumber,
          accountType: 'CREDIT',
          institutionName: name,
          counterpartyName: null,
          counterpartyDocument: tx.partieCnpjCpf || null,
          status: tx.paymentType || null,
        });
      }
    }
  }

  console.log('[mapKlaviReportToLocal] creditTransactions sample:', creditTransactions[0] ? JSON.stringify(creditTransactions[0], null, 2).slice(0, 600) : 'nenhuma');

  // Empréstimos / financiamentos
  const loanLists = LOAN_PRODUCTS.map(p => report?.[p] || []).flat();
  for (const loan of loanLists) {
    debts.push({
      id: `${institutionCode}|${loan.contractId || loan.loanId}`,
      name: loan.productName || loan.contractId,
      type: 'LOAN',
      balance: parseMoney(loan.outstandingBalance || loan.balances?.outstandingBalance),
      creditLimit: null,
      institutionName: name,
    });
  }

  // Investimentos
  const investmentLists = INVESTMENT_PRODUCTS.map(p => report?.[p] || []).flat();
  for (const inv of investmentLists) {
    investments.push({
      id: `${institutionCode}|${inv.investmentId || inv.id}`,
      name: inv.productName || inv.name,
      type: 'INVESTMENT',
      subtype: inv.subProductType || inv.productType,
      balance: parseMoney(inv.balance),
      value: parseMoney(inv.amount),
      quantity: inv.quantity,
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : null,
      issuer: null,
      status: null,
    });
  }

  return { bankTransactions, creditTransactions, investments, debts, accounts };
}

// ── Status helpers ───────────────────────────────────────────────────────────

export function isKlaviConsentAuthorised(status) {
  return String(status).toLowerCase() === 'authorised';
}

export function isKlaviConsentRejected(status) {
  const s = String(status).toLowerCase();
  return s === 'rejected' || s === 'expired' || s === 'revoked';
}

export function normalizeKlaviStatus(reportPayload, consentStatus) {
  const hasData = !!(
    reportPayload?.checkingAccounts?.length ||
    reportPayload?.creditCardAccounts?.length ||
    reportPayload?.savingsAccounts?.length ||
    reportPayload?.creditCards?.length ||
    LOAN_PRODUCTS.some(p => reportPayload?.[p]?.length) ||
    INVESTMENT_PRODUCTS.some(p => reportPayload?.[p]?.length)
  );

  if (reportPayload?.code && reportPayload.code !== 200) {
    // 204 na Klavi significa "dados parciais" — o banco entregou algumas APIs, mas outras falharam.
    // Se o relatório veio com transações, não tratamos como erro crítico; mantemos UPDATED com o aviso registrado.
    if (reportPayload.code === 204 && hasData) {
      return {
        status: 'UPDATED',
        errorCode: '204',
        errorMessage: reportPayload.message || 'Banco retornou dados parciais (algumas APIs indisponíveis)',
      };
    }
    return { status: 'ERROR', errorCode: String(reportPayload.code), errorMessage: reportPayload.message || 'Erro no relatório' };
  }
  if (isKlaviConsentRejected(consentStatus)) {
    return { status: 'LOGIN_ERROR', errorCode: 'USER_AUTHORIZATION_REVOKED', errorMessage: 'Consentimento rejeitado, expirado ou revogado' };
  }
  if (hasData) {
    return { status: 'UPDATED' };
  }
  if (consentStatus && isKlaviConsentAuthorised(consentStatus)) {
    return { status: 'WAITING_DATA' };
  }
  return { status: 'PENDING' };
}
