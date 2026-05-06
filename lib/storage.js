import fs from 'fs';
import path from 'path';

const USE_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const REDIS_KEY = 'pluggy:clients';

// ── Upstash Redis (Vercel / produção) ───────────────────────────────────────
async function redisGet() {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  return (await redis.get(REDIS_KEY)) ?? [];
}

async function redisSet(clients) {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  await redis.set(REDIS_KEY, clients);
}

// ── Sistema de arquivos (desenvolvimento local) ─────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]', 'utf-8');
}

function fileGet() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
}

function fileSet(clients) {
  ensureDataDir();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
}

// ── API pública (sempre async) ──────────────────────────────────────────────
export async function getClients() {
  return USE_REDIS ? redisGet() : fileGet();
}

export async function saveClients(clients) {
  if (USE_REDIS) await redisSet(clients);
  else fileSet(clients);
}

export async function getClientById(id) {
  const clients = await getClients();
  return clients.find((c) => c.id === id) ?? null;
}

export async function createClient({ id, name }) {
  const clients = await getClients();
  const client = {
    id,
    name,
    itemId: null,
    lastSync: null,
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  await saveClients(clients);
  return client;
}

export async function updateClient(id, updates) {
  const clients = await getClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  clients[idx] = { ...clients[idx], ...updates };
  await saveClients(clients);
  return clients[idx];
}

export async function deleteClient(id) {
  const clients = await getClients();
  const filtered = clients.filter((c) => c.id !== id);
  if (filtered.length === clients.length) return false;
  await saveClients(filtered);
  return true;
}
