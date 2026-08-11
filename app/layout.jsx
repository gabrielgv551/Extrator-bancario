import './globals.css';

export const metadata = {
  title: 'Extrator Bancário — Have',
  description: 'Gerencie extratos bancários dos seus clientes via Have',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
