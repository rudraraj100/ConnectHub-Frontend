import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../auth.service';

/**
 * Handles the OAuth2 redirect from the Spring Boot backend.
 * URL: /oauth2/callback?token=JWT&refreshToken=...&userId=UUID
 *
 * Flow:
 *  1. Read tokens from query params
 *  2. Save tokens to localStorage
 *  3. Fetch /auth/profile (JWT is now available) → save user to 'current_user'
 *  4. Navigate to /dashboard
 */
@Component({
  selector: 'app-oauth2-callback',
  standalone: true,
  template: `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:100vh;background:#1a0a2e;color:#c084fc;
                font-family:'Outfit',sans-serif;gap:1rem;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
           stroke="#a855f7" stroke-width="2" style="animation:spin 1s linear infinite;">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span style="font-size:1.05rem;opacity:.85;">Completing sign-in…</span>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>
  `
})
export class OAuth2CallbackComponent implements OnInit {

  private route      = inject(ActivatedRoute);
  private router     = inject(Router);
  private authSvc    = inject(AuthService);
  private platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    const token        = this.route.snapshot.queryParamMap.get('token');
    const refreshToken = this.route.snapshot.queryParamMap.get('refreshToken');

    if (!token || !refreshToken) {
      // Missing tokens — something went wrong with the OAuth flow
      this.router.navigate(['/login'], { replaceUrl: true });
      return;
    }

    // 1️⃣ Persist tokens so subsequent API calls are authenticated
    this.authSvc.saveTokens(token, refreshToken);

    // 2️⃣ Fetch the full user profile (JWT is now in localStorage)
    //    and store it so the Chat UI can display the username
    this.authSvc.getProfile().subscribe({
      next: (res: any) => {
        const userData = res?.data;
        if (userData) {
          localStorage.setItem('current_user', JSON.stringify(userData));
        }
        // Route: admin → /admin, everyone else → /chat
        const email = userData?.email || '';
        const dest = email === 'rudrar2002@gmail.com' ? '/admin' : '/chat';
        this.router.navigate([dest], { replaceUrl: true });
      },
      error: () => {
        // Profile fetch failed — still go to /chat (no username shown)
        this.router.navigate(['/chat'], { replaceUrl: true });
      }
    });
  }
}
