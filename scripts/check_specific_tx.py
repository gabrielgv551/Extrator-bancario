import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar histórico da transação específica
print("=== HISTÓRICO DA TRANSAÇÃO 0747650f-f6be-4ecb-a115-3cf7b3312a25 ===\n")
check_tx = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.date::date,
  t.type,
  t.amount,
  t.description,
  t.status,
  t.synced_at,
  t.institution_name,
  c.name as client_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE t.id = '0747650f-f6be-4ecb-a115-3cf7b3312a25';
"
'''

stdin, stdout, stderr = client.exec_command(check_tx, timeout=30)
print(stdout.read().decode())

# Verificar se há outras transações similares (mesmo valor+data+desc)
print("=== TRANSAÇÕES SIMILARES (mesmo valor+data+desc) ===\n")
check_similar = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.date::date,
  t.type,
  t.amount,
  LEFT(t.description, 40),
  t.status,
  t.synced_at,
  t.institution_name
FROM transactions t
WHERE t.date::date = '2026-05-01'
  AND t.amount = -189.80
  AND t.description ILIKE '%OZION%'
ORDER BY t.synced_at DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_similar, timeout=30)
print(stdout.read().decode())

# Verificar na Pluggy se o ID mudou
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

async function checkTx() {
  const apiKey = await getApiKey();
  
  // Buscar transação específica
  try {
    const txRes = await fetch(`${PLUGGY_BASE}/transactions/0747650f-f6be-4ecb-a115-3cf7b3312a25`, {
      headers: { 'X-API-KEY': apiKey }
    });
    
    if (txRes.ok) {
      const tx = await txRes.json();
      console.log('TRANSAÇÃO ENCONTRADA:');
      console.log(`  ID: ${tx.id}`);
      console.log(`  Date: ${tx.date}`);
      console.log(`  Description: ${tx.description}`);
      console.log(`  Amount: ${tx.amount}`);
      console.log(`  Status: ${tx.status}`);
      console.log(`  Type: ${tx.type}`);
    } else {
      console.log('Transação não encontrada na Pluggy');
    }
  } catch (e) {
    console.log(`Erro: ${e.message}`);
  }
  
  // Buscar por descrição e data
  console.log('\\nBuscando transações similares na Pluggy...');
  
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  for (const account of accData.results) {
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=2026-05-01&to=2026-05-01&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    
    const similar = txData.results.filter(t => 
      t.description?.toLowerCase().includes('ozion') ||
      Math.abs(t.amount - (-189.80)) < 0.01
    );
    
    if (similar.length > 0) {
      console.log(`\\nEncontradas ${similar.length} transação(ões):`);
      for (const tx of similar) {
        console.log(`  ${tx.id} | ${tx.date} | ${tx.status} | ${tx.amount} | ${tx.description}`);
      }
    }
  }
}

checkTx().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_specific.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_specific.mjs', timeout=60)
print(stdout.read().decode())

client.close()
