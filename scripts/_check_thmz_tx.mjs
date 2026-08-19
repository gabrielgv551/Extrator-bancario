import { getCompanyPool, closeCompanyPools } from '../lib/company-db.js';

async function main() {
  const pool = await getCompanyPool('thmz');

  const { rows: debitSummary } = await pool.query(`
    SELECT COUNT(*) AS cnt, MAX(date) AS max_date, MAX(synced_at) AS max_synced
    FROM extrator_transactions
    WHERE client_id = '8013aeb0-7893-4ef0-9d48-cad1a2d4477d'
  `);
  console.log('Débito/conta:', debitSummary[0]);

  const { rows: recentDebit } = await pool.query(`
    SELECT date, description, amount, synced_at
    FROM extrator_transactions
    WHERE client_id = '8013aeb0-7893-4ef0-9d48-cad1a2d4477d'
      AND date >= '2026-08-17'
    ORDER BY date DESC
    LIMIT 5
  `);
  console.log('Transações débito recentes:', recentDebit);

  await closeCompanyPools();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
