export type Keyword = string & { readonly _brand: unique symbol };

export function createKeyword(value: string): Keyword {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Keyword cannot be empty');
  return trimmed as Keyword;
}
