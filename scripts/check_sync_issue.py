import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar quando as transações foram inseridas e qual status
print("=== HISTÓRICO DAS TRANSAÇÕES 09/06 ===\n")
check_history = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.id,
  t.date::date,
  t.type,
  t.amount,
  LEFT(t.description, 35) as descricao,
  t.status,
  t.synced_at,
  EXTRACT(EPOCH FROM (NOW() - t.synced_at))/60 as minutos_atras
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND t.date::date = '2026-06-09'
ORDER BY t.amount DESC;
"
'''

stdin, stdout, stderr = client.exec_command(check_history, timeout=30)
print(stdout.read().decode())

# Verificar se há transações com mesmo valor+descricao mas IDs diferentes
print("=== VERIFICANDO DUPLICATAS POTENCIAIS ===\n")
check_dups = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.amount,
  LEFT(t.description, 30),
  COUNT(*) as qtd,
  STRING_AGG(t.status, ', ') as statuses,
  STRING_AGG(LEFT(t.id::text, 8), ', ') as ids
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
  AND t.date::date = '2026-06-09'
GROUP BY t.amount, LEFT(t.description, 30)
HAVING COUNT(*) > 1;
"
'''

stdin, stdout, stderr = client.exec_command(check_dups, timeout=30)
print(stdout.read().decode())

# Verificar se há transações POSTED e PENDING com mesma descrição
print("=== POSTED vs PENDING (mesma descrição) ===\n")
check_both = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
WITH posted AS (
  SELECT description, amount, id
  FROM transactions t
  JOIN clients c ON c.id = t.client_id
  WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
    AND t.date::date = '2026-06-09'
    AND t.status = 'POSTED'
),
pending AS (
  SELECT description, amount, id
  FROM transactions t
  JOIN clients c ON c.id = t.client_id
  WHERE c.id = 'e88bc7e9-5159-41e1-ad79-e026c43353bc'
    AND t.date::date = '2026-06-09'
    AND t.status = 'PENDING'
)
SELECT 
  p.description,
  p.amount,
  p.id as posted_id,
  pe.id as pending_id
FROM posted p
JOIN pending pe ON p.description = pe.description AND p.amount = pe.amount;
"
'''

stdin, stdout, stderr = client.exec_command(check_both, timeout=30)
print(stdout.read().decode())

client.close()
