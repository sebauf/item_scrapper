const AMAZON_IMAGE_SIZE_SUFFIX = /^(https:\/\/[^/]+\/images\/I\/[A-Za-z0-9+-]+)\..*\.(jpg|jpeg|png|gif)$/i;

export function toHighResImageUrl(url: string): string {
  const match = url.match(AMAZON_IMAGE_SIZE_SUFFIX);
  return match ? `${match[1]}.${match[2]}` : url;
}

export function toHighResImageUrls(urls: string[]): string[] {
  return [...new Set(urls.map(toHighResImageUrl))];
}
