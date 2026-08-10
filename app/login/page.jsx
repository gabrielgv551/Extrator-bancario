'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Lock, Eye, EyeOff, ChevronDown } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [empresa, setEmpresa] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  useEffect(() => {
    fetch('/api/admin/companies')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCompanies(data.map((c) => (typeof c === 'string' ? { slug: c, name: c.toUpperCase() } : c)));
        }
      })
      .catch((err) => console.error('[login] erro ao carregar empresas:', err))
      .finally(() => setLoadingCompanies(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa: empresa.trim().toLowerCase(), password }),
    });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error || 'Erro ao entrar');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-md">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Extrator Bancário</h1>
          <p className="text-sm text-gray-500 mt-1">Acesso administrativo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Empresa</label>
            <div className="relative">
              <select
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                className="w-full appearance-none px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                autoFocus
                disabled={loadingCompanies}
              >
                <option value="">{loadingCompanies ? 'Carregando empresas...' : 'Selecione uma empresa'}</option>
                <option value="__geral__">⚙️ Admin Geral</option>
                <option disabled>──────────────</option>
                {companies.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Selecione a empresa no Have Gestor</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite a senha"
                className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password || !empresa}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
