import { Injectable, inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, of, Subscription, timer } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface PresenceRecord {
  userId: string;
  status: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastSeenAt: string | null;
}

/**
 * PresenceService — manages real-time user status in the Angular frontend.
 *
 * Flow:
 *   1. startHeartbeat()  — sends POST /presence/heartbeat every 20s
 *   2. loadBulk(ids)     — POST /presence/bulk for contact list dots
 *   3. setStatus()       — PUT /presence/status?status=AWAY|OFFLINE on blur/logout
 *   4. presence$ map     — BehaviorSubject so components reactively read status
 *
 * Auth: All requests use the JWT from localStorage. If no token exists, the
 *       request is silently skipped to avoid sending "Bearer null" to the gateway.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService implements OnDestroy {

  private readonly GATEWAY  = 'http://localhost:8080';
  private readonly INTERVAL = 20_000;  // 20 s heartbeat

  private readonly http     = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);

  /** Map of userId → PresenceRecord, updated after every bulk fetch */
  readonly presence$ = new BehaviorSubject<Map<string, PresenceRecord>>(new Map());

  private heartbeatSub?: Subscription;
  private visibilityCb?: () => void;

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Returns auth headers, or null if no valid token is available.
   * Returning null prevents sending "Bearer null" which the gateway rejects with 401.
   */
  private headers(): HttpHeaders | null {
    if (!isPlatformBrowser(this.platform)) return null;
    const token = localStorage.getItem('jwt_token');
    if (!token) return null;
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  // ── heartbeat ──────────────────────────────────────────────────────────────

  /**
   * Start sending heartbeats every 20 s.
   * Listens for visibilitychange to send AWAY when tab is hidden.
   * Call this once after successful login.
   */
  startHeartbeat(): void {
    if (!isPlatformBrowser(this.platform)) return;

    this.sendHeartbeat();   // immediate first ping

    this.heartbeatSub = timer(this.INTERVAL, this.INTERVAL)
      .subscribe(() => this.sendHeartbeat());

    // AWAY on tab blur, ONLINE when tab regains focus
    this.visibilityCb = () => {
      if (document.hidden) {
        this.setStatus('AWAY').subscribe();
      } else {
        this.sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityCb);
  }

  stopHeartbeat(): void {
    this.heartbeatSub?.unsubscribe();
    if (this.visibilityCb && isPlatformBrowser(this.platform)) {
      document.removeEventListener('visibilitychange', this.visibilityCb);
    }
  }

  private sendHeartbeat(): void {
    const h = this.headers();
    if (!h) return;   // no token — skip silently

    this.http.post<any>(`${this.GATEWAY}/presence/heartbeat`, {}, { headers: h })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  // ── status update ─────────────────────────────────────────────────────────

  setStatus(status: 'ONLINE' | 'AWAY' | 'OFFLINE'): Observable<any> {
    const h = this.headers();
    if (!h) return of(null);  // no token — skip silently

    return this.http.put<any>(
      `${this.GATEWAY}/presence/status?status=${status}`, {},
      { headers: h }
    ).pipe(catchError(() => of(null)));
  }

  // ── bulk fetch (contact list dots) ────────────────────────────────────────

  /**
   * Fetches presence for all given userIds at once.
   * Updates presence$ BehaviorSubject so all subscribers get fresh dots.
   */
  loadBulk(userIds: string[]): Observable<Map<string, PresenceRecord>> {
    const h = this.headers();
    if (!h || !userIds.length) return of(new Map());

    return this.http.post<any>(
      `${this.GATEWAY}/presence/bulk`,
      userIds,
      { headers: h }
    ).pipe(
      map(res => {
        const raw: Record<string, PresenceRecord> = res?.data ?? {};
        const map = new Map<string, PresenceRecord>(Object.entries(raw));
        this.presence$.next(map);
        return map;
      }),
      catchError(() => of(new Map<string, PresenceRecord>()))
    );
  }

  // ── single user ───────────────────────────────────────────────────────────

  getPresence(userId: string): Observable<PresenceRecord | null> {
    const h = this.headers();
    if (!h) return of(null);

    return this.http.get<any>(
      `${this.GATEWAY}/presence/${userId}`,
      { headers: h }
    ).pipe(
      map(res => res?.data ?? null),
      catchError(() => of(null))
    );
  }

  // ── helper — get current status from map ─────────────────────────────────

  getStatus(userId: string): 'ONLINE' | 'AWAY' | 'OFFLINE' {
    return this.presence$.value.get(userId)?.status ?? 'OFFLINE';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  ngOnDestroy(): void {
    this.stopHeartbeat();
  }
}
