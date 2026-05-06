const PLUGGY_API_BASE = 'https://api.pluggy.ai';

async function fetchPluggy(path, options = {}) {
  const res = await fetch(`${PLUGGY_API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Pluggy API error ${res.status} em ${path}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  return res.json();
}

export async function getApiKey() {
  const data = await fetchPluggy('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  return data.apiKey;
}

export async function getConnectToken(clientUserId) {
  const apiKey = await getApiKey();
  const data = await fetchPluggy('/connect_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ clientUserId, avoidDuplicates: true }),
  });
  return data.accessToken;
}

export async function getAccounts(itemId) {
  const apiKey = await getApiKey();
  const data = await fetchPluggy(`/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  return data.results;
}

export async function getAllTransactions(itemId, { from, to } = {}) {
  const apiKey = await getApiKey();
  const accounts = await getAccounts(itemId);
  const allTx = [];

  for (const account of accounts) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      let url = `/transactions?accountId=${account.id}&page=${page}&pageSize=500`;
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;

      const data = await fetchPluggy(url, { headers: { 'X-API-KEY': apiKey } });
      totalPages = data.totalPages;

      for (const tx of data.results) {
        allTx.push({
          ...tx,
          accountName: account.name,
          accountType: account.type,
        });
      }
      page++;
    }
  }

  allTx.sort((a, b) => new Date(b.date) - new Date(a.date));
  return allTx;
}

export async function getItem(itemId) {
  const apiKey = await getApiKey();
  return fetchPluggy(`/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
}

export async function deletePluggyItem(itemId) {
  const apiKey = await getApiKey();
  await fetchPluggy(`/items/${itemId}`, {
    method: 'DELETE',
    headers: { 'X-API-KEY': apiKey },
  });
}
