import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar se há transações com mesmo ID mas status diferente
print("=== VERIFICANDO IDs DUPLICADOS (mesmo ID, status diferente) ===\n")
check_dup_ids = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  COUNT(*) as qtd,
  STRING_AGG(DISTINCT t.status, ', ') as statuses
FROM transactions t
WHERE t.date::date >= '2026-06-01'
GROUP BY t.id
HAVING COUNT(*) > 1
LIMIT 10;
"
'''

stdin, stdout, stderr = client.exec_command(check_dup_ids, timeout=30)
print(stdout.read().decode())

# Verificar na Pluggy se IDs de PENDING são os mesmos de POSTED
print("=== VERIFICANDO NA PLUGGY ===\n")
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

async function checkIds() {
  const apiKey = await getApiKey();
  
  // Buscar items com PENDING
  const itemsRes = await fetch(`${PLUGGY_BASE}/items`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const itemsData = await itemsRes.json();
  
  for (const item of itemsData.results) {
    if (item.status !== 'UPDATED') continue;
    
    const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${item.id}`, {
      headers: { 'X-API-KEY': apiKey }
    });
    const accData = await accRes.json();
    
    for (const account of accData.results) {
      const txRes = await fetch(
        `${PLUGGY_BASE}/transactions?accountId=${account.id}&pageSize=100`,
        { headers: { 'X-API-KEY': apiKey } }
      );
      const txData = await txRes.json();
      
      const pending = txData.results.filter(t => t.status === 'PENDING');
      
      if (pending.length > 0) {
        console.log(`\\nBANCO: ${item.connector?.name}`);
        console.log(`PENDING encontradas: ${pending.length}`);
        
        // Mostrar 3 exemplos
        for (const tx of pending.slice(0, 3)) {
          console.log(`  ${tx.id} | ${tx.date} | ${tx.amount} | ${tx.description.slice(0, 30)}`);
        }
      }
    }
  }
}

checkIds().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_ids.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_ids.mjs', timeout=60)
print(stdout.read().decode())

client.close()
