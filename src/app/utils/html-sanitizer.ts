const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
  'style',
  'svg',
  'math',
]);

const BLOCKED_URL_PROTOCOLS = ['javascript:', 'vbscript:', 'file:', 'filesystem:'];
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'cid:', 'blob:'];

export function sanitizeEmailHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    const tagName = element.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tagName)) {
      element.remove();
      continue;
    }

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (name === 'srcset' || name === 'formaction' || name === 'xlink:href') {
        element.removeAttribute(attr.name);
        continue;
      }

      if ((name === 'href' || name === 'src') && !isSafeResourceUrl(value, tagName, name)) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (name === 'style') {
        const safeStyle = sanitizeInlineStyle(value);
        if (safeStyle) {
          element.setAttribute(attr.name, safeStyle);
        } else {
          element.removeAttribute(attr.name);
        }
      }
    }
  }

  return template.innerHTML;
}

function isSafeResourceUrl(value: string, tagName: string, attrName: string): boolean {
  if (!value || value.startsWith('#')) return true;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;

  const lower = value.replace(/\s+/g, '').toLowerCase();
  if (BLOCKED_URL_PROTOCOLS.some((protocol) => lower.startsWith(protocol))) {
    return false;
  }

  if (lower.startsWith('data:')) {
    return tagName === 'img'
      && attrName === 'src'
      && /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon);base64,/i.test(value);
  }

  try {
    const url = new URL(value, window.location.href);
    return ALLOWED_URL_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeInlineStyle(value: string): string {
  if (!value) return '';
  const lower = value.replace(/\s+/g, '').toLowerCase();
  if (
    lower.includes('expression(')
    || lower.includes('javascript:')
    || lower.includes('vbscript:')
    || lower.includes('behavior:')
    || lower.includes('-moz-binding')
  ) {
    return '';
  }
  return value;
}
