import { getCompanyPool, closeCompanyPools } from '../lib/company-db.js';

async function main() {
  const pool = await getCompanyPool('thmz');
  const { rows } = await pool.query(`
    SELECT 
      (SELECT MAX(date) FROM extrator_transactions) AS last_debit_date,
      (SELECT MAX(date) FROM extrator_credit_transactions) AS last_credit_date,
      (SELECT COUNT(*) FROM extrator_transactions WHERE synced_at > NOW() - INTERVAL '1 hour') AS debit_recent,
      (SELECT COUNT(*) FROM extrator_credit_transactions WHERE synced_at > NOW() - INTERVAL '1 hour') AS credit_recent,
      (SELECT COUNT(*) FROM extrator_transactions) AS total_debit,
      (SELECT COUNT(*) FROM extrator_credit_transactions) AS total_credit
  `);
  console.log(rows[0]);
  await closeCompanyPools();
}
main().catch(err => { console.error(err); process.exit(1); });
