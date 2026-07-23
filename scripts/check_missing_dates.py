import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar transações por data
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  COUNT(*) as quantidade,
  SUM(CASE WHEN t.type = 'CREDIT' THEN t.amount ELSE 0 END) as entradas,
  SUM(CASE WHEN t.type = 'DEBIT' THEN t.amount ELSE 0 END) as saidas
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date
ORDER BY t.date::date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("=== TRANSAÇÕES MS POR DATA ===")
print(stdout.read().decode())

# Verificar transações específicas dos dias 04-10/06
check_specific = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  t.description,
  t.id
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date BETWEEN '2026-06-04' AND '2026-06-10'
ORDER BY t.date DESC, t.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_specific, timeout=30)
print("\n=== TRANSAÇÕES 04-10/06 ===")
print(stdout.read().decode())

# Verificar na Pluggy
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

async function checkPluggy() {
  const apiKey = await getApiKey();
  const accountId = '0d154420-0049-4183-bc69-d6737aaef7c2';
  
  console.log('=== PLUGGY - TRANSAÇÕES 04-10/06 ===\\n');
  
  const txRes = await fetch(
    `${PLUGGY_BASE}/transactions?accountId=${accountId}&from=2026-06-04&to=2026-06-10&pageSize=100`,
    { headers: { 'X-API-KEY': apiKey } }
  );
  const txData = await txRes.json();
  
  console.log('Total na Pluggy:', txData.results.length);
  console.log('');
  
  for (const tx of txData.results) {
    console.log(`${tx.date.slice(0,10)} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 40)}`);
  }
}

checkPluggy().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_pluggy.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_pluggy.mjs', timeout=60)
print("\n=== PLUGGY ===")
print(stdout.read().decode())

client.close()
