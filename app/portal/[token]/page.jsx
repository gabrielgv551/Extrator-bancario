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
  const [connectors, setConnectors] = useState([]);
  const [showConnectorSelector, setShowConnectorSelector] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [reconnectingItem, setReconnectingItem] = useState(null);

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

  const fetchConnectors = async () => {
    try {
      const res = await fetch(`/api/portal/${token}/connectors`);
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch (e) {
      console.error('Erro ao buscar conectores:', e);
    }
  };

  useEffect(() => { fetchData(); fetchConnectors(); }, [token]);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const getItemStatus = (item) => {
    if (item.requiresReconnect || item.status === 'LOGIN_ERROR') {
      return { label: 'Reconectar necessário', color: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', requiresAction: true };
    }
    if (item.status === 'OUTDATED' || item.status === 'ERROR') {
      return { label: 'Erro na conexão', color: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', requiresAction: true };
    }
    if (item.status === 'UPDATED' || item.status === 'PARTIAL_SUCCESS') {
      return { label: 'Conectado', color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', requiresAction: false };
    }
    if (item.status === 'UPDATING') {
      return { label: 'Sincronizando', color: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50', requiresAction: false };
    }
    return { label: 'Pendente', color: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', requiresAction: false };
  };

  const openWidget = async ({ connectorId, itemId } = {}) => {
    if (!widgetReady) return showMessage('Widget carregando, aguarde...', 'error');
    setConnecting(true);
    try {
      const res = await fetch(`/api/portal/${token}/connect-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const config = {
        connectToken: data.token,
        onSuccess: async (itemData) => {
          const saveRes = await fetch(`/api/portal/${token}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluggyItemId: itemData.item.id }),
          });
          if (saveRes.ok) {
            await fetchData();
            showMessage(itemId ? 'Banco reconectado com sucesso!' : 'Banco conectado com sucesso!', 'success');
          }
          setConnecting(false);
          setReconnectingItem(null);
          setSelectedConnector(null);
          setShowConnectorSelector(false);
        },
        onError: (err) => {
          showMessage(`Erro: ${JSON.stringify(err)}`, 'error');
          setConnecting(false);
          setReconnectingItem(null);
        },
        onClose: () => {
          setConnecting(false);
          setReconnectingItem(null);
        },
      };
      if (connectorId) config.selectedConnectorId = connectorId;

      const pluggyConnect = new window.PluggyConnect(config);
      pluggyConnect.init();
    } catch (e) {
      showMessage(e.message, 'error');
      setConnecting(false);
      setReconnectingItem(null);
    }
  };

  const connectBank = () => {
    setShowConnectorSelector(true);
  };

  const handleSelectConnector = (connector) => {
    setSelectedConnector(connector);
    setShowConnectorSelector(false);
    openWidget({ connectorId: connector.id });
  };

  const handleReconnect = (item) => {
    setReconnectingItem(item.pluggyItemId);
    // Busca o conector Open Finance correspondente pelo nome da instituicao.
    const openFinanceConnector = connectors.find(
      (c) => c.name.toLowerCase() === item.institutionName.toLowerCase()
    );
    if (openFinanceConnector) {
      openWidget({ itemId: item.pluggyItemId, connectorId: openFinanceConnector.id });
    } else {
      openWidget({ itemId: item.pluggyItemId });
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
              {items.map((item) => {
                const s = getItemStatus(item);
                return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl border p-4 flex items-center gap-4 shadow-sm ${s.requiresAction ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}
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
                      <span className={`w-1.5 h-1.5 rounded-full ${s.color} inline-block`}></span>
                      <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
                      {item.accountNumbers && (
                        <span className="text-xs text-gray-400">· Conta: {item.accountNumbers}</span>
                      )}
                    </div>
                    {item.errorMessage && s.requiresAction && (
                      <p className="text-xs text-red-600 mt-1 truncate" title={item.errorMessage}>{item.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {(reconnectingItem === item.pluggyItemId || removingId === item.id) && (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    )}
                    <button
                      onClick={() => handleReconnect(item)}
                      disabled={connecting}
                      className="text-blue-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors disabled:opacity-50"
                      title="Reconectar pelo Open Finance"
                    >
                      <Wifi className="w-4 h-4" />
                    </button>
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
                </div>
                );
              })}
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

        {/* Modal de selecao de conector */}
        {showConnectorSelector && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setShowConnectorSelector(false)}
            />
            <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Escolha o banco</h3>
                <button
                  onClick={() => setShowConnectorSelector(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  ✕
                </button>
              </div>
              <div className="overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {connectors.length === 0 ? (
                  <div className="col-span-full flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                  </div>
                ) : (
                  connectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => handleSelectConnector(connector)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
                    >
                      {connector.imageUrl ? (
                        <img
                          src={connector.imageUrl}
                          alt={connector.name}
                          className="w-10 h-10 rounded-lg object-contain border border-gray-100 p-1"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-blue-600" />
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-800 flex-1">{connector.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
