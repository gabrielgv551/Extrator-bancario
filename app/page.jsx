'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  Wifi,
  WifiOff,
  RefreshCw,
  Plus,
  Search,
  Trash2,
  FileText,
  X,
  Building2,
  Copy,
  Check,
  LogOut,
  AlertCircle,
} from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [currentEmpresa, setCurrentEmpresa] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loadingMode, setLoadingMode] = useState(true);
  const [newCompanySlug, setNewCompanySlug] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCnpj, setNewCnpj] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [fetchError, setFetchError] = useState('');

  const fetchMe = async () => {
    try {
      const res = await fetch('/api/admin/me');
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login');
        }
        return;
      }
      setMode(data.mode);
      setCurrentEmpresa(data.empresa);
      if (data.companies) setCompanies(data.companies);
    } finally {
      setLoadingMode(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const selectCompany = async (slug) => {
    const res = await fetch('/api/admin/select-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa: slug }),
    });
    if (res.ok) {
      router.refresh();
      window.location.reload();
    }
  };

  const resetCompany = async (slug) => {
    if (!confirm(`Isso vai apagar TODO o banco da empresa "${slug}" e recriar o schema. Continuar?`)) return;
    const res = await fetch(`/api/admin/companies/${encodeURIComponent(slug)}/reset`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Banco da empresa "${slug}" recriado com sucesso.`);
    } else {
      alert(data.error || 'Erro ao resetar empresa');
    }
  };

  const createCompany = async (e) => {
    e.preventDefault();
    if (!newCompanySlug.trim()) return;
    setCreatingCompany(true);
    const res = await fetch('/api/admin/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: newCompanySlug, name: newCompanyName }),
    });
    const data = await res.json();
    if (res.ok) {
      setCompanies((prev) => [...prev, { slug: data.slug, name: data.name }]);
      setNewCompanySlug('');
      setNewCompanyName('');
    } else {
      alert(data.error || 'Erro ao criar empresa');
    }
    setCreatingCompany(false);
  };

  const fetchClients = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      setClients(data);
    } catch (e) {
      setFetchError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: clients.length,
    synced: clients.filter((c) => c.lastSync).length,
    needsReconnect: clients.filter((c) => c.items?.some((i) => i.requiresReconnect || i.status === 'LOGIN_ERROR')).length,
  };

  const getClientStatus = (client) => {
    const needs = client.items?.some((i) => i.requiresReconnect || i.status === 'LOGIN_ERROR');
    if (needs) return { label: 'Reconectar', className: 'bg-red-100 text-red-700 border-red-200' };
    const hasItems = client.items && client.items.length > 0;
    if (!hasItems) return { label: 'Sem banco', className: 'bg-gray-100 text-gray-600 border-gray-200' };
    return { label: 'OK', className: 'bg-green-100 text-green-700 border-green-200' };
  };

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/login');
  };

  const copyPortalLink = (client) => {
    const url = `${window.location.origin}/portal/${client.portalToken}`;
    navigator.clipboard.writeText(url);
    setCopiedId(client.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const createClient = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const rawCnpj = newCnpj.replace(/\D/g, '');
    if (rawCnpj && rawCnpj.length !== 14) {
      alert('CNPJ inválido. Digite 14 dígitos ou deixe em branco.');
      return;
    }
    setCreating(true);
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, businessTaxId: rawCnpj || undefined }),
    });
    if (res.ok) {
      setNewName('');
      setNewCnpj('');
      setShowModal(false);
      fetchClients();
    }
    setCreating(false);
  };

  const deleteClient = async (id, name) => {
    if (!confirm(`Excluir o cliente "${name}"? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/clients/${id}`, { method: 'DELETE' });
    fetchClients();
  };

  const formatDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

  if (loadingMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Carregando...</p>
      </div>
    );
  }

  if (mode === 'geral') {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-gray-900 leading-tight">Extrator Bancário</h1>
                <p className="text-xs text-gray-400">Admin Geral</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-gray-500 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Empresas cadastradas</h2>
          {companies.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {companies.map((c) => (
                <div key={c.slug} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => resetCompany(c.slug)}
                      className="text-sm text-orange-600 border border-orange-200 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
                      title="Recria o banco (apaga dados)"
                    >
                      Resetar
                    </button>
                    <button
                      onClick={() => selectCompany(c.slug)}
                      className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Entrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Criar nova empresa</h2>
            <form onSubmit={createCompany} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={newCompanySlug}
                  onChange={(e) => setNewCompanySlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="Ex: nova-empresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="Ex: Nova Empresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={creatingCompany || !newCompanySlug.trim()}
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {creatingCompany ? 'Criando...' : 'Criar empresa'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Extrator Bancário</h1>
              <p className="text-xs text-gray-400">Open Finance · Klavi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectCompany('__geral__')}
              className="flex items-center gap-2 text-gray-600 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              title="Trocar empresa"
            >
              <Building2 className="w-4 h-4" />
              {currentEmpresa || 'Trocar empresa'}
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo Cliente
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-gray-500 border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Error */}
        {fetchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
            <span className="font-semibold">Erro ao carregar clientes:</span>
            <span>{fetchError}</span>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total de Clientes', value: stats.total, icon: Users, bg: 'bg-blue-100', fg: 'text-blue-600' },
            { label: 'Já Sincronizados', value: stats.synced, icon: RefreshCw, bg: 'bg-purple-100', fg: 'text-purple-600' },
            { label: 'Precisam Reconectar', value: stats.needsReconnect, icon: AlertCircle, bg: 'bg-red-100', fg: 'text-red-600' },
          ].map(({ label, value, icon: Icon, bg, fg }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${fg}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-5 py-3 font-semibold text-gray-600">Cliente</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Link do Portal</th>
                <th className="px-5 py-3 font-semibold text-gray-600">Última Sync</th>
                <th className="px-5 py-3 font-semibold text-gray-600 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    Carregando clientes...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda. Clique em "Novo Cliente" para começar.'}
                  </td>
                </tr>
              ) : (
                filtered.map((client) => {
                  const status = getClientStatus(client);
                  return (
                  <tr
                    key={client.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-5 py-3.5 font-medium text-gray-900">{client.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${status.className}`}>
                        {stats.needsReconnect > 0 && (client.items?.some((i) => i.requiresReconnect || i.status === 'LOGIN_ERROR')) && <AlertCircle className="w-3 h-3" />}
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => copyPortalLink(client)}
                        className="inline-flex items-center gap-1.5 text-xs border px-2.5 py-1 rounded-full font-medium transition-colors"
                        style={copiedId === client.id
                          ? { background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' }
                          : { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
                      >
                        {copiedId === client.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedId === client.id ? 'Copiado!' : 'Copiar link'}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{formatDate(client.lastSync)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/clients/${client.id}`}
                          className="inline-flex items-center gap-1.5 text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Ver Extrato
                        </Link>
                        <button
                          onClick={() => deleteClient(client.id, client.name)}
                          className="inline-flex items-center gap-1.5 text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal: Novo Cliente */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Novo Cliente</h2>
              <button
                onClick={() => { setShowModal(false); setNewName(''); }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={createClient}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome do cliente
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: João Silva"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                autoFocus
              />
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CNPJ <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={newCnpj}
                onChange={(e) => setNewCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setNewName(''); setNewCnpj(''); }}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Criando...' : 'Criar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
