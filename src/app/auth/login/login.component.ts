import { Component, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {

  private fb          = inject(FormBuilder);
  private router      = inject(Router);
  private authService = inject(AuthService);
  private platformId  = inject(PLATFORM_ID);

  readonly GATEWAY_URL = 'http://localhost:8080'; // API Gateway

  loginForm: FormGroup = this.fb.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  showPassword    = signal(false);
  isLoading       = signal(false);
  loginError      = signal('');
  showForgotModal = signal(false);
  forgotEmail     = signal('');
  forgotSent      = signal(false);
  forgotLoading   = signal(false);
  forgotError     = signal('');
  forgotEmailNotRegistered = signal(false);

  get emailCtrl()    { return this.loginForm.get('email'); }
  get passwordCtrl() { return this.loginForm.get('password'); }

  togglePassword() { this.showPassword.update(v => !v); }

  // ── Login ────────────────────────────────────────────────────────
  onLogin() {
    if (this.loginForm.invalid) { this.loginForm.markAllAsTouched(); return; }
    this.isLoading.set(true);
    this.loginError.set('');

    this.authService.login(this.loginForm.value).subscribe({
      next: (res) => {
        // Tokens saved inside AuthService.login() via tap()
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loginError.set(err.error?.message || 'Invalid email or password.');
        this.isLoading.set(false);
      }
    });
  }

  // ── OAuth ─────────────────────────────────────────────────────────
  loginWithGoogle() {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `${this.GATEWAY_URL}/oauth2/authorization/google`;
    }
  }

  // ── Forgot Password ──────────────────────────────────────────────
  openForgotModal()  {
    this.showForgotModal.set(true);
    this.forgotSent.set(false);
    this.forgotError.set('');
    this.forgotEmailNotRegistered.set(false);
  }
  closeForgotModal() { this.showForgotModal.set(false); }
  onForgotEmailInput(e: Event) { this.forgotEmail.set((e.target as HTMLInputElement).value); }

  sendForgotPassword() {
    const email = this.forgotEmail().trim();
    if (!email) { this.forgotError.set('Please enter your email address.'); return; }
    this.forgotLoading.set(true);
    this.forgotError.set('');
    this.forgotEmailNotRegistered.set(false);

    this.authService.forgotPassword(email).subscribe({
      next: () => { this.forgotSent.set(true); this.forgotLoading.set(false); },
      error: (err) => {
        const msg = err.error?.message || 'Could not send reset email. Try again.';
        this.forgotError.set(msg);
        this.forgotEmailNotRegistered.set(
          msg.toLowerCase().includes('not registered') ||
          msg.toLowerCase().includes('sign up')
        );
        this.forgotLoading.set(false);
      }
    });
  }
}
