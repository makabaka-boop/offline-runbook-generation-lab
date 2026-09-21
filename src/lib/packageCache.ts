import type {
  CatalogEntry,
  FaultEntry,
  PackageManifest,
  ResourceRecord,
  SafetyNotes,
  VerifiedPackage
} from '../types';
import { sha256Hex } from './crypto';

const PREFIX = 'offline-manual-package-';

export function packageCacheName(version: string): string {
  if (!/^20\d{2}\.\d{1,2}\.\d{1,3}$/.test(version)) {
    throw new Error(`非法手册版本：${version}`);
  }
  return `${PREFIX}${version}`;
}

export function isPackageCacheName(name: string): boolean {
  return name.startsWith(PREFIX);
}

export function versionFromPackageCacheName(name: string): string | null {
  return isPackageCacheName(name) ? name.slice(PREFIX.length) : null;
}

async function readCachedBuffer(url: string, cache: Cache): Promise<ArrayBuffer> {
  const response = await cache.match(url, { ignoreSearch: true });
  if (!response) throw new Error(`缺少缓存资源：${url}`);
  return response.arrayBuffer();
}

async function validateResource(cache: Cache, resource: ResourceRecord): Promise<ArrayBuffer> {
  const buffer = await readCachedBuffer(resource.url, cache);
  if (buffer.byteLength !== resource.bytes) throw new Error(`文件大小不匹配：${resource.url}`);
  const hash = await sha256Hex(buffer);
  if (hash !== resource.sha256) throw new Error(`校验失败：${resource.url}`);
  return buffer;
}

function decodeJson<T>(buffer: ArrayBuffer, url: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as T;
  } catch {
    throw new Error(`清单不是有效 JSON：${url}`);
  }
}

function assertArrayOfStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} 格式无效`);
  }
  return value as readonly string[];
}

function validateManifestShape(value: unknown): PackageManifest {
  if (!value || typeof value !== 'object') throw new Error('手册清单格式无效');
  const manifest = value as PackageManifest;
  if (manifest.schemaVersion !== 1) throw new Error('不支持的清单版本');
  for (const key of ['id', 'version', 'label', 'issuedAt', 'originUrl'] as const) {
    if (typeof manifest[key] !== 'string' || manifest[key].length === 0) {
      throw new Error(`清单字段 ${key} 无效`);
    }
  }
  assertArrayOfStrings(manifest.steps, '有序步骤');
  if (!Array.isArray(manifest.resources) || manifest.resources.length !== 3) {
    throw new Error('清单资源列表无效');
  }
  const kinds = new Set(manifest.resources.map((resource) => resource.kind));
  for (const kind of ['steps', 'faults', 'notes'] as const) {
    if (!kinds.has(kind)) throw new Error(`缺少 ${kind} 资源`);
  }
  for (const resource of manifest.resources) {
    if (!resource.url.startsWith('/') || !/^[a-f0-9]{64}$/.test(resource.sha256) || resource.bytes <= 0) {
      throw new Error(`资源 ${resource.url} 的校验信息无效`);
    }
  }
  return manifest;
}

function validateFaults(value: unknown): readonly FaultEntry[] {
  if (!Array.isArray(value)) throw new Error('故障条目格式无效');
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('故障条目格式无效');
    for (const key of ['id', 'title', 'symptom', 'diagnosis', 'action'] as const) {
      if (typeof (item as Record<string, unknown>)[key] !== 'string') throw new Error(`故障字段 ${key} 无效`);
    }
  }
  return value as readonly FaultEntry[];
}

function validateNotes(value: unknown): SafetyNotes {
  if (!value || typeof value !== 'object') throw new Error('安全要点格式无效');
  const notes = value as SafetyNotes;
  for (const key of ['id', 'title', 'body'] as const) {
    if (typeof notes[key] !== 'string' || notes[key].length === 0) throw new Error(`安全要点 ${key} 无效`);
  }
  return notes;
}

export async function readVerifiedPackage(cache: Cache, entry: CatalogEntry): Promise<VerifiedPackage> {
  const manifestResponse = await cache.match(entry.originUrl, { ignoreSearch: true });
  if (!manifestResponse) throw new Error(`缺少清单：${entry.originUrl}`);
  const manifestBuffer = await manifestResponse.arrayBuffer();
  if (manifestBuffer.byteLength !== entry.manifestBytes) throw new Error('清单大小不匹配');
  const manifestHash = await sha256Hex(manifestBuffer);
  if (manifestHash !== entry.manifestSha256) throw new Error('清单 SHA-256 不匹配');
  const manifest = validateManifestShape(decodeJson<PackageManifest>(manifestBuffer, entry.originUrl));
  if (manifest.version !== entry.version || manifest.id !== entry.id) throw new Error('清单身份不匹配');

  const buffers = new Map<string, ArrayBuffer>();
  for (const resource of manifest.resources) {
    if (!resource.url.startsWith(`/packages/${manifest.version}/`)) throw new Error('资源路径越界');
    buffers.set(resource.kind, await validateResource(cache, resource));
  }

  const stepsBuffer = buffers.get('steps');
  const faultsBuffer = buffers.get('faults');
  const notesBuffer = buffers.get('notes');
  if (!stepsBuffer || !faultsBuffer || !notesBuffer) throw new Error('资源不完整');
  const steps = assertArrayOfStrings(decodeJson<readonly string[]>(stepsBuffer, 'steps.json'), '有序步骤');
  if (steps.length !== manifest.steps.length || steps.some((step, index) => step !== manifest.steps[index])) {
    throw new Error('清单步骤与 steps.json 不一致');
  }
  const faults = validateFaults(decodeJson<readonly FaultEntry[]>(faultsBuffer, 'faults.json'));
  const notes = validateNotes(decodeJson<SafetyNotes>(notesBuffer, 'notes.json'));
  return { manifest, steps, faults, notes };
}

export async function deletePackageCache(version: string): Promise<boolean> {
  return caches.delete(packageCacheName(version));
}

export async function deleteUnknownPackageCaches(allowedVersions: ReadonlySet<string>): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names.map(async (name) => {
      const version = versionFromPackageCacheName(name);
      if (version && !allowedVersions.has(version)) await caches.delete(name);
    })
  );
}

export async function packageCacheExists(version: string): Promise<boolean> {
  const names = await caches.keys();
  return names.includes(packageCacheName(version));
}
