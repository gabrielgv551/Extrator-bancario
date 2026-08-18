// Backfill do campo balance nas transações do canal40 usando payloads da Klavi já recebidos.
// Atualiza extrator_transactions e extrator_credit_transactions com postTransactionBalance.
//
// Uso:
//   node --env-file=.env.local scripts/backfill-klavi-balance-canal40.mjs [--dry-run]

import { getCompanyPool, closeCompanyPools } from '../lib/company-db.js';
import { getClientByGestorEmpresa } from '../lib/storage-company.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const empresa = 'canal40';
  const pool = await getCompanyPool(empresa);
  const client = await getClientByGestorEmpresa(pool, empresa);
  if (!client) throw new Error(`Cliente não encontrado para ${empresa}`);

  console.log(`Cliente: ${client.name} (${client.id})`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'EXECUÇÃO REAL'}`);

  // Pega os payloads mais recentes da Klavi (últimos 30 dias).
  const { rows: webhooks } = await pool.query(`
    SELECT id, payload, received_at
    FROM extrator_klavi_webhook_debug
    WHERE received_at > NOW() - INTERVAL '30 days'
    ORDER BY received_at DESC
  `);

  // Mapa: transactionId -> postTransactionBalance (do payload mais recente).
  const balanceByTxId = new Map();

  for (const wh of webhooks) {
    const payload = typeof wh.payload === 'string' ? JSON.parse(wh.payload) : wh.payload;

    const sources = [
      ...(payload?.checkingAccounts || []),
      ...(payload?.savingsAccounts || []),
    ];

    for (const acc of sources) {
      for (const tx of acc?.transactionDetails || []) {
        if (tx.transactionId && tx.postTransactionBalance !== undefined && !balanceByTxId.has(tx.transactionId)) {
          balanceByTxId.set(tx.transactionId, tx.postTransactionBalance);
        }
      }
    }

    for (const card of payload?.creditCards || []) {
      const statements = [
        ...(card.openStatement ? [card.openStatement] : []),
        ...(card.closedStatements || []),
      ];
      for (const stmt of statements) {
        for (const tx of stmt?.transactionDetails || []) {
          if (tx.transactionId && tx.postTransactionBalance !== undefined && !balanceByTxId.has(tx.transactionId)) {
            balanceByTxId.set(tx.transactionId, tx.postTransactionBalance);
          }
        }
      }
    }

    for (const acc of payload?.creditCardAccounts || []) {
      for (const tx of acc?.transactionDetails || []) {
        if (tx.transactionId && tx.postTransactionBalance !== undefined && !balanceByTxId.has(tx.transactionId)) {
          balanceByTxId.set(tx.transactionId, tx.postTransactionBalance);
        }
      }
    }
  }

  console.log(`Transaction IDs com saldo nos payloads: ${balanceByTxId.size}`);

  // Converte para arrays, ignorando valores inválidos.
  const txIds = [];
  const balances = [];
  for (const [txId, balance] of balanceByTxId) {
    const numericBalance = parseFloat(balance);
    if (!Number.isNaN(numericBalance)) {
      txIds.push(txId);
      balances.push(numericBalance);
    }
  }

  if (DRY_RUN) {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as total
      FROM extrator_transactions
      WHERE client_id = $1 AND id LIKE ANY($2::text[])
      UNION ALL
      SELECT COUNT(*)
      FROM extrator_credit_transactions
      WHERE client_id = $1 AND id LIKE ANY($2::text[])
    `, [client.id, txIds.map(id => `%|${id}`)]);
    console.log(`Transações que seriam atualizadas: ${rows.reduce((a, r) => a + parseInt(r.total, 10), 0)}`);
    return;
  }

  // Atualiza em batch usando unnest, em chunks pequenos para evitar deadlock
  // com a trigger que replica para extrato_openfinance.
  const CHUNK = 100;
  let updatedBank = 0;
  let updatedCredit = 0;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  for (let i = 0; i < txIds.length; i += CHUNK) {
    const chunkIds = txIds.slice(i, i + CHUNK);
    const chunkBalances = balances.slice(i, i + CHUNK);

    const resBank = await pool.query(`
      WITH values AS (
        SELECT unnest($1::text[]) AS tx_id, unnest($2::numeric[]) AS balance
      )
      UPDATE extrator_transactions t
      SET balance = v.balance
      FROM values v
      WHERE t.client_id = $3 AND t.id LIKE '%|' || v.tx_id
    `, [chunkIds, chunkBalances, client.id]);
    updatedBank += resBank.rowCount;

    const resCredit = await pool.query(`
      WITH values AS (
        SELECT unnest($1::text[]) AS tx_id, unnest($2::numeric[]) AS balance
      )
      UPDATE extrator_credit_transactions t
      SET balance = v.balance
      FROM values v
      WHERE t.client_id = $3 AND t.id LIKE '%|' || v.tx_id
    `, [chunkIds, chunkBalances, client.id]);
    updatedCredit += resCredit.rowCount;

    console.log(`  chunk ${i + 1}-${Math.min(i + CHUNK, txIds.length)}: ${resBank.rowCount} débito + ${resCredit.rowCount} crédito`);
    if (i + CHUNK < txIds.length) await sleep(100);
  }

  console.log(`Atualizado total: ${updatedBank} débito + ${updatedCredit} crédito`);

  const { rows: [{ com_saldo, sem_saldo }] } = await pool.query(`
    SELECT
      (SELECT COUNT(balance) FROM extrator_transactions WHERE client_id = $1) +
      (SELECT COUNT(balance) FROM extrator_credit_transactions WHERE client_id = $1) AS com_saldo,
      (SELECT COUNT(*) - COUNT(balance) FROM extrator_transactions WHERE client_id = $1) +
      (SELECT COUNT(*) - COUNT(balance) FROM extrator_credit_transactions WHERE client_id = $1) AS sem_saldo
  `, [client.id]);
  console.log(`Resumo: ${com_saldo} com saldo, ${sem_saldo} sem saldo`);
}

main()
  .then(async () => {
    await closeCompanyPools();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Erro:', err);
    await closeCompanyPools();
    process.exit(1);
  });
