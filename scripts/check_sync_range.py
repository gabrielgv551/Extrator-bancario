import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar qual período o sync está buscando
check_sync = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  c.name,
  c.last_sync,
  c.created_at
FROM clients c
WHERE c.name ILIKE '%MS%';
"
'''

stdin, stdout, stderr = client.exec_command(check_sync, timeout=30)
print("=== CLIENTE MS ===")
print(stdout.read().decode())

# Verificar se é primeiro carregamento ou não
check_first = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  COUNT(*) as total_transacoes,
  MIN(date::date) as primeira,
  MAX(date::date) as ultima
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%';
"
'''

stdin, stdout, stderr = client.exec_command(check_first, timeout=30)
print("\n=== PERÍODO DAS TRANSAÇÕES MS ===")
print(stdout.read().decode())

# Verificar o sync.mjs para ver o período padrão
check_script = '''
grep -n "FIRST_LOAD_FROM\|sevenDaysAgo\|from =" /root/sync.mjs | head -10
'''

stdin, stdout, stderr = client.exec_command(check_script, timeout=30)
print("\n=== CONFIGURAÇÃO DO SYNC ===")
print(stdout.read().decode())

client.close()
