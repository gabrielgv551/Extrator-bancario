'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Link2,
  RefreshCw,
  Download,
  Wifi,
  WifiOff,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from 'lucide-react';

export default function ClientPage({ params }) {
  const { id } = use(params);

  const [client, setClient] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [widgetReady, setWidgetReady] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(ninetyDaysAgo);
  const [toDate, setToDate] = useState(today);

  useEffect(() => {
    if (document.querySelector('[data-pluggy-widget]')) {
      setWidgetReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.1.0/pluggy-connect.js';
    script.setAttribute('data-pluggy-widget', 'true');
    script.onload = () => setWidgetReady(true);
    script.onerror = () => setError('Falha ao carregar o widget da Pluggy. Verifique sua conexão.');
    document.head.appendChild(script);
  }, []);

  const fetchClient = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}`);
    if (res.ok) setClient(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  const fetchTransactions = async () => {
    if (!client?.itemId) return;
    setSyncing(true);
    setError('');
    try {
      const res = await fetch(
        `/api/clients/${id}/transactions?from=${fromDate}&to=${toDate}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTransactions(data.transactions);
      fetchClient();
    } catch (e) {
      setError(e.message);
    }
    setSyncing(false);
  };

  const connectBank = async () => {
    if (!widgetReady) return setError('Widget ainda carregando, aguarde...');
    setConnecting(true);
    setError('');
    try {
      const res = await fetch('/api/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientUserId: client.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const pluggyConnect = new window.PluggyConnect({
        connectToken: data.token,
        onSuccess: async (itemData) => {
          const itemId = itemData.item.id;
          await fetch(`/api/clients/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId }),
          });
          await fetchClient();
          setConnecting(false);
        },
        onError: (err) => {
          setError(`Erro na conexão: ${JSON.stringify(err)}`);
          setConnecting(false);
        },
        onClose: () => setConnecting(false),
      });
      pluggyConnect.init();
    } catch (e) {
      setError(e.message);
      setConnecting(false);
    }
  };

  const exportCSV = () => {
    if (!client?.itemId) return;
    window.location.href = `/api/clients/${id}/export?from=${fromDate}&to=${toDate}`;
  };

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);

  const summary = transactions.reduce(
    (acc, tx) => {
      if (tx.type === 'CREDIT') acc.entradas += tx.amount;
      else acc.saidas += Math.abs(tx.amount);
      return acc;
    },
    { entradas: 0, saidas: 0 }
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 font-medium">Cliente não encontrado.</p>
          <Link href="/" className="text-blue-600 text-sm mt-2 inline-block hover:underline">
            Voltar ao início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-700 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-900 leading-tight">{client.name}</h1>
            <p className="text-xs text-gray-400">Extrato Bancário</p>
          </div>
          <div className="flex items-center gap-3">
            {client.itemId ? (
              <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-medium">
                <Wifi className="w-3 h-3" />
                Conectado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-xs font-medium">
                <WifiOff className="w-3 h-3" />
                Não conectado
              </span>
            )}
            <button
              onClick={connectBank}
              disabled={connecting || !widgetReady}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Link2 className="w-4 h-4" />
              {connecting ? 'Abrindo...' : client.itemId ? 'Reconectar Banco' : 'Conectar Banco'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Prompt to connect */}
        {!client.itemId && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <WifiOff className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-700 font-semibold text-lg">Conta bancária não conectada</p>
            <p className="text-gray-400 text-sm mt-2 mb-6">
              Clique em &quot;Conectar Banco&quot; no topo para vincular a conta deste cliente via Pluggy.
            </p>
            <button
              onClick={connectBank}
              disabled={connecting || !widgetReady}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Link2 className="w-4 h-4" />
              {connecting ? 'Abrindo...' : 'Conectar Banco'}
            </button>
          </div>
        )}

        {client.itemId && (
          <>
            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Período do Extrato</h2>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">De</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Até</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={fetchTransactions}
                  disabled={syncing}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Buscando...' : 'Buscar Extrato'}
                </button>
                {transactions.length > 0 && (
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Exportar CSV
                  </button>
                )}
              </div>
            </div>

            {/* Summary Cards */}
            {transactions.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    label: 'Total de Entradas',
                    value: formatCurrency(summary.entradas),
                    icon: TrendingUp,
                    bg: 'bg-green-100',
                    fg: 'text-green-600',
                    text: 'text-green-700',
                  },
                  {
                    label: 'Total de Saídas',
                    value: formatCurrency(summary.saidas),
                    icon: TrendingDown,
                    bg: 'bg-red-100',
                    fg: 'text-red-600',
                    text: 'text-red-700',
                  },
                  {
                    label: 'Saldo do Período',
                    value: formatCurrency(summary.entradas - summary.saidas),
                    icon: DollarSign,
                    bg: summary.entradas >= summary.saidas ? 'bg-blue-100' : 'bg-orange-100',
                    fg: summary.entradas >= summary.saidas ? 'text-blue-600' : 'text-orange-600',
                    text: summary.entradas >= summary.saidas ? 'text-blue-700' : 'text-orange-700',
                  },
                ].map(({ label, value, icon: Icon, bg, fg, text }) => (
                  <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                      <Icon className={`w-5 h-5 ${fg}`} />
                    </div>
                    <p className={`text-xl font-bold ${text}`}>{value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Transactions Table */}
            {transactions.length === 0 && !syncing ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
                <RefreshCw className="w-10 h-10 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 font-medium">Nenhuma transação carregada</p>
                <p className="text-gray-400 text-sm mt-1">
                  Selecione o período e clique em &quot;Buscar Extrato&quot;
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    {transactions.length} transações
                  </p>
                  {client.lastSync && (
                    <p className="text-xs text-gray-400">
                      Última sync: {new Date(client.lastSync).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left">
                        <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Data</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Descrição</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Tipo</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Valor</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Saldo</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Categoria</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Conta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, idx) => (
                        <tr
                          key={tx.id || idx}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                            {formatDate(tx.date)}
                          </td>
                          <td className="px-4 py-2.5 text-gray-900 max-w-xs">
                            <span className="block truncate" title={tx.description}>
                              {tx.description}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                tx.type === 'CREDIT'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {tx.type === 'CREDIT' ? 'Entrada' : 'Saída'}
                            </span>
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                              tx.type === 'CREDIT' ? 'text-green-700' : 'text-red-700'
                            }`}
                          >
                            {tx.type === 'CREDIT' ? '+' : '-'}
                            {formatCurrency(Math.abs(tx.amount))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500 whitespace-nowrap text-xs">
                            {tx.balance != null ? formatCurrency(tx.balance) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{tx.category || '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                            {tx.accountName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
