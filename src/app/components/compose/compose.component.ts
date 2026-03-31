import { Component, inject, signal, output, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GmailService } from '../../services/gmail.service';

@Component({
  selector: 'app-compose',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
      (click)="onClose()"
      (keydown.escape)="onClose()"
      role="presentation"
      aria-hidden="true"></div>

    <!-- Compose dialog -->
    <div
      class="fixed bottom-0 right-4 md:right-8 w-full max-w-lg z-50 flex flex-col
             bg-white rounded-t-2xl shadow-2xl border border-gray-200 max-h-[85vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Nouveau message">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 bg-gray-800 rounded-t-2xl">
        <h2 class="text-sm font-semibold text-white">Nouveau message</h2>
        <div class="flex items-center gap-1">
          <button
            (click)="minimized.set(!minimized())"
            class="p-1 text-gray-300 hover:text-white rounded transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            [attr.aria-label]="minimized() ? 'Agrandir' : 'Minimiser'">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/>
            </svg>
          </button>
          <button
            (click)="onClose()"
            class="p-1 text-gray-300 hover:text-white rounded transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            aria-label="Fermer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      @if (!minimized()) {
        <form (submit)="onSend($event)" class="flex flex-col flex-1 overflow-hidden">
          <!-- To -->
          <div class="flex items-center border-b border-gray-100 px-4">
            <label for="compose-to" class="text-sm text-gray-500 w-8 shrink-0">A</label>
            <input
              id="compose-to"
              type="email"
              [(ngModel)]="to"
              name="to"
              class="flex-1 py-2.5 text-sm text-gray-800 focus:outline-none"
              placeholder="destinataire@email.com"
              required
              autocomplete="email">
          </div>

          <!-- Cc toggle -->
          @if (!showCc()) {
            <div class="px-4 pt-1">
              <button type="button" (click)="showCc.set(true)"
                      class="text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded">
                Cc / Cci
              </button>
            </div>
          }

          @if (showCc()) {
            <div class="flex items-center border-b border-gray-100 px-4">
              <label for="compose-cc" class="text-sm text-gray-500 w-8 shrink-0">Cc</label>
              <input
                id="compose-cc"
                type="text"
                [(ngModel)]="cc"
                name="cc"
                class="flex-1 py-2.5 text-sm text-gray-800 focus:outline-none"
                placeholder="cc@email.com">
            </div>
            <div class="flex items-center border-b border-gray-100 px-4">
              <label for="compose-bcc" class="text-sm text-gray-500 w-8 shrink-0">Cci</label>
              <input
                id="compose-bcc"
                type="text"
                [(ngModel)]="bcc"
                name="bcc"
                class="flex-1 py-2.5 text-sm text-gray-800 focus:outline-none"
                placeholder="cci@email.com">
            </div>
          }

          <!-- Subject -->
          <div class="flex items-center border-b border-gray-100 px-4">
            <label for="compose-subject" class="text-sm text-gray-500 w-14 shrink-0">Objet</label>
            <input
              id="compose-subject"
              type="text"
              [(ngModel)]="subject"
              name="subject"
              class="flex-1 py-2.5 text-sm text-gray-800 focus:outline-none"
              placeholder="Objet du message">
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto">
            <label for="compose-body" class="sr-only">Corps du message</label>
            <textarea
              id="compose-body"
              [(ngModel)]="body"
              name="body"
              class="w-full h-full min-h-[200px] px-4 py-3 text-sm text-gray-800 resize-none focus:outline-none"
              placeholder="Ecrivez votre message..."
              required></textarea>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <button
              type="submit"
              class="px-6 py-2 bg-amber-500 text-white text-sm font-semibold rounded-xl
                     hover:bg-amber-600 transition-colors shadow-sm
                     focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
              [disabled]="sending() || !to() || !body()">
              @if (sending()) {
                Envoi...
              } @else {
                Envoyer
              }
            </button>
            <button
              type="button"
              (click)="onClose()"
              class="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors
                     focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label="Supprimer le brouillon">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class ComposeComponent {
  private readonly gmail = inject(GmailService);

  readonly close = output<void>();

  readonly to = signal('');
  readonly cc = signal('');
  readonly bcc = signal('');
  readonly subject = signal('');
  readonly body = signal('');
  readonly showCc = signal(false);
  readonly minimized = signal(false);
  readonly sending = signal(false);

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.to() || !this.body()) return;

    this.sending.set(true);
    try {
      await this.gmail.sendEmail(this.to(), this.subject(), this.body(), this.cc(), this.bcc());
      this.close.emit();
    } catch (err) {
      console.error('Failed to send email', err);
    } finally {
      this.sending.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
