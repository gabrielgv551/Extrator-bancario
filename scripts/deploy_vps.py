import paramiko
import sys

# Forçar UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Ler o arquivo sync.mjs
with open('scripts/sync.mjs', 'r', encoding='utf-8') as f:
    content = f.read()

# Conectar a VPS
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Fazer upload do arquivo
sftp = client.open_sftp()
with sftp.file('/root/sync.mjs', 'w') as remote_file:
    remote_file.write(content)
sftp.close()

print('[OK] sync.mjs atualizado na VPS')

# Verificar sintaxe
stdin, stdout, stderr = client.exec_command('node --check /root/sync.mjs')
output = stdout.read().decode()
errors = stderr.read().decode()

if errors:
    print('[ERRO] Sintaxe:', errors)
else:
    print('[OK] Sintaxe OK')

# Executar o sync
print('\n[INICIANDO] Sync em todos os clientes...')
print('='*70)
stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /root/sync.mjs', timeout=300)

# Ler output em tempo real
for line in stdout:
    print(line, end='')

err_output = stderr.read().decode()
if err_output:
    print('\n[ERROS]')
    print(err_output)

client.close()
print('\n[OK] Deploy e execucao concluidos!')
