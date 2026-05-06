import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-5xl font-bold text-gray-200 mb-4">404</p>
        <p className="text-gray-600 font-medium">Página não encontrada</p>
        <Link href="/" className="text-blue-600 text-sm mt-3 inline-block hover:underline">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
