import { Injectable, inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Subject, of, timer } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';
import { Client, IMessage } from '@stomp/stompjs';

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

  private readonly GATEWAY      = 'http://localhost:8080';
  // BUG 1 FIX: The notification-service has its OWN STOMP broker exposed at
  // /ws-notifications — completely separate from the chat handler at /ws.
  // NotifServiceImpl.send() pushes to /topic/notifications/{userId} on THIS
  // broker. The frontend was never connecting here, so all real-time pushes
  // were silently lost. Polling still returned data via REST, masking the bug.
  // Connect to the raw STOMP endpoint — no /websocket suffix.
  // /websocket is SockJS-specific (HTTP polling handshake sub-path).
  // notification-service WebSocketConfig uses no SockJS, so the
  // WebSocket upgrade happens at exactly /ws-notifications.
  private readonly WS_NOTIF_URL = 'ws://localhost:8080/ws-notifications';

  private readonly http     = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy$ = new Subject<void>();

  // STOMP client dedicated to the notification-service broker
  private stompClient: Client | null = null;

  readonly notifications$ = new BehaviorSubject<AppNotification[]>([]);
  readonly unreadCount$   = new BehaviorSubject<number>(0);
  /** Emits once per incoming notification — drives the 3-second toast popup. */
  readonly toast$         = new Subject<AppNotification>();

  // ── Auth helper ──────────────────────────────────────────────────────────

  private headers(): HttpHeaders | null {
    if (!isPlatformBrowser(this.platform)) return null;
    const token = localStorage.getItem('jwt_token');
    if (!token) return null;
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private token(): string | null {
    if (!isPlatformBrowser(this.platform)) return null;
    return localStorage.getItem('jwt_token');
  }

  // ── Start polling + WebSocket (call once on login) ───────────────────────

  startPolling(userId: string): void {
    if (!isPlatformBrowser(this.platform)) return;

    // 1. Seed the list immediately via REST
    this.loadNotifications();

    // 2. Keep REST as a fallback safety net every 30 s
    timer(30_000, 30_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadNotifications());

    // 3. BUG 1 FIX: Subscribe to real-time pushes via the notification-service
    //    STOMP broker so new notifications appear instantly without waiting for
    //    the 30-second REST poll.
    this.connectWebSocket(userId);
  }

  // ── WebSocket connection to notification-service ─────────────────────────

  private connectWebSocket(userId: string): void {
    if (this.stompClient?.active) return;

    const jwt = this.token();

    this.stompClient = new Client({
      // Connects to ws://localhost:8080/ws-notifications via the API Gateway.
      // Gateway routes /ws-notifications/** → ws://localhost:8086 (notification-service).
      // No SockJS — raw STOMP over native WebSocket. SockJS was removed from
      // notification-service WebSocketConfig to match the Gateway's ws:// proxy protocol.
      brokerURL: this.WS_NOTIF_URL,

      connectHeaders: jwt ? {
        Authorization: `Bearer ${jwt}`,
        'X-User-Id':   userId,
      } : {},

      reconnectDelay: 10_000,

      onConnect: () => {
        console.log('[NotifWS] Connected to notification broker');

        // Subscribe to the personal notification topic.
        // NotifServiceImpl.send() broadcasts to exactly this destination:
        //   ws.convertAndSend("/topic/notifications/" + recipientId, dto)
        this.stompClient!.subscribe(
          `/topic/notifications/${userId}`,
          (frame: IMessage) => {
            try {
              const incoming = JSON.parse(frame.body);
              // BUG 3 FIX: normalise isRead vs read (see loadNotifications comment)
              const notif: AppNotification = {
                ...incoming,
                isRead: incoming.isRead ?? incoming.read ?? false,
              };
              // Prepend — newest first, consistent with REST order
              const current = this.notifications$.value;
              this.notifications$.next([notif, ...current]);
              if (!notif.isRead) {
                this.unreadCount$.next(this.unreadCount$.value + 1);
              }
              // Fire the toast so the chat component can show the popup
              this.toast$.next(notif);
            } catch (e) {
              console.error('[NotifWS] Failed to parse notification frame', e);
            }
          }
        );
      },

      onStompError: (frame) => {
        console.error('[NotifWS] STOMP error:', frame.headers['message']);
      },

      onDisconnect: () => {
        console.log('[NotifWS] Disconnected from notification broker');
      },
    });

    this.stompClient.activate();
  }

  // ── REST calls ───────────────────────────────────────────────────────────

  loadNotifications(): void {
    const h = this.headers();
    if (!h) return;

    this.http.get<any>(`${this.GATEWAY}/notifications/me`, { headers: h })
      .pipe(
        // BUG 3 FIX (backend): NotificationDTO had `private boolean isRead`
        // which Lombok @Data turns into an isRead() getter. Jackson strips the
        // "is" prefix and serialises as "read", not "isRead".
        // The backend fix adds @JsonProperty("isRead") to force correct naming.
        // This map() is a defensive client-side normaliser that handles both
        // "isRead" (fixed backend) and "read" (old backend) transparently.
        map(res => {
          const items = (res?.data ?? []) as any[];
          return items.map(n => ({
            ...n,
            isRead: n.isRead ?? n.read ?? false,
          })) as AppNotification[];
        }),
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

  /**
   * Pushes a synthetic local notification into the bell counter for online users.
   * Called by ChatComponent when a NEW_MESSAGE WS event arrives for a room the
   * user is NOT currently viewing. The notification-service only stores
   * notifications for OFFLINE users; for online users we inject one locally so
   * the bell badge updates without waiting for the 30-second REST poll.
   */
  pushRoomNotification(roomName: string, preview: string): void {
    const synthetic: AppNotification = {
      notificationId: Date.now(),   // synthetic ID — never synced to server
      recipientId:    '',
      actorId:        '',
      type:           'NEW_MESSAGE',
      title:          `New message in ${roomName}`,
      message:        preview || 'New message',
      roomId:         null,
      messageId:      null,
      isRead:         false,
      createdAt:      new Date().toISOString(),
    };
    this.notifications$.next([synthetic, ...this.notifications$.value]);
    this.unreadCount$.next(this.unreadCount$.value + 1);
    // Fire the toast for the 3-second sidebar popup
    this.toast$.next(synthetic);
  }

  ngOnDestroy(): void {
    this.stompClient?.deactivate();
    this.stompClient = null;
    this.destroy$.next();
    this.destroy$.complete();
  }
}