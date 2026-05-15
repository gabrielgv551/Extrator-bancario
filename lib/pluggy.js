const PLUGGY_API_BASE = 'https://api.pluggy.ai';

let _cachedApiKey = null;
let _cacheExpiry  = 0;

const CATEGORY_PT = {
  'Income': 'Receita',
  'Salary': 'Salário',
  'Retirement': 'Aposentadoria',
  'Entrepreneurial activities': 'Atividades Empreendedoras',
  'Government aid': 'Auxílio do Governo',
  'Non-recurring income': 'Receita Não Recorrente',
  'Loans and Financing': 'Empréstimos e Financiamentos',
  'Late payment and overdraft costs': 'Juros e Mora',
  'Interests charged': 'Juros Cobrados',
  'Loans': 'Empréstimos',
  'Financing': 'Financiamentos',
  'Real estate financing': 'Financiamento Imobiliário',
  'Vehicle Financing': 'Financiamento de Veículos',
  'Student loan': 'Financiamento Estudantil',
  'Investments': 'Investimentos',
  'Automatic investment': 'Investimento Automático',
  'Fixed income': 'Renda Fixa',
  'Mutual funds': 'Fundos de Investimento',
  'Variable income': 'Renda Variável',
  'Margin': 'Margem',
  'Proceeds interests and dividends': 'Rendimentos e Dividendos',
  'Pension': 'Previdência',
  'Same person transfer': 'Transferência Própria',
  'Same person transfer - Cash': 'Transferência Própria - Dinheiro',
  'Same person transfer - PIX': 'Transferência Própria - PIX',
  'Same person transfer - TED': 'Transferência Própria - TED',
  'Transfers': 'Transferências',
  'Transfer - Bank slip (Boleto)': 'Transferência - Boleto',
  'Transfer - Cash': 'Transferência - Dinheiro',
  'Transfer - Check': 'Transferência - Cheque',
  'Transfer - DOC': 'Transferência - DOC',
  'Transfer - Foreign exchange': 'Transferência - Câmbio',
  'Transfer - Internal': 'Transferência Interna',
  'Transfer - PIX': 'Transferência - PIX',
  'Transfer - TED': 'Transferência - TED',
  'Credit card payment': 'Pagamento de Cartão de Crédito',
  'Third-party transfers': 'Transferências para Terceiros',
  'Bank slip': 'Boleto',
  'Debt card': 'Cartão de Débito',
  'Legal obligations': 'Obrigações Legais',
  'Blocked balances': 'Saldos Bloqueados',
  'Alimony': 'Pensão Alimentícia',
  'Services': 'Serviços',
  'Telecommunications': 'Telecomunicações',
  'Internet': 'Internet',
  'Mobile': 'Celular',
  'TV': 'TV',
  'Education': 'Educação',
  'Online Courses': 'Cursos Online',
  'University': 'Universidade',
  'School': 'Escola',
  'Kindergarten': 'Educação Infantil',
  'Wellness and fitness': 'Saúde e Bem-estar',
  'Gyms and fitness centers': 'Academias',
  'Sports practice': 'Esportes',
  'Wellness': 'Bem-estar',
  'Tickets': 'Ingressos',
  'Stadiums and arenas': 'Estádios e Arenas',
  'Landmarks and museums': 'Pontos Turísticos e Museus',
  'Cinema, theater and concerts': 'Cinema, Teatro e Shows',
  'Shopping': 'Compras',
  'Online shopping': 'Compras Online',
  'Electronics': 'Eletrônicos',
  'Pet supplies and vet': 'Pet Shop e Veterinário',
  'Clothing': 'Roupas e Calçados',
  'Kids and toys': 'Infantil e Brinquedos',
  'Bookstore': 'Livraria',
  'Sports goods': 'Artigos Esportivos',
  'Office Supplies': 'Material de Escritório',
  'Cashback': 'Cashback',
  'Digital services': 'Serviços Digitais',
  'Gaming': 'Jogos',
  'Video streaming': 'Streaming de Vídeo',
  'Music streaming': 'Streaming de Música',
  'Groceries': 'Supermercado',
  'Food and drinks': 'Alimentação e Bebidas',
  'Eating out': 'Restaurantes',
  'Food delivery': 'Delivery de Comida',
  'Travel': 'Viagem',
  'Airport and airlines': 'Aeroporto e Companhias Aéreas',
  'Accommodation': 'Hospedagem',
  'Mileage programs': 'Programas de Milhas',
  'Bus tickets': 'Passagens de Ônibus',
  'Donations': 'Doações',
  'Gambling': 'Jogos e Apostas',
  'Lottery': 'Loteria',
  'Online bet': 'Apostas Online',
  'Taxes': 'Impostos',
  'Income taxes': 'Imposto de Renda',
  'Taxes on investments': 'Imposto sobre Investimentos',
  'Tax on financial operations': 'IOF',
  'Bank fees': 'Tarifas Bancárias',
  'Account fees': 'Tarifas de Conta',
  'Wire transfer fees and ATM fees': 'Tarifas de Transferência e Saque',
  'Credit card fees': 'Tarifas de Cartão de Crédito',
  'Housing': 'Moradia',
  'Rent': 'Aluguel',
  'Houseware': 'Artigos do Lar',
  'Urban land and building tax': 'IPTU',
  'Utilities': 'Contas de Consumo',
  'Water': 'Água',
  'Electricity': 'Energia Elétrica',
  'Gas': 'Gás',
  'Healthcare': 'Saúde',
  'Dentist': 'Dentista',
  'Pharmacy': 'Farmácia',
  'Optometry': 'Ótica',
  'Hospital clinics and labs': 'Hospital, Clínicas e Laboratórios',
  'Transportation': 'Transporte',
  'Taxi and ride-hailing': 'Táxi e Aplicativos',
  'Public transportation': 'Transporte Público',
  'Car rental': 'Aluguel de Carro',
  'Bicycle': 'Bicicleta',
  'Automotive': 'Automotivo',
  'Gas stations': 'Postos de Combustível',
  'Parking': 'Estacionamento',
  'Tolls and in-vehicle payment': 'Pedágio e Via Fácil',
  'Vehicle ownership taxes and fees': 'IPVA e Licenciamento',
  'Vehicle maintenance': 'Manutenção de Veículo',
  'Traffic tickets': 'Multas de Trânsito',
  'Insurance': 'Seguros',
  'Life insurance': 'Seguro de Vida',
  'Home Insurance': 'Seguro Residencial',
  'Health insurance': 'Plano de Saúde',
  'Vehicle insurance': 'Seguro de Veículo',
  'Leisure': 'Lazer',
  'Other': 'Outros',
};

function translateCategory(category) {
  if (!category) return null;
  return CATEGORY_PT[category] ?? category;
}

const ACCOUNT_NAME_PT = {
  'Checking Account':  'Conta Corrente',
  'Savings Account':   'Conta Poupança',
  'Credit Card':       'Cartão de Crédito',
  'Salary Account':    'Conta Salário',
  'Payment Account':   'Conta Pagamento',
  'Prepaid Card':      'Cartão Pré-pago',
  'Current Account':   'Conta Corrente',
};

const ACCOUNT_TYPE_PT = {
  'BANK':       'Conta Bancária',
  'CREDIT':     'Cartão de Crédito',
  'LOAN':       'Empréstimo',
  'INVESTMENT': 'Investimento',
};

function translateAccountName(name) {
  if (!name) return name;
  return ACCOUNT_NAME_PT[name] ?? name;
}

function translateAccountType(type) {
  if (!type) return type;
  return ACCOUNT_TYPE_PT[type] ?? type;
}

function extractDateFromDescription(description, referenceDate) {
  if (!description) return null;
  const dmyFull = description.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (dmyFull) {
    const [, d, m, y] = dmyFull;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  const dmyShort = description.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2})(?!\d)/);
  if (dmyShort) {
    const [, d, m, y] = dmyShort;
    const fullYear = parseInt(y) > 50 ? `19${y}` : `20${y}`;
    const date = new Date(`${fullYear}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  const iso = description.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  const dmPartial = description.match(/(\d{2})\/(\d{2})(?!\/|\d)/);
  if (dmPartial && referenceDate) {
    const [, d, m] = dmPartial;
    const y = new Date(referenceDate).getFullYear();
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (!isNaN(date)) return date.toISOString();
  }
  return null;
}

async function fetchPluggy(path, options = {}) {
  const res = await fetch(`${PLUGGY_API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Pluggy API error ${res.status} em ${path}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Pluggy retornou resposta inválida em ${path}: ${text.slice(0, 150)}`);
  }
}

export async function getApiKey() {
  if (_cachedApiKey && Date.now() < _cacheExpiry) return _cachedApiKey;
  const data = await fetchPluggy('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  _cachedApiKey = data.apiKey;
  _cacheExpiry  = Date.now() + 25 * 60 * 1000;
  return _cachedApiKey;
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
        const counterpartyName =
          tx.type === 'DEBIT'
            ? (tx.paymentData?.receiver?.name ?? tx.merchant?.businessName ?? tx.merchant?.name ?? null)
            : (tx.paymentData?.payer?.name ?? null);
        const counterpartyDocument =
          tx.type === 'DEBIT'
            ? (tx.paymentData?.receiver?.documentNumber?.value ?? tx.paymentData?.receiver?.document?.value ?? null)
            : (tx.paymentData?.payer?.documentNumber?.value ?? tx.paymentData?.payer?.document?.value ?? null);
        const transferNumber = account.bankData?.transferNumber || null;
        const number = account.number || null;
        const accountNumber = transferNumber || number || null;
        allTx.push({
          ...tx,
          category: translateCategory(tx.category),
          accountName: translateAccountName(account.name),
          accountType: account.type,
          accountNumber,
          counterpartyName,
          counterpartyDocument,
          dateTransacted: extractDateFromDescription(tx.description, tx.date) ?? tx.creditCardMetadata?.purchaseDate ?? tx.date ?? null,
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

export async function getInvestments(itemId) {
  const apiKey = await getApiKey();
  const results = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await fetchPluggy(
      `/investments?itemId=${itemId}&page=${page}&pageSize=500`,
      { headers: { 'X-API-KEY': apiKey } }
    );
    totalPages = data.totalPages ?? 1;
    results.push(...(data.results ?? []));
    page++;
  }
  return results;
}

export async function getLoanAccounts(itemId) {
  const apiKey = await getApiKey();
  const data = await fetchPluggy(`/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  const LOAN_TYPES = ['LOAN', 'FINANCING', 'CREDIT_CARD', 'MORTGAGE'];
  return (data.results ?? []).filter(a => LOAN_TYPES.includes(a.type) || a.subtype === 'LOAN');
}

export async function deletePluggyItem(itemId) {
  const apiKey = await getApiKey();
  await fetchPluggy(`/items/${itemId}`, {
    method: 'DELETE',
    headers: { 'X-API-KEY': apiKey },
  });
}

export async function updatePluggyItem(itemId) {
  const apiKey = await getApiKey();
  return fetchPluggy(`/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({}),
  });
}

export async function waitForItemUpdate(itemId, { timeoutMs = 25000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await getItem(itemId);
    if (item.status === 'UPDATED' || item.status === 'PARTIAL_SUCCESS') return item;
    if (item.status === 'ERROR' || item.status === 'LOGIN_ERROR') return item;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return await getItem(itemId);
}
