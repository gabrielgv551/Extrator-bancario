'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  RefreshCw,
  AlertCircle,
  FileText,
  Tags,
  Check,
  Loader2,
  Settings,
  X,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { CLASSIFICACOES } from '@/lib/classification';

export default function ClassificarPage({ params }) {
  const { id } = use(params);

  const [client, setClient] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUnclassified, setOnlyUnclassified] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all'); // all | CREDIT | DEBIT
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configDate, setConfigDate] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  // Sugestões do motor de pré-classificação: { [txId]: { l1, l2, confianca, origem } | null }
  const [sugestoes, setSugestoes] = useState({});
  const [loadingSugestoes, setLoadingSugestoes] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState(today);

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);

  const fetchClient = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}`);
    if (res.ok) {
      const data = await res.json();
      setClient(data);
      if (data.classificarDe) setFromDate(String(data.classificarDe).slice(0, 10));
    }
  }, [id]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  const loadSugestoes = async (from, to) => {
    setLoadingSugestoes(true);
    try {
      const res = await fetch(`/api/clients/${id}/sugestoes?from=${from}&to=${to}`);
      const data = await res.json();
      if (res.ok) setSugestoes(data.sugestoes || {});
    } catch {
      // sugestões são opcionais; falha silenciosa
    }
    setLoadingSugestoes(false);
  };

  const fetchTransactions = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch(`/api/clients/${id}/transactions?from=${fromDate}&to=${toDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTransactions(data.transactions);
      loadSugestoes(fromDate, toDate);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setSyncing(false);
  };

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClassification = async (tx, classificacaoL1, classificacaoL2) => {
    setSavingId(tx.id);
    setError('');
    try {
      const res = await fetch(`/api/clients/${id}/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classificacaoL1, classificacaoL2 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === tx.id ? { ...t, classificacaoL1, classificacaoL2 } : t
        )
      );
      setSavedId(tx.id);
      setTimeout(() => setSavedId((cur) => (cur === tx.id ? null : cur)), 1500);
    } catch (e) {
      setError(e.message);
    }
    setSavingId(null);
  };

  const sugerePendente = (tx) => {
    const sug = sugestoes[tx.id];
    if (!sug) return false;
    if (tx.classificacaoL1 === sug.l1 && tx.classificacaoL2 === sug.l2) return false;
    return (CLASSIFICACOES[sug.l1] || []).includes(sug.l2);
  };

  const applyAllSuggestions = async () => {
    const pendentes = filtered.filter(sugerePendente);
    if (!pendentes.length) return;
    if (!confirm(`Aplicar a sugestão em ${pendentes.length} lançamento(s)?`)) return;
    for (const tx of pendentes) {
      const sug = sugestoes[tx.id];
      await saveClassification(tx, sug.l1, sug.l2);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    setError('');
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classificarDe: configDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClient(data);
      setFromDate(data.classificarDe ? String(data.classificarDe).slice(0, 10) : '2026-01-01');
      setShowConfig(false);
      fetchTransactions();
    } catch (e) {
      setError(e.message);
    }
    setSavingConfig(false);
  };

  const classificarDe = client?.classificarDe ? String(client.classificarDe).slice(0, 10) : null;

  const filtered = transactions.filter((tx) => {
    if (classificarDe && (tx.date || '').slice(0, 10) < classificarDe) return false;
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (onlyUnclassified && (tx.classificacaoL1 || tx.classificacaoL2)) return false;
    if (search && !(tx.description || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const classifiedCount = transactions.filter((t) => t.classificacaoL1 && t.classificacaoL2).length;
  const pendentesCount = filtered.filter(sugerePendente).length;

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
            <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Tags className="w-4 h-4 text-violet-600" />
              Classificar — {client.name}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Classifique as receitas e despesas do cliente
            </p>
          </div>
          <button
            onClick={() => { setConfigDate(classificarDe || ''); setShowConfig(true); }}
            className="inline-flex items-center gap-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            title="Configurar data inicial da classificação"
          >
            <Settings className="w-3.5 h-3.5" />
            Configurar
          </button>
          <Link
            href={`/clients/${id}/regras`}
            className="inline-flex items-center gap-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Regras
          </Link>
          <Link
            href={`/clients/${id}`}
            className="inline-flex items-center gap-1.5 text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Ver Extrato
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Período e Filtros</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">De</label>
              <input
                type="date"
                value={fromDate}
                min={classificarDe || undefined}
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
              {syncing ? 'Buscando...' : 'Buscar'}
            </button>
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar descrição..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border border-gray-300 rounded-lg pl-3 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Todos os tipos</option>
              <option value="CREDIT">Entradas</option>
              <option value="DEBIT">Saídas</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyUnclassified}
                onChange={(e) => setOnlyUnclassified(e.target.checked)}
                className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Só não classificadas
            </label>
          </div>
        </div>

        {/* Table */}
        {transactions.length === 0 && !syncing ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <Tags className="w-10 h-10 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Nenhuma transação no período</p>
            <p className="text-gray-400 text-sm mt-1">
              Ajuste o período e clique em &quot;Buscar&quot;
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">
                {filtered.length} transações
                {classifiedCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-violet-600">
                    {classifiedCount} classificadas
                  </span>
                )}
              </p>
              {pendentesCount > 0 && (
                <button
                  onClick={applyAllSuggestions}
                  disabled={savingId !== null}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Aplicar {pendentesCount} sugestão(ões)
                </button>
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
                    <th className="px-4 py-3 font-semibold text-gray-600">Banco</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Categoria Klavi</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Sugestão</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => {
                    const sug = sugestoes[tx.id];
                    const sugValida = sug && (CLASSIFICACOES[sug.l1] || []).includes(sug.l2);
                    const jaAplicada = sugValida && tx.classificacaoL1 === sug.l1 && tx.classificacaoL2 === sug.l2;
                    return (
                      <tr
                        key={tx.id}
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
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {tx.institutionName || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                          {tx.categoryL2 || tx.categoryL1 || '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {sugValida ? (
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium"
                                title={`Origem da sugestão: ${sug.origem}`}
                              >
                                <Sparkles className="w-3 h-3" />
                                {sug.l1} › {sug.l2}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {Math.round((sug.confianca || 0) * 100)}%
                              </span>
                              {!jaAplicada && (
                                <button
                                  onClick={() => saveClassification(tx, sug.l1, sug.l2)}
                                  disabled={savingId === tx.id}
                                  className="text-xs text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                                >
                                  Aplicar
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">
                              {loadingSugestoes ? '...' : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={tx.classificacaoL1 || ''}
                              disabled={savingId === tx.id}
                              onChange={(e) => {
                                const l1 = e.target.value || null;
                                saveClassification(tx, l1, null);
                              }}
                              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                            >
                              <option value="">—</option>
                              {Object.keys(CLASSIFICACOES).map((grupo) => (
                                <option key={grupo} value={grupo}>
                                  {grupo}
                                </option>
                              ))}
                            </select>
                            <select
                              value={tx.classificacaoL2 || ''}
                              disabled={savingId === tx.id || !tx.classificacaoL1}
                              onChange={(e) => {
                                const l2 = e.target.value || null;
                                saveClassification(tx, tx.classificacaoL1, l2);
                              }}
                              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white disabled:opacity-50"
                            >
                              <option value="">—</option>
                              {(CLASSIFICACOES[tx.classificacaoL1] || []).map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                            {savingId === tx.id ? (
                              <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                            ) : savedId === tx.id ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-gray-400">
                        Nenhuma transação corresponde aos filtros
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Configurar data inicial */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-500" />
                Configuração
              </h2>
              <button
                onClick={() => setShowConfig(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Classificar a partir de
            </label>
            <input
              type="date"
              value={configDate}
              onChange={(e) => setConfigDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-2"
            />
            <p className="text-xs text-gray-400 mb-5">
              Só serão exibidas para classificação as transações a partir desta data.
              Deixe em branco para não ter limite.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {savingConfig && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {savingConfig ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
