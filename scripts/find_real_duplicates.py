import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar duplicatas reais (mesmo valor+data+desc, IDs diferentes)
print("=== DUPLICATAS REAIS (mesmo valor+data+desc, IDs diferentes) ===\n")
check_dups = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date,
  t.amount,
  LEFT(t.description, 30),
  COUNT(*) as qtd,
  STRING_AGG(t.id, ' | ') as ids,
  STRING_AGG(t.status, ' | ') as statuses
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
GROUP BY t.date::date, t.amount, LEFT(t.description, 30)
HAVING COUNT(*) > 1
ORDER BY t.date::date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_dups, timeout=30)
print(stdout.read().decode())

# Verificar transações de 01/05 especificamente
print("=== TODAS AS TRANSAÇÕES DE 01/05 PERUILLE ===\n")
check_may1 = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.type,
  t.amount,
  t.description,
  t.status,
  t.synced_at
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.date::date = '2026-05-01'
ORDER BY t.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_may1, timeout=30)
print(stdout.read().decode())

# Verificar se há transações com descrição similar mas IDs diferentes
print("=== TRANSAÇÕES MERCADOLIVRE DE 01/05 ===\n")
check_mercado = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.amount,
  t.description,
  t.status,
  t.synced_at
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.date::date = '2026-05-01'
  AND t.description ILIKE '%MERCADOLIVRE%'
ORDER BY t.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_mercado, timeout=30)
print(stdout.read().decode())

client.close()
