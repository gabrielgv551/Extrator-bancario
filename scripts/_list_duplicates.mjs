import fs from 'fs';
const envContent = fs.readFileSync('.sync.env', 'utf8');
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length > 0 && !key.startsWith('#')) {
    process.env[key.trim()] = rest.join('=').trim();
  }
}

async function main() {
  const auth = await fetch('https://api.pluggy.ai/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET })
  }).then(r => r.json());

  const all = await fetch('https://api.pluggy.ai/connectors', {
    headers: { 'X-API-KEY': auth.apiKey }
  }).then(r => r.json());

  const byName = {};
  for (const c of all.results) {
    if (!byName[c.name]) byName[c.name] = [];
    byName[c.name].push(c);
  }

  const duplicates = Object.entries(byName).filter(([, list]) => list.length > 1);
  console.log('Conectores duplicados com versao Open Finance + legado (mesmo nome):\n');
  for (const [name, list] of duplicates) {
    const hasOF = list.some(c => c.isOpenFinance);
    const hasLegacy = list.some(c => !c.isOpenFinance);
    if (hasOF && hasLegacy) {
      console.log(`${name}:`);
      for (const c of list) {
        console.log(`  id=${c.id} | OF=${c.isOpenFinance} | MFA=${c.hasMFA} | type=${c.type}`);
      }
      console.log('');
    }
  }
}
main().catch(console.error);
