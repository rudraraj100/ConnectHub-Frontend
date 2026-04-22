import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="page">
      <div class="card">
        <div class="logo">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="15" stroke="white" stroke-width="1.5"/>
            <path d="M8 12h16M8 16h10M8 20h13" stroke="#c084fc" stroke-width="2" stroke-linecap="round"/>
          </svg>
          ConnectHub
        </div>

        @if (!done()) {
          <h2>Set new password</h2>
          <p class="sub">Enter your new password below.</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <div class="field">
              <label>New Password</label>
              <input [type]="show() ? 'text' : 'password'"
                     formControlName="newPassword"
                     placeholder="Enter new password" />
            </div>
            @if (error()) { <p class="err">{{ error() }}</p> }
            <button type="submit" [disabled]="loading()">
              {{ loading() ? 'Resetting…' : 'Reset Password' }}
            </button>
          </form>
        } @else {
          <div class="success">
            <p>✅ Password reset successfully!</p>
            <a routerLink="/login">Back to Sign In</a>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { min-height:100vh; background:linear-gradient(145deg,#1a0a2e,#0f0520);
            display:flex; align-items:center; justify-content:center; font-family:'Outfit',sans-serif; }
    .card { background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.15);
            border-radius:20px; padding:2.5rem; width:100%; max-width:400px; color:#fff; }
    .logo { display:flex; align-items:center; gap:.6rem; font-size:1.3rem; font-weight:700; margin-bottom:1.5rem; color:#c084fc; }
    h2 { font-size:1.5rem; margin-bottom:.3rem; }
    .sub { color:rgba(255,255,255,0.6); margin-bottom:1.5rem; font-size:.9rem; }
    .field label { display:block; font-size:.8rem; color:#e9d5ff; margin-bottom:.4rem; text-transform:uppercase; }
    .field input { width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);
                   border-radius:8px; padding:.8rem 1rem; color:#fff; font-family:'Outfit',sans-serif;
                   font-size:.95rem; outline:none; box-sizing:border-box; }
    button { width:100%; margin-top:1.25rem; padding:.85rem; background:linear-gradient(135deg,#6b21a8,#a855f7);
             border:none; border-radius:8px; color:#fff; font-size:.95rem; font-weight:600;
             font-family:'Outfit',sans-serif; cursor:pointer; }
    button:disabled { opacity:.6; cursor:not-allowed; }
    .err { color:#f87171; font-size:.83rem; margin-top:.5rem; }
    .success { text-align:center; }
    .success a { color:#c084fc; }
  `]
})
export class ResetPasswordComponent implements OnInit {

  private route   = inject(ActivatedRoute);
  private router  = inject(Router);
  private authSvc = inject(AuthService);
  private fb      = inject(FormBuilder);

  form: FormGroup = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(6)]]
  });

  show    = signal(false);
  loading = signal(false);
  error   = signal('');
  done    = signal(false);
  token   = '';

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) this.router.navigate(['/login']);
  }

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');

    this.authSvc.resetPassword(this.token, this.form.value.newPassword).subscribe({
      next: () => { this.done.set(true); this.loading.set(false); },
      error: (err) => {
        this.error.set(err.error?.message || 'Reset failed. The link may have expired.');
        this.loading.set(false);
      }
    });
  }
}
