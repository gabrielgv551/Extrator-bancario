'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LogOut, Search, Filter, ChevronLeft, ChevronRight, RefreshCw, Server } from 'lucide-react';

const METHOD_STYLES = {
  GET: 'bg-blue-100 text-blue-700 border-blue-200',
  POST: 'bg-green-100 text-green-700 border-green-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_STYLES = {
  ok: 'bg-green-100 text-green-700 border-green-200',
  error: 'bg-red-100 text-red-700 border-red-200',
  warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

export default function KlaviLogsPage() {
  const router = useRouter();
  const [empresa, setEmpresa] = useState('');
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(new Set());
  const [filters, setFilters] = useState({
    clientId: '',
    itemId: '',
    linkId: '',
    consentId: '',
    personalTaxId: '',
    businessTaxId: '',
    institutionCode: '',
    method: '',
    path: '',
    status: '',
    source: '',
    from: '',
    to: '',
  });
  const limit = 50;

  const fetchLogs = useCallback(async ({ resetOffset = false } = {}) => {
    if (!empresa.trim()) {
      setError('Informe a empresa no header x-extrator-empresa');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(resetOffset ? 0 : offset));
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      params.set('empresa', empresa.trim());
      const res = await fetch(`/api/debug/klavi-request-logs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      if (resetOffset) setOffset(0);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [empresa, filters, offset]);

  useEffect(() => {
    // Carrega empresa salva no localStorage, se houver.
    const saved = localStorage.getItem('extrator_empresa');
    if (saved) setEmpresa(saved);
  }, []);

  useEffect(() => {
    if (empresa) {
      localStorage.setItem('extrator_empresa', empresa);
      fetchLogs({ resetOffset: true });
    }
  }, [empresa]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/login');
  };

  const formatDate = (iso) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';

  const statusType = (status) => {
    if (!status) return 'warning';
    if (status >= 200 && status < 300) return 'ok';
    if (status >= 400) return 'error';
    return 'warning';
  };

  const toggleExpand = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const applyFilters = () => fetchLogs({ resetOffset: true });
  const clearFilters = () => {
    setFilters({
      clientId: '', itemId: '', linkId: '', consentId: '', personalTaxId: '', businessTaxId: '',
      institutionCode: '', method: '', path: '', status: '', source: '', from: '', to: '',
    });
    setOffset(0);
  };

  const goPage = (delta) => {
    const next = Math.max(0, offset + delta * limit);
    if (next > total) return;
    setOffset(next);
  };

  useEffect(() => {
    if (empresa) fetchLogs();
  }, [offset]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Server className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Extrator Bancário</h1>
              <p className="text-xs text-gray-400">Admin Geral · Logs de requisições Klavi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-600 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Link>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-gray-500 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Logs de requisições Klavi</h2>
            <p className="text-sm text-gray-500">POST, GET e DELETE feitos para a API Klavi por empresa</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Empresa (slug)"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={applyFilters}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 text-center text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtros</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { key: 'linkId', placeholder: 'linkId' },
              { key: 'consentId', placeholder: 'consentId' },
              { key: 'clientId', placeholder: 'clientId' },
              { key: 'itemId', placeholder: 'itemId' },
              { key: 'personalTaxId', placeholder: 'CPF' },
              { key: 'businessTaxId', placeholder: 'CNPJ' },
              { key: 'institutionCode', placeholder: 'Código banco' },
              { key: 'path', placeholder: 'Path (ex: /consents)' },
              { key: 'status', placeholder: 'HTTP status' },
              { key: 'source', placeholder: 'source' },
              { key: 'from', placeholder: 'De (ISO)' },
              { key: 'to', placeholder: 'Até (ISO)' },
            ].map(({ key, placeholder }) => (
              <input
                key={key}
                type="text"
                placeholder={placeholder}
                value={filters[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            ))}
            <select
              value={filters.method}
              onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Método</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={clearFilters}
              className="text-gray-600 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Limpar
            </button>
            <button
              onClick={applyFilters}
              className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              <Search className="w-4 h-4" />
              Filtrar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {total} registro{total !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goPage(-1)}
              disabled={offset === 0 || loading}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600">
              Página {Math.floor(offset / limit) + 1} de {Math.max(1, Math.ceil(total / limit))}
            </span>
            <button
              onClick={() => goPage(1)}
              disabled={offset + limit >= total || loading}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600">Horário</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Método</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Path</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Duração</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Source</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">IDs</th>
                  <th className="px-4 py-3 font-semibold text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400">
                      Carregando logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400">
                      Nenhum log encontrado.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <Fragment key={log.id}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {formatDate(log.requestedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              METHOD_STYLES[log.method] || 'bg-gray-100 text-gray-700 border-gray-200'
                            }`}
                          >
                            {log.method}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{log.path}</td>
                        <td className="px-4 py-3">
                          {log.responseStatus ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                STATUS_STYLES[statusType(log.responseStatus)]
                              }`}
                            >
                              {log.responseStatus}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{log.durationMs != null ? `${log.durationMs}ms` : '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{log.source || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {log.linkId && <div className="truncate max-w-[120px]" title={log.linkId}>link: {log.linkId}</div>}
                          {log.consentId && <div className="truncate max-w-[120px]" title={log.consentId}>consent: {log.consentId}</div>}
                          {log.institutionCode && <div>inst: {log.institutionCode}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          >
                            {expanded.has(log.id) ? 'Ocultar' : 'Ver'}
                          </button>
                        </td>
                      </tr>
                      {expanded.has(log.id) && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              <div>
                                <h4 className="font-semibold text-gray-700 mb-1">Query</h4>
                                <pre className="bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-60">
                                  {JSON.stringify(log.query, null, 2) || '—'}
                                </pre>
                              </div>
                              <div>
                                <h4 className="font-semibold text-gray-700 mb-1">Request Body</h4>
                                <pre className="bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-60">
                                  {JSON.stringify(log.requestBody, null, 2) || '—'}
                                </pre>
                              </div>
                              <div className="md:col-span-2">
                                <h4 className="font-semibold text-gray-700 mb-1">Response Body</h4>
                                <pre className="bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-96">
                                  {JSON.stringify(log.responseBody, null, 2) || '—'}
                                </pre>
                              </div>
                              {log.errorMessage && (
                                <div className="md:col-span-2">
                                  <h4 className="font-semibold text-red-700 mb-1">Erro</h4>
                                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">
                                    {log.errorMessage}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
