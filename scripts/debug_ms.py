import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Script para debug da MS
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

async function debugMS() {
  const apiKey = await getApiKey();
  const itemId = 'fd8738a2-1be5-490b-b447-4c6343c28307';
  
  console.log('=== DEBUG MS (Item: ' + itemId + ') ===\\n');
  
  // 1. Ver status do item
  console.log('1. STATUS DO ITEM:');
  const itemRes = await fetch(`${PLUGGY_BASE}/items/${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const itemData = await itemRes.json();
  console.log('   Status:', itemData.status);
  console.log('   Execution:', itemData.executionStatus);
  console.log('   Last Updated:', itemData.lastUpdatedAt);
  console.log('   Connector:', itemData.connector?.name);
  console.log('');
  
  // 2. Buscar contas
  console.log('2. CONTAS:');
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  console.log('   Total contas:', accData.results.length);
  
  for (const acc of accData.results) {
    console.log('\\n   Conta:', acc.name, '(', acc.type, ')');
    console.log('   ID:', acc.id);
    console.log('   Number:', acc.number || 'N/A');
    console.log('   Balance:', acc.balance);
    
    // 3. Buscar transações desta conta
    console.log('\\n   3. TRANSAÇÕES DA CONTA:');
    
    // Últimas 10 transações
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${acc.id}&pageSize=10`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    console.log('   Total transações:', txData.total);
    console.log('   Páginas:', txData.totalPages);
    
    console.log('\\n   Últimas 10 transações:');
    for (const tx of txData.results) {
      console.log(`   ${tx.date} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 50)}`);
    }
    
    // 4. Buscar transações de 03/06 pra frente
    console.log('\\n   4. TRANSAÇÕES A PARTIR DE 04/06/2026:');
    const txFromRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${acc.id}&from=2026-06-04&pageSize=100`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txFromData = await txFromRes.json();
    console.log('   Encontradas:', txFromData.results.length);
    
    if (txFromData.results.length > 0) {
      for (const tx of txFromData.results) {
        console.log(`   ${tx.date} | ${tx.type.padEnd(6)} | ${tx.amount.toFixed(2).padStart(10)} | ${tx.description.slice(0, 50)}`);
      }
    } else {
      console.log('   NENHUMA transação encontrada após 03/06!');
    }
  }
  
  // 5. Verificar no banco de dados
  console.log('\\n=== 5. BANCO DE DADOS ===');
}

debugMS().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/debug_ms.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/debug_ms.mjs', timeout=60)
output = stdout.read().decode()
print(output)
err = stderr.read().decode()
if err:
    print("ERROS:")
    print(err)

# Agora verificar no banco
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  LEFT(t.description, 50) as descricao,
  t.account_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
ORDER BY t.date DESC
LIMIT 20;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("\n=== BANCO DE DADOS (MS) ===")
print(stdout.read().decode())

client.close()
