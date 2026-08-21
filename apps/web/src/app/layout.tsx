import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { ServiceWorker } from './service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'KnowIt — Coverage',
  description: 'Provenance-first news for domain professionals. Phase 1: ingestion coverage.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'KnowIt' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0d1117',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="inner">
            <span className="brand">KnowIt</span>
            <span className="phase">Phase 1 · ingestion</span>
            <nav>
              <Link href="/feed">Feed</Link>
              <Link href="/">Coverage</Link>
              <Link href="/sources">Registry</Link>
              <Link href="/documents">Documents</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
