import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Verificar colunas da tabela items
cmd = "source /root/.sync.env && psql \"$DATABASE_URL\" -c \"SELECT column_name FROM information_schema.columns WHERE table_name = 'items' ORDER BY ordinal_position;\""
stdin, stdout, stderr = client.exec_command(cmd)
print('Colunas da tabela items:')
print(stdout.read().decode())

# Verificar colunas da tabela clients
cmd2 = "source /root/.sync.env && psql \"$DATABASE_URL\" -c \"SELECT column_name FROM information_schema.columns WHERE table_name = 'clients' ORDER BY ordinal_position;\""
stdin, stdout, stderr = client.exec_command(cmd2)
print('\nColunas da tabela clients:')
print(stdout.read().decode())

client.close()
