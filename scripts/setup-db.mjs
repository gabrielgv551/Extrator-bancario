import pg from 'pg';

const { Client } = pg;

const CONFIG = {
  host: '37.60.236.200',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD ?? '131105Gv',
};

async function setup() {
  console.log('🔌 Conectando ao PostgreSQL...');

  // Passo 1: criar o banco "extratos" se não existir
  const admin = new Client({ ...CONFIG, database: 'postgres' });
  await admin.connect();

  const { rows } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'extratos'"
  );

  if (rows.length === 0) {
    await admin.query('CREATE DATABASE extratos');
    console.log('✅ Banco de dados "extratos" criado!');
  } else {
    console.log('ℹ️  Banco "extratos" já existe.');
  }
  await admin.end();

  // Passo 2: criar tabela clients dentro de "extratos"
  const db = new Client({ ...CONFIG, database: 'extratos' });
  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id           UUID PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      portal_token VARCHAR(64)  UNIQUE NOT NULL,
      last_sync    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token VARCHAR(64) UNIQUE`);
  await db.query(`ALTER TABLE clients DROP COLUMN IF EXISTS item_id`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id               UUID PRIMARY KEY,
      client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      pluggy_item_id   VARCHAR(255) NOT NULL,
      institution_name VARCHAR(255),
      institution_logo TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('✅ Tabelas "clients" e "items" criadas/atualizadas!');
  console.log('\n📋 Adicione ao seu .env.local e ao Vercel:');
  console.log('DATABASE_URL=postgresql://postgres:****@37.60.236.200:5432/extratos');
  console.log('ADMIN_PASSWORD=sua_senha_admin\n');

  await db.end();
}

setup().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
