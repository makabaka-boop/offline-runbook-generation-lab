import { describe, expect, it } from 'vitest';
import { fetchVerifiedText, sha256Hex } from '../../src/lib/crypto';

describe('SHA-256 resource verification', () => {
  it('accepts content matching its byte length and digest', async () => {
    const text = '{"step":"先验电"}';
    const bytes = new TextEncoder().encode(text);
    const hash = await sha256Hex(bytes.buffer);
    const result = await fetchVerifiedText(
      '/packages/test.json',
      hash,
      bytes.byteLength,
      undefined,
      async () => new Response(bytes, { status: 200 })
    );
    expect(result).toBe(text);
  });

  it('rejects tampered content without relying on HTTP status', async () => {
    const original = new TextEncoder().encode('{"ok":true}');
    const tampered = new TextEncoder().encode('{"ok":fals}');
    const hash = await sha256Hex(original.buffer);
    await expect(
      fetchVerifiedText(
        '/packages/test.json',
        hash,
        original.byteLength,
        undefined,
        async () => new Response(tampered, { status: 200 })
      )
    ).rejects.toThrow(/校验失败/);
  });
});
