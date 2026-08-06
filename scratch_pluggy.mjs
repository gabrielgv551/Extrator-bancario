import { getApiKey } from './lib/pluggy.js';

const PLUGGY_BASE = 'https://api.pluggy.ai';
const ITEM_ID = '5284dfc7-f34b-48a2-9baa-14d549235ae8';
const FROM = '2026-06-01';
const TO = '2026-06-05';

async function run() {
  const apiKey = await getApiKey();
  
  // get accounts
  const accRes = await fetch(`${PLUGGY_BASE}/accounts?itemId=${ITEM_ID}`, { headers: { 'X-API-KEY': apiKey }});
  const accData = await accRes.json();
  const accountId = accData.results[0].id; // assume first account

  let page = 1;
  let totalPages = 1;
  const txs = [];

  while (page <= totalPages) {
    const txRes = await fetch(`${PLUGGY_BASE}/transactions?accountId=${accountId}&from=${FROM}&to=${TO}&page=${page}`, { headers: { 'X-API-KEY': apiKey }});
    const data = await txRes.json();
    totalPages = data.totalPages;
    txs.push(...data.results);
    page++;
  }

  const idsToFind = ['5f5b327d-fd86-4bd0-9709-4374c08b0f44', 'af988526-31fc-402d-aa08-1cb0eced5bf3'];
  const found = txs.filter(t => idsToFind.includes(t.id));
  
  console.log(`Total transactions from ${FROM} to ${TO}:`, txs.length);
  console.log('Found our target IDs in Pluggy response:');
  for (const t of found) {
    console.log(`- ${t.id}: ${t.description} | ${t.amount}`);
  }
}

run().catch(console.error);
