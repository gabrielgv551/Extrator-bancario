import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar status das transações MS no banco
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.status,
  COUNT(*) as quantidade
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
GROUP BY t.status
ORDER BY quantidade DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("=== STATUS DAS TRANSAÇÕES MS ===")
print(stdout.read().decode())

# Ver transações sem filtro de status
check_all = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  LEFT(t.description, 40) as descricao,
  t.status,
  t.account_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-03'
ORDER BY t.date DESC
LIMIT 20;
"
'''

stdin, stdout, stderr = client.exec_command(check_all, timeout=30)
print("\n=== TODAS AS TRANSAÇÕES MS (sem filtro) ===")
print(stdout.read().decode())

# Verificar status na Pluggy
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

async function checkStatus() {
  const apiKey = await getApiKey();
  const accountId = '0d154420-0049-4183-bc69-d6737aaef7c2';
  
  console.log('=== STATUS DAS TRANSAÇÕES NA PLUGGY ===\\n');
  
  const txRes = await fetch(
    `${PLUGGY_BASE}/transactions?accountId=${accountId}&pageSize=20`,
    { headers: { 'X-API-KEY': apiKey } }
  );
  const txData = await txRes.json();
  
  // Agrupar por status
  const byStatus = {};
  for (const tx of txData.results) {
    byStatus[tx.status || 'NULL'] = (byStatus[tx.status || 'NULL'] || 0) + 1;
  }
  
  console.log('Status na Pluggy:');
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  
  console.log('\\nÚltimas 10 transações com status:');
  for (const tx of txData.results.slice(0, 10)) {
    console.log(`  ${tx.date.slice(0,10)} | ${(tx.status || 'NULL').padEnd(10)} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 40)}`);
  }
}

checkStatus().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_status.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_status.mjs', timeout=60)
print("\n=== STATUS NA PLUGGY ===")
print(stdout.read().decode())

client.close()
