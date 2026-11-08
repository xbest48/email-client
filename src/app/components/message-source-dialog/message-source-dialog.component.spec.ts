import { TestBed } from '@angular/core/testing';
import { MessageSourceDialogComponent } from './message-source-dialog.component';
import { EmailService } from '../../services/email.service';

describe('MessageSourceDialogComponent', () => {
  const raw = 'Subject: Facture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nÉté 2026';

  async function render(fetchMessageSource: () => Promise<Blob>) {
    TestBed.configureTestingModule({
      imports: [MessageSourceDialogComponent],
      providers: [{ provide: EmailService, useValue: { fetchMessageSource } }],
    });
    const fixture = TestBed.createComponent(MessageSourceDialogComponent);
    fixture.componentRef.setInput('folder', 'INBOX');
    fixture.componentRef.setInput('uid', 42);
    fixture.detectChanges();
    // FileReader resolves outside Angular's view of pending work.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    return fixture;
  }

  it('shows the raw source decoded as UTF-8', async () => {
    const fixture = await render(() => Promise.resolve(new Blob([new TextEncoder().encode(raw)])));

    const pre: HTMLElement = fixture.nativeElement.querySelector('pre');
    expect(pre.textContent).toContain('Subject: Facture');
    expect(pre.textContent).toContain('Été 2026');
    expect(fixture.nativeElement.querySelector('[role="dialog"]').getAttribute('aria-labelledby'))
      .toBe('message-source-title');
  });

  it('shows an error when the source cannot be loaded', async () => {
    const fixture = await render(() => Promise.reject(new Error('502')));

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('Impossible de charger la source');
  });

  it('emits close on Escape', async () => {
    const fixture = await render(() => Promise.resolve(new Blob([raw])));
    let closed = false;
    fixture.componentInstance.close.subscribe(() => (closed = true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closed).toBe(true);
  });
});
