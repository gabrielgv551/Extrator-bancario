#!/usr/bin/env node
/**
 * Sync standalone — roda fora da Vercel, sem timeout.
 * Uso: node scripts/sync.mjs [clientId]
 *
 * Variáveis de ambiente necessárias:
 *   DATABASE_URL          ex: postgresql://user:pass@host:5432/db
 *   PLUGGY_CLIENT_ID
 *   PLUGGY_CLIENT_SECRET
 *   SYNC_SKIP_PATCH       se "1", não faz PATCH (só busca dados já syncados)
 *   SYNC_SKIP_ORPHAN_DELETE  se "1", não deleta transações órfãs
 *   SYNC_FORCE            se "1", ignora lock existente
 */

import pg from 'pg';
import { createHash } from 'crypto';
import {
  getItem,
  updatePluggyItem,
  getAllTransactions,
  getLoanAccounts,
  waitForItemUpdate,
  isItemHealthy,
  isItemUpdating,
  isItemError,
  requiresReconnectFromError,
} from '../lib/pluggy.js';
import {
  updateItemStatus,
  createSyncLog,
  finishSyncLog,
  acquireSyncLock,
  releaseSyncLock,
  forceReleaseSyncLock,
} from '../lib/storage.js';
import { syncItemData } from '../lib/sync-processor.js';

const { Pool } = pg;
const PLUGGY_BASE = 'https://api.pluggy.ai';
const FIRST_LOAD_FROM = '2026-05-01';

// ── Configurações ─────────────────────────────────────────────────────────────

const SKIP_PATCH = process.env.SYNC_SKIP_PATCH === '1';
const SKIP_ORPHAN_DELETE = process.env.SYNC_SKIP_ORPHAN_DELETE === '1';
const SYNC_FORCE = process.env.SYNC_FORCE === '1';
const PATCH_POLL_INTERVAL_MS = 3000;
const PATCH_MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutos
const PLUGGY_MIN_UPDATE_FREQUENCY_MS = 60 * 60 * 1000; // Pluggy exige 1h entre updates
const PATCH_DELAY_BETWEEN_ITEMS_MS = 5000; // evita rate limit

// ── Pool PostgreSQL ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

const translateCategory = c => c ? (CATEGORY_PT[c] ?? c) : null;
const translateAccountName = n => n ? (ACCOUNT_NAME_PT[n] ?? n) : n;
const toAccountTypePT = t => t ? (ACCOUNT_TYPE_PT[t] ?? t) : null;

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

// ── DB: upsert em batch ───────────────────────────────────────────────────────

async function upsertBatch(table, clientId, pluggyItemId, transactions) {
  if (!transactions.length) return 0;

  const duplicates = [];
  const newTxs = [];

  for (const tx of transactions) {
    const { rows } = await pool.query(
      `SELECT id FROM ${table}
       WHERE client_id = $1
         AND date::date = $2::date
         AND amount = $3
         AND description = $4`,
      [clientId, tx.date, tx.amount, tx.description ?? '']
    );

    if (rows.length > 0) {
      duplicates.push({ existingId: rows[0].id, newTx: tx });
    } else {
      newTxs.push(tx);
    }
  }

  for (const dup of duplicates) {
    await pool.query(
      `UPDATE ${table}
       SET status = $1, id = $2, synced_at = NOW()
       WHERE id = $3`,
      [dup.newTx.status ?? 'POSTED', dup.newTx.id, dup.existingId]
    ).catch(() => {});
  }

  const CHUNK = 200;
  for (let c = 0; c < newTxs.length; c += CHUNK) {
    const chunk = newTxs.slice(c, c + CHUNK);
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

// ── Status helpers ────────────────────────────────────────────────────────────

function normalizeItemStatus(pluggyItem) {
  if (!pluggyItem) return { status: 'UNKNOWN', executionStatus: null, errorCode: null, errorMessage: null, lastUpdatedAt: null };
  return {
    status: pluggyItem.status ?? 'UNKNOWN',
    executionStatus: pluggyItem.executionStatus ?? null,
    errorCode: pluggyItem.error?.code ?? null,
    errorMessage: pluggyItem.error?.message ?? pluggyItem.error?.providerMessage ?? null,
    lastUpdatedAt: pluggyItem.lastUpdatedAt ?? null,
  };
}

async function persistItemStatus(itemId, pluggyItem, { forceError = false } = {}) {
  const norm = normalizeItemStatus(pluggyItem);
  const needsReconnect = forceError || requiresReconnectFromError(norm.errorCode) || norm.status === 'LOGIN_ERROR';
  const updates = {
    status: norm.status,
    executionStatus: norm.executionStatus,
    errorCode: norm.errorCode,
    errorMessage: norm.errorMessage,
    lastUpdatedAt: norm.lastUpdatedAt,
    requiresReconnect: needsReconnect,
    incrementSyncCount: true,
  };
  if (isItemHealthy(norm.status) || norm.status === 'PARTIAL_SUCCESS') {
    updates.resetConsecutiveErrors = true;
  } else if (isItemError(norm.status)) {
    updates.incrementConsecutiveErrors = true;
    updates.lastErrorAt = new Date().toISOString();
  }
  await updateItemStatus(itemId, updates);
}

// ── Processar um item ─────────────────────────────────────────────────────────

function toCamelCaseItem(item) {
  return {
    id: item.id,
    clientId: item.client_id,
    pluggyItemId: item.pluggy_item_id,
    institutionName: item.institution_name,
    institutionLogo: item.institution_logo,
    accountNumbers: item.account_numbers,
    status: item.status,
    executionStatus: item.execution_status,
    errorCode: item.error_code,
    errorMessage: item.error_message,
    lastUpdatedAt: item.last_updated_at,
    lastErrorAt: item.last_error_at,
    syncCount: item.sync_count,
    consecutiveErrors: item.consecutive_errors,
    requiresReconnect: item.requires_reconnect,
    deletedAt: item.deleted_at,
    consentExpiresAt: item.consent_expires_at,
    notificationSentAt: item.notification_sent_at,
    createdAt: item.created_at,
  };
}

async function processItem(client, item, from, to) {
  const localItem = toCamelCaseItem(item);
  const result = await syncItemData(localItem, { fromOverride: from, toOverride: to, skipIfNotHealthy: true });

  return {
    bank: result.institutionName || localItem.institutionName || 'Banco desconhecido',
    status: result.success ? 'ok' : (result.status === 'LOGIN_ERROR' ? 'login_error' : 'error'),
    transactions: result.transactions?.total ?? 0,
    reason: result.reason,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const filterClientId = process.argv[2] ?? null;

  const to = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  // Lock distribuído
  const lock = await acquireSyncLock('sync-standalone');
  if (!lock.acquired) {
    console.error(`[sync] lock ativo desde ${lock.existing?.started_at}. Use SYNC_FORCE=1 para ignorar.`);
    process.exit(0);
  }

  try {
    let { rows: clients } = await pool.query(`SELECT id, name, last_sync FROM clients ORDER BY created_at`);
    if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

    console.log(`[sync] ${clients.length} cliente(s) | ${new Date().toISOString()}`);
    console.log(`[config] SKIP_PATCH=${SKIP_PATCH}, SKIP_ORPHAN_DELETE=${SKIP_ORPHAN_DELETE}`);

    for (const client of clients) {
      const { rows: items } = await pool.query(
        `SELECT id, pluggy_item_id, institution_name, status, last_updated_at FROM items WHERE client_id = $1`,
        [client.id],
      );
      if (!items.length) {
        console.log(`  ⤷ ${client.name}: sem itens, pulando`);
        continue;
      }

      // ── PATCH serial (se não estiver desabilitado) ───────────────────────────
      if (!SKIP_PATCH) {
        for (const item of items) {
          let beforeItem;
          try {
            beforeItem = await getItem(item.pluggy_item_id);
          } catch (err) {
            console.log(`  ⚠ ${client.name} / ${item.institution_name}: não foi possível verificar status (${err.message})`);
            continue;
          }

          const norm = normalizeItemStatus(beforeItem);
          const lastUpdatedAt = norm.lastUpdatedAt ? new Date(norm.lastUpdatedAt).getTime() : 0;
          const timeSinceUpdate = Date.now() - lastUpdatedAt;

          if (norm.status === 'LOGIN_ERROR') {
            console.log(`  🔄 ${client.name} / ${item.institution_name}: credenciais inválidas, aguardando reconexão`);
            await persistItemStatus(item.id, beforeItem);
            continue;
          }

          if (isItemUpdating(norm.status)) {
            console.log(`  ⏳ ${client.name} / ${item.institution_name}: item já está atualizando, aguardando...`);
            const ready = await waitForItemUpdate(item.pluggy_item_id, { timeoutMs: PATCH_MAX_WAIT_MS, intervalMs: PATCH_POLL_INTERVAL_MS });
            if (ready) await persistItemStatus(item.id, ready);
            continue;
          }

          const isPatchable = isItemHealthy(norm.status) || norm.status === 'OUTDATED';
          if (!isPatchable) {
            console.log(`  🔄 ${client.name} / ${item.institution_name}: status ${norm.status}, PATCH não aplicável`);
            await persistItemStatus(item.id, beforeItem);
            continue;
          }

          if (timeSinceUpdate < PLUGGY_MIN_UPDATE_FREQUENCY_MS) {
            console.log(`  🔄 ${client.name} / ${item.institution_name}: PATCH pulado, último update há ${Math.round(timeSinceUpdate / 1000)}s`);
            continue;
          }

          console.log(`  🔄 ${client.name} / ${item.institution_name}: disparando PATCH`);
          let patchResult;
          try {
            patchResult = await updatePluggyItem(item.pluggy_item_id);
          } catch (err) {
            console.log(`    ⚠ PATCH não realizado: ${err.message}`);
            await persistItemStatus(item.id, beforeItem, { forceError: true });
            continue;
          }

          if (patchResult?._skipped) {
            console.log(`    ⏭ PATCH pulado pela Pluggy: ${patchResult._message}`);
          } else if (isItemUpdating(patchResult?.status)) {
            console.log(`    ⏳ aguardando sync completar...`);
            const ready = await waitForItemUpdate(item.pluggy_item_id, { timeoutMs: PATCH_MAX_WAIT_MS, intervalMs: PATCH_POLL_INTERVAL_MS });
            if (ready) {
              console.log(`    ✓ sync completou: ${ready.status}`);
              await persistItemStatus(item.id, ready);
            } else {
              console.log(`    ⚠ timeout aguardando sync`);
            }
          } else if (patchResult) {
            console.log(`    ✓ PATCH ok: ${patchResult.status}`);
            await persistItemStatus(item.id, patchResult);
          }

          // Delay entre PATCHs para respeitar rate limit de 20/min
          await new Promise(r => setTimeout(r, PATCH_DELAY_BETWEEN_ITEMS_MS));
        }
      } else {
        console.log(`  ⏭ PATCH desabilitado (SYNC_SKIP_PATCH=1)`);
      }

      // ── Processar todos os itens em paralelo ────────────────────────────────
      const results = await Promise.allSettled(
        items.map(async item => {
          const { rows: hasTx } = await pool.query(
            `SELECT 1 FROM transactions WHERE pluggy_item_id = $1 LIMIT 1`,
            [item.pluggy_item_id]
          );
          const from = hasTx.length ? sevenDaysAgo : FIRST_LOAD_FROM;
          return processItem(client, item, from, to);
        })
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

      await pool.query(`UPDATE clients SET last_sync = NOW() WHERE id = $1`, [client.id]);
    }

    console.log(`[sync] concluído ${new Date().toISOString()}`);
  } finally {
    await releaseSyncLock(lock.lockId);
    await pool.end();
  }
}

main().catch(async err => {
  console.error('[sync] erro fatal:', err.message);
  // Tenta liberar lock em caso de erro inesperido
  try {
    await forceReleaseSyncLock('sync-standalone');
  } catch {}
  process.exit(1);
});
