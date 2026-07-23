import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Testar o SQL exato do usuário
sql = '''
SELECT 
  t.id                                              AS "ID",
  c.name                                            AS "Cliente",
  t.date::date                                      AS "Data Lançamento",
  to_char(t.date_transacted, 'DD/MM/YYYY')          AS "Data Transação",
  t.description                                     AS "Descrição",
  CASE WHEN t.type = 'CREDIT' THEN 'Entrada' ELSE 'Saída' END AS "Tipo",
  REPLACE(t.amount::TEXT, '.', ',')                 AS "Valor (R$)",
  REPLACE(t.balance::TEXT, '.', ',')                AS "Saldo",
  t.category                                        AS "Categoria",
  t.account_name                                    AS "Conta",
  t.account_number                                  AS "Agência/Número",
  t.account_type                                    AS "Tipo de Conta",
  t.institution_name                                AS "Banco",
  t.counterparty_name                               AS "Razão Social",
  CASE
    WHEN t.counterparty_document IS NULL THEN NULL
    WHEN length(t.counterparty_document) = 14
      THEN regexp_replace(t.counterparty_document, '(\\d{2})(\\d{3})(\\d{3})(\\d{4})(\\d{2})', '\\1.\\2.\\3/\\4-\\5')
    WHEN length(t.counterparty_document) = 11
      THEN regexp_replace(t.counterparty_document, '(\\d{3})(\\d{3})(\\d{3})(\\d{2})', '\\1.\\2.\\3-\\4')
    ELSE t.counterparty_document
  END                                               AS "CNPJ/CPF",
  'Conta Bancária'                                  AS "Origem",
  t.status                                          AS "Status"
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE t.status = 'POSTED'
  AND c.name ILIKE '%Peruille%'
  AND t.date::date = '2026-06-09'
ORDER BY t.date ASC;
'''

# Salvar SQL em arquivo
sftp = client.open_sftp()
with sftp.file('/tmp/test_sql.sql', 'w') as f:
    f.write(sql)
sftp.close()

print("=== EXECUTANDO SQL DO USUÁRIO ===\n")
stdin, stdout, stderr = client.exec_command(
    'source /root/.sync.env && psql "$DATABASE_URL" -f /tmp/test_sql.sql',
    timeout=30
)

output = stdout.read().decode()
print(output)

err = stderr.read().decode()
if err:
    print("ERROS:")
    print(err)

# Contar total de transações Peruille com status POSTED
print("\n=== CONTAGEM TOTAL PERUILLE ===")
count_sql = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.date::date,
  COUNT(*) as qtd
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.status = 'POSTED'
  AND t.date::date >= '2026-06-01'
GROUP BY t.date::date
ORDER BY t.date::date DESC;
"
'''

stdin, stdout, stderr = client.exec_command(count_sql, timeout=30)
print(stdout.read().decode())

# Verificar se há transações com status diferente de POSTED
print("=== STATUS DIFERENTE DE POSTED ===")
status_sql = '''
source /root/.sync.env
psql "$DATABASE_URL" -c "
SELECT 
  t.status,
  COUNT(*) as qtd
FROM transactions t
JOIN clients c ON c.id = t.client_id
WHERE c.name ILIKE '%Peruille%'
  AND t.date::date = '2026-06-09'
GROUP BY t.status;
"
'''

stdin, stdout, stderr = client.exec_command(status_sql, timeout=30)
print(stdout.read().decode())

client.close()
