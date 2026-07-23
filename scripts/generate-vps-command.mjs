#!/usr/bin/env node
/**
 * Gera um comando único para copiar o sync.mjs para a VPS via copy-paste.
 * Útil quando não há acesso SSH configurado localmente.
 *
 * Uso:
 *   node scripts/generate-vps-command.mjs
 *
 * Depois cole o output na VPS (via SSH no terminal).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncPath = join(__dirname, '..', 'scripts', 'sync.mjs');

console.log('🔧 Gerando comando para deploy na VPS...\n');

const content = readFileSync(syncPath, 'utf-8');
const compressed = gzipSync(Buffer.from(content));
const base64 = compressed.toString('base64');

console.log('══════════════════════════════════════════════════════════════════');
console.log('  COLE O COMANDO ABAIXO NA VPS (via SSH)');
console.log('══════════════════════════════════════════════════════════════════\n');

// Dividir em chunks para não quebrar o terminal
const CHUNK_SIZE = 8000;
const chunks = [];
for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
  chunks.push(base64.slice(i, i + CHUNK_SIZE));
}

console.log('# ── Comando único ──');
console.log('# Cole TUDO de uma vez na VPS:\n');

console.log(`echo '${chunks[0]}' \\\`);
for (let i = 1; i < chunks.length; i++) {
  console.log(`  '${chunks[i]}' \\\`);
}
console.log(`  | base64 -d | gunzip > /root/sync.mjs.new && \\\`);
console.log(`  mv /root/sync.mjs.new /root/sync.mjs && \\\`);
console.log(`  chmod +x /root/sync.mjs && \\\`);
console.log(`  echo "✅ sync.mjs atualizado ($(wc -c < /root/sync.mjs) bytes)"`);

console.log('\n');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  OU USE O MÉTODO SIMPLIFICADO (mais confiável)');
console.log('══════════════════════════════════════════════════════════════════\n');

// Método alternativo: salvar em arquivo temporário local e mostrar scp
console.log('# Na VPS, primeiro crie o arquivo vazio:');
console.log('touch /root/sync.mjs');
console.log('');
console.log('# Depois abra o editor:');
console.log('nano /root/sync.mjs');
console.log('');
console.log('# Cole o conteúdo abaixo (Ctrl+A, Ctrl+C, depois na VPS Ctrl+Shift+V):');
console.log('');
console.log('--- CONTEÚDO DO sync.mjs ---');
console.log(content);
console.log('--- FIM DO CONTEÚDO ---');

console.log('\n');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  ESTATÍSTICAS`);
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  Tamanho original:  ${content.length} bytes`);
console.log(`  Tamanho gzip+base64: ${base64.length} bytes`);
console.log(`  Chunks gerados: ${chunks.length}`);
console.log('');
