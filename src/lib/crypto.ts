export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeOrigin(url: string): string {
  if (!url.startsWith('/')) {
    throw new Error(`资源必须使用同源绝对路径：${url}`);
  }
  return url;
}

export function assertExpectedHash(actual: string, expected: string, url: string): void {
  if (actual.toLocaleLowerCase() !== expected.toLocaleLowerCase()) {
    const error = new Error(`校验失败：${url}`) as Error & { name: string };
    error.name = 'ChecksumError';
    throw error;
  }
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'QuotaExceeded');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function fetchVerifiedText(
  url: string,
  expectedSha256: string,
  expectedBytes: number,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await fetchImpl(normalizeOrigin(url), { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error(`下载失败：${response.status} ${url}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expectedBytes) {
    const error = new Error(`文件大小不匹配：${url}`) as Error & { name: string };
    error.name = 'ChecksumError';
    throw error;
  }
  const actual = await sha256Hex(buffer);
  assertExpectedHash(actual, expectedSha256, url);
  return new TextDecoder().decode(buffer);
}
