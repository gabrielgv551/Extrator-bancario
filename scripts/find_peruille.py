import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Buscar cliente Peruille
check_db = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  id,
  name,
  last_sync,
  created_at
FROM clients
WHERE name ILIKE '%peruille%'
ORDER BY name;
"
'''

stdin, stdout, stderr = client.exec_command(check_db, timeout=30)
print("=== CLIENTE PERUILLE ===")
print(stdout.read().decode())

# Buscar items da Peruille
check_items = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  i.id,
  i.client_id,
  c.name as client_name,
  i.pluggy_item_id,
  i.institution_name
FROM items i
JOIN clients c ON c.id = i.client_id
WHERE c.name ILIKE '%peruille%'
ORDER BY i.institution_name;
"
'''

stdin, stdout, stderr = client.exec_command(check_items, timeout=30)
print("\n=== ITEMS PERUILLE ===")
print(stdout.read().decode())

client.close()
