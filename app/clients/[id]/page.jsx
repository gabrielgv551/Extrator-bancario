'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Link2,
  RefreshCw,
  Download,
  WifiOff,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Building2,
  Copy,
  Check,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';

export default function ClientPage({ params }) {
  const { id } = use(params);

  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [diagnostics, setDiagnostics] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');
  const [widgetReady, setWidgetReady] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(false);
  const [empresaInput, setEmpresaInput] = useState('');
  const [savingEmpresa, setSavingEmpresa] = useState(false);
  const [gestorCompanies, setGestorCompanies] = useState([]);

  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState('2026-01-01');
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
    const clientRes = await fetch(`/api/clients/${id}`);
    if (clientRes.ok) {
      const data = await clientRes.json();
      setClient(data);
      setEmpresaInput(data.gestorEmpresa ?? '');
      const portalRes = await fetch(`/api/portal/${data.portalToken}`);
      if (portalRes.ok) {
        const portalData = await portalRes.json();
        setItems(portalData.items);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetch('/api/gestor-companies')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setGestorCompanies(data))
      .catch(() => {});
  }, []);

  const saveGestorEmpresa = async () => {
    setSavingEmpresa(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gestorEmpresa: empresaInput.trim() || null }),
      });
      if (res.ok) {
        const data = await res.json();
        setClient(data);
        setEditingEmpresa(false);
      }
    } finally {
      setSavingEmpresa(false);
    }
  };

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  const fetchTransactions = async () => {
    if (items.length === 0) return;
    setSyncing(true);
    setError('');
    try {
      const res = await fetch(
        `/api/clients/${id}/transactions?from=${fromDate}&to=${toDate}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTransactions(data.transactions);
      setDiagnostics(data.diagnostics ?? []);
      fetchClient();
    } catch (e) {
      setError(e.message);
    }
    setSyncing(false);
  };

  const refreshConnections = async (itemId = null) => {
    if (items.length === 0) return;
    setRefreshing(true);
    setError('');
    try {
      const url = itemId
        ? `/api/clients/${id}/refresh?itemId=${itemId}`
        : `/api/clients/${id}/refresh`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const failures = data.results?.filter(r => !r.success) || [];
      if (failures.length > 0) {
        const msgs = failures.map(f => `${f.bank}: ${f.reason}`).join('; ');
        setError(`Algumas conexões não foram atualizadas: ${msgs}`);
      }
      await fetchClient();
      await fetchTransactions();
    } catch (e) {
      setError(e.message);
    }
    setRefreshing(false);
  };

  const connectBank = async () => {
    if (!widgetReady) return setError('Widget ainda carregando, aguarde...');
    if (!client?.portalToken) return setError('Token do portal não disponível.');
    setConnecting(true);
    setError('');
    try {
      const res = await fetch(`/api/portal/${client.portalToken}/connect-token`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const pluggyConnect = new window.PluggyConnect({
        connectToken: data.token,
        onSuccess: async (itemData) => {
          await fetch(`/api/portal/${client.portalToken}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluggyItemId: itemData.item.id }),
          });
          await fetchClient();
          setConnecting(false);
        },
        onError: (err) => { setError(`Erro: ${JSON.stringify(err)}`); setConnecting(false); },
        onClose: () => setConnecting(false),
      });
      pluggyConnect.init();
    } catch (e) {
      setError(e.message);
      setConnecting(false);
    }
  };

  const removeBank = async (itemId, name) => {
    if (!confirm(`Desconectar "${name}"?`)) return;
    setRemovingId(itemId);
    await fetch(`/api/portal/${client.portalToken}/items/${itemId}`, { method: 'DELETE' });
    await fetchClient();
    setRemovingId(null);
  };

  const copyPortalLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/portal/${client.portalToken}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const exportCSV = () => {
    if (items.length === 0) return;
    window.location.href = `/api/clients/${id}/export?from=${fromDate}&to=${toDate}`;
  };

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);

  const getItemStatus = (item) => {
    if (item.requiresReconnect || item.status === 'LOGIN_ERROR') {
      return { label: 'Reconectar', color: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', requiresAction: true };
    }
    if (item.status === 'OUTDATED' || item.status === 'ERROR') {
      return { label: 'Erro', color: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', requiresAction: true };
    }
    if (item.status === 'UPDATED' || item.status === 'PARTIAL_SUCCESS') {
      return { label: 'Atualizado', color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', requiresAction: false };
    }
    if (item.status === 'UPDATING') {
      return { label: 'Sincronizando', color: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50', requiresAction: false };
    }
    return { label: 'Pendente', color: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', requiresAction: false };
  };

  const summary = transactions.reduce(
    (acc, tx) => {
      const amount = Number(tx.amount);
      if (Number.isNaN(amount)) return acc;
      if (tx.type === 'CREDIT') acc.entradas += amount;
      else acc.saidas += Math.abs(amount);
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
            <div className="flex items-center gap-1.5 mt-0.5">
              {editingEmpresa ? (
                <>
                  <select
                    autoFocus
                    value={empresaInput}
                    onChange={(e) => setEmpresaInput(e.target.value)}
                    className="text-xs border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— sem vínculo —</option>
                    {gestorCompanies.map((c) => (
                      <option key={c.slug} value={c.slug}>{c.name} ({c.slug})</option>
                    ))}
                  </select>
                  <button onClick={saveGestorEmpresa} disabled={savingEmpresa} className="text-green-600 hover:text-green-700 p-0.5">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingEmpresa(false)} className="text-gray-400 hover:text-gray-600 p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setEmpresaInput(client.gestorEmpresa ?? ''); setEditingEmpresa(true); }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors group"
                  title="Vincular ao Have Gestor"
                >
                  <span className={client.gestorEmpresa ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                    {client.gestorEmpresa ? `gestor: ${client.gestorEmpresa}` : 'Vincular ao Gestor...'}
                  </span>
                  <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyPortalLink}
              className="inline-flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={copiedLink ? { background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' } : { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
            >
              {copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedLink ? 'Copiado!' : 'Link do Portal'}
            </button>
            <button
              onClick={connectBank}
              disabled={connecting || !widgetReady}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Link2 className="w-4 h-4" />
              {connecting ? 'Abrindo...' : 'Conectar Banco'}
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

        {/* Connected banks list */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Bancos conectados ({items.length})</p>
          </div>
          {items.length === 0 ? (
            <div className="p-8 text-center">
              <WifiOff className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Nenhum banco conectado. Clique em &quot;Conectar Banco&quot; ou compartilhe o link do portal.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((item) => {
                const s = getItemStatus(item);
                return (
                  <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                    {item.institutionLogo ? (
                      <img src={item.institutionLogo} alt={item.institutionName} className="w-8 h-8 rounded-lg object-contain border border-gray-100 p-0.5" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center"><Building2 className="w-4 h-4 text-blue-600" /></div>
                    )}
                    <span className="flex-1 text-sm font-medium text-gray-900">
                      {item.institutionName}
                      {item.accountNumbers && (
                        <span className="ml-2 text-xs font-normal text-gray-400">Conta: {item.accountNumbers}</span>
                      )}
                    </span>
                    <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.color}`}></span>
                      {s.label}
                    </span>
                    <button
                      onClick={() => refreshConnections(item.id)}
                      disabled={refreshing}
                      className="text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition-colors"
                      title="Atualizar esta conexão"
                    >
                      <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => removeBank(item.id, item.institutionName)} disabled={removingId === item.id} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <>
            {/* Diagnostics */}
            {diagnostics.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-700">Status das contas</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {diagnostics.map((d, i) => {
                    const ok = d.status === 'UPDATED' || d.status === 'PARTIAL_SUCCESS';
                    const error = d.status === 'LOGIN_ERROR' || d.status === 'ERROR' || d.status === 'OUTDATED' || d.requiresReconnect;
                    const statusColor = ok ? 'bg-green-100 text-green-700' : error ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700';
                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 px-5 py-3 text-sm">
                        <div className="flex items-center gap-3 flex-1">
                          <span className="font-medium text-gray-800">{d.bank}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>{d.status}</span>
                        </div>
                        {ok && d.accounts > 0 && (
                          <span className="text-gray-500 text-xs">
                            {d.transactions} transações · {d.accounts} conta(s)
                            {d.lastUpdatedAt && (
                              <> · dados de {new Date(d.lastUpdatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>
                            )}
                          </span>
                        )}
                        {ok && d.accounts === 0 && (
                          <span className="text-orange-600 text-xs">
                            Nenhuma conta bancária encontrada na Pluggy
                            {d.loanAccountsFound?.length > 0 && <> · {d.loanAccountsFound.length} empréstimo(s)</>}
                            {d.connectorProducts?.length > 0 && <> · produtos: {d.connectorProducts.join(', ')}</>}
                            {d.lastUpdatedAt && (
                              <> · dados de {new Date(d.lastUpdatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>
                            )}
                          </span>
                        )}
                        {error && (
                          <span className="text-red-600 text-xs">
                            {d.requiresReconnect
                              ? 'Credenciais inválidas ou consentimento revogado. Clique em "Reconectar" no portal.'
                              : d.status === 'OUTDATED'
                                ? 'Dados desatualizados. A Pluggy tentará novamente automaticamente.'
                                : `Erro: ${d.errorMessage || d.errorCode || 'falha na sincronização'}`}
                            {d.lastUpdatedAt && (
                              <> · último dado: {new Date(d.lastUpdatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
                <button
                  onClick={() => refreshConnections()}
                  disabled={refreshing}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Atualizando...' : 'Atualizar Conexões'}
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
                        <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Data Transação</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Descrição</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Tipo</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Valor</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Saldo</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Categoria</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Conta</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Agência/Número</th>
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
                          <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                            {tx.dateTransacted ? formatDate(tx.dateTransacted) : '—'}
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
                          <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                            {tx.accountNumber || '—'}
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
