import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule }  from '@angular/common';
import { AuthService }   from '../auth.service';

/**
 * OTP verification page — shown after registration.
 * User enters the 6-digit code received in their inbox.
 */
@Component({
  selector: 'app-verify-email-sent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './verify-email-sent.component.html',
  styleUrl:    './verify-email-sent.component.css'
})
export class VerifyEmailSentComponent implements OnInit {

  private route       = inject(ActivatedRoute);
  private router      = inject(Router);
  private authService = inject(AuthService);

  email         = signal('');
  digits        = signal<string[]>(['', '', '', '', '', '']);

  verifyLoading = signal(false);
  verifySuccess = signal(false);
  verifyError   = signal('');

  resendLoading = signal(false);
  resendSuccess = signal(false);
  resendError   = signal('');
  resendCooldown = signal(0); // seconds remaining

  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  otpJustSent = signal(false);   // true when navigated here from login (OTP auto-sent)

  ngOnInit() {
    const e    = this.route.snapshot.queryParamMap.get('email') ?? '';
    const sent = this.route.snapshot.queryParamMap.get('sent');
    this.email.set(e);
    if (sent === '1') {
      this.otpJustSent.set(true);   // show "check your inbox" hint
    }
  }

  // ── OTP digit input handling ────────────────────────────────────

  onDigitInput(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const val   = input.value.replace(/\D/g, '').slice(-1);
    const arr   = [...this.digits()];
    arr[index]  = val;
    this.digits.set(arr);

    if (val && index < 5) {
      const next = document.getElementById(`otp-${index + 1}`) as HTMLInputElement;
      next?.focus();
    }
  }

  onDigitKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'Backspace') {
      const arr = [...this.digits()];
      if (!arr[index] && index > 0) {
        arr[index - 1] = '';
        this.digits.set(arr);
        const prev = document.getElementById(`otp-${index - 1}`) as HTMLInputElement;
        prev?.focus();
      } else {
        arr[index] = '';
        this.digits.set(arr);
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      (document.getElementById(`otp-${index - 1}`) as HTMLInputElement)?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      (document.getElementById(`otp-${index + 1}`) as HTMLInputElement)?.focus();
    }
  }

  onPaste(event: ClipboardEvent) {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) ?? '';
    const arr = pasted.split('').concat(['', '', '', '', '', '']).slice(0, 6);
    this.digits.set(arr);
    const lastFilled = Math.min(pasted.length, 5);
    (document.getElementById(`otp-${lastFilled}`) as HTMLInputElement)?.focus();
  }

  get otp(): string { return this.digits().join(''); }
  get otpComplete(): boolean { return this.otp.length === 6; }

  // ── Verify OTP ──────────────────────────────────────────────────

  verify() {
    if (!this.otpComplete || this.verifyLoading()) return;
    this.verifyLoading.set(true);
    this.verifyError.set('');

    this.authService.verifyOtp(this.email(), this.otp).subscribe({
      next: () => {
        this.verifySuccess.set(true);
        this.verifyLoading.set(false);
        // Auto-redirect to login after 2s
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.verifyError.set(err.error?.message || 'Incorrect OTP. Please try again.');
        this.verifyLoading.set(false);
        // Shake the inputs
        this.digits.set(['', '', '', '', '', '']);
        setTimeout(() => (document.getElementById('otp-0') as HTMLInputElement)?.focus(), 50);
      }
    });
  }

  // ── Resend OTP ──────────────────────────────────────────────────

  resend() {
    if (!this.email() || this.resendLoading() || this.resendCooldown() > 0) return;
    this.resendLoading.set(true);
    this.resendError.set('');
    this.resendSuccess.set(false);

    this.authService.resendVerification(this.email()).subscribe({
      next: () => {
        this.resendSuccess.set(true);
        this.resendLoading.set(false);
        this.startCooldown(60);
      },
      error: () => {
        this.resendError.set('Could not send email. Please try again later.');
        this.resendLoading.set(false);
      }
    });
  }

  private startCooldown(seconds: number) {
    this.resendCooldown.set(seconds);
    this.cooldownTimer = setInterval(() => {
      const remaining = this.resendCooldown() - 1;
      this.resendCooldown.set(remaining);
      if (remaining <= 0 && this.cooldownTimer) {
        clearInterval(this.cooldownTimer);
      }
    }, 1000);
  }

  goToLogin() { this.router.navigate(['/login']); }
}
