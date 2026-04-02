import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly loading = signal(false);

  async onRegister(): Promise<void> {
    if (!this.email() || !this.password()) return;

    this.loading.set(true);
    const success = await this.auth.register({
      email: this.email(),
      password: this.password(),
    });
    this.loading.set(false);

    if (success) {
      this.router.navigate(['/inbox']);
    }
  }
}
