import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="dashboard-page">
      <div class="glow-orb orb1"></div>
      <div class="glow-orb orb2"></div>

      <div class="dashboard-card">
        <div class="success-badge">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>

        <h1 class="title">Login Successful!</h1>
        <p class="subtitle">Welcome back to <span class="brand">ConnectHub</span></p>

        @if (username || fullName) {
          <div class="user-chip">
            <span class="avatar-letter">{{ (username || fullName).charAt(0).toUpperCase() }}</span>
            <span>{{ username || fullName }}</span>
          </div>
        }

        <div class="info-grid">
          <div class="info-item">
            <span class="info-icon">💬</span>
            <span>Real-time messaging ready</span>
          </div>
          <div class="info-item">
            <span class="info-icon">🔒</span>
            <span>JWT session active</span>
          </div>
          <div class="info-item">
            <span class="info-icon">⚡</span>
            <span>WebSocket standby</span>
          </div>
          <div class="info-item">
            <span class="info-icon">🌐</span>
            <span>Chat rooms available</span>
          </div>
        </div>

        <p class="coming-soon">Chat interface coming soon — stay tuned!</p>

        <button class="btn-logout" (click)="logout()" id="logout-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .dashboard-page {
      min-height: 100vh;
      background: linear-gradient(145deg, #1a0a2e 0%, #0f0520 60%, #2d1b4e 100%);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Outfit', sans-serif;
      position: relative; overflow: hidden;
    }

    .glow-orb {
      position: absolute; border-radius: 50%;
      filter: blur(80px); pointer-events: none;
    }
    .orb1 { width: 400px; height: 400px; background: rgba(168,85,247,0.15); top: -100px; right: -100px; }
    .orb2 { width: 300px; height: 300px; background: rgba(139,92,246,0.12); bottom: -80px; left: -80px; }

    .dashboard-card {
      position: relative; z-index: 2;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 24px; padding: 3rem 2.5rem;
      width: 100%; max-width: 480px;
      backdrop-filter: blur(24px);
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      text-align: center;
      animation: fadeUp .45s cubic-bezier(0.16,1,0.3,1);
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(32px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .success-badge {
      width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 1.5rem;
      background: rgba(168,85,247,0.12);
      border: 1px solid rgba(168,85,247,0.3);
      display: flex; align-items: center; justify-content: center;
      animation: pulse 2.5s ease infinite;
    }

    @keyframes pulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(168,85,247,0.3); }
      50%      { box-shadow: 0 0 0 14px rgba(168,85,247,0); }
    }

    .title { font-size: 2rem; font-weight: 800; color: #fff; letter-spacing: -.03em; margin-bottom: .4rem; }
    .subtitle { font-size: 1rem; color: rgba(255,255,255,0.6); margin-bottom: 1.5rem; }
    .brand { color: #c084fc; font-weight: 700; }

    .user-chip {
      display: inline-flex; align-items: center; gap: .65rem;
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 50px; padding: .5rem 1.2rem;
      font-size: .95rem; color: #e9d5ff; margin-bottom: 2rem;
    }
    .avatar-letter {
      width: 28px; height: 28px; border-radius: 50%;
      background: linear-gradient(135deg,#6b21a8,#a855f7);
      display: flex; align-items: center; justify-content: center;
      font-size: .8rem; font-weight: 700; color: #fff;
    }

    .info-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-bottom: 2rem;
    }
    .info-item {
      display: flex; align-items: center; gap: .6rem;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px; padding: .7rem .9rem;
      font-size: .82rem; color: rgba(255,255,255,0.7); text-align: left;
    }
    .info-icon { font-size: 1rem; }

    .coming-soon {
      font-size: .82rem; color: rgba(255,255,255,0.4);
      margin-bottom: 1.75rem; font-style: italic;
    }

    .btn-logout {
      display: inline-flex; align-items: center; gap: .5rem;
      padding: .75rem 2rem;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 10px; font-size: .9rem; font-weight: 500;
      font-family: 'Outfit', sans-serif; color: rgba(255,255,255,0.7);
      cursor: pointer; transition: all .25s ease;
    }
    .btn-logout:hover { background: rgba(248,113,113,0.15); border-color: rgba(248,113,113,0.3); color: #f87171; }
  `]
})
export class DashboardComponent implements OnInit {
  private router      = inject(Router);
  private platformId  = inject(PLATFORM_ID);

  username = '';
  fullName = '';

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Guard: must have a JWT — if not, send to login
      const token = localStorage.getItem('jwt_token');
      if (!token) { this.router.navigate(['/login']); return; }

      // Read saved profile (set by AuthService.saveTokens or OAuth2 callback)
      const raw = localStorage.getItem('current_user');
      if (raw) {
        try {
          const user = JSON.parse(raw);
          this.username = user?.username || '';
          this.fullName = user?.fullName || '';
        } catch { /* ignore malformed JSON */ }
      }
      // If current_user is missing but token exists (rare OAuth2 edge case),
      // we stay on dashboard without a username rather than bouncing to /login.
    }
  }

  logout() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('current_user');
    }
    this.router.navigate(['/login']);
  }
}
