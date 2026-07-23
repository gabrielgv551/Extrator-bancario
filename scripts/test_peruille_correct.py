import paramiko
import sys

# Forçar UTF-8
sys.stdout.reconfigure(encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Executar sync para Peruille (client_id correto)
print("=== SYNC PERUILLE ===\n")
stdin, stdout, stderr = client.exec_command(
    'source /root/.sync.env && node /root/sync.mjs e88bc7e9-5159-41e1-ad79-e026c43353bc',
    timeout=120
)

# Ler output
output = stdout.read().decode('utf-8', errors='replace')
print(output)

err = stderr.read().decode('utf-8', errors='replace')
if err:
    print("\nERROS:")
    print(err)

# Verificar transações no banco
print("\n=== TRANSACOES PERUILLE NO BANCO ===\n")
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
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date
ORDER BY t.date::date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Verificar últimas transações
print("=== ULTIMAS TRANSACOES PERUILLE ===\n")
check_last = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  LEFT(t.description, 40) as descricao,
  t.account_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
ORDER BY t.date DESC
LIMIT 15;
"
'''

stdin, stdout, stderr = client.exec_command(check_last, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
