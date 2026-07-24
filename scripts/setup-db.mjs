import { setupDatabase } from '../lib/setup-db.js';

setupDatabase()
  .then((databaseName) => {
    console.log('✅ Tabelas criadas/atualizadas no banco "' + databaseName + '"!');
    console.log('\n📋 DATABASE_URL atual:');
    console.log(process.env.DATABASE_URL);
    console.log('\n📋 Adicione ao Vercel:');
    console.log('ADMIN_PASSWORD=sua_senha_admin\n');
  })
  .catch((err) => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  });
