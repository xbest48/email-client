import { Directive, ElementRef, inject, input, effect, OnDestroy } from '@angular/core';

@Directive({
  selector: '[appSandboxedHtml]',
})
export class SandboxedHtmlDirective implements OnDestroy {
  private readonly el = inject(ElementRef);

  readonly appSandboxedHtml = input<string | null>(null);

  private shadowRoot: ShadowRoot;
  private objectUrls: string[] = [];

  constructor() {
    this.shadowRoot = this.el.nativeElement.attachShadow({ mode: 'open' });

    effect(() => {
      const html = this.appSandboxedHtml();
      this.revokeObjectUrls();
      if (html) {
        this.shadowRoot.innerHTML = `<div style="width:100%;overflow-x:auto;overflow-wrap:break-word">${this.prepareHtmlForRendering(html)}</div>`;
      } else {
        this.shadowRoot.innerHTML = '';
      }
    });
  }

  ngOnDestroy(): void {
    this.revokeObjectUrls();
  }

  private prepareHtmlForRendering(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;

    for (const image of Array.from(template.content.querySelectorAll('img'))) {
      const src = image.getAttribute('src');
      if (src?.startsWith('data:image/')) {
        image.setAttribute('src', this.createObjectUrlFromDataImage(src));
      }
    }

    for (const anchor of Array.from(template.content.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href')?.trim();
      if (!href || !this.shouldOpenInNewTab(href)) continue;

      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }

    return template.innerHTML;
  }

  private shouldOpenInNewTab(href: string): boolean {
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return false;
    }

    if (href.startsWith('//')) {
      return true;
    }

    try {
      const url = new URL(href, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private createObjectUrlFromDataImage(dataUrl: string): string {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return dataUrl;

    const mimeType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    this.objectUrls.push(objectUrl);
    return objectUrl;
  }

  private revokeObjectUrls(): void {
    for (const objectUrl of this.objectUrls) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls = [];
  }
}
