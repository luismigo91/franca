import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Chat de prueba · Franca', template: '%s · Franca' },
  description: 'Prueba tus flujos de Franca como lo haría una persona usuaria.',
  // Sin `Referer` hacia terceros: la URL de una conversación no sale (D13). La cabecera `Referrer-Policy` lo repite.
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
