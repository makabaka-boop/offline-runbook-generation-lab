export function isSupportedEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'caches' in globalThis &&
    'indexedDB' in globalThis &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof fetch === 'function' &&
    typeof AbortController !== 'undefined' &&
    (window.isSecureContext || location.hostname === '127.0.0.1' || location.hostname === 'localhost')
  );
}

export function missingCapabilities(): string[] {
  const missing: string[] = [];
  if (!('serviceWorker' in navigator)) missing.push('Service Worker');
  if (!('caches' in globalThis)) missing.push('Cache Storage');
  if (!('indexedDB' in globalThis)) missing.push('IndexedDB');
  if (typeof crypto === 'undefined' || !crypto.subtle) missing.push('Web Crypto SHA-256');
  if (typeof fetch !== 'function') missing.push('Fetch');
  if (typeof AbortController === 'undefined') missing.push('AbortController');
  if (!window.isSecureContext && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
    missing.push('安全上下文');
  }
  return missing;
}
