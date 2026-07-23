import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# 1. Buscar IDs da Pluggy a partir de 01/05/2026
print("=== BUSCANDO IDs DA PLUGGY (>= 01/05/2026) ===")
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

async function getIds() {
  const apiKey = await getApiKey();
  const itemId = 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey }
  });
  const accData = await accRes.json();
  
  const ids = [];
  for (const account of accData.results) {
    let page = 1;
    let totalPages = 1;
    
    while (page <= totalPages) {
      const txRes = await fetch(
        `${PLUGGY_BASE}/transactions?accountId=${account.id}&from=2026-05-01&page=${page}&pageSize=500`,
        { headers: { 'X-API-KEY': apiKey } }
      );
      const txData = await txRes.json();
      totalPages = txData.totalPages;
      
      for (const tx of txData.results) {
        ids.push({
          id: tx.id,
          date: tx.date.slice(0,10),
          desc: tx.description.slice(0,40),
          amount: tx.amount,
          type: tx.type
        });
      }
      page++;
    }
  }
  
  console.log(JSON.stringify(ids));
}

getIds().catch(console.error);
'''

sftp = client.open_sftp()
with sftp.file('/tmp/get_ids.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/get_ids.mjs', timeout=120)
pluggy_json = stdout.read().decode('utf-8', errors='replace')

try:
    pluggy_txs = json.loads(pluggy_json)
    print(f"Total na Pluggy (>= 01/05/2026): {len(pluggy_txs)}")
except:
    print("Erro:", pluggy_json[:200])
    pluggy_txs = []

# 2. Buscar IDs do banco a partir de 01/05/2026
print("\n=== BUSCANDO IDs DO BANCO (>= 01/05/2026) ===")
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -t -A -F"," -c "
SELECT 
  t.id,
  t.date::date,
  LEFT(t.description, 40),
  t.amount,
  t.type
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND t.date::date >= '2026-05-01'
ORDER BY t.date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
db_output = stdout.read().decode('utf-8', errors='replace')

db_txs = []
for line in db_output.strip().split('\n'):
    if line.strip() and not line.startswith('('):
        parts = line.split(',')
        if len(parts) >= 5:
            try:
                db_txs.append({
                    'id': parts[0],
                    'date': parts[1],
                    'desc': parts[2],
                    'amount': float(parts[3]),
                    'type': parts[4]
                })
            except:
                pass

print(f"Total no banco (>= 01/05/2026): {len(db_txs)}")

# 3. Comparar IDs
print("\n" + "="*80)
print("COMPARACAO PLUGGY vs BANCO (>= 01/05/2026)")
print("="*80)

pluggy_ids = {tx['id'] for tx in pluggy_txs}
db_ids = {tx['id'] for tx in db_txs}

missing_in_db = pluggy_ids - db_ids
missing_in_pluggy = db_ids - pluggy_ids
common = pluggy_ids & db_ids

print(f"\nNa Pluggy: {len(pluggy_ids)}")
print(f"No banco: {len(db_ids)}")
print(f"Em comum: {len(common)}")
print(f"\nNa Pluggy mas NAO no banco: {len(missing_in_db)}")
print(f"No banco mas NAO na Pluggy: {len(missing_in_pluggy)}")

if missing_in_db:
    print("\n--- Faltando no banco (primeiros 20) ---")
    for tx_id in list(missing_in_db)[:20]:
        tx = next((t for t in pluggy_txs if t['id'] == tx_id), None)
        if tx:
            print(f"  {tx['date']} | {tx['type']} | {tx['amount']:>10.2f} | {tx['desc']}")

if missing_in_pluggy:
    print("\n--- Faltando na Pluggy (primeiros 20) ---")
    for tx_id in list(missing_in_pluggy)[:20]:
        tx = next((t for t in db_txs if t['id'] == tx_id), None)
        if tx:
            print(f"  {tx['date']} | {tx['type']} | {tx['amount']:>10.2f} | {tx['desc']}")

# Verificar divergencias nos IDs comuns
print("\n--- Verificando divergencias nos IDs comuns ---")
divergences = 0
for tx_id in list(common)[:100]:  # Verificar primeiros 100
    ptx = next((t for t in pluggy_txs if t['id'] == tx_id), None)
    dtx = next((t for t in db_txs if t['id'] == tx_id), None)
    if ptx and dtx:
        if abs(ptx['amount'] - dtx['amount']) > 0.01 or ptx['type'] != dtx['type']:
            divergences += 1
            if divergences <= 5:
                print(f"  ID: {tx_id[:20]}...")
                print(f"    Pluggy: {ptx['date']} | {ptx['type']} | {ptx['amount']}")
                print(f"    Banco:  {dtx['date']} | {dtx['type']} | {dtx['amount']}")

if divergences > 0:
    print(f"\nTotal de divergencias encontradas: {divergences}")

if not missing_in_db and not missing_in_pluggy and divergences == 0:
    print("\nPERFEITO! Pluggy e Banco estao identicos!")
else:
    print(f"\nDiferencas encontradas")

client.close()
