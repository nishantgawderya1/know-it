'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker so the app is installable.
 *
 * The dashboard itself has little use for offline caching — it shows live ingestion state.
 * The point is that the PWA shell is real from day one, because the consumer feed inherits
 * exactly this scaffold and offline reading is a genuine requirement in the Indian market.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registration failure must never break the page — the app works fine uninstalled.
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
