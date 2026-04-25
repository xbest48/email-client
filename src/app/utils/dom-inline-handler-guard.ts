const BLOCKED_URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction']);

export function installDomInlineHandlerGuard(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  const cleanElement = (element: Element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().replace(/\s+/g, '').toLowerCase();

      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (BLOCKED_URL_ATTRIBUTES.has(name) && value.startsWith('javascript:')) {
        element.removeAttribute(attr.name);
      }
    }
  };

  const cleanTree = (node: Node) => {
    if (node instanceof Element) {
      cleanElement(node);
      for (const child of Array.from(node.querySelectorAll('*'))) {
        cleanElement(child);
      }
    }
  };

  cleanTree(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        cleanElement(mutation.target);
        continue;
      }

      for (const node of Array.from(mutation.addedNodes)) {
        cleanTree(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.violatedDirective.includes('script-src')) {
      console.warn('CSP: blocage de script inline', {
        directive: event.violatedDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        sample: event.sample,
      });
    }
  });
}
