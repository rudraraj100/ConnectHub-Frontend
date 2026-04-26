import { Injectable, inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Subject, of, timer } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';

export interface AppNotification {
  notificationId: number;
  recipientId:    string;
  actorId:        string;
  type:           string;   // NEW_MESSAGE | MENTION | ROOM_INVITE | SYSTEM
  title:          string;
  message:        string;
  roomId:         string | null;
  messageId:      string | null;
  isRead:         boolean;
  createdAt:      string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {

  private readonly GATEWAY = 'http://localhost:8080';
  private readonly http     = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy$ = new Subject<void>();

  readonly notifications$ = new BehaviorSubject<AppNotification[]>([]);
  readonly unreadCount$   = new BehaviorSubject<number>(0);

  // ── Auth helper ──────────────────────────────────────────────────────────

  private headers(): HttpHeaders | null {
    if (!isPlatformBrowser(this.platform)) return null;
    const token = localStorage.getItem('jwt_token');
    if (!token) return null;
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  // ── Start polling (call once on login) ───────────────────────────────────

  startPolling(): void {
    if (!isPlatformBrowser(this.platform)) return;

    // Load immediately, then every 30 s
    this.loadNotifications();
    timer(30_000, 30_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadNotifications());
  }

  // ── REST calls ───────────────────────────────────────────────────────────

  loadNotifications(): void {
    const h = this.headers();
    if (!h) return;

    this.http.get<any>(`${this.GATEWAY}/notifications/me`, { headers: h })
      .pipe(
        map(res => (res?.data ?? []) as AppNotification[]),
        catchError(() => of([] as AppNotification[]))
      )
      .subscribe(items => {
        this.notifications$.next(items);
        this.unreadCount$.next(items.filter(n => !n.isRead).length);
      });
  }

  markAsRead(id: number): void {
    const h = this.headers();
    if (!h) return;

    this.http.patch<any>(`${this.GATEWAY}/notifications/${id}/read`, {}, { headers: h })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        const updated = this.notifications$.value.map(n =>
          n.notificationId === id ? { ...n, isRead: true } : n
        );
        this.notifications$.next(updated);
        this.unreadCount$.next(updated.filter(n => !n.isRead).length);
      });
  }

  markAllRead(): void {
    const h = this.headers();
    if (!h) return;

    this.http.patch<any>(`${this.GATEWAY}/notifications/read-all`, {}, { headers: h })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        const updated = this.notifications$.value.map(n => ({ ...n, isRead: true }));
        this.notifications$.next(updated);
        this.unreadCount$.next(0);
      });
  }

  deleteNotification(id: number): void {
    const h = this.headers();
    if (!h) return;

    this.http.delete<any>(`${this.GATEWAY}/notifications/${id}`, { headers: h })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        const updated = this.notifications$.value.filter(n => n.notificationId !== id);
        this.notifications$.next(updated);
        this.unreadCount$.next(updated.filter(n => !n.isRead).length);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
