'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Building2, ArrowLeft, LogOut } from 'lucide-react';

export default function AccountsListPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchAccounts() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin/accounts');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
        setAccounts(data.accounts || []);
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    }
    fetchAccounts();
  }, []);

  const filteredAccounts = accounts.filter((a) => {
    const term = search.toLowerCase();
    return (
      (a.empresaNome || '').toLowerCase().includes(term) ||
      (a.clientName || '').toLowerCase().includes(term) ||
      (a.bank || '').toLowerCase().includes(term) ||
      (a.status || '').toLowerCase().includes(term) ||
      (a.rawStatus || '').toLowerCase().includes(term) ||
      (a.executionStatus || '').toLowerCase().includes(term) ||
      (a.errorCode || '').toLowerCase().includes(term)
    );
  });

  const statusStyles = {
    error: 'bg-red-100 text-red-700 border-red-200',
    updating: 'bg-blue-100 text-blue-700 border-blue-200',
    ok: 'bg-green-100 text-green-700 border-green-200',
    warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    waiting: 'bg-purple-100 text-purple-700 border-purple-200',
    empty: 'bg-gray-100 text-gray-600 border-gray-200',
    unknown: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  const formatDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Extrator Bancário</h1>
              <p className="text-xs text-gray-400">Admin Geral · Lista de contas</p>
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Lista de contas</h2>
            <p className="text-sm text-gray-500">Todas as empresas, clientes e conexões bancárias</p>
          </div>
          <p className="text-sm text-gray-500">
            {filteredAccounts.length} conta{filteredAccounts.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar empresa, cliente, banco ou status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="p-4 text-center text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left">
                <th className="px-5 py-3 font-semibold text-gray-600">Empresa</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Cliente</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Banco</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Status da Conexão</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Situação</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Última Sync</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    Carregando contas...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    {search ? 'Nenhuma conta encontrada' : 'Nenhuma conta cadastrada.'}
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((account, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-900 font-medium">{account.empresaNome}</td>
                    <td className="px-5 py-3 text-gray-700">{account.clientName}</td>
                    <td className="px-5 py-3 text-gray-700">{account.bank}</td>
                    <td className="px-5 py-3 text-gray-700 text-xs">
                      <div className="font-medium">{account.rawStatus}</div>
                      {account.executionStatus && account.executionStatus !== account.rawStatus && (
                        <div className="text-gray-500">{account.executionStatus}</div>
                      )}
                      {account.errorCode && (
                        <div className="text-red-600 mt-0.5">{account.errorCode}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          statusStyles[account.statusType] || statusStyles.unknown
                        }`}
                      >
                        {account.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDate(account.lastSync)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
