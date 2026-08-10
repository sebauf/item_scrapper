export type TrackedUrl = string & { readonly _brand: unique symbol };

export function createTrackedUrl(value: string): TrackedUrl {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Tracked URL cannot be empty');
  return trimmed as TrackedUrl;
}
