
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const { rows } = await pool.query(`SELECT id, name FROM clients WHERE name ILIKE '%high%'`);
  console.log(rows);
  await pool.end();
}
run();
