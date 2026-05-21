#!/usr/bin/env node
/**
 * Sync standalone — roda fora da Vercel, sem timeout.
 * Uso: node scripts/sync.mjs [clientId]
 *
 * Variáveis de ambiente necessárias:
 *   DATABASE_URL          ex: postgresql://user:pass@host:5432/db
 *   PLUGGY_CLIENT_ID
 *   PLUGGY_CLIENT_SECRET
 */

import pg from 'pg';
import { createHash } from 'crypto';

const { Pool } = pg;
const PLUGGY_BASE = 'https://api.pluggy.ai';
const FIRST_LOAD_FROM = '2026-05-01';

// ── Pool PostgreSQL ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Pluggy auth ───────────────────────────────────────────────────────────────

let _cachedApiKey = null;
let _cacheExpiry = 0;

async function getApiKey() {
  if (_cachedApiKey && Date.now() < _cacheExpiry) return _cachedApiKey;
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Pluggy auth falhou: ${res.status}`);
  const data = await res.json();
  _cachedApiKey = data.apiKey;
  _cacheExpiry = Date.now() + 25 * 60 * 1000;
  return _cachedApiKey;
}

async function pluggyFetch(path, options = {}) {
  const res = await fetch(`${PLUGGY_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Pluggy error ${res.status} em ${path}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function pluggyGet(path) {
  const apiKey = await getApiKey();
  return pluggyFetch(path, { headers: { 'X-API-KEY': apiKey } });
}

async function updatePluggyItem(itemId) {
  const apiKey = await getApiKey();
  return pluggyFetch(`/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({}),
  }).catch(() => null);
}

// ── Traduções ─────────────────────────────────────────────────────────────────

const CATEGORY_PT = {
  'Income': 'Receita', 'Salary': 'Salário', 'Retirement': 'Aposentadoria',
  'Entrepreneurial activities': 'Atividades Empreendedoras', 'Government aid': 'Auxílio do Governo',
  'Non-recurring income': 'Receita Não Recorrente', 'Loans and Financing': 'Empréstimos e Financiamentos',
  'Late payment and overdraft costs': 'Juros e Mora', 'Interests charged': 'Juros Cobrados',
  'Loans': 'Empréstimos', 'Financing': 'Financiamentos', 'Real estate financing': 'Financiamento Imobiliário',
  'Vehicle Financing': 'Financiamento de Veículos', 'Student loan': 'Financiamento Estudantil',
  'Investments': 'Investimentos', 'Automatic investment': 'Investimento Automático',
  'Fixed income': 'Renda Fixa', 'Mutual funds': 'Fundos de Investimento',
  'Variable income': 'Renda Variável', 'Proceeds interests and dividends': 'Rendimentos e Dividendos',
  'Pension': 'Previdência', 'Same person transfer': 'Transferência Própria',
  'Same person transfer - PIX': 'Transferência Própria - PIX', 'Same person transfer - TED': 'Transferência Própria - TED',
  'Transfers': 'Transferências', 'Transfer - PIX': 'Transferência - PIX', 'Transfer - TED': 'Transferência - TED',
  'Credit card payment': 'Pagamento de Cartão de Crédito', 'Third-party transfers': 'Transferências para Terceiros',
  'Bank slip': 'Boleto', 'Debt card': 'Cartão de Débito', 'Digital services': 'Serviços Digitais',
  'Groceries': 'Supermercado', 'Food and drinks': 'Alimentação e Bebidas', 'Eating out': 'Restaurantes',
  'Food delivery': 'Delivery de Comida', 'Travel': 'Viagem', 'Donations': 'Doações',
  'Gambling': 'Jogos e Apostas', 'Lottery': 'Loteria', 'Online bet': 'Apostas Online',
  'Taxes': 'Impostos', 'Income taxes': 'Imposto de Renda', 'Bank fees': 'Tarifas Bancárias',
  'Housing': 'Moradia', 'Rent': 'Aluguel', 'Utilities': 'Contas de Consumo',
  'Healthcare': 'Saúde', 'Transportation': 'Transporte', 'Automotive': 'Automotivo',
  'Insurance': 'Seguros', 'Shopping': 'Compras', 'Education': 'Educação',
  'Services': 'Serviços', 'Telecommunications': 'Telecomunicações', 'Other': 'Outros',
};

const ACCOUNT_NAME_PT = {
  'Checking Account': 'Conta Corrente', 'Savings Account': 'Conta Poupança',
  'Credit Card': 'Cartão de Crédito', 'Salary Account': 'Conta Salário',
  'Payment Account': 'Conta Pagamento', 'Prepaid Card': 'Cartão Pré-pago',
  'Current Account': 'Conta Corrente',
};

const ACCOUNT_TYPE_PT = {
  'BANK': 'Conta Bancária', 'CREDIT': 'Cartão de Crédito',
  'LOAN': 'Empréstimo', 'INVESTMENT': 'Investimento',
};

const translateCategory   = c => c ? (CATEGORY_PT[c] ?? c) : null;
const translateAccountName = n => n ? (ACCOUNT_NAME_PT[n] ?? n) : n;
const toAccountTypePT     = t => t ? (ACCOUNT_TYPE_PT[t] ?? t) : null;

function extractDateFromDescription(description, referenceDate) {
  if (!description) return null;
  const dmyFull = description.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (dmyFull) {
    const [, d, m, y] = dmyFull;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  const iso = description.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  const dmPartial = description.match(/(\d{2})\/(\d{2})(?!\/|\d)/);
  if (dmPartial && referenceDate) {
    const [, d, m] = dmPartial;
    if (parseInt(m) >= 1 && parseInt(m) <= 12 && parseInt(d) >= 1 && parseInt(d) <= 31) {
      const y = new Date(referenceDate).getFullYear();
      const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
      if (!isNaN(date)) return date.toISOString();
    }
  }
  return null;
}

// ── Pluggy: buscar transações (todas as contas em paralelo) ───────────────────

async function getAllTransactions(itemId, { from, to } = {}) {
  const accountsData = await pluggyGet(`/accounts?itemId=${itemId}`);
  const accounts = accountsData?.results ?? [];

  const perAccount = await Promise.all(accounts.map(async (account) => {
    const txs = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      let url = `/transactions?accountId=${account.id}&page=${page}&pageSize=500`;
      if (from) url += `&from=${from}`;
      if (to)   url += `&to=${to}`;

      const data = await pluggyGet(url);
      totalPages = data.totalPages;

      for (const tx of data.results) {
        const counterpartyName =
          tx.type === 'DEBIT'
            ? (tx.paymentData?.receiver?.name ?? tx.merchant?.businessName ?? tx.merchant?.name ?? null)
            : (tx.paymentData?.payer?.name ?? null);
        const counterpartyDocument =
          tx.type === 'DEBIT'
            ? (tx.paymentData?.receiver?.documentNumber?.value ?? tx.paymentData?.receiver?.document?.value ?? null)
            : (tx.paymentData?.payer?.documentNumber?.value ?? tx.paymentData?.payer?.document?.value ?? null);
        const accountNumber = account.bankData?.transferNumber || account.number || null;
        txs.push({
          ...tx,
          category: translateCategory(tx.category),
          accountName: translateAccountName(account.name),
          accountType: account.type,
          accountNumber,
          counterpartyName,
          counterpartyDocument,
          dateTransacted: extractDateFromDescription(tx.description, tx.date)
            ?? tx.creditCardMetadata?.purchaseDate
            ?? tx.date
            ?? null,
        });
      }
      page++;
    }
    return txs;
  }));

  return perAccount.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getLoanAccounts(itemId) {
  const data = await pluggyGet(`/accounts?itemId=${itemId}`);
  const LOAN_TYPES = ['LOAN', 'FINANCING', 'CREDIT_CARD', 'MORTGAGE'];
  return (data?.results ?? []).filter(a => LOAN_TYPES.includes(a.type) || a.subtype === 'LOAN');
}

// ── DB: upsert em batch ───────────────────────────────────────────────────────

async function upsertBatch(table, clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;
  const CHUNK = 200;
  for (let c = 0; c < transactions.length; c += CHUNK) {
    const chunk = transactions.slice(c, c + CHUNK);
    const placeholders = [];
    const params = [];
    let p = 1;
    for (const tx of chunk) {
      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},NOW())`);
      params.push(
        tx.id, clientId, pluggyItemId, tx.date, tx.description ?? '',
        tx.type, tx.amount, tx.balance ?? null, tx.category ?? null,
        tx.accountName ?? null, tx.accountNumber ?? null,
        toAccountTypePT(tx.accountType), tx.institutionName ?? null,
        tx.counterpartyName ?? null, tx.counterpartyDocument ?? null,
        tx.status ?? null, tx.dateTransacted ?? null,
      );
      p += 17;
    }
    await pool.query(
      `INSERT INTO ${table}
         (id, client_id, pluggy_item_id, date, description, type, amount, balance,
          category, account_name, account_number, account_type, institution_name,
          counterparty_name, counterparty_document, status, date_transacted, synced_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         description=EXCLUDED.description, amount=EXCLUDED.amount, balance=EXCLUDED.balance,
         category=EXCLUDED.category, account_number=EXCLUDED.account_number,
         institution_name=EXCLUDED.institution_name, counterparty_name=EXCLUDED.counterparty_name,
         counterparty_document=EXCLUDED.counterparty_document, status=EXCLUDED.status,
         date_transacted=EXCLUDED.date_transacted, synced_at=NOW()`,
      params,
    );
  }
  return transactions.length;
}

async function upsertDebts(clientId, pluggyItemId, accounts) {
  for (const acc of accounts) {
    await pool.query(
      `INSERT INTO debts (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance=EXCLUDED.balance, credit_limit=EXCLUDED.credit_limit,
         institution_name=EXCLUDED.institution_name, synced_at=NOW()`,
      [acc.id, clientId, pluggyItemId, acc.name ?? null, acc.type ?? null,
       acc.balance ?? null, acc.creditLimit ?? null, acc.institutionName ?? null],
    );
  }
}

async function upsertDerivedDebts(clientId) {
  const { rows } = await pool.query(
    `SELECT REGEXP_REPLACE(description, '\\s+\\d+/\\d+', '') AS name,
            SUBSTRING(description FROM '\\d+/(\\d+)')::int AS total_parcelas,
            MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int) AS ultima_parcela,
            ROUND(AVG(ABS(amount))::numeric, 2) AS valor_medio,
            ROUND(SUM(ABS(amount))::numeric, 2) AS total_pago,
            ROUND((AVG(ABS(amount)) * (SUBSTRING(description FROM '\\d+/(\\d+)')::int
              - MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)))::numeric, 2) AS saldo_estimado,
            pluggy_item_id, institution_name
     FROM transactions
     WHERE client_id = $1
       AND description ~ '\\d+/\\d+'
       AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
            OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
     GROUP BY REGEXP_REPLACE(description, '\\s+\\d+/\\d+', ''),
              SUBSTRING(description FROM '\\d+/(\\d+)')::int, pluggy_item_id, institution_name`,
    [clientId],
  );

  for (const row of rows) {
    const seed = `${clientId}-${row.name}-${row.total_parcelas}`;
    const hash = createHash('md5').update(seed).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const saldo = parseFloat(row.saldo_estimado ?? 0);
    const total = parseFloat(row.total_pago ?? 0) + saldo;
    await pool.query(
      `INSERT INTO debts (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at)
       VALUES ($1,$2,$3,$4,'LOAN',$5,$6,$7,NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance=EXCLUDED.balance, credit_limit=EXCLUDED.credit_limit,
         institution_name=EXCLUDED.institution_name, synced_at=NOW()`,
      [id, clientId, row.pluggy_item_id, row.name, saldo, total, row.institution_name ?? null],
    );
  }
}

// ── Processar um item ─────────────────────────────────────────────────────────

async function processItem(client, item, from, to) {
  const pluggyItem = await pluggyGet(`/items/${item.pluggy_item_id}`).catch(() => null);
  const status = pluggyItem?.status ?? 'UNKNOWN';

  if (!['UPDATED', 'PARTIAL_SUCCESS', 'UPDATING'].includes(status)) {
    return { bank: item.institution_name, status: 'skipped', reason: status };
  }

  const institutionName = item.institution_name ?? pluggyItem?.connector?.name ?? null;
  const allTx = (await getAllTransactions(item.pluggy_item_id, { from, to }))
    .map(tx => ({ ...tx, institutionName }));

  const bankTx   = allTx.filter(tx => tx.accountType !== 'CREDIT');
  const creditTx = allTx.filter(tx => tx.accountType === 'CREDIT');

  await upsertBatch('transactions', client.id, item.pluggy_item_id, bankTx);
  await upsertBatch('credit_transactions', client.id, item.pluggy_item_id, creditTx);

  const loanAccounts = await getLoanAccounts(item.pluggy_item_id).catch(() => []);
  await upsertDebts(client.id, item.pluggy_item_id, loanAccounts).catch(() => {});

  return { bank: institutionName, status: 'ok', transactions: allTx.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const filterClientId = process.argv[2] ?? null;

  const to          = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  let { rows: clients } = await pool.query(`SELECT id, name FROM clients ORDER BY created_at`);
  if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

  console.log(`[sync] ${clients.length} cliente(s) | ${new Date().toISOString()}`);

  for (const client of clients) {
    const { rows: items } = await pool.query(
      `SELECT id, pluggy_item_id, institution_name FROM items WHERE client_id = $1`,
      [client.id],
    );
    if (!items.length) {
      console.log(`  ⤷ ${client.name}: sem itens, pulando`);
      continue;
    }

    // Verificar se é primeiro carregamento
    const { rows: hasTx } = await pool.query(
      `SELECT 1 FROM transactions WHERE client_id = $1 LIMIT 1`,
      [client.id],
    );
    const from = hasTx.length ? sevenDaysAgo : FIRST_LOAD_FROM;

    // Disparar PATCH em todos os itens em paralelo
    await Promise.all(items.map(item => updatePluggyItem(item.pluggy_item_id)));
    await new Promise(r => setTimeout(r, 1000));

    // Processar todos os itens em paralelo
    const results = await Promise.allSettled(
      items.map(item => processItem(client, item, from, to)),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        if (v.status === 'ok')
          console.log(`  ✓ ${client.name} / ${v.bank}: ${v.transactions} transações`);
        else
          console.log(`  ⤷ ${client.name} / ${v.bank}: ${v.status} (${v.reason})`);
      } else {
        console.error(`  ✗ ${client.name}: ${r.reason?.message}`);
      }
    }

    await upsertDerivedDebts(client.id).catch(() => {});
    await pool.query(`UPDATE clients SET last_sync = NOW() WHERE id = $1`, [client.id]);
  }

  await pool.end();
  console.log(`[sync] concluído ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('[sync] erro fatal:', err.message);
  process.exit(1);
});
