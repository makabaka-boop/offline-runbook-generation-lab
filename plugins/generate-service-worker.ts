import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

async function listFiles(directory: string, root = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath, root);
      const info = await stat(fullPath);
      return info.isFile() ? [`/${relative(root, fullPath).split('\\').join('/')}`] : [];
    })
  );
  return files.flat();
}

export function serviceWorkerSourceForTest(precacheList: string[]): string {
  const shellFiles = precacheList.filter((file) => !file.startsWith('/packages/') && file !== '/sw.js');
  const precache = JSON.stringify(shellFiles);
  return `
const APP_CACHE = 'offline-manual-app-v1';
const PACKAGE_PREFIX = 'offline-manual-package-';
const DB_NAME = 'offline-manual-drill';
const STORE = 'state';
const CURRENT_KEY = 'current-generation';
const PRECACHE = ${precache};

function openStateDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function activeVersion() {
  const db = await openStateDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(CURRENT_KEY);
    request.onsuccess = () => {
      db.close();
      resolve(typeof request.result === 'string' ? request.result : null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

function isPackageRequest(url) {
  return url.pathname.startsWith('/packages/');
}

async function packageResponse(request) {
  const url = new URL(request.url);
  let version = null;
  try {
    version = await activeVersion();
  } catch {
    version = null;
  }
  if (version) {
    const cache = await caches.open(PACKAGE_PREFIX + version);
    const response = await cache.match(url.pathname, { ignoreSearch: true });
    if (response) return response;
  }
  return fetch(request);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then(async (cache) => {
      for (const file of PRECACHE) {
        const response = await fetch(file, { cache: 'reload' });
        if (!response.ok) throw new Error('预缓存失败: ' + file);
        await cache.put(file, response);
      }
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (isPackageRequest(url)) {
    event.respondWith(packageResponse(event.request).catch(() => Response.error()));
  } else if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html', { ignoreSearch: true }).then((response) => response || Response.error())
    );
  } else {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).catch(() => Response.error());
      })
    );
  }
});
`;
}

export function generateServiceWorker(): Plugin {
  let resolvedConfig: ResolvedConfig | null = null;
  return {
    name: 'generate-service-worker',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      if (!resolvedConfig || resolvedConfig.command !== 'build') return;
      const outDir = join(resolvedConfig.root, resolvedConfig.build.outDir);
      const files = await listFiles(outDir);
      await writeFile(join(outDir, 'sw.js'), serviceWorkerSourceForTest(files), 'utf8');
    }
  };
}
