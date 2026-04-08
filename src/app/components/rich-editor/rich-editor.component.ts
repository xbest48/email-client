import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  ElementRef,
  viewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';

export type EditorToolbarPosition = 'top' | 'bottom';

@Component({
  selector: 'app-rich-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rich-editor.component.html',
  styleUrl: './rich-editor.component.css',
})
export class RichEditorComponent implements AfterViewInit {
  readonly placeholder = input('');
  readonly initialContent = input('');
  readonly toolbarPosition = input<EditorToolbarPosition>('top');
  readonly minHeight = input('150px');
  readonly contentChange = output<string>();

  readonly editorRef = viewChild<ElementRef<HTMLDivElement>>('editor');
  readonly showLinkInput = signal(false);
  readonly linkUrl = signal('');

  private objectUrlMap = new Map<string, string>();
  private lastSourceHtml = '';
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

  ngAfterViewInit(): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor && this.initialContent()) {
      this.setHtml(this.initialContent());
    }
  }

  ngOnDestroy(): void {
    this.revokeObjectUrls();
  }

  onInput(): void {
    if (this.suppressInput) return;
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      this.contentChange.emit(this.restoreEmbeddedDataImageUrls(editor.innerHTML));
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
    const html = this.editorRef()?.nativeElement.innerHTML;
    if (!html) return this.lastSourceHtml;
    return this.restoreEmbeddedDataImageUrls(html);
  }

  setHtml(html: string): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      this.lastSourceHtml = html;
      this.revokeObjectUrls();
      this.suppressInput = true;
      editor.innerHTML = this.prepareHtmlForRendering(html);
      this.suppressInput = false;
      this.onInput();
    }
  }

  clear(): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      this.lastSourceHtml = '';
      this.revokeObjectUrls();
      this.suppressInput = true;
      editor.innerHTML = '';
      this.suppressInput = false;
      this.onInput();
    }
  }

  isEmpty(): boolean {
    const editor = this.editorRef()?.nativeElement;
    if (!editor) return true;
    const text = editor.innerText.trim();
    return text === '' || text === '\n';
  }

  private prepareHtmlForRendering(html: string): string {
    return html.replace(
      /(<img\b[^>]*\bsrc\s*=\s*["'])(data:image\/[^;"']+;base64,[^"']+)(["'][^>]*>)/gi,
      (_match, prefix: string, dataUrl: string, suffix: string) => {
        const objectUrl = this.createObjectUrlFromDataImage(dataUrl);
        return `${prefix}${objectUrl}${suffix}`;
      },
    );
  }

  private restoreEmbeddedDataImageUrls(html: string): string {
    let restored = html;
    for (const [objectUrl, dataUrl] of this.objectUrlMap.entries()) {
      restored = restored.split(objectUrl).join(dataUrl);
    }
    return restored;
  }

  private createObjectUrlFromDataImage(dataUrl: string): string {
    const cached = Array.from(this.objectUrlMap.entries()).find(([, original]) => original === dataUrl)?.[0];
    if (cached) return cached;

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
    this.objectUrlMap.set(objectUrl, dataUrl);
    return objectUrl;
  }

  private revokeObjectUrls(): void {
    for (const objectUrl of this.objectUrlMap.keys()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrlMap.clear();
  }
}
