import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# 1. Verificar transações do dia 09/06 no banco
print("=== BANCO - TRANSAÇÕES 09/06 PERUILLE ===\n")
check_db = '''
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
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND t.date::date = '2026-06-09'
ORDER BY t.amount DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print(stdout.read().decode())

# 2. Verificar na Pluggy
print("=== PLUGGY - TRANSAÇÕES 09/06 PERUILLE ===\n")
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
  return (await res.json()).apiKey;
}

async function check() {
  const apiKey = await getApiKey();
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  for (const account of accData.results) {
    console.log(`\\nConta: ${account.name}`);
    
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=2026-06-09&to=2026-06-09&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    
    console.log(`Total: ${txData.results.length}`);
    
    for (const tx of txData.results) {
      console.log(`  ${tx.date} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 50)}`);
    }
  }
}

check().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_june09.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_june09.mjs', timeout=60)
print(stdout.read().decode())

# 3. Verificar se há transações em credit_transactions
print("=== BANCO - CREDIT_TRANSACTIONS 09/06 ===\n")
check_credit = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  ct.date::date as data,
  ct.type,
  ct.amount,
  ct.description,
  ct.id
FROM credit_transactions ct
JOIN clients c ON c.id = ct.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND ct.date::date = '2026-06-09'
ORDER BY ct.amount DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_credit, timeout=30)
print(stdout.read().decode())

client.close()
