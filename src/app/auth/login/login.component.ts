import { Component, signal, inject, PLATFORM_ID, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {

  private fb          = inject(FormBuilder);
  private router      = inject(Router);
  private route       = inject(ActivatedRoute);
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
  suspendedBanner = signal(false);
  showForgotModal = signal(false);
  forgotEmail     = signal('');
  forgotSent      = signal(false);
  forgotLoading   = signal(false);
  forgotError     = signal('');
  forgotEmailNotRegistered = signal(false);

  // Email verification state
  emailNotVerified   = signal(false);   // true when backend returns EMAIL_NOT_VERIFIED
  resendEmail        = signal('');      // holds the email typed in the form
  resendLoading      = signal(false);
  resendSuccess      = signal(false);

  ngOnInit() {
    // Check for ?error=suspended (set by authInterceptor on 403) or ?error=session_expired
    const err = this.route.snapshot.queryParamMap.get('error');
    if (err === 'suspended') {
      this.suspendedBanner.set(true);
      this.loginError.set('Your account has been suspended. Please contact support.');
    }
  }

  get emailCtrl()    { return this.loginForm.get('email'); }
  get passwordCtrl() { return this.loginForm.get('password'); }

  togglePassword() { this.showPassword.update(v => !v); }

  onLogin() {
    if (this.loginForm.invalid) { this.loginForm.markAllAsTouched(); return; }
    this.isLoading.set(true);
    this.loginError.set('');
    this.emailNotVerified.set(false);
    this.resendSuccess.set(false);

    this.authService.login(this.loginForm.value).subscribe({
      next: (res) => {
        const email = res?.data?.user?.email || this.loginForm.value.email || '';
        if (email === 'rudrar2002@gmail.com') {
          this.router.navigate(['/admin']);
        } else {
          this.router.navigate(['/chat']);
        }
      },
      error: (err) => {
        const msg: string = err.error?.message || '';
        if (msg === 'EMAIL_NOT_VERIFIED') {
          this.emailNotVerified.set(true);
          this.resendEmail.set(this.loginForm.value.email || '');
        } else {
          this.loginError.set(msg || 'Invalid email or password.');
        }
        this.isLoading.set(false);
      }
    });
  }

  // ── Resend verification OTP ──────────────────────────────────────
  resendVerification() {
    const email = this.resendEmail();
    if (!email || this.resendLoading()) return;
    this.resendLoading.set(true);
    this.resendSuccess.set(false);
    this.authService.resendVerification(email).subscribe({
      next: () => { this.resendSuccess.set(true); this.resendLoading.set(false); },
      error: ()  => { this.resendLoading.set(false); }
    });
  }

  // Navigate to OTP entry page — auto-sends a fresh OTP first
  goToOtpPage() {
    const email = this.resendEmail();
    if (!email) return;

    this.resendLoading.set(true);

    // Always send a fresh OTP before taking the user to the OTP page
    // (existing/unverified users won't have a code in Redis otherwise)
    this.authService.resendVerification(email).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.router.navigate(['/verify-email-sent'], {
          queryParams: { email, sent: '1' }   // sent=1 signals page that OTP was just emailed
        });
      },
      error: () => {
        this.resendLoading.set(false);
        // Navigate anyway — user can click Resend on the OTP page
        this.router.navigate(['/verify-email-sent'], {
          queryParams: { email }
        });
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
