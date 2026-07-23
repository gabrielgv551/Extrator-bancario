import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Ler o sync.mjs corrigido
with open('scripts/sync.mjs', 'r', encoding='utf-8') as f:
    content = f.read()

# Fazer upload
sftp = client.open_sftp()
with sftp.file('/root/sync.mjs', 'w') as f:
    f.write(content)
sftp.close()

print('[OK] sync.mjs atualizado')

# Verificar sintaxe
stdin, stdout, stderr = client.exec_command('node --check /root/sync.mjs')
err = stderr.read().decode()
if err:
    print('[ERRO] Sintaxe:', err)
else:
    print('[OK] Sintaxe OK')

# Testar sync Peruille
print('\n[TESTE] Sync Peruille...')
stdin, stdout, stderr = client.exec_command(
    'source /root/.sync.env && node /root/sync.mjs e88bc7e9-5159-41e1-ad79-e026c43353bc',
    timeout=120
)

output = stdout.read().decode('utf-8', errors='replace')
print(output)

client.close()
