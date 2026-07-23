import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Criar script de sync forçado no diretório do projeto
sync_script = '''
import pg from 'pg';
const { Pool } = pg;
const PLUGGY_BASE = 'https://api.pluggy.ai';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getApiKey() {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  return (await res.json()).apiKey;
}

async function getAllTransactions(itemId, from) {
  const apiKey = await getApiKey();
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  const allTxs = [];
  for (const account of accData.results) {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const url = `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=${from}&page=${page}&pageSize=500`;
      const res = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
      const data = await res.json();
      totalPages = data.totalPages;
      allTxs.push(...data.results);
      page++;
    }
  }
  return allTxs;
}

async function main() {
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  const clientId = 'e88bc7e9-5159-41e1-ad79-e026c43353bc';
  
  console.log('[force-sync] Buscando todas as transacoes desde 01/05/2026...');
  const txs = await getAllTransactions(itemId, '2026-05-01');
  console.log(`[force-sync] Total na Pluggy: ${txs.length}`);
  
  // Verificar quais ja estao no banco
  const { rows: dbTxs } = await pool.query(
    'SELECT id FROM transactions WHERE client_id = $1 AND date >= $2',
    [clientId, '2026-05-01']
  );
  const dbIds = new Set(dbTxs.map(r => r.id));
  console.log(`[force-sync] Total no banco: ${dbIds.size}`);
  
  // Inserir as faltantes
  let inserted = 0;
  for (const tx of txs) {
    if (!dbIds.has(tx.id)) {
      try {
        await pool.query(
          `INSERT INTO transactions (id, client_id, pluggy_item_id, date, description, type, amount, status, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [tx.id, clientId, itemId, tx.date, tx.description || '', tx.type, tx.amount, tx.status || 'POSTED']
        );
        inserted++;
        console.log(`[force-sync] Inserido: ${tx.date} | ${tx.type} | ${tx.amount} | ${tx.description?.slice(0, 30)}`);
      } catch (e) {
        console.log(`[force-sync] Erro ao inserir ${tx.id}: ${e.message}`);
      }
    }
  }
  
  console.log(`[force-sync] Inseridas ${inserted} transacoes novas`);
  await pool.end();
}

main().catch(err => {
  console.error('[force-sync] erro:', err.message);
  process.exit(1);
});
'''

sftp = client.open_sftp()
with sftp.file('/root/force_sync.mjs', 'w') as f:
    f.write(sync_script)
sftp.close()

print("=== EXECUTANDO SYNC FORCADO ===")
stdin, stdout, stderr = client.exec_command(
    'source /root/.sync.env && cd /root && node force_sync.mjs',
    timeout=120
)

for line in stdout:
    print(line, end='')

err = stderr.read().decode()
if err:
    print("ERROS:")
    print(err)

client.close()
