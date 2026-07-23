import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar se outros bancos também têm PENDING
print("=== PENDING POR BANCO ===\n")
check_banks = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.institution_name,
  t.status,
  COUNT(*) as qtd
FROM transactions t
WHERE t.date::date >= '2026-06-01'
GROUP BY t.institution_name, t.status
ORDER BY t.institution_name, t.status;
"
'''

stdin, stdout, stderr = client.exec_command(check_banks, timeout=30)
print(stdout.read().decode())

# Verificar histórico de status das transações Sicoob
print("=== HISTÓRICO STATUS SICOOB ===\n")
check_history = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date,
  t.status,
  COUNT(*) as qtd,
  MIN(t.synced_at) as primeiro_sync,
  MAX(t.synced_at) as ultimo_sync
FROM transactions t
WHERE t.institution_name ILIKE '%Sicoob%'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date, t.status
ORDER BY t.date::date DESC, t.status;
"
'''

stdin, stdout, stderr = client.exec_command(check_history, timeout=30)
print(stdout.read().decode())

# Verificar na Pluggy se Sicoob tem comportamento diferente
print("=== VERIFICANDO COMPORTAMENTO PLUGGY ===\n")
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

async function checkBehavior() {
  const apiKey = await getApiKey();
  
  // Buscar todos os items
  const itemsRes = await fetch(`${PLUGGY_BASE}/items`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const itemsData = await itemsRes.json();
  
  for (const item of itemsData.results) {
    if (item.status === 'UPDATED') {
      const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${item.id}`, {
        headers: { 'X-API-KEY': apiKey }
      });
      const accData = await accRes.json();
      
      for (const account of accData.results) {
        // Buscar últimas 5 transações
        const txRes = await fetch(
          `${PLUGGY_BASE}/transactions?accountId=${account.id}&pageSize=5`,
          { headers: { 'X-API-KEY': apiKey } }
        );
        const txData = await txRes.json();
        
        const pendingCount = txData.results.filter(t => t.status === 'PENDING').length;
        const postedCount = txData.results.filter(t => t.status === 'POSTED').length;
        
        if (pendingCount > 0) {
          console.log(`BANCO: ${item.connector?.name || 'Unknown'}`);
          console.log(`  PENDING: ${pendingCount}, POSTED: ${postedCount}`);
          console.log(`  Exemplo PENDING: ${txData.results.find(t => t.status === 'PENDING')?.description}`);
          console.log('');
        }
      }
    }
  }
}

checkBehavior().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_behavior.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_behavior.mjs', timeout=60)
print(stdout.read().decode())

client.close()
