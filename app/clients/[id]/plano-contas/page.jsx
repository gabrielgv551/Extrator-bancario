'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  AlertCircle,
  FileText,
  ListTree,
  Plus,
  Pencil,
  Trash2,
  Check,
  Loader2,
  X,
} from 'lucide-react';

export default function PlanoContasPage({ params }) {
  const { id } = use(params);

  const [client, setClient] = useState(null);
  const [plano, setPlano] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  // Modal de criação/edição
  const [modal, setModal] = useState(null); // { mode: 'create-group'|'create-account'|'edit', grupo?, conta? }
  const [modalNome, setModalNome] = useState('');

  const fetchClient = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}`);
    if (res.ok) {
      const data = await res.json();
      setClient(data);
    }
  }, [id]);

  const fetchPlano = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}/plano-contas`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setPlano(data.plano);
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        await fetchClient();
        await fetchPlano();
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, [fetchClient, fetchPlano]);

  const grupos = plano.filter((p) => !p.parentId);
  const contasDe = (grupoId) => plano.filter((p) => p.parentId === grupoId);

  const flashSaved = (contaId) => {
    setSavedId(contaId);
    setTimeout(() => setSavedId((cur) => (cur === contaId ? null : cur)), 1500);
  };

  const openModal = (mode, grupo = null, conta = null) => {
    setModal({ mode, grupo, conta });
    setModalNome(conta?.nome || '');
  };

  const saveModal = async () => {
    if (!modalNome.trim()) return;
    setSavingId(modal.conta?.id || modal.grupo?.id || 'new');
    setError('');
    try {
      let res;
      if (modal.mode === 'create-group') {
        res = await fetch(`/api/clients/${id}/plano-contas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: modalNome }),
        });
      } else if (modal.mode === 'create-account') {
        res = await fetch(`/api/clients/${id}/plano-contas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: modalNome, parentId: modal.grupo.id }),
        });
      } else {
        res = await fetch(`/api/clients/${id}/plano-contas/${modal.conta.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: modalNome }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModal(null);
      await fetchPlano();
      flashSaved(data.conta?.id || 'new');
    } catch (e) {
      setError(e.message);
    }
    setSavingId(null);
  };

  const toggleAtivo = async (conta) => {
    setSavingId(conta.id);
    setError('');
    try {
      const res = await fetch(`/api/clients/${id}/plano-contas/${conta.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !conta.ativo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlano((prev) => prev.map((p) => (p.id === conta.id ? { ...p, ativo: !conta.ativo } : p)));
      flashSaved(conta.id);
    } catch (e) {
      setError(e.message);
    }
    setSavingId(null);
  };

  const remove = async (conta, isGrupo) => {
    const label = isGrupo
      ? `Excluir o grupo "${conta.nome}" e todas as suas contas?`
      : `Excluir a conta "${conta.nome}"?`;
    if (!window.confirm(`${label}\nLançamentos já classificados não serão alterados.`)) return;
    setSavingId(conta.id);
    setError('');
    try {
      const res = await fetch(`/api/clients/${id}/plano-contas/${conta.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchPlano();
    } catch (e) {
      setError(e.message);
    }
    setSavingId(null);
  };

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
          <Link href={`/clients/${id}/classificar`} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ListTree className="w-4 h-4 text-violet-600" />
              Plano de Contas — {client.name}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Gerencie os grupos e contas usados na classificação dos lançamentos
            </p>
          </div>
          <button
            onClick={() => openModal('create-group')}
            className="inline-flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar grupo
          </button>
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

        {grupos.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <ListTree className="w-10 h-10 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Nenhum grupo cadastrado</p>
            <p className="text-gray-400 text-sm mt-1">
              Clique em &quot;Adicionar grupo&quot; para começar o plano de contas
            </p>
          </div>
        ) : (
          grupos.map((grupo) => (
            <div key={grupo.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
                <h2 className={`text-sm font-bold ${grupo.ativo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                  {grupo.nome}
                  {!grupo.ativo && <span className="ml-2 text-xs font-normal text-gray-400">(inativo)</span>}
                </h2>
                <div className="flex items-center gap-1">
                  {savingId === grupo.id ? (
                    <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                  ) : savedId === grupo.id ? (
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  ) : null}
                  <button
                    onClick={() => toggleAtivo(grupo)}
                    disabled={savingId === grupo.id}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      grupo.ativo
                        ? 'text-gray-500 hover:bg-gray-100'
                        : 'text-green-600 hover:bg-green-50'
                    }`}
                    title={grupo.ativo ? 'Desativar grupo' : 'Reativar grupo'}
                  >
                    {grupo.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={() => openModal('edit', null, grupo)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Renomear grupo"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(grupo, true)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir grupo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {contasDe(grupo.id).map((conta) => (
                  <li key={conta.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <span className={`text-sm ${conta.ativo ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                      {conta.nome}
                      {!conta.ativo && <span className="ml-2 text-xs text-gray-400">(inativa)</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      {savingId === conta.id ? (
                        <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                      ) : savedId === conta.id ? (
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      ) : null}
                      <button
                        onClick={() => toggleAtivo(conta)}
                        disabled={savingId === conta.id}
                        className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          conta.ativo
                            ? 'text-gray-500 hover:bg-gray-100'
                            : 'text-green-600 hover:bg-green-50'
                        }`}
                        title={conta.ativo ? 'Desativar conta' : 'Reativar conta'}
                      >
                        {conta.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => openModal('edit', null, conta)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Renomear conta"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(conta, false)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir conta"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
                {contasDe(grupo.id).length === 0 && (
                  <li className="px-5 py-3 text-sm text-gray-400">Nenhuma conta neste grupo</li>
                )}
              </ul>
              <div className="px-5 py-3 border-t border-gray-100">
                <button
                  onClick={() => openModal('create-account', grupo)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar conta
                </button>
              </div>
            </div>
          ))
        )}
      </main>

      {/* Modal: criar/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">
                {modal.mode === 'create-group' && 'Novo grupo'}
                {modal.mode === 'create-account' && `Nova conta em "${modal.grupo.nome}"`}
                {modal.mode === 'edit' && 'Renomear'}
              </h2>
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
            <input
              type="text"
              value={modalNome}
              onChange={(e) => setModalNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveModal()}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-5"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveModal}
                disabled={savingId !== null || !modalNome.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {savingId !== null && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
