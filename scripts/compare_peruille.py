import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Script para buscar TODAS as transações da Pluggy
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

async function getAllPluggyTransactions() {
  const apiKey = await getApiKey();
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  
  // Buscar contas
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  const allTxs = [];
  
  for (const account of accData.results) {
    let page = 1;
    let totalPages = 1;
    
    while (page <= totalPages) {
      const txRes = await fetch(
        `${PLUGGY_BASE}/transactions?accountId=${account.id}&page=${page}&pageSize=500`,
        { headers: { 'X-API-KEY': apiKey } }
      );
      const txData = await txRes.json();
      totalPages = txData.totalPages;
      
      for (const tx of txData.results) {
        allTxs.push({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          type: tx.type,
          amount: tx.amount,
          status: tx.status || 'NULL',
          accountId: account.id,
          accountName: account.name
        });
      }
      page++;
    }
  }
  
  return allTxs;
}

getAllPluggyTransactions().then(txs => {
  console.log(JSON.stringify(txs));
}).catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/get_pluggy_txs.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

print("Buscando transações da Pluggy...")
stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/get_pluggy_txs.mjs', timeout=120)
pluggy_output = stdout.read().decode('utf-8', errors='replace')

# Parse Pluggy transactions
try:
    pluggy_txs = json.loads(pluggy_output)
    print(f"Total na Pluggy: {len(pluggy_txs)}")
except:
    print("Erro ao parsear Pluggy:")
    print(pluggy_output[:500])
    pluggy_txs = []

# Buscar transações do banco
print("\nBuscando transações do banco...")
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.date::date as date,
  t.description,
  t.type,
  t.amount,
  t.status,
  t.account_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
ORDER BY t.date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
db_output = stdout.read().decode('utf-8', errors='replace')

# Parse DB transactions
db_txs = []
lines = db_output.strip().split('\n')
header_found = False
for line in lines:
    if 'id' in line and 'date' in line and not header_found:
        header_found = True
        continue
    if header_found and line.strip() and not line.startswith('---') and not line.startswith('('):
        parts = line.split('|')
        if len(parts) >= 6:
            db_txs.append({
                'id': parts[0].strip(),
                'date': parts[1].strip(),
                'description': parts[2].strip(),
                'type': parts[3].strip(),
                'amount': float(parts[4].strip()),
                'status': parts[5].strip(),
                'accountName': parts[6].strip() if len(parts) > 6 else ''
            })

print(f"Total no banco: {len(db_txs)}")

# Comparar
print("\n" + "="*80)
print("COMPARAÇÃO PLUGGY vs BANCO")
print("="*80)

pluggy_ids = {tx['id'] for tx in pluggy_txs}
db_ids = {tx['id'] for tx in db_txs}

missing_in_db = pluggy_ids - db_ids
missing_in_pluggy = db_ids - pluggy_ids

print(f"\nNa Pluggy mas NÃO no banco: {len(missing_in_db)}")
if missing_in_db:
    for tx_id in list(missing_in_db)[:10]:
        tx = next((t for t in pluggy_txs if t['id'] == tx_id), None)
        if tx:
            print(f"  {tx['date']} | {tx['type']} | {tx['amount']} | {tx['description'][:50]}")

print(f"\nNo banco mas NÃO na Pluggy: {len(missing_in_pluggy)}")
if missing_in_pluggy:
    for tx_id in list(missing_in_pluggy)[:10]:
        tx = next((t for t in db_txs if t['id'] == tx_id), None)
        if tx:
            print(f"  {tx['date']} | {tx['type']} | {tx['amount']} | {tx['description'][:50]}")

# Verificar divergências nos IDs que existem em ambos
print(f"\nIDs em ambos: {len(pluggy_ids & db_ids)}")
divergences = []
for tx_id in pluggy_ids & db_ids:
    ptx = next((t for t in pluggy_txs if t['id'] == tx_id), None)
    dtx = next((t for t in db_txs if t['id'] == tx_id), None)
    if ptx and dtx:
        diffs = []
        if ptx['date'] != str(dtx['date']):
            diffs.append(f"data: {ptx['date']} vs {dtx['date']}")
        if abs(ptx['amount'] - dtx['amount']) > 0.01:
            diffs.append(f"valor: {ptx['amount']} vs {dtx['amount']}")
        if ptx['type'] != dtx['type']:
            diffs.append(f"tipo: {ptx['type']} vs {dtx['type']}")
        if ptx['description'] != dtx['description']:
            diffs.append(f"desc: diferente")
        if diffs:
            divergences.append({'id': tx_id, 'diffs': diffs, 'pluggy': ptx, 'db': dtx})

print(f"Divergências: {len(divergences)}")
if divergences:
    for d in divergences[:5]:
        print(f"\n  ID: {d['id'][:20]}...")
        for diff in d['diffs']:
            print(f"    - {diff}")

if not missing_in_db and not missing_in_pluggy and not divergences:
    print("\n✅ PERFEITO! Pluggy e Banco estão idênticos!")
else:
    print(f"\n⚠️  Há diferenças entre Pluggy e Banco")

client.close()
