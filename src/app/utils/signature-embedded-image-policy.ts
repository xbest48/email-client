export const MAX_SIGNATURE_EMBEDDED_IMAGE_BYTES = 180 * 1024;

export type OversizedEmbeddedSignatureImage = {
  alt: string | null;
  approxBytes: number;
  index: number;
  mimeType: string;
};

export function findOversizedEmbeddedSignatureImage(
  html: string,
  maxBytes = MAX_SIGNATURE_EMBEDDED_IMAGE_BYTES,
): OversizedEmbeddedSignatureImage | null {
  if (!html || !/data:image\//i.test(html)) return null;

  const template = document.createElement('template');
  template.innerHTML = html;

  const images = Array.from(template.content.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]'));
  for (const [index, image] of images.entries()) {
    const src = image.getAttribute('src')?.trim();
    if (!src) continue;

    const match = src.match(/^data:(image\/[^;]+);base64,(.*)$/i);
    if (!match) continue;

    const mimeType = match[1].toLowerCase();
    const base64 = match[2].replace(/\s+/g, '');
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes <= maxBytes) continue;

    return {
      alt: image.getAttribute('alt'),
      approxBytes,
      index: index + 1,
      mimeType,
    };
  }

  return null;
}

export function formatEmbeddedImageSizeKiB(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
