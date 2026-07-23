import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar status das transações MS
check_status = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.status,
  COUNT(*) as quantidade
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
GROUP BY t.status
ORDER BY quantidade DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_status, timeout=30)
print("=== STATUS DAS TRANSAÇÕES MS (JUNHO) ===")
print(stdout.read().decode())

# Verificar transações com status diferente de POSTED
check_non_posted = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  t.description,
  t.status,
  t.account_name
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
  AND t.status != 'POSTED'
ORDER BY t.date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_non_posted, timeout=30)
print("\n=== TRANSAÇÕES MS COM STATUS != POSTED ===")
print(stdout.read().decode())

# Verificar TODAS as transações de junho (sem filtro de status)
check_all = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date as data,
  t.type,
  t.amount,
  LEFT(t.description, 35) as descricao,
  t.status
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%MS%'
  AND t.date::date >= '2026-06-01'
ORDER BY t.date DESC, t.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_all, timeout=30)
print("\n=== TODAS AS TRANSAÇÕES MS (JUNHO) ===")
print(stdout.read().decode())

client.close()
