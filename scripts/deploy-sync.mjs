#!/usr/bin/env node
/**
 * Deploy automatizado do sync.mjs para a VPS
 * Faz upload, verifica, testa e mostra instruções finais
 *
 * Uso:
 *   node scripts/deploy-sync.mjs [--test] [--client-id <ID>]
 *
 * Opções:
 *   --test         Executa um teste rápido após o deploy
 *   --client-id    ID do cliente para testar (padrão: primeiro encontrado)
 *   --env          Também faz upload do .env.production
 */

import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Configurações ─────────────────────────────────────────────────────────────

const VPS_HOST = 'root@37.60.236.200';
const VPS_SYNC_PATH = '/root/sync.mjs';
const VPS_ENV_PATH = '/root/.sync.env';
const LOCAL_SYNC = join(ROOT, 'scripts', 'sync.mjs');
const LOCAL_ENV = join(ROOT, '.env.production');

// ── Cores ─────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(kind, msg) {
  const colors = {
    info: C.blue,
    ok: C.green,
    warn: C.yellow,
    error: C.red,
    step: C.cyan,
  };
  const emoji = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌', step: '▶️' };
  console.log(`${colors[kind] || ''}${emoji[kind] || '•'} ${msg}${C.reset}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.silent ? 'pipe' : 'inherit',
      shell: true,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    if (opts.silent || opts.capture) {
      child.stdout?.on('data', d => stdout += d);
      child.stderr?.on('data', d => stderr += d);
    }
    child.on('close', code => {
      if (code !== 0 && !opts.ignoreError) {
        reject(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function ssh(cmd, opts = {}) {
  const result = await run('ssh', [VPS_HOST, cmd], { ...opts, silent: true });
  return result.stdout.trim();
}

async function scp(local, remote) {
  await run('scp', [local, `${VPS_HOST}:${remote}`]);
}

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const doTest = args.includes('--test');
const doEnv = args.includes('--env');
const clientIdFlag = args.indexOf('--client-id');
const testClientId = clientIdFlag >= 0 ? args[clientIdFlag + 1] : null;

// ── Validações ────────────────────────────────────────────────────────────────

console.log(`${C.bold}${C.cyan}`);
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║           DEPLOY AUTOMATIZADO - SYNC.MJS PARA VPS                   ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log(`${C.reset}\n`);

if (!existsSync(LOCAL_SYNC)) {
  log('error', `Arquivo não encontrado: ${LOCAL_SYNC}`);
  process.exit(1);
}

if (doEnv && !existsSync(LOCAL_ENV)) {
  log('error', `Arquivo não encontrado: ${LOCAL_ENV}`);
  log('info', 'Crie o arquivo .env.production ou remova a flag --env');
  process.exit(1);
}

// ── Verificar conectividade ───────────────────────────────────────────────────

log('step', 'Verificando conectividade SSH...');
try {
  const test = await ssh('echo "SSH_OK"', { timeout: 10000 });
  if (test === 'SSH_OK') {
    log('ok', `Conectado em ${VPS_HOST}`);
  } else {
    throw new Error('Resposta inesperada');
  }
} catch (e) {
  log('error', `Não foi possível conectar em ${VPS_HOST}`);
  console.log(`\n${C.yellow}Verifique:${C.reset}`);
  console.log('  1. Se a VPS está online: ping 37.60.236.200');
  console.log('  2. Se você tem acesso SSH configurado');
  console.log('  3. Se sua chave SSH está carregada: ssh-add -l');
  console.log(`\n${C.cyan}Alternativa manual:${C.reset}`);
  console.log(`  scp scripts/sync.mjs ${VPS_HOST}:/root/sync.mjs`);
  process.exit(1);
}

// ── Upload do sync.mjs ────────────────────────────────────────────────────────

log('step', 'Fazendo upload do sync.mjs...');
await scp(LOCAL_SYNC, VPS_SYNC_PATH);

// Verificar tamanho
const localSize = readFileSync(LOCAL_SYNC).length;
const remoteSize = parseInt(await ssh(`wc -c < ${VPS_SYNC_PATH}`), 10);

if (localSize === remoteSize) {
  log('ok', `sync.mjs enviado (${remoteSize} bytes)`);
} else {
  log('warn', `Tamanho diferente! Local: ${localSize}, Remoto: ${remoteSize}`);
}

// ── Upload do .env (se solicitado) ────────────────────────────────────────────

if (doEnv) {
  log('step', 'Fazendo upload do .env.production...');
  
  // Backup do .env antigo
  await ssh(`cp ${VPS_ENV_PATH} ${VPS_ENV_PATH}.bak.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true`, { ignoreError: true });
  await scp(LOCAL_ENV, VPS_ENV_PATH);
  log('ok', '.env.production enviado');
}

// ── Verificar ambiente na VPS ─────────────────────────────────────────────────

log('step', 'Verificando ambiente na VPS...');

const nodeVersion = await ssh('node --version', { ignoreError: true });
if (nodeVersion) {
  log('info', `Node.js na VPS: ${nodeVersion}`);
} else {
  log('warn', 'Node.js não encontrado na VPS');
}

// Verificar se .sync.env existe
const envExists = await ssh(`test -f ${VPS_ENV_PATH} && echo "EXISTS" || echo "MISSING"`);
if (envExists === 'EXISTS') {
  log('ok', `.sync.env encontrado em ${VPS_ENV_PATH}`);
} else {
  log('error', `.sync.env NÃO encontrado em ${VPS_ENV_PATH}`);
  console.log(`\n${C.yellow}Você precisa criar o arquivo /root/.sync.env na VPS com:${C.reset}`);
  console.log('  DATABASE_URL=postgresql://...');
  console.log('  PLUGGY_CLIENT_ID=...');
  console.log('  PLUGGY_CLIENT_SECRET=...');
}

// Verificar cron jobs
const cronJobs = await ssh('crontab -l 2>/dev/null | grep -E "sync|pluggy" || echo "NONE"', { ignoreError: true });
if (cronJobs !== 'NONE') {
  log('info', 'Cron jobs encontrados:');
  cronJobs.split('\n').forEach(line => {
    if (line.trim()) console.log(`    ${C.cyan}${line.trim()}${C.reset}`);
  });
} else {
  log('warn', 'Nenhum cron job de sync encontrado');
}

// ── Teste (se solicitado) ─────────────────────────────────────────────────────

if (doTest) {
  console.log(`\n${C.bold}${C.cyan}═══ TESTE DO SYNC ═══${C.reset}\n`);
  
  let testId = testClientId;
  
  if (!testId) {
    // Buscar primeiro cliente
    log('step', 'Buscando cliente para teste...');
    const clientsJson = await ssh(
      `source ${VPS_ENV_PATH} && node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT id, name FROM clients ORDER BY name LIMIT 5').then(r => {
          console.log(JSON.stringify(r.rows));
          pool.end();
        });
      "`,
      { ignoreError: true }
    );
    
    try {
      const clients = JSON.parse(clientsJson);
      if (clients.length > 0) {
        testId = clients[0].id;
        log('info', `Usando cliente: ${clients[0].name} (${testId})`);
        if (clients.length > 1) {
          console.log(`  ${C.cyan}Outros disponíveis:${C.reset}`);
          clients.slice(1).forEach(c => console.log(`    ${c.id} - ${c.name}`));
        }
      }
    } catch (e) {
      log('warn', 'Não foi possível listar clientes');
    }
  }
  
  if (testId) {
    log('step', `Executando sync de teste para ${testId}...`);
    console.log(`  ${C.yellow}(isso pode levar alguns segundos...)${C.reset}\n`);
    
    try {
      const testOutput = await ssh(
        `source ${VPS_ENV_PATH} && cd /root && node sync.mjs ${testId}`,
        { timeout: 120000, ignoreError: true }
      );
      
      // Mostrar últimas linhas do output
      const lines = testOutput.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-20);
      
      console.log(`${C.cyan}─── Output do teste ───${C.reset}`);
      lastLines.forEach(line => {
        if (line.includes('✓') || line.includes('ok')) {
          console.log(`  ${C.green}${line}${C.reset}`);
        } else if (line.includes('✗') || line.includes('erro') || line.includes('falhou')) {
          console.log(`  ${C.red}${line}${C.reset}`);
        } else if (line.includes('⤷') || line.includes('pulando')) {
          console.log(`  ${C.yellow}${line}${C.reset}`);
        } else {
          console.log(`  ${line}`);
        }
      });
      
      if (testOutput.includes('concluído') || testOutput.includes('transações')) {
        log('ok', 'Teste executado com sucesso!');
      } else if (testOutput.includes('erro') || testOutput.includes('falhou')) {
        log('warn', 'Teste executado mas com avisos/erros');
      }
    } catch (e) {
      log('error', `Teste falhou: ${e.message}`);
    }
  } else {
    log('warn', 'Nenhum cliente encontrado para teste');
  }
}

// ── Resumo final ──────────────────────────────────────────────────────────────

console.log(`\n${C.bold}${C.green}`);
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║                     DEPLOY CONCLUÍDO! ✅                              ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log(`${C.reset}`);

console.log(`${C.bold}Resumo:${C.reset}`);
console.log(`  📁 sync.mjs → ${VPS_HOST}:${VPS_SYNC_PATH}`);
if (doEnv) console.log(`  📁 .env → ${VPS_HOST}:${VPS_ENV_PATH}`);
console.log(`  📊 Tamanho: ${remoteSize} bytes`);

console.log(`\n${C.bold}Comandos úteis na VPS:${C.reset}`);
console.log(`  ${C.cyan}# Testar manualmente${C.reset}`);
console.log(`  ssh ${VPS_HOST} 'source ${VPS_ENV_PATH} && node ${VPS_SYNC_PATH} <CLIENT_ID>'`);
console.log(`  `);
console.log(`  ${C.cyan}# Ver logs em tempo real${C.reset}`);
console.log(`  ssh ${VPS_HOST} 'tail -f /var/log/sync.log 2>/dev/null || echo "Sem log configurado"'`);
console.log(`  `);
console.log(`  ${C.cyan}# Ver cron jobs${C.reset}`);
console.log(`  ssh ${VPS_HOST} 'crontab -l'`);
console.log(`  `);
console.log(`  ${C.cyan}# Diagnóstico rápido${C.reset}`);
console.log(`  node scripts/diagnose.mjs <CLIENT_ID>`);

console.log(`\n${C.bold}Para configurar o cron (na VPS):${C.reset}`);
console.log(`  crontab -e`);
console.log(`  # Adicione (ex: a cada 30 minutos):`);
console.log(`  */30 * * * * /root/run-sync.sh >> /var/log/sync.log 2>&1`);

console.log('');
