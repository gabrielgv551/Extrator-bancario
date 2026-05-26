import { readFileSync } from 'fs';

for (const file of ['.env.local', '.env']) {
  try {
    readFileSync(file, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq < 1 || line.startsWith('#')) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    });
  } catch {}
}

console.log('PLUGGY_CLIENT_ID:', process.env.PLUGGY_CLIENT_ID ? '✅ carregado' : '❌ não encontrado');
console.log('PLUGGY_CLIENT_SECRET:', process.env.PLUGGY_CLIENT_SECRET ? '✅ carregado' : '❌ não encontrado');

const { getApiKey, getAccounts } = await import('../lib/pluggy.js');

const ITEM_ID = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
const FROM    = process.argv[2] || '2026-05-01';
const TO      = process.argv[3] || '2026-05-11';
const PLUGGY_API_BASE = 'https://api.pluggy.ai';

async function testPagination() {
  const apiKey   = await getApiKey();
  const accounts = await getAccounts(ITEM_ID);

  console.log(`\n🔍 Item: ${ITEM_ID}`);
  console.log(`📅 Período: ${FROM} → ${TO}\n`);

  for (const account of accounts) {
    console.log(`\n📂 Conta: ${account.name} (${account.type}) — ID: ${account.id}`);

    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = `${PLUGGY_API_BASE}/transactions?accountId=${account.id}&page=${page}&pageSize=500&from=${FROM}&to=${TO}`;
      console.log(`   📄 Buscando página ${page}...`);

      try {
        const res  = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
        const text = await res.text();

        if (!res.ok) {
          console.error(`   ❌ Erro HTTP ${res.status} na página ${page}:`);
          console.error(`   ${text.slice(0, 300)}`);
          break;
        }

        const data = JSON.parse(text);
        totalPages = data.totalPages;

        console.log(`   ✅ Página ${page}/${totalPages} — ${data.results.length} transações | total: ${data.total}`);

        if (data.results.length > 0) {
          const first = data.results[0];
          const last  = data.results[data.results.length - 1];
          console.log(`      Datas: ${last.date?.slice(0,10)} → ${first.date?.slice(0,10)}`);
        }

        page++;
      } catch (err) {
        console.error(`   ❌ Erro na página ${page}: ${err.message}`);
        break;
      }
    }
  }
}

testPagination().catch(err => { console.error('❌', err.message); process.exit(1); });
