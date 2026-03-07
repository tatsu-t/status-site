import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tatsu Status',
  description: 'Cross-Server Container Monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
