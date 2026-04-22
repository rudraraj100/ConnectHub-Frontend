import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, tap } from 'rxjs';

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
    user: UserProfile;
  };
}

export interface UserProfile {
  userId: string;
  username: string;
  email: string;
  fullName: string;
  avatarUrl: string;
  bio: string;
  status: string;
  provider: string;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  country?: string;
  city?: string;
  countryCode?: string;
  phoneNumber?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  // All traffic routes through API Gateway (port 8080)
  private readonly BASE_URL = 'http://localhost:8080/auth';
  private readonly http     = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);

  // ── Storage helpers ────────────────────────────────────────────
  saveTokens(token: string, refreshToken: string, user?: UserProfile): void {
    if (isPlatformBrowser(this.platform)) {
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('refresh_token', refreshToken);
      if (user) localStorage.setItem('current_user', JSON.stringify(user));
    }
  }

  getToken(): string | null {
    return isPlatformBrowser(this.platform)
      ? localStorage.getItem('jwt_token')
      : null;
  }

  getRefreshToken(): string | null {
    return isPlatformBrowser(this.platform)
      ? localStorage.getItem('refresh_token')
      : null;
  }

  clearTokens(): void {
    if (isPlatformBrowser(this.platform)) {
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('current_user');
    }
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.getToken()}` });
  }

  // ── API calls ──────────────────────────────────────────────────

  register(payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    country?: string;
    city?: string;
    countryCode?: string;
    phoneNumber?: string;
  }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.BASE_URL}/register`, payload).pipe(
      tap(res => {
        if (res.success)
          this.saveTokens(res.data.token, res.data.refreshToken, res.data.user);
      })
    );
  }

  login(payload: { email: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.BASE_URL}/login`, payload).pipe(
      tap(res => {
        if (res.success)
          this.saveTokens(res.data.token, res.data.refreshToken, res.data.user);
      })
    );
  }

  logout(): Observable<any> {
    return this.http.post(`${this.BASE_URL}/logout`, {}, {
      headers: this.authHeaders()
    });
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.BASE_URL}/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.BASE_URL}/reset-password`, { token, newPassword });
  }

  getProfile(): Observable<any> {
    return this.http.get(`${this.BASE_URL}/profile`, { headers: this.authHeaders() });
  }

  updateProfile(data: Partial<UserProfile>): Observable<any> {
    return this.http.put(`${this.BASE_URL}/profile`, data, { headers: this.authHeaders() });
  }

  updateStatus(status: string): Observable<any> {
    return this.http.put(`${this.BASE_URL}/status`, { status }, { headers: this.authHeaders() });
  }

  searchUsers(username: string): Observable<any> {
    return this.http.get(`${this.BASE_URL}/search?username=${username}`, {
      headers: this.authHeaders()
    });
  }

  checkUsernameAvailability(username: string): Observable<any> {
    return this.http.get(`${this.BASE_URL}/check-username?username=${encodeURIComponent(username)}`);
  }
}
