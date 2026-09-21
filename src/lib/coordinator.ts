import { catalog } from '../generated/catalog';
import type {
  CatalogEntry,
  FailureReason,
  PackageManifest,
  PersistentState,
  VerifiedPackage
} from '../types';
import { fetchVerifiedText, isAbortError, isQuotaError } from './crypto';
import {
  commitActivation,
  loadPersistentState,
  saveInstall,
  clearInstallationRecord,
  clearCurrentVersion
} from './idb';
import { deletePackageCache, deleteUnknownPackageCaches, packageCacheName, readVerifiedPackage } from './packageCache';
import { idleInstall, type ManualAction } from '../state/manualReducer';

export function catalogEntry(version: string): CatalogEntry {
  const entry = catalog.find((candidate) => candidate.version === version);
  if (!entry) throw new Error(`未知手册版本：${version}`);
  return entry;
}

export function isManifest(value: unknown): value is PackageManifest {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as PackageManifest).schemaVersion === 1 &&
      typeof (value as PackageManifest).version === 'string'
  );
}

function failureReason(error: unknown): FailureReason {
  if (isAbortError(error)) return 'canceled';
  if (error instanceof Error && error.name === 'ChecksumError') return 'checksum';
  if (isQuotaError(error)) return 'quota';
  if (error instanceof TypeError) return 'network';
  if (error instanceof Error && /network|fetch|load|下载|网络/i.test(error.message)) return 'network';
  return 'unknown';
}

function jsonResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function openPackageCache(version: string): Promise<Cache> {
  return caches.open(packageCacheName(version));
}

async function verifyReadyPackage(version: string): Promise<VerifiedPackage> {
  const cache = await openPackageCache(version);
  return readVerifiedPackage(cache, catalogEntry(version));
}

export interface CoordinatorDispatch {
  (action: ManualAction): void;
}

export class ManualCoordinator {
  private abortController: AbortController | null = null;

  constructor(private readonly dispatch: CoordinatorDispatch) {}

  async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker unavailable');
    await navigator.serviceWorker.register('/sw.js');
  }

  async bootstrap(): Promise<{ state: PersistentState; activePackage: VerifiedPackage | null }> {
    let state = await loadPersistentState();
    const install = state.install;
    const interruptedVersion = install.phase === 'installing' || install.phase === 'failed' ? install.version : null;
    const activationVersion = install.phase === 'activating' ? install.version : null;

    if (interruptedVersion && interruptedVersion !== state.currentVersion) {
      await deletePackageCache(interruptedVersion).catch(() => undefined);
      await clearInstallationRecord();
      state = { ...state, install: idleInstall };
    }

    const installedCurrentVersion = state.currentVersion;
    if (activationVersion) {
      try {
        const ready = await verifyReadyPackage(activationVersion);
        await commitActivation(activationVersion);
        const allowed = new Set([activationVersion]);
        if (installedCurrentVersion && installedCurrentVersion !== activationVersion) {
          await deletePackageCache(installedCurrentVersion).catch(() => undefined);
        }
        await deleteUnknownPackageCaches(allowed).catch(() => undefined);
        return {
          state: { currentVersion: activationVersion, install: idleInstall },
          activePackage: ready
        };
      } catch {
        await deletePackageCache(activationVersion).catch(() => undefined);
        if (installedCurrentVersion) {
          await clearInstallationRecord();
          state = { currentVersion: installedCurrentVersion, install: idleInstall };
        } else {
          await clearCurrentVersion();
          state = { currentVersion: null, install: idleInstall };
        }
      }
    }

    if (state.install.phase === 'ready' && state.install.version) {
      const readyVersion = state.install.version;
      try {
        await verifyReadyPackage(readyVersion);
      } catch {
        await deletePackageCache(readyVersion).catch(() => undefined);
        await clearInstallationRecord();
        state = { ...state, install: idleInstall };
      }
    }

    let activePackage: VerifiedPackage | null = null;
    if (state.currentVersion) {
      try {
        activePackage = await verifyReadyPackage(state.currentVersion);
      } catch {
        const brokenVersion = state.currentVersion;
        const readyVersion = state.install.phase === 'ready' ? state.install.version : null;
        await deletePackageCache(brokenVersion).catch(() => undefined);
        await clearCurrentVersion();
        if (readyVersion && readyVersion !== brokenVersion) {
          try {
            await verifyReadyPackage(readyVersion);
            state = { currentVersion: null, install: state.install };
          } catch {
            await deletePackageCache(readyVersion).catch(() => undefined);
            await clearInstallationRecord();
            state = { currentVersion: null, install: idleInstall };
          }
        } else {
          state = { currentVersion: null, install: idleInstall };
        }
      }
    }

    const allowed = new Set<string>();
    if (state.currentVersion) allowed.add(state.currentVersion);
    if (state.install.phase === 'ready' && state.install.version) allowed.add(state.install.version);
    await deleteUnknownPackageCaches(allowed);

    return { state, activePackage };
  }

  async install(version: string): Promise<void> {
    if (this.abortController) return;
    const currentState = await loadPersistentState();
    if (currentState.currentVersion === version) return;
    if (currentState.install.version === version && currentState.install.phase !== 'failed') return;
    const entry = catalogEntry(version);
    const controller = new AbortController();
    this.abortController = controller;
    const total = entry.resources.length + 1;
    this.dispatch({ type: 'INSTALL_STARTED', version, total });
    await saveInstall({
      phase: 'installing',
      version,
      progress: 0,
      total,
      failureReason: null,
      failureMessage: null
    });

    try {
      await deletePackageCache(version);
      const cache = await openPackageCache(version);
      let progress = 0;
      const reportProgress = () => {
        progress += 1;
        this.dispatch({ type: 'INSTALL_PROGRESS', version, progress, total });
      };

      const manifestText = await fetchVerifiedText(
        entry.originUrl,
        entry.manifestSha256,
        entry.manifestBytes,
        controller.signal
      );
      reportProgress();
      const manifest = JSON.parse(manifestText) as PackageManifest;
      if (
        manifest.version !== version ||
        manifest.id !== entry.id ||
        manifest.originUrl !== entry.originUrl ||
        manifest.resources.length !== entry.resources.length
      ) {
        throw Object.assign(new Error('清单身份或资源列表不匹配'), { name: 'ChecksumError' });
      }

      await cache.put(entry.originUrl, jsonResponse(manifestText));
      const listedResources = new Set(manifest.resources.map((resource) => resource.url));
      for (const expected of entry.resources) {
        const listed = manifest.resources.find((resource) => resource.url === expected.url);
        if (!listed || listed.sha256 !== expected.sha256 || listed.bytes !== expected.bytes) {
          throw Object.assign(new Error(`清单资源校验信息不一致：${expected.url}`), {
            name: 'ChecksumError'
          });
        }
        if (!listed.url.startsWith(`/packages/${version}/`)) {
          throw Object.assign(new Error(`拒绝跨版本资源：${listed.url}`), { name: 'ChecksumError' });
        }
      }

      for (const resource of entry.resources) {
        const text = await fetchVerifiedText(
          resource.url,
          resource.sha256,
          resource.bytes,
          controller.signal
        );
        reportProgress();
        await cache.put(resource.url, jsonResponse(text));
        listedResources.delete(resource.url);
      }
      if (listedResources.size !== 0) throw Object.assign(new Error('存在未下载资源'), { name: 'ChecksumError' });

      await readVerifiedPackage(cache, entry);
      const ready = {
        phase: 'ready' as const,
        version,
        progress: total,
        total,
        failureReason: null,
        failureMessage: null
      };
      await saveInstall(ready);
      this.dispatch({ type: 'INSTALL_READY', version });
    } catch (error) {
      await deletePackageCache(version).catch(() => undefined);
      await clearInstallationRecord().catch(() => undefined);
      const reason = failureReason(error);
      const message =
        reason === 'canceled'
          ? '安装已取消；继续使用此前完整版本。'
          : reason === 'checksum'
            ? 'SHA-256 或文件大小校验未通过，未激活缓存已清理。'
            : reason === 'quota'
              ? '浏览器存储配额不足，未激活缓存已清理。'
              : reason === 'network'
                ? '网络中断或资源无法下载；未激活缓存已清理。'
                : error instanceof Error
                  ? error.message
                  : '安装失败，未激活缓存已清理。';
      this.dispatch({ type: 'INSTALL_FAILED', version, reason, message });
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  cancelInstall(): void {
    this.abortController?.abort();
  }

  async activate(version: string): Promise<VerifiedPackage | null> {
    const currentVersion = (await loadPersistentState()).currentVersion;
    let verified: VerifiedPackage;
    try {
      verified = await verifyReadyPackage(version);
    } catch (error) {
      await deletePackageCache(version).catch(() => undefined);
      await clearInstallationRecord().catch(() => undefined);
      const reason = failureReason(error);
      this.dispatch({
        type: 'INSTALL_FAILED',
        version,
        reason,
        message: '待激活包校验失败，已清理。'
      });
      return null;
    }

    this.dispatch({ type: 'ACTIVATING', version });
    await saveInstall({
      phase: 'activating',
      version,
      progress: verified.manifest.resources.length + 1,
      total: verified.manifest.resources.length + 1,
      failureReason: null,
      failureMessage: null
    });
    await commitActivation(version);
    const allowed = new Set([version]);
    if (currentVersion && currentVersion !== version) {
      await deletePackageCache(currentVersion).catch(() => undefined);
    }
    await deleteUnknownPackageCaches(allowed).catch(() => undefined);
    this.dispatch({ type: 'ACTIVATED', version });
    return verified;
  }

  async discardReady(version: string): Promise<void> {
    const state = await loadPersistentState();
    if (state.install.version === version && state.install.phase === 'ready') {
      await deletePackageCache(version);
      await clearInstallationRecord();
      this.dispatch({ type: 'READY_DISCARDED', version });
    }
  }
}
