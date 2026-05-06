import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]', 'utf-8');
}

export function getClients() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
}

export function saveClients(clients) {
  ensureDataDir();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
}

export function getClientById(id) {
  return getClients().find((c) => c.id === id) ?? null;
}

export function createClient({ id, name }) {
  const clients = getClients();
  const client = {
    id,
    name,
    itemId: null,
    lastSync: null,
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  saveClients(clients);
  return client;
}

export function updateClient(id, updates) {
  const clients = getClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  clients[idx] = { ...clients[idx], ...updates };
  saveClients(clients);
  return clients[idx];
}

export function deleteClient(id) {
  const clients = getClients();
  const filtered = clients.filter((c) => c.id !== id);
  if (filtered.length === clients.length) return false;
  saveClients(filtered);
  return true;
}
