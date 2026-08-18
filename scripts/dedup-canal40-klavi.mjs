// Limpa duplicatas de transações Klavi no banco da empresa canal40.
// As duplicatas ocorrem porque a Klavi/Open Finance pode retornar IDs diferentes
// para a mesma transação quando ela muda de PROCESSANDO para EFETIVADA.
//
// Uso:
//   node scripts/dedup-canal40-klavi.mjs [--dry-run]

import { getCompanyPool, closeCompanyPools } from '../lib/company-db.js';
import { deduplicateKlaviTransactions, getClientByGestorEmpresa } from '../lib/storage-company.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const empresa = 'canal40';
  const pool = await getCompanyPool(empresa);

  const client = await getClientByGestorEmpresa(pool, empresa);
  if (!client) {
    console.error(`Cliente não encontrado para empresa: ${empresa}`);
    process.exit(1);
  }

  console.log(`Cliente: ${client.name} (${client.id})`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (simulação)' : 'EXECUÇÃO REAL'}`);

  if (DRY_RUN) {
    // Em dry-run apenas lista as transações que seriam removidas.
    const { rows: pendingDups } = await pool.query(`
      SELECT 
        'STATUS-INFERIOR' as tipo,
        p.id,
        p.date::date as data,
        p.amount,
        p.description,
        p.status,
        e.id as id_mais_recente,
        e.date::date as data_mais_recente,
        e.status as status_mais_recente
      FROM extrator_transactions p
      JOIN extrator_transactions e
        ON p.client_id = e.client_id
        AND p.account_number = e.account_number
        AND p.amount = e.amount
        AND p.id != e.id
        AND UPPER(REGEXP_REPLACE(TRIM(p.description), '\\s+', ' ', 'g')) =
            UPPER(REGEXP_REPLACE(TRIM(e.description), '\\s+', ' ', 'g'))
        AND DATE_TRUNC('month', p.date) = DATE_TRUNC('month', e.date)
      WHERE p.client_id = $1
        AND p.status IN ('TRANSACAO_PROCESSANDO', 'PENDING', 'PROCESSANDO', 'LANCAMENTO_FUTURO')
        AND e.status IN ('TRANSACAO_EFETIVADA', 'POSTED', 'EFETIVADA', 'TRANSACAO_PROCESSANDO', 'PROCESSANDO', 'PENDING')
      ORDER BY p.date DESC;
    `, [client.id]);

    const { rows: installmentDups } = await pool.query(`
      SELECT 
        'PARCELA DUPLICADA' as tipo,
        id,
        date::date as data,
        amount,
        description,
        status,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, account_number, amount,
            UPPER(REGEXP_REPLACE(TRIM(description), '\\s+', ' ', 'g')),
            DATE_TRUNC('month', date)
          ORDER BY date DESC, synced_at DESC
        ) AS rn
      FROM extrator_transactions
      WHERE client_id = $1
        AND status IN ('TRANSACAO_EFETIVADA', 'POSTED', 'EFETIVADA')
        AND (
          UPPER(description) ~* '\\m(PARCELA|DEBITO\\s+SEGURO|SEGURO|EMPREST|FINANC|CONTRATO|MENSALIDADE)\\M'
          OR UPPER(description) ~* '\\mPARCELA\\s+GIRO\\M'
        )
      ORDER BY description, date;
    `, [client.id]);

    console.log(`\nTransações de status inferior que seriam removidas: ${pendingDups.length}`);
    for (const r of pendingDups) {
      console.log(`  ${r.id} | ${r.data} | ${r.amount} | ${r.description} (${r.status}) | mantém ${r.id_mais_recente} (${r.status_mais_recente})`);
    }

    const toRemoveInstallments = installmentDups.filter(r => r.rn > 1);
    console.log(`\nParcelas efetivadas duplicadas que seriam removidas: ${toRemoveInstallments.length}`);
    for (const r of toRemoveInstallments) {
      console.log(`  ${r.id} | ${r.data} | ${r.amount} | ${r.description}`);
    }

    console.log('\nTotal a remover:', pendingDups.length + toRemoveInstallments.length);
    return;
  }

  const result = await deduplicateKlaviTransactions(pool, client.id);
  console.log('Resultado:', result);
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
