'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  AlertCircle,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  Wand2,
  Tags,
  Sparkles,
} from 'lucide-react';
import { CLASSIFICACOES } from '@/lib/classification';

const TIPOS = ['Entrada', 'Saída'];

const regraVazia = {
  descricao_padrao: '',
  tipo_padrao: '',
  razao_social_padrao: '',
  documento_padrao: '',
  banco_padrao: '',
  l1: '',
  l2: '',
  prioridade: '',
};

// Resume as condições da regra para exibição em tabela.
function resumoCondicoes(regra) {
  const partes = [];
  if (regra.descricao_padrao) partes.push(`descrição contém "${regra.descricao_padrao}"`);
  if (regra.tipo_padrao) partes.push(`tipo: ${regra.tipo_padrao}`);
  if (regra.razao_social_padrao) partes.push(`razão social: ${regra.razao_social_padrao}`);
  if (regra.documento_padrao) partes.push(`documento: ${regra.documento_padrao}`);
  if (regra.banco_padrao) partes.push(`banco: ${regra.banco_padrao}`);
  return partes.length ? partes.join(' · ') : '—';
}

export default function RegrasPage({ params }) {
  const { id } = use(params);

  const [client, setClient] = useState(null);
  const [regras, setRegras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null); // regra sendo editada ou null (nova)
  const [form, setForm] = useState(regraVazia);
  const [saving, setSaving] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [gruposContas, setGruposContas] = useState(CLASSIFICACOES);

  const fetchClient = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}`);
    if (res.ok) setClient(await res.json());
  }, [id]);

  const fetchRegras = useCallback(async () => {
    try {
      const res = await fetch('/api/regras-classificacao');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRegras(data.regras || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClient();
    fetchRegras();
  }, [fetchClient, fetchRegras]);

  useEffect(() => {
    fetch(`/api/clients/${id}/plano-contas`)
      .then(async (res) => {
        if (!res.ok) throw new Error('plano indisponível');
        const data = await res.json();
        const map = {};
        for (const grupo of data.plano.filter((p) => !p.parentId && p.ativo)) {
          map[grupo.nome] = data.plano
            .filter((p) => p.parentId === grupo.id && p.ativo)
            .map((p) => p.nome);
        }
        if (Object.keys(map).length) setGruposContas(map);
      })
      .catch(() => setGruposContas(CLASSIFICACOES));
  }, [id]);

  const abrirNova = () => {
    setEditando(null);
    setForm(regraVazia);
    setShowForm(true);
  };

  const abrirEdicao = (regra) => {
    setEditando(regra);
    const [l1 = '', l2 = ''] = String(regra.categoria_sugerida || '').split('>').map((s) => s.trim());
    setForm({
      descricao_padrao: regra.descricao_padrao || '',
      tipo_padrao: regra.tipo_padrao || '',
      razao_social_padrao: regra.razao_social_padrao || '',
      documento_padrao: regra.documento_padrao || '',
      banco_padrao: regra.banco_padrao || '',
      l1: gruposContas[l1] ? l1 : '',
      l2: l2 || '',
      prioridade: regra.prioridade != null ? String(regra.prioridade) : '',
    });
    setShowForm(true);
  };

  const sugerir = async () => {
    setSugerindo(true);
    setError('');
    try {
      const res = await fetch('/api/regras-classificacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestOnly: true,
          descricao: form.descricao_padrao || null,
          tipo: form.tipo_padrao || null,
          razao_social: form.razao_social_padrao || null,
          documento: form.documento_padrao || null,
          banco: form.banco_padrao || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.sugestao?.classificacao) {
        setForm((f) => ({
          ...f,
          l1: data.sugestao.classificacao.l1,
          l2: (gruposContas[data.sugestao.classificacao.l1] || []).includes(data.sugestao.classificacao.l2)
            ? data.sugestao.classificacao.l2
            : f.l2,
        }));
      } else {
        setError('O motor não encontrou uma classificação para essas condições.');
      }
    } catch (e) {
      setError(e.message);
    }
    setSugerindo(false);
  };

  const salvar = async () => {
    setSaving(true);
    setError('');
    try {
      const body = {
        descricao_padrao: form.descricao_padrao || null,
        tipo_padrao: form.tipo_padrao || null,
        razao_social_padrao: form.razao_social_padrao || null,
        documento_padrao: form.documento_padrao || null,
        banco_padrao: form.banco_padrao || null,
        l1: form.l1 || null,
        l2: form.l2 || null,
        ...(form.prioridade !== '' ? { prioridade: Number(form.prioridade) } : {}),
      };
      let res;
      if (editando) {
        res = await fetch('/api/regras-classificacao', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editando.id, ...body }),
        });
      } else {
        res = await fetch('/api/regras-classificacao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowForm(false);
      await fetchRegras();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const toggleAtivo = async (regra) => {
    try {
      const res = await fetch('/api/regras-classificacao', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: regra.id, ativo: !regra.ativo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRegras();
    } catch (e) {
      setError(e.message);
    }
  };

  const excluir = async (regra) => {
    if (!confirm(`Excluir a regra "${regra.categoria_sugerida}"?`)) return;
    try {
      const res = await fetch('/api/regras-classificacao', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: regra.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRegras();
    } catch (e) {
      setError(e.message);
    }
  };

  const set = (campo) => (e) => {
    const valor = e.target.value;
    setForm((f) => ({
      ...f,
      [campo]: valor,
      ...(campo === 'l1' ? { l2: '' } : {}),
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href={`/clients/${id}/classificar`} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-violet-600" />
              Regras de Pré-classificação — {client?.name || '...'}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Regras que alimentam as sugestões de classificação do extrato
            </p>
          </div>
          <button
            onClick={abrirNova}
            className="inline-flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Regra
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <Loader2 className="w-6 h-6 text-gray-300 animate-spin mx-auto" />
          </div>
        ) : regras.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm">
            <Wand2 className="w-10 h-10 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">Nenhuma regra cadastrada</p>
            <p className="text-gray-400 text-sm mt-1">
              Crie regras para o motor sugerir classificações automaticamente
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-600">Condições</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Classificação</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">Prioridade</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">Origem</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">Ativa</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {regras.map((regra) => (
                    <tr
                      key={regra.id}
                      className={`border-b border-gray-100 transition-colors ${regra.ativo ? 'hover:bg-gray-50' : 'bg-gray-50/50 opacity-60'}`}
                    >
                      <td className="px-4 py-2.5 text-gray-600 text-xs max-w-md">
                        {resumoCondicoes(regra)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 bg-violet-50 border border-violet-200 text-violet-800 px-2 py-0.5 rounded-full text-xs font-medium">
                          <Tags className="w-3 h-3" />
                          {regra.categoria_sugerida}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500 text-xs">
                        {regra.prioridade}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-400 text-xs">
                        {regra.origem || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleAtivo(regra)}
                          title={regra.ativo ? 'Desativar regra' : 'Ativar regra'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            regra.ativo ? 'bg-violet-600' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              regra.ativo ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => abrirEdicao(regra)}
                          className="text-gray-400 hover:text-violet-600 transition-colors mr-3"
                          title="Editar regra"
                        >
                          <Pencil className="w-4 h-4 inline" />
                        </button>
                        <button
                          onClick={() => excluir(regra)}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                          title="Excluir regra"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Nova/Editar regra */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-violet-600" />
                {editando ? 'Editar Regra' : 'Nova Regra'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Descrição contém
                </label>
                <input
                  type="text"
                  value={form.descricao_padrao}
                  onChange={set('descricao_padrao')}
                  placeholder='Ex: "PIX - RECEBIDO", "PGTO BOLETO"'
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                  <select
                    value={form.tipo_padrao}
                    onChange={set('tipo_padrao')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                  >
                    <option value="">Qualquer</option>
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Banco</label>
                  <input
                    type="text"
                    value={form.banco_padrao}
                    onChange={set('banco_padrao')}
                    placeholder="Ex: Nubank"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Razão social</label>
                  <input
                    type="text"
                    value={form.razao_social_padrao}
                    onChange={set('razao_social_padrao')}
                    placeholder="Contraparte"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">CNPJ/CPF</label>
                  <input
                    type="text"
                    value={form.documento_padrao}
                    onChange={set('documento_padrao')}
                    placeholder="Somente números"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-500">Classificação sugerida</label>
                  <button
                    onClick={sugerir}
                    disabled={sugerindo}
                    className="inline-flex items-center gap-1 text-xs text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
                    title="Usar o motor para sugerir com base nas condições acima"
                  >
                    {sugerindo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Sugerir
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={form.l1}
                    onChange={set('l1')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                  >
                    <option value="">Grupo...</option>
                    {Object.keys(gruposContas).map((grupo) => (
                      <option key={grupo} value={grupo}>{grupo}</option>
                    ))}
                  </select>
                  <select
                    value={form.l2}
                    onChange={set('l2')}
                    disabled={!form.l1}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white disabled:opacity-50"
                  >
                    <option value="">Conta...</option>
                    {(gruposContas[form.l1] || []).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Prioridade <span className="text-gray-300">(opcional — vazio = automática)</span>
                </label>
                <input
                  type="number"
                  value={form.prioridade}
                  onChange={set('prioridade')}
                  placeholder="Quanto maior, vence primeiro"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={saving || !form.l1 || !form.l2}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
