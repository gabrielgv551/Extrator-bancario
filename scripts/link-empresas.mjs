/**
 * Gerencia o vínculo entre clientes do Extrator Bancários
 * e empresas do Have Gestor (coluna gestor_empresa na tabela clients).
 *
 * Uso:
 *   node scripts/link-empresas.mjs list           → lista todos os clientes e seus vínculos
 *   node scripts/link-empresas.mjs set <nome_cliente> <empresa>  → vincula
 *   node scripts/link-empresas.mjs unset <nome_cliente>          → remove vínculo
 *
 * Exemplos:
 *   node scripts/link-empresas.mjs set Lanzi lanzi
 *   node scripts/link-empresas.mjs set Supershop supershop
 *   node scripts/link-empresas.mjs set Marcon marcon
 */

import pg from 'pg';

const pool = new pg.Pool({
  host: '37.60.236.200', port: 5432, database: 'extratos',
  user: 'postgres', password: '131105Gv',
});

async function migrar() {
  await pool.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS gestor_empresa VARCHAR(50)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_gestor_empresa
    ON clients(gestor_empresa) WHERE gestor_empresa IS NOT NULL
  `);
}

async function listar() {
  const { rows } = await pool.query(`
    SELECT name, gestor_empresa, last_sync, id
    FROM clients ORDER BY name
  `);
  console.log('\n  Cliente Extrator                 │ Empresa Gestor   │ Último Sync');
  console.log('  ' + '─'.repeat(70));
  for (const r of rows) {
    const nome    = r.name.padEnd(32);
    const empresa = (r.gestor_empresa ?? '─ não vinculado ─').padEnd(16);
    const sync    = r.last_sync ? new Date(r.last_sync).toLocaleString('pt-BR') : 'nunca';
    console.log(`  ${nome} │ ${empresa} │ ${sync}`);
  }
  console.log();
}

async function vincular(nomeCliente, empresa) {
  const { rowCount } = await pool.query(
    `UPDATE clients SET gestor_empresa = $1 WHERE LOWER(name) = LOWER($2)`,
    [empresa.toLowerCase(), nomeCliente]
  );
  if (rowCount === 0) {
    console.log(`\n  ❌ Cliente "${nomeCliente}" não encontrado.\n`);
  } else {
    console.log(`\n  ✅ "${nomeCliente}" vinculado a empresa "${empresa}"\n`);
  }
}

async function desvincular(nomeCliente) {
  const { rowCount } = await pool.query(
    `UPDATE clients SET gestor_empresa = NULL WHERE LOWER(name) = LOWER($1)`,
    [nomeCliente]
  );
  if (rowCount === 0) {
    console.log(`\n  ❌ Cliente "${nomeCliente}" não encontrado.\n`);
  } else {
    console.log(`\n  ✅ Vínculo de "${nomeCliente}" removido.\n`);
  }
}

const [,, cmd, arg1, arg2] = process.argv;

await migrar();

if (!cmd || cmd === 'list') {
  await listar();
} else if (cmd === 'set' && arg1 && arg2) {
  await vincular(arg1, arg2);
  await listar();
} else if (cmd === 'unset' && arg1) {
  await desvincular(arg1);
  await listar();
} else {
  console.log('\n  Uso:');
  console.log('    node scripts/link-empresas.mjs list');
  console.log('    node scripts/link-empresas.mjs set "Nome Cliente" empresa');
  console.log('    node scripts/link-empresas.mjs unset "Nome Cliente"\n');
}

await pool.end();
