import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, TimeoutError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

// ── DTOs matching backend responses ─────────────────────────────────────────

export interface AdminUser {
  userId:       string;
  username:     string;
  email:        string;
  fullName:     string;
  avatarUrl:    string;
  status:       string;
  isActive:     boolean;
  role:         string;   // 'MEMBER' | 'PLATFORM_ADMIN'
  createdAt:    string;
  lastSeenAt:   string | null;
  country:      string | null;
  city:         string | null;
}

export interface AdminRoom {
  roomId:      string;
  name:        string;
  description: string | null;
  type:        string;   // GROUP | DM
  memberCount: number;
  createdAt:   string;
  createdBy:   string;
}

export interface UserReport {
  reportId:          string;
  reporterId:        string;
  reporterUsername:  string;
  reportedUserId:    string;
  reportedUsername:  string;
  reason:            string;
  details:           string | null;
  status:            'PENDING' | 'RESOLVED' | 'DISMISSED';
  createdAt:         string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {

  private readonly GATEWAY  = 'http://localhost:8080';
  private readonly platform = inject(PLATFORM_ID);
  private readonly http     = inject(HttpClient);

  // ── Auth headers ─────────────────────────────────────────────────────────

  private headers(): HttpHeaders | null {
    if (!isPlatformBrowser(this.platform)) return null;
    const token = localStorage.getItem('jwt_token');
    if (!token) return null;
    // Only set Authorization — Angular's HttpClient auto-sets Content-Type
    // for JSON bodies. Explicitly setting it can cause CORS preflight issues.
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
    });
  }

  // ── Users ────────────────────────────────────────────────────────────────

  /** GET /auth/admin/users — list all platform users */
  getUsers(): Observable<AdminUser[]> {
    const h = this.headers();
    if (!h) return of([]);
    return this.http
      .get<any>(`${this.GATEWAY}/auth/admin/users`, { headers: h })
      .pipe(
        // Jackson serializes Lombok's isActive() getter as "active" (strips is-prefix).
        // Normalize both field names so the UI works before AND after the backend restart.
        map(res => (res?.data ?? []).map((u: any) => ({
          ...u,
          isActive: !!(u.isActive ?? u['active'])
        })) as AdminUser[]),
        catchError(err => {
          console.error('[AdminService] GET /auth/admin/users failed', err.status, err.error);
          return of([] as AdminUser[]);
        })
      );
  }

  /** PATCH /auth/admin/users/{userId}/toggle — suspend or reactivate */
  toggleUser(userId: string): Observable<AdminUser | null> {
    const h = this.headers();
    if (!h) return of(null);
    return this.http
      .patch<any>(`${this.GATEWAY}/auth/admin/users/${userId}/toggle`, {}, { headers: h })
      .pipe(
        map(res => {
          const u = res?.data;
          if (!u) return null;
          return { ...u, isActive: !!(u.isActive ?? u['active']) } as AdminUser;
        }),
        catchError(() => of(null))
      );
  }

  /** DELETE /auth/admin/users/{userId} — hard-delete a user */
  deleteUser(userId: string): Observable<boolean> {
    const h = this.headers();
    if (!h) return of(false);
    return this.http
      .delete<any>(`${this.GATEWAY}/auth/admin/users/${userId}`, { headers: h })
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  /** GET /rooms/admin/all — list all rooms */
  getRooms(): Observable<AdminRoom[]> {
    const h = this.headers();
    if (!h) return of([]);
    return this.http
      .get<any>(`${this.GATEWAY}/rooms/admin/all`, { headers: h })
      .pipe(
        map(res => (res?.data ?? []) as AdminRoom[]),
        catchError(err => {
          console.error('[AdminService] GET /rooms/admin/all failed', err.status, err.error);
          return of([] as AdminRoom[]);
        })
      );
  }

  /** DELETE /rooms/admin/{roomId} — hard-delete any room */
  deleteRoom(roomId: string): Observable<boolean> {
    const h = this.headers();
    if (!h) return of(false);
    return this.http
      .delete<any>(`${this.GATEWAY}/rooms/admin/${roomId}`, { headers: h })
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  // ── Broadcast ────────────────────────────────────────────────────────────

  /**
   * POST /notifications/broadcast — send a SYSTEM notification to all users.
   * The frontend passes the user list it already fetched to avoid an extra
   * auth-service call from the notification service.
   */
  broadcast(recipientIds: string[], title: string, message: string): Observable<boolean> {
    const h = this.headers();
    if (!h) return of(false);
    return this.http
      .post<any>(`${this.GATEWAY}/notifications/broadcast`,
        { recipientIds, title, message }, { headers: h })
      .pipe(
        map(() => true),
        timeout(15000),   // never block the UI for more than 15 s
        catchError(err => {
          if (err instanceof TimeoutError) {
            console.error('[AdminService] Broadcast timed out after 15 s');
          } else {
            console.error('[AdminService] Broadcast failed', err.status, err.error);
          }
          return of(false);
        })
      );
  }

  // ── Reports ─────────────────────────────────────────────────

  /** GET /auth/admin/reports — all reports, newest first */
  getReports(): Observable<UserReport[]> {
    const h = this.headers();
    if (!h) return of([]);
    return this.http
      .get<any>(`${this.GATEWAY}/auth/admin/reports`, { headers: h })
      .pipe(
        map(res => (res?.data ?? []) as UserReport[]),
        catchError(err => {
          console.error('[AdminService] GET reports failed', err.status);
          return of([] as UserReport[]);
        })
      );
  }

  /** PATCH /auth/admin/reports/{id}/status?action=RESOLVED|DISMISSED */
  updateReportStatus(reportId: string, action: 'RESOLVED' | 'DISMISSED'): Observable<UserReport | null> {
    const h = this.headers();
    if (!h) return of(null);
    return this.http
      .patch<any>(
        `${this.GATEWAY}/auth/admin/reports/${reportId}/status?action=${action}`,
        {}, { headers: h })
      .pipe(
        map(res => res?.data as UserReport ?? null),
        catchError(() => of(null))
      );
  }

  /** POST /auth/reports — any authenticated user submits a report */
  submitReport(reportedUsername: string, reason: string, details: string): Observable<boolean> {
    const h = this.headers();
    if (!h) return of(false);
    return this.http
      .post<any>(`${this.GATEWAY}/auth/reports`,
        { reportedUsername, reason, details }, { headers: h })
      .pipe(
        map(() => true),
        catchError(err => {
          console.error('[AdminService] Submit report failed', err.status, err.error);
          return of(false);
        })
      );
  }
}
