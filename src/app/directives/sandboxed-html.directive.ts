import { Directive, ElementRef, inject, input, effect } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';
import {
  restoreTokenizedEmbeddedDataImageHtml,
  tokenizeEmbeddedDataImageHtml,
} from '../utils/embedded-data-image-html';

@Directive({
  selector: '[appSandboxedHtml]',
})
export class SandboxedHtmlDirective {
  private readonly el = inject(ElementRef);
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);

  readonly appSandboxedHtml = input<string | null>(null);

  private shadowRoot: ShadowRoot;

  constructor() {
    this.shadowRoot = this.el.nativeElement.attachShadow({ mode: 'open' });

    effect(() => {
      const html = this.appSandboxedHtml();
      // Read isDark() and the user's dark-email-rendering preference inside
      // the effect so theme toggles and setting changes both re-render the
      // email with the right baseline styles. The preference lives on the
      // user profile (server-synced) so it follows the account everywhere.
      const dark = this.theme.isDark();
      const mode = this.auth.user()?.darkEmailRendering ?? 'force-dark';
      if (html) {
        const style = document.createElement('style');
        style.textContent = this.baseStyles(dark, mode);

        const container = document.createElement('div');
        container.className = 'email-body';
        const rendered = this.prepareHtmlForRendering(html);
        const tokenized = tokenizeEmbeddedDataImageHtml(rendered);
        container.innerHTML = tokenized.html;
        restoreTokenizedEmbeddedDataImageHtml(container, tokenized.tokens);

        this.shadowRoot.replaceChildren(style, container);
      } else {
        this.shadowRoot.innerHTML = '';
      }
    });
  }

  /**
   * Styles injected at the top of every rendered email's shadow root.
   *
   * In light mode (or when the user chose 'preserve' in dark mode), we only
   * set readable defaults and let the email's own inline styles drive the
   * design — the email sits on a white card. Best for branded newsletters.
   *
   * In dark mode with 'force-dark', we aggressively force a dark background
   * + light text via `!important` overrides on every descendant, because
   * email HTML commonly hard-codes black text with no background, which
   * ends up invisible on our dark chrome. The trade-off: designed
   * newsletters lose their original colors — but everything is legible.
   */
  private baseStyles(dark: boolean, mode: 'preserve' | 'force-dark'): string {
    const common = `
      :host { display: block; border-radius: 12px; }
      .email-body {
        width: 100%;
        padding: 16px;
        overflow-x: auto;
        overflow-wrap: break-word;
        box-sizing: border-box;
      }
      .email-body img { max-width: 100%; height: auto; }
    `;

    // Preserve mode: always render on a white card, in both themes. The
    // email's own styles win. Matches the Gmail / Apple Mail default.
    if (!dark || mode === 'preserve') {
      return `
        ${common}
        :host { color: #111827; background-color: #ffffff; color-scheme: light; }
        .email-body a { color: #2563eb; }
      `;
    }

    // Force-dark mode: override inline colors so plain emails stay readable.
    return `
      ${common}
      :host {
        color: #e5e5e5;
        background-color: #1f1f1f;
        color-scheme: dark;
      }
      .email-body, .email-body * {
        background-color: transparent !important;
        background-image: none !important;
        color: inherit !important;
        border-color: #404040 !important;
      }
      .email-body a, .email-body a:visited {
        color: #8bb8ff !important;
        text-decoration: underline;
      }
      /* Tables often rely on explicit borders to separate cells; keep them
         visible on dark */
      .email-body td, .email-body th { border-color: #404040 !important; }
      /* Tone down very bright photographic images so they don't glare */
      .email-body img { filter: brightness(0.92); }
    `;
  }

  private prepareHtmlForRendering(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;

    // Inline data: URLs in <img src> are rendered natively by the browser —
    // we intentionally don't convert them to blob URLs here. The conversion
    // proved fragile for the first/largest image in HTML signatures (the
    // image would render fine in compose but not in the settings preview
    // /edit). Data URLs are slightly heavier on reparse, but shadow-root
    // content is short-lived and the compatibility is bulletproof.

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

}
