import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: '37.60.236.200',
  port: 5432,
  user: 'postgres',
  password: '131105Gv',
  database: 'postgres',
});

await client.connect();

const { rows } = await client.query(`
  SELECT datname, usename, application_name, client_addr, state, query_start
  FROM pg_stat_activity
  WHERE datname IN ('extratos', 'Openfinance Klavi')
  ORDER BY datname, query_start DESC
`);
console.log(JSON.stringify(rows, null, 2));

await client.end();
