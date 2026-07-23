import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar período das transações no banco
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  MIN(date::date) as primeira,
  MAX(date::date) as ultima,
  COUNT(*) as total
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc';
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("=== PERIODO NO BANCO ===")
print(stdout.read().decode())

# Verificar configuração do sync
check_config = '''
grep -n "FIRST_LOAD_FROM\|sevenDaysAgo\|from =" /root/sync.mjs
'''

stdin, stdout, stderr = client.exec_command(check_config, timeout=30)
print("=== CONFIGURACAO SYNC ===")
print(stdout.read().decode())

# Verificar se é primeiro carregamento
check_first = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT COUNT(*) as total FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc';
"
'''

stdin, stdout, stderr = client.exec_command(check_first, timeout=30)
print("=== TOTAL TRANSACOES ===")
print(stdout.read().decode())

client.close()
