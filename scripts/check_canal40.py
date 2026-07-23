import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

CLIENT_ID = '5d13fcd3-0a39-4ff2-ba8f-4bc3f87053ff'

def run_query(label, query):
    print(f"\n=== {label} ===")
    cmd = f'source /root/.sync.env && psql "$DATABASE_URL" -c "{query}"'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err:
        print("STDERR:", err)
    print(out)

# Dados do cliente
run_query("DADOS DO CLIENTE", f"""
SELECT id, name, portal_token, last_sync, created_at, gestor_empresa
FROM clients
WHERE id = '{CLIENT_ID}';
""")

# Itens Pluggy
run_query("ITENS PLUGGY", f"""
SELECT i.id, i.client_id, c.name, i.pluggy_item_id, i.institution_name, i.account_numbers, i.created_at
FROM items i
JOIN clients c ON c.id = i.client_id
WHERE i.client_id = '{CLIENT_ID}'
ORDER BY i.created_at;
""")

# Contagens
run_query("CONTAGEM DE TRANSACOES", f"""
SELECT 
  (SELECT COUNT(*) FROM transactions t WHERE t.client_id = '{CLIENT_ID}') as debito,
  (SELECT COUNT(*) FROM credit_transactions ct WHERE ct.client_id = '{CLIENT_ID}') as credito,
  (SELECT COUNT(*) FROM transactions t WHERE t.client_id = '{CLIENT_ID}' AND t.status = 'PENDING') as debito_pending,
  (SELECT COUNT(*) FROM credit_transactions ct WHERE ct.client_id = '{CLIENT_ID}' AND ct.status = 'PENDING') as credito_pending;
""")

# Duplicatas por descricao + valor + data (débito)
run_query("DUPLICATAS DEBITO (mesmo valor+data+desc) - JUN/2026", f"""
SELECT 
  t.date::date,
  t.amount,
  t.description,
  COUNT(*) as qtd,
  STRING_AGG(t.id, ' | ' ORDER BY t.status, t.synced_at) as ids,
  STRING_AGG(t.status, ' | ' ORDER BY t.status, t.synced_at) as statuses,
  STRING_AGG(COALESCE(t.account_number,''), ' | ' ORDER BY t.status, t.synced_at) as contas
FROM transactions t
WHERE t.client_id = '{CLIENT_ID}'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date, t.amount, t.description
HAVING COUNT(*) > 1
ORDER BY t.date::date DESC, COUNT(*) DESC;
""")

# Duplicatas por descricao + valor + data (crédito)
run_query("DUPLICATAS CREDITO (mesmo valor+data+desc) - JUN/2026", f"""
SELECT 
  t.date::date,
  t.amount,
  t.description,
  COUNT(*) as qtd,
  STRING_AGG(t.id, ' | ' ORDER BY t.status, t.synced_at) as ids,
  STRING_AGG(t.status, ' | ' ORDER BY t.status, t.synced_at) as statuses,
  STRING_AGG(COALESCE(t.account_number,''), ' | ' ORDER BY t.status, t.synced_at) as contas
FROM credit_transactions t
WHERE t.client_id = '{CLIENT_ID}'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date, t.amount, t.description
HAVING COUNT(*) > 1
ORDER BY t.date::date DESC, COUNT(*) DESC;
""")

# PENDING débito
run_query("PENDING vs POSTED DEBITO - JUN/2026", f"""
SELECT 
  t.date::date,
  t.amount,
  t.description,
  t.status,
  t.id,
  t.synced_at,
  COALESCE(t.account_number,'') as conta
FROM transactions t
WHERE t.client_id = '{CLIENT_ID}'
  AND t.date::date >= '2026-06-01'
  AND t.status = 'PENDING'
ORDER BY t.date::date DESC, t.amount;
""")

# PENDING crédito
run_query("PENDING vs POSTED CREDITO - JUN/2026", f"""
SELECT 
  t.date::date,
  t.amount,
  t.description,
  t.status,
  t.id,
  t.synced_at,
  COALESCE(t.account_number,'') as conta
FROM credit_transactions t
WHERE t.client_id = '{CLIENT_ID}'
  AND t.date::date >= '2026-06-01'
  AND t.status = 'PENDING'
ORDER BY t.date::date DESC, t.amount;
""")

# Verificar se os IDs passados pelo usuário existem como transações
run_query("IDS FORNECIDOS COMO TRANSACOES", f"""
SELECT 'debito' as origem, id, client_id, date::date, amount, description, status, account_number
FROM transactions
WHERE id IN ('204f4871-c633-4673-9934-1ba173836a47','81e1a717-8382-4109-a548-44639e0215d2')
UNION ALL
SELECT 'credito' as origem, id, client_id, date::date, amount, description, status, account_number
FROM credit_transactions
WHERE id IN ('204f4871-c633-4673-9934-1ba173836a47','81e1a717-8382-4109-a548-44639e0215d2');
""")

client.close()
