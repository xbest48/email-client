import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  ElementRef,
  viewChild,
  AfterViewInit,
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
      editor.innerHTML = this.initialContent();
    }
  }

  onInput(): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      this.contentChange.emit(editor.innerHTML);
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
    return this.editorRef()?.nativeElement.innerHTML ?? '';
  }

  setHtml(html: string): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      editor.innerHTML = html;
      this.onInput();
    }
  }

  clear(): void {
    const editor = this.editorRef()?.nativeElement;
    if (editor) {
      editor.innerHTML = '';
      this.onInput();
    }
  }

  isEmpty(): boolean {
    const editor = this.editorRef()?.nativeElement;
    if (!editor) return true;
    const text = editor.innerText.trim();
    return text === '' || text === '\n';
  }
}
