import type { InstallState, PersistentState } from '../types';
import { idleInstall } from '../state/manualReducer';

const DB_NAME = 'offline-manual-drill';
const DB_VERSION = 1;
const STORE = 'state';
const CURRENT_KEY = 'current-generation';
const INSTALL_KEY = 'installation';

export interface MinimalDatabase {
  close(): void;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务中止'));
  });
}

function normalizeInstall(value: unknown): InstallState {
  if (!value || typeof value !== 'object') return idleInstall;
  const candidate = value as Partial<InstallState>;
  const allowedPhases = new Set(['idle', 'installing', 'ready', 'activating', 'failed']);
  if (!candidate.phase || !allowedPhases.has(candidate.phase)) return idleInstall;
  return {
    phase: candidate.phase,
    version: typeof candidate.version === 'string' ? candidate.version : null,
    progress: Number.isFinite(candidate.progress) ? Number(candidate.progress) : 0,
    total: Number.isFinite(candidate.total) ? Number(candidate.total) : 0,
    failureReason:
      candidate.failureReason === 'network' ||
      candidate.failureReason === 'checksum' ||
      candidate.failureReason === 'quota' ||
      candidate.failureReason === 'canceled' ||
      candidate.failureReason === 'unknown'
        ? candidate.failureReason
        : null,
    failureMessage: typeof candidate.failureMessage === 'string' ? candidate.failureMessage : null
  };
}

export async function loadPersistentState(): Promise<PersistentState> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    const [currentRaw, installRaw] = await Promise.all([
      requestToPromise(store.get(CURRENT_KEY)),
      requestToPromise(store.get(INSTALL_KEY))
    ]);
    await transactionDone(transaction);
    const currentVersion = typeof currentRaw === 'string' ? currentRaw : null;
    const install = normalizeInstall(installRaw);
    return { currentVersion, install };
  } finally {
    database.close();
  }
}

export async function saveInstall(install: InstallState): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(install, INSTALL_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function commitActivation(version: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.put(version, CURRENT_KEY);
    store.put(idleInstall, INSTALL_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearInstallationRecord(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(idleInstall, INSTALL_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearCurrentVersion(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(CURRENT_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
