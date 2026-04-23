const INLINE_DATA_IMAGE_TOKEN_ATTR = 'data-inline-image-token';
const INLINE_DATA_IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export type TokenizedEmbeddedDataImages = {
  html: string;
  tokens: Map<string, string>;
};

export function tokenizeEmbeddedDataImageHtml(html: string): TokenizedEmbeddedDataImages {
  const tokens = new Map<string, string>();
  let index = 0;

  const quoted = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[^"']+)\2/gi;
  const unquoted = /(<img\b[^>]*?\bsrc\s*=\s*)(data:image\/[^\s>]+)/gi;

  const replaceMatch = (_match: string, prefix: string, quoteOrDataUrl: string, maybeDataUrl?: string) => {
    const quote = maybeDataUrl ? quoteOrDataUrl : '"';
    const dataUrl = maybeDataUrl ?? quoteOrDataUrl;
    const token = `inline-data-image-${index += 1}`;
    tokens.set(token, dataUrl);
    return `${prefix}${quote}${INLINE_DATA_IMAGE_PLACEHOLDER}${quote} ${INLINE_DATA_IMAGE_TOKEN_ATTR}="${token}"`;
  };

  let transformed = html.replace(quoted, replaceMatch);
  transformed = transformed.replace(unquoted, replaceMatch);

  return { html: transformed, tokens };
}

export function restoreTokenizedEmbeddedDataImageHtml(root: ParentNode, tokens: Map<string, string>): void {
  for (const [token, dataUrl] of tokens.entries()) {
    const images = root.querySelectorAll<HTMLImageElement>(`img[${INLINE_DATA_IMAGE_TOKEN_ATTR}="${token}"]`);
    for (const image of Array.from(images)) {
      image.setAttribute('src', dataUrl);
      image.removeAttribute(INLINE_DATA_IMAGE_TOKEN_ATTR);
    }
  }
}
