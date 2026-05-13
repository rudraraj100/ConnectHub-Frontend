import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

/**
 * This component is deprecated — email verification now uses OTP.
 * Kept to avoid broken imports; redirects to the OTP page.
 */
@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `<p style="color:white;padding:2rem">Redirecting…</p>`
})
export class VerifyEmailComponent implements OnInit {
  private router = inject(Router);

  ngOnInit() {
    // Old link-based flow removed — redirect to OTP page
    this.router.navigate(['/verify-email-sent']);
  }
}
