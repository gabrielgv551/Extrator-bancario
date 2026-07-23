import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Script para comparar IDs das transações
debug_script = '''
const PLUGGY_BASE = 'https://api.pluggy.ai';

async function getApiKey() {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  return data.apiKey;
}

async function compareTransactions() {
  const apiKey = await getApiKey();
  const accountId = '0d154420-0049-4183-bc69-d6737aaef7c2';
  
  console.log('=== COMPARANDO TRANSAÇÕES MS ===\\n');
  
  // Buscar TODAS as transações da Pluggy
  const pluggyIds = new Set();
  const pluggyTxs = [];
  let page = 1;
  let totalPages = 1;
  
  while (page <= totalPages) {
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${accountId}&page=${page}&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    totalPages = txData.totalPages;
    
    for (const tx of txData.results) {
      pluggyIds.add(tx.id);
      pluggyTxs.push({
        id: tx.id,
        date: tx.date.slice(0,10),
        type: tx.type,
        amount: tx.amount,
        description: tx.description
      });
    }
    page++;
  }
  
  console.log(`Total na Pluggy: ${pluggyTxs.length}`);
  console.log(`Últimas 5 na Pluggy:`);
  pluggyTxs.slice(-5).forEach(tx => {
    console.log(`  ${tx.date} | ${tx.id.slice(0,20)}... | ${tx.type} | ${tx.amount}`);
  });
}

compareTransactions().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/compare.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/compare.mjs', timeout=60)
print("=== PLUGGY ===")
print(stdout.read().decode())

# Buscar IDs no banco
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.date::date,
  t.type,
  t.amount,
  LEFT(t.description, 30) as descricao
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.account_name = 'Conta corrente'
ORDER BY t.date DESC
LIMIT 25;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("\n=== BANCO ===")
print(stdout.read().decode())

client.close()
