import { describe, expect, it } from 'vitest';
import { serviceWorkerSourceForTest } from '../../plugins/generate-service-worker';

describe('service worker source generation', () => {
  it('keeps manual package files out of the application precache list', () => {
    const source = serviceWorkerSourceForTest([
      '/index.html',
      '/assets/index.js',
      '/packages/2025.03.2/manifest.json'
    ]);
    expect(source).toContain('"/index.html"');
    expect(source).toContain('"/assets/index.js"');
    expect(source).not.toContain('"/packages/2025.03.2/manifest.json"');
    expect(source).toContain('PACKAGE_PREFIX');
    expect(source).toContain('CURRENT_KEY');
  });
});
