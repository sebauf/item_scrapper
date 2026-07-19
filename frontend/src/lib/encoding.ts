/**
 * Product route ids are the base64url-encoded product URL (the MongoDB _id).
 * base64url only uses [A-Za-z0-9_-], so ids survive reverse proxies that
 * mangle percent-encoded slashes in path segments.
 * Isomorphic: btoa/atob are available in both Node and the browser.
 */

export function encodeProductId(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeProductId(id: string): string | null {
  if (!id || id.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    const base64 = id.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const url = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}
