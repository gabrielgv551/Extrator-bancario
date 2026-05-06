import './globals.css';

export const metadata = {
  title: 'Extrator Bancário — Pluggy',
  description: 'Gerencie extratos bancários dos seus clientes via Pluggy',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
