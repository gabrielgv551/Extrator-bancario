'use client';

import { useState, useEffect, use } from 'react';
import { Plus, Trash2, Building2, Wifi, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

export default function PortalPage({ params }) {
  const { token } = use(params);

  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [widgetReady, setWidgetReady] = useState(false);

  useEffect(() => {
    if (document.querySelector('[data-pluggy-widget]')) { setWidgetReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.1.0/pluggy-connect.js';
    s.setAttribute('data-pluggy-widget', 'true');
    s.onload = () => setWidgetReady(true);
    document.head.appendChild(s);
  }, []);

  const fetchData = async () => {
    const res = await fetch(`/api/portal/${token}`);
    if (res.status === 404) { setNotFound(true); setLoading(false); return; }
    const data = await res.json();
    setClient(data.client);
    setItems(data.items);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [token]);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const connectBank = async () => {
    if (!widgetReady) return showMessage('Widget carregando, aguarde...', 'error');
    setConnecting(true);
    try {
      const res = await fetch(`/api/portal/${token}/connect-token`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const pluggyConnect = new window.PluggyConnect({
        connectToken: data.token,
        onSuccess: async (itemData) => {
          const saveRes = await fetch(`/api/portal/${token}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluggyItemId: itemData.item.id }),
          });
          if (saveRes.ok) {
            await fetchData();
            showMessage('Banco conectado com sucesso!', 'success');
          }
          setConnecting(false);
        },
        onError: (err) => {
          showMessage(`Erro: ${JSON.stringify(err)}`, 'error');
          setConnecting(false);
        },
        onClose: () => setConnecting(false),
      });
      pluggyConnect.init();
    } catch (e) {
      showMessage(e.message, 'error');
      setConnecting(false);
    }
  };

  const removeBank = async (itemId, name) => {
    if (!confirm(`Desconectar "${name}"?`)) return;
    setRemovingId(itemId);
    const res = await fetch(`/api/portal/${token}/items/${itemId}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchData();
      showMessage('Banco desconectado.', 'success');
    } else {
      showMessage('Erro ao desconectar.', 'error');
    }
    setRemovingId(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-700 font-semibold">Portal não encontrado</p>
          <p className="text-gray-400 text-sm mt-1">Verifique o link e tente novamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">Portal Bancário</h1>
            <p className="text-xs text-gray-500">Olá, <span className="font-medium text-gray-700">{client?.name}</span></p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* Toast */}
        {message && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-sm ${
            message.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

        {/* Connected banks */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
            Bancos conectados ({items.length})
          </h2>

          {items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm">
              <Wifi className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Nenhum banco conectado ainda</p>
              <p className="text-gray-400 text-sm mt-1">Clique em &quot;Adicionar banco&quot; para começar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4 shadow-sm"
                >
                  {item.institutionLogo ? (
                    <img
                      src={item.institutionLogo}
                      alt={item.institutionName}
                      className="w-11 h-11 rounded-xl object-contain border border-gray-100 p-1"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{item.institutionName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                      <span className="text-xs text-gray-500">Conectado</span>
                      {item.accountNumbers && (
                        <span className="text-xs text-gray-400">· Conta: {item.accountNumbers}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeBank(item.id, item.institutionName)}
                    disabled={removingId === item.id}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-50"
                    title="Desconectar"
                  >
                    {removingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add bank button */}
        <button
          onClick={connectBank}
          disabled={connecting || !widgetReady}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3.5 rounded-2xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md"
        >
          {connecting ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Abrindo...</>
          ) : (
            <><Plus className="w-5 h-5" /> Adicionar banco</>
          )}
        </button>

        <p className="text-center text-xs text-gray-400 pb-4">
          Seus dados são protegidos pela Pluggy · Open Finance
        </p>
      </main>
    </div>
  );
}
