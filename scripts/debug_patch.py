import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('37.60.236.200', username='root', password='131105Gv', timeout=30)

# Script de debug para testar PATCH
debug_script = '''
const PLUGGY_BASE = 'https://api.pluggy.ai';

async function getApiKey() {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Auth falhou: ${res.status}`);
  const data = await res.json();
  return data.apiKey;
}

async function testPatch(itemId) {
  try {
    const apiKey = await getApiKey();
    console.log(`\\n[TESTE] Item: ${itemId}`);
    console.log(`[TESTE] API Key: ${apiKey.slice(0, 10)}...`);
    
    // 1. Ver status atual do item
    const statusRes = await fetch(`${PLUGGY_BASE}/items/${itemId}`, {
      headers: { 'X-API-KEY': apiKey }
    });
    const statusData = await statusRes.json();
    console.log(`[TESTE] Status atual: ${statusData.status}`);
    console.log(`[TESTE] Execution status: ${statusData.executionStatus || 'N/A'}`);
    console.log(`[TESTE] Last updated: ${statusData.lastUpdatedAt || 'N/A'}`);
    
    // 2. Tentar PATCH
    console.log(`[TESTE] Enviando PATCH...`);
    const patchRes = await fetch(`${PLUGGY_BASE}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey 
      },
      body: JSON.stringify({}),
    });
    
    console.log(`[TESTE] PATCH status: ${patchRes.status}`);
    
    if (!patchRes.ok) {
      const errorData = await patchRes.json().catch(() => ({}));
      console.log(`[TESTE] PATCH erro: ${JSON.stringify(errorData)}`);
    } else {
      const patchData = await patchRes.json();
      console.log(`[TESTE] PATCH sucesso: ${JSON.stringify(patchData)}`);
    }
    
  } catch (e) {
    console.log(`[TESTE] ERRO: ${e.message}`);
  }
}

// Testar com alguns items
const items = [
  '96fa65b1-966d-47c6-87db-3640200c12e5',  // Peruille / Sicoob
  'fd8738a2-1be5-490b-b447-4c6343c28307',  // MS / Itau
  '947651f5-6c72-426b-b852-e3736f06d6fe',  // Supershop / Bradesco
];

async function main() {
  for (const itemId of items) {
    await testPatch(itemId);
    await new Promise(r => setTimeout(r, 2000)); // esperar 2s entre testes
  }
}

main().catch(console.error);
'''

# Salvar e executar
sftp = client.open_sftp()
with sftp.file('/tmp/debug_patch.mjs', 'w') as f:
    f.write(debug_script)
sftp.close()

stdin, stdout, stderr = client.exec_command('source /root/.sync.env && node /tmp/debug_patch.mjs', timeout=60)
print("OUTPUT:")
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("ERROS:")
    print(err)

client.close()
