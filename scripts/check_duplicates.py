import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar duplicatas por descrição + valor + data
print("=== VERIFICANDO DUPLICATAS PERUILLE ===\n")
check_dup = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date,
  t.amount,
  t.description,
  COUNT(*) as qtd,
  STRING_AGG(t.id, ' | ') as ids,
  STRING_AGG(t.status, ' | ') as statuses
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date, t.amount, t.description
HAVING COUNT(*) > 1
ORDER BY t.date::date DESC, COUNT(*) DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_dup, timeout=30)
print("=== POSSÍVEIS DUPLICATAS (mesmo valor+data+desc) ===")
print(stdout.read().decode())

# Verificar se há transações PENDING que depois viraram POSTED
print("=== PENDING vs POSTED (mesma descrição) ===")
check_pending = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date,
  t.amount,
  t.description,
  t.status,
  t.id
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.date::date >= '2026-06-01'
  AND t.status = 'PENDING'
ORDER BY t.date::date DESC, t.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_pending, timeout=30)
print(stdout.read().decode())

# Verificar na Pluggy se há IDs diferentes para mesma transação
print("=== VERIFICANDO NA PLUGGY ===")
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
    
    // Buscar transações PENDING e POSTED do dia 09/06
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=2026-06-09&to=2026-06-09&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    
    console.log(`Total: ${txData.results.length}`);
    
    // Agrupar por descrição + valor
    const byDesc = {};
    for (const tx of txData.results) {
      const key = `${tx.description}|${tx.amount}`;
      if (!byDesc[key]) byDesc[key] = [];
      byDesc[key].push({ id: tx.id, status: tx.status, date: tx.date });
    }
    
    // Mostrar apenas as que têm mais de uma entrada
    for (const [key, txs] of Object.entries(byDesc)) {
      if (txs.length > 1) {
        console.log(`\\n  POSSIVEL DUPLICATA: ${key}`);
        for (const tx of txs) {
          console.log(`    ${tx.id} | ${tx.status} | ${tx.date}`);
        }
      }
    }
  }
}

check().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_dup_pluggy.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_dup_pluggy.mjs', timeout=60)
print(stdout.read().decode())

client.close()
