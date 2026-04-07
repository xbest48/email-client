import { Directive, ElementRef, inject, input, effect } from '@angular/core';

@Directive({
  selector: '[appSandboxedHtml]',
})
export class SandboxedHtmlDirective {
  private readonly el = inject(ElementRef);

  readonly appSandboxedHtml = input<string | null>(null);

  private shadowRoot: ShadowRoot;

  constructor() {
    this.shadowRoot = this.el.nativeElement.attachShadow({ mode: 'open' });

    effect(() => {
      const html = this.appSandboxedHtml();
      if (html) {
        this.shadowRoot.innerHTML = `<div style="width:100%;overflow-x:auto;overflow-wrap:break-word">${html}</div>`;
      } else {
        this.shadowRoot.innerHTML = '';
      }
    });
  }
}
