'use client';

import { useState, useEffect, use } from 'react';
import { Plus, Trash2, Building2, Wifi, AlertCircle, CheckCircle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';

export default function PortalPage({ params }) {
  const { token } = use(params);

  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [showConnectorSelector, setShowConnectorSelector] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [cnpjInput, setCnpjInput] = useState('');
  const [cpfInput, setCpfInput] = useState('');
  const [showTaxIdsInput, setShowTaxIdsInput] = useState(false);
  const [pendingConnector, setPendingConnector] = useState(null);

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
      const res = await fetch(`/api/portal/${token}/institutions`);
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.institutions || []);
      }
    } catch (e) {
      console.error('Erro ao buscar instituições:', e);
    }
  };

  useEffect(() => { fetchData(); fetchConnectors(); }, [token]);

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const formatCnpj = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  };

  const formatCpf = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const getItemStatus = (item) => {
    if (item.requiresReconnect || item.status === 'LOGIN_ERROR') {
      return { label: 'Reconectar necessário', color: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', requiresAction: true };
    }
    if (item.status === 'ERROR' || item.status === 'OUTDATED') {
      return { label: 'Erro na conexão', color: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', requiresAction: true };
    }
    if (item.status === 'UPDATED' || item.status === 'PARTIAL_SUCCESS') {
      return { label: 'Conectado', color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', requiresAction: false };
    }
    if (item.status === 'WAITING_DATA') {
      return { label: 'Aguardando dados', color: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50', requiresAction: false };
    }
    if (item.status === 'UPDATING') {
      return { label: 'Sincronizando', color: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50', requiresAction: false };
    }
    return { label: 'Pendente', color: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', requiresAction: false };
  };

  const connectBank = () => {
    if (!client?.businessTaxId) {
      setShowTaxIdsInput(true);
      return;
    }
    setShowConnectorSelector(true);
  };

  const handleConfirmTaxIds = () => {
    const rawCnpj = cnpjInput.replace(/\D/g, '');
    const rawCpf = cpfInput.replace(/\D/g, '');
    if (rawCnpj.length !== 14) {
      showMessage('CNPJ inválido. Digite 14 dígitos.', 'error');
      return;
    }
    if (rawCpf.length !== 11) {
      showMessage('CPF inválido. Digite 11 dígitos.', 'error');
      return;
    }
    setShowTaxIdsInput(false);
    if (pendingConnector) {
      const connector = pendingConnector;
      setPendingConnector(null);
      handleSelectConnector(connector);
    } else {
      setShowConnectorSelector(true);
    }
  };

  const handleSelectConnector = async (connector) => {
    setSelectedConnector(connector);
    setShowConnectorSelector(false);

    const businessTaxId = client?.businessTaxId || cnpjInput.replace(/\D/g, '');
    const personalTaxId = cpfInput.replace(/\D/g, '');

    // Se faltar CNPJ/CPF, abre o modal e guarda o connector para continuar depois.
    if (!businessTaxId || !personalTaxId) {
      setPendingConnector(connector);
      setShowTaxIdsInput(true);
      setConnecting(false);
      return;
    }

    setConnecting(true);

    try {

      const res = await fetch(`/api/portal/${token}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institutionCode: connector.institutionCode,
          businessTaxId,
          personalTaxId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Salva item local antes de redirecionar.
      await fetch(`/api/portal/${token}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          klaviLinkId: data.linkId,
          klaviConsentId: data.consentId,
          institutionCode: connector.institutionCode,
          institutionName: connector.name,
          institutionLogo: connector.avatar || null,
          businessTaxId,
          personalTaxId,
          status: 'WAITING_DATA',
        }),
      });

      // Redireciona o usuário ao banco para autorizar.
      window.location.href = data.consentRedirectUrl;
    } catch (e) {
      showMessage(e.message, 'error');
      setConnecting(false);
      setSelectedConnector(null);
    }
  };

  const handleRequestData = async (item) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/portal/${token}/items/${item.id}/request-data`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMessage(data.message || 'Solicitação enviada ao banco.', 'success');
    } catch (e) {
      showMessage(e.message, 'error');
    }
  };

  const handleReconnect = (item) => {
    const connector = connectors.find(c => c.institutionCode === item.institutionCode || c.name.toLowerCase() === (item.institutionName || '').toLowerCase());
    if (connector) {
      handleSelectConnector(connector);
    } else {
      showMessage('Instituição não encontrada na lista atual. Tente adicionar como novo banco.', 'error');
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
        {message && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-sm ${
            message.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

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
                    {(connecting && selectedConnector?.institutionCode === item.institutionCode) || removingId === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    ) : null}
                    {(item.status === 'WAITING_DATA' || item.status === 'UPDATING') && (
                      <button
                        onClick={() => handleRequestData(item)}
                        className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors"
                        title="Solicitar dados do banco novamente"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
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

        <button
          onClick={connectBank}
          disabled={connecting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3.5 rounded-2xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md"
        >
          {connecting ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Abrindo...</>
          ) : (
            <><Plus className="w-5 h-5" /> Adicionar banco</>
          )}
        </button>

        <p className="text-center text-xs text-gray-400 pb-4">
          Seus dados são protegidos pelo Open Finance · Provedor Klavi
        </p>

        {/* Modal de CNPJ/CPF */}
        {showTaxIdsInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowTaxIdsInput(false)} />
            <div className="relative bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
              <h3 className="text-base font-bold text-gray-900 mb-2">Informe CNPJ e CPF</h3>
              <p className="text-sm text-gray-500 mb-4">São necessários para abrir o consentimento com o banco.</p>
              <label className="block text-xs font-medium text-gray-700 mb-1">CNPJ</label>
              <input
                type="text"
                value={formatCnpj(cnpjInput)}
                onChange={(e) => setCnpjInput(e.target.value)}
                placeholder="00.000.000/0000-00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />
              <label className="block text-xs font-medium text-gray-700 mb-1">CPF</label>
              <input
                type="text"
                value={formatCpf(cpfInput)}
                onChange={(e) => setCpfInput(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowTaxIdsInput(false)} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
                <button onClick={handleConfirmTaxIds} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Continuar</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de seleção de instituição */}
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
                      key={connector.institutionCode}
                      onClick={() => handleSelectConnector(connector)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
                    >
                      {connector.avatar ? (
                        <img
                          src={connector.avatar}
                          alt={connector.name}
                          className="w-10 h-10 rounded-lg object-contain border border-gray-100 p-1"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-blue-600" />
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-800 flex-1">{connector.name}</span>
                      <ExternalLink className="w-4 h-4 text-gray-300" />
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
