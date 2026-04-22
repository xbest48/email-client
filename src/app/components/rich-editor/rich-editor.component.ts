import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  ElementRef,
  viewChild,
  OnDestroy,
  effect,
} from '@angular/core';

export type EditorToolbarPosition = 'top' | 'bottom';

@Component({
  selector: 'app-rich-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rich-editor.component.html',
  styleUrl: './rich-editor.component.css',
})
export class RichEditorComponent implements OnDestroy {
  readonly placeholder = input('');
  readonly initialContent = input('');
  readonly footerHtml = input('');
  readonly toolbarPosition = input<EditorToolbarPosition>('top');
  readonly minHeight = input('150px');
  readonly contentChange = output<string>();

  readonly editorRef = viewChild<ElementRef<HTMLDivElement>>('editor');
  readonly showLinkInput = signal(false);
  readonly linkUrl = signal('');

  private objectUrlMap = new Map<string, string>();
  private lastSourceHtml = '';
  private lastRenderedFooterHtml = '';
  private suppressInput = false;

  private readonly tools = [
    { cmd: 'bold', icon: 'B', title: 'Gras', style: 'font-weight: bold' },
    { cmd: 'italic', icon: 'I', title: 'Italique', style: 'font-style: italic' },
    { cmd: 'underline', icon: 'U', title: 'Souligne', style: 'text-decoration: underline' },
    { cmd: 'strikeThrough', icon: 'S', title: 'Barre', style: 'text-decoration: line-through' },
    { cmd: 'separator', icon: '', title: '', style: '' },
    { cmd: 'insertUnorderedList', icon: '•', title: 'Liste a puces', style: '' },
    { cmd: 'insertOrderedList', icon: '1.', title: 'Liste numerotee', style: '' },
    { cmd: 'separator', icon: '', title: '', style: '' },
    { cmd: 'justifyLeft', icon: '≡', title: 'Aligner a gauche', style: '' },
    { cmd: 'justifyCenter', icon: '≡', title: 'Centrer', style: '' },
    { cmd: 'justifyRight', icon: '≡', title: 'Aligner a droite', style: '' },
    { cmd: 'separator', icon: '', title: '', style: '' },
    { cmd: 'createLink', icon: '🔗', title: 'Lien', style: '' },
    { cmd: 'removeFormat', icon: '⌧', title: 'Supprimer le format', style: '' },
  ];

  get toolItems() {
    return this.tools;
  }

  constructor() {
    effect(() => {
      const editor = this.editorRef()?.nativeElement;
      const html = this.initialContent();
      const footer = this.footerHtml();
      if (!editor) return;
      if (html === this.lastSourceHtml && footer === this.lastRenderedFooterHtml) return;
      this.setHtml(html);
    });
  }

  ngOnDestroy(): void {
    this.revokeObjectUrls();
  }

  onInput(): void {
    if (this.suppressInput) return;
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      const restored = this.extractBodyHtml(editor);
      this.lastSourceHtml = restored;
      this.contentChange.emit(restored);
    }
  }

  execCommand(cmd: string): void {
    if (cmd === 'separator') return;

    if (cmd === 'createLink') {
      this.showLinkInput.set(true);
      return;
    }

    document.execCommand(cmd, false);
    this.editorRef()?.nativeElement.focus();
    this.onInput();
  }

  insertLink(): void {
    const url = this.linkUrl();
    if (url) {
      document.execCommand('createLink', false, url);
      this.linkUrl.set('');
      this.showLinkInput.set(false);
      this.editorRef()?.nativeElement.focus();
      this.onInput();
    }
  }

  cancelLink(): void {
    this.linkUrl.set('');
    this.showLinkInput.set(false);
    this.editorRef()?.nativeElement.focus();
  }

  changeFontSize(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) {
      document.execCommand('fontSize', false, value);
      this.editorRef()?.nativeElement.focus();
      this.onInput();
    }
  }

  changeColor(event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    document.execCommand('foreColor', false, color);
    this.editorRef()?.nativeElement.focus();
    this.onInput();
  }

  getHtml(): string {
    const editor = this.editorRef()?.nativeElement;
    if (!editor) return this.lastSourceHtml;
    return this.extractBodyHtml(editor);
  }

  getFullHtml(): string {
    const bodyHtml = this.stripInjectedFooter(this.getHtml());
    const footerHtml = this.footerHtml();
    if (!footerHtml) return bodyHtml;
    if (!bodyHtml) return footerHtml;
    return `${bodyHtml}${footerHtml}`;
  }

  setHtml(html: string): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      const sanitizedHtml = this.stripInjectedFooter(html);
      this.lastSourceHtml = sanitizedHtml;
      this.lastRenderedFooterHtml = this.footerHtml();
      this.revokeObjectUrls();
      this.suppressInput = true;
      this.renderEditorContent(editor, sanitizedHtml);
      this.suppressInput = false;
      this.onInput();
    }
  }

  clear(): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      this.lastSourceHtml = '';
      this.lastRenderedFooterHtml = this.footerHtml();
      this.revokeObjectUrls();
      this.suppressInput = true;
      this.renderEditorContent(editor, '');
      this.suppressInput = false;
      this.onInput();
    }
  }

  isEmpty(): boolean {
    const editor = this.editorRef()?.nativeElement;
    if (!editor) return true;
    const text = this.extractEditorText(editor);
    return text === '' || text === '\n';
  }

  private renderEditorContent(editor: HTMLDivElement, bodyHtml: string): void {
    const preparedBodyHtml = this.prepareHtmlForRendering(bodyHtml).trim();
    editor.innerHTML = preparedBodyHtml || '<div><br></div>';

    const footerHtml = this.footerHtml();
    if (!footerHtml) return;

    const footerRoot = document.createElement('div');
    footerRoot.setAttribute('data-editor-footer-root', 'true');
    footerRoot.setAttribute('contenteditable', 'false');

    const footerHost = document.createElement('div');
    footerHost.setAttribute('data-editor-footer-shadow-host', 'true');
    footerRoot.appendChild(footerHost);
    editor.appendChild(footerRoot);

    const shadowRoot = footerHost.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML =
      `<div style="width:100%;overflow-x:auto;overflow-wrap:break-word">${this.prepareHtmlForRendering(footerHtml)}</div>`;
  }

  private prepareHtmlForRendering(html: string): string {
    // Data: URLs render natively in every context we care about (<img src>,
    // CSS url()). We intentionally skip blob-URL conversion: for reasons we
    // couldn't fully pin down, the conversion broke rendering of the first
    // large image inside contenteditable / shadow-root paths in settings,
    // while non-converted data URLs always work.
    return html;
  }

  private restoreEmbeddedDataImageUrls(html: string): string {
    let restored = html;
    for (const [objectUrl, dataUrl] of this.objectUrlMap.entries()) {
      restored = restored.split(objectUrl).join(dataUrl);
    }
    return restored;
  }

  private extractBodyHtml(editor: HTMLDivElement): string {
    const container = document.createElement('div');
    container.innerHTML = editor.innerHTML;
    container.querySelector('[data-editor-footer-root="true"]')?.remove();
    return this.stripInjectedFooter(this.restoreEmbeddedDataImageUrls(container.innerHTML));
  }

  private extractEditorText(editor: HTMLDivElement): string {
    const container = document.createElement('div');
    container.innerHTML = editor.innerHTML;
    container.querySelector('[data-editor-footer-root="true"]')?.remove();
    return container.innerText.trim();
  }

  private revokeObjectUrls(): void {
    // Legacy blob-URL cache is no longer populated (see prepareHtmlForRendering),
    // but we still sweep any stragglers left on disk from earlier versions.
    for (const objectUrl of this.objectUrlMap.keys()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrlMap.clear();
  }

  private stripInjectedFooter(html: string): string {
    const footerHtml = this.footerHtml()?.trim();
    if (!html) return html;
    if (!footerHtml) return this.stripTrailingSignatureMarkers(html);

    const normalizedFooter = footerHtml.replace(/\s+/g, ' ').trim();
    let bodyHtml = html.trim();
    const footerPrefix = footerHtml.slice(0, 200);

    const candidates = [
      `<br><br>--<br>${footerHtml}`,
      `<div><br><br>--<br></div>${footerHtml}`,
      footerHtml,
    ];

    for (const candidate of candidates) {
      if (bodyHtml.includes(candidate)) {
        bodyHtml = bodyHtml.replace(candidate, '').trim();
      }
    }

    if (footerPrefix && bodyHtml.includes(footerPrefix)) {
      bodyHtml = bodyHtml.slice(0, bodyHtml.indexOf(footerPrefix)).trim();
    }

    const normalizedBody = bodyHtml.replace(/\s+/g, ' ').trim();
    if (normalizedBody.endsWith(normalizedFooter)) {
      bodyHtml = bodyHtml.slice(0, Math.max(0, bodyHtml.length - footerHtml.length)).trim();
      bodyHtml = bodyHtml.replace(/(<br\s*\/?>\s*){1,3}--(<br\s*\/?>\s*)?$/i, '').trim();
    }

    const footerContainer = document.createElement('div');
    footerContainer.innerHTML = footerHtml;
    const footerText = footerContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!footerText) return this.stripTrailingSignatureMarkers(bodyHtml);

    const bodyContainer = document.createElement('div');
    bodyContainer.innerHTML = bodyHtml;
    const bodyText = bodyContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!bodyText.endsWith(footerText)) return this.stripTrailingSignatureMarkers(bodyHtml);

    const removedContainer = document.createElement('div');
    while (bodyContainer.lastChild) {
      const lastChild = bodyContainer.lastChild;
      removedContainer.prepend(lastChild);
      const removedText = removedContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (removedText.includes(footerText)) {
        break;
      }
    }

    bodyHtml = bodyContainer.innerHTML.trim();
    bodyHtml = this.stripTrailingSignatureMarkers(bodyHtml);

    return bodyHtml;
  }

  private stripTrailingSignatureMarkers(html: string): string {
    let cleaned = html.trim();
    const patterns = [
      /(?:<br\s*\/?>|\s|&nbsp;)*--(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /(?:<p|<div)[^>]*>\s*--\s*<\/(?:p|div)>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /<hr[^>]*>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /(?:<p|<div)[^>]*>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/(?:p|div)>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of patterns) {
        const next = cleaned.replace(pattern, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          changed = true;
        }
      }
    }

    if (this.isVisuallyEmpty(cleaned)) {
      return '';
    }

    return cleaned;
  }

  private isVisuallyEmpty(html: string): boolean {
    const normalized = html
      .replace(/<hr[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(div|p|span)[^>]*>/gi, '')
      .replace(/&nbsp;/gi, '')
      .replace(/-/g, '')
      .replace(/\s+/g, '')
      .trim();

    return normalized === '';
  }
}
