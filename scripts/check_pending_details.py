import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Buscar detalhes completos das transações PENDING na Pluggy
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

async function checkPending() {
  const apiKey = await getApiKey();
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  for (const account of accData.results) {
    console.log(`\\n=== CONTA: ${account.name} ===\\n`);
    
    const txRes = await fetch(
      `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=2026-06-09&to=2026-06-09&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    const txData = await txRes.json();
    
    console.log(`Total transações: ${txData.results.length}\\n`);
    
    for (const tx of txData.results) {
      console.log('-------------------------------------------');
      console.log(`ID: ${tx.id}`);
      console.log(`Data: ${tx.date}`);
      console.log(`Descrição: ${tx.description}`);
      console.log(`Tipo: ${tx.type}`);
      console.log(`Valor: ${tx.amount}`);
      console.log(`Status: ${tx.status || 'NULL'}`);
      console.log(`Categoria: ${tx.category || 'NULL'}`);
      
      // Verificar campos especiais
      if (tx.creditCardMetadata) {
        console.log(`Credit Card - Purchase Date: ${tx.creditCardMetadata.purchaseDate}`);
        console.log(`Credit Card - Installment: ${tx.creditCardMetadata.installmentNumber}/${tx.creditCardMetadata.totalInstallments}`);
      }
      
      if (tx.paymentData) {
        console.log(`Payment Data: ${JSON.stringify(tx.paymentData)}`);
      }
      
      // Verificar se é agendada
      if (tx.providerCode) {
        console.log(`Provider Code: ${tx.providerCode}`);
      }
      
      // Verificar tags
      if (tx.tags && tx.tags.length > 0) {
        console.log(`Tags: ${tx.tags.join(', ')}`);
      }
      
      // Verificar operationType
      if (tx.operationType) {
        console.log(`Operation Type: ${tx.operationType}`);
      }
      
      console.log('');
    }
  }
}

checkPending().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/check_pending.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

print("=== BUSCANDO DETALHES DAS TRANSAÇÕES ===\n")
stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/check_pending.mjs', timeout=60)
output = stdout.read().decode('utf-8', errors='replace')

# Salvar em arquivo para análise
with open('c:/Users/HAVE/Desktop/Extrator-bancario/scripts/pending_details.txt', 'w', encoding='utf-8') as f:
    f.write(output)

print(output[:3000])  # Mostrar primeiros 3000 caracteres
print("\n... (output completo salvo em pending_details.txt)")

client.close()
