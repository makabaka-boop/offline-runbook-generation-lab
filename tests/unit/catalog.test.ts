import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import catalog from '../../src/generated/catalog.json';

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('built-in signed package catalog', () => {
  it('contains exactly two versions and exposes same-origin signed URLs', () => {
    expect(catalog.packages.map((entry) => entry.version)).toEqual(['2024.11.0', '2025.03.2']);
    for (const entry of catalog.packages) {
      expect(entry.originUrl).toMatch(/^\/packages\/[^/]+\//);
      expect(entry.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.resources.map((resource) => resource.kind)).toEqual(['steps', 'faults', 'notes']);
      for (const resource of entry.resources) {
        expect(resource.url).toMatch(/^\/packages\/[^/]+\//);
        expect(resource.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it.each(catalog.packages)('every generated file for $version matches catalog metadata', async (entry) => {
    const directory = join('public', 'packages', entry.version);
    const files = await readdir(directory);
    expect(files.sort()).toEqual(['faults.json', 'manifest.json', 'notes.json', 'steps.json']);

    const manifestBuffer = await readFile(join(directory, 'manifest.json'));
    expect(manifestBuffer.length).toBe(entry.manifestBytes);
    expect(hash(manifestBuffer)).toBe(entry.manifestSha256);

    for (const resource of entry.resources) {
      const buffer = await readFile(join('public', resource.url));
      expect(buffer.length).toBe(resource.bytes);
      expect(hash(buffer)).toBe(resource.sha256);
    }
  });
});
