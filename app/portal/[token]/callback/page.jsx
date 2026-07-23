'use client';

import { useEffect, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function CallbackPage({ params }) {
  const { token } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Processando autorização...');

  useEffect(() => {
    const query = new URLSearchParams();
    searchParams.forEach((value, key) => query.append(key, value));

    fetch(`/api/portal/${token}/callback?${query.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setMessage(data.message || 'Autorização concluída. Aguardando dados do banco...');
        } else {
          setStatus('error');
          setMessage(data.errorDescription || data.error || 'Erro ao processar autorização.');
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message || 'Erro de conexão.');
      });

    // Redireciona de volta para o portal após 4 segundos.
    const timeout = setTimeout(() => {
      router.push(`/portal/${token}`);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [token, searchParams, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-bold text-gray-900 mb-2">Processando autorização</h1>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-lg font-bold text-gray-900 mb-2">Autorização recebida</h1>
            <p className="text-sm text-gray-500">{message}</p>
            <p className="text-xs text-gray-400 mt-4">Você será redirecionado em instantes...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-lg font-bold text-gray-900 mb-2">Autorização não concluída</h1>
            <p className="text-sm text-gray-500">{message}</p>
            <button
              onClick={() => router.push(`/portal/${token}`)}
              className="mt-6 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Voltar ao portal
            </button>
          </>
        )}
      </div>
    </div>
  );
}
