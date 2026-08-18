// Diagnóstico de lastSync de todas as empresas ativas
import {
  getCompanyPool,
  closeCompanyPools,
  listActiveCompanies,
} from '../lib/company-db.js';
import { getClients, getItemsByClientId } from '../lib/storage-company.js';

async function main() {
  const companies = await listActiveCompanies().catch(() => []);
  const rows = [];

  for (const company of companies) {
    let pool;
    try {
      pool = await getCompanyPool(company.slug);
    } catch (err) {
      rows.push({ empresa: company.slug, erro: err.message });
      continue;
    }

    const clients = await getClients(pool).catch(() => []);
    for (const client of clients) {
      const items = await getItemsByClientId(pool, client.id).catch(() => []);
      const lastSync = client.lastSync ? new Date(client.lastSync) : null;
      const agora = new Date();
      const diasSemSync = lastSync ? (agora - lastSync) / (1000 * 60 * 60 * 24) : null;
      rows.push({
        empresa: company.slug,
        cliente: client.name,
        lastSync: lastSync ? lastSync.toLocaleString('pt-BR') : 'nunca',
        diasSemSync: diasSemSync !== null ? diasSemSync.toFixed(1) : '-',
        itens: items.length,
        itensKlavi: items.filter(i => i.provider === 'klavi' || i.klaviLinkId).length,
        itensPluggy: items.filter(i => i.provider === 'pluggy' && i.pluggyItemId).length,
      });
    }
  }

  console.log('Empresa | Cliente | lastSync | diasSemSync | itens | klavi | pluggy');
  for (const r of rows) {
    if (r.erro) {
      console.log(`${r.empresa} | ERRO: ${r.erro}`);
    } else {
      console.log(`${r.empresa} | ${r.cliente} | ${r.lastSync} | ${r.diasSemSync} | ${r.itens} | ${r.itensKlavi} | ${r.itensPluggy}`);
    }
  }

  await closeCompanyPools();
}

main().catch(err => {
  console.error('Falha:', err);
  process.exit(1);
});
