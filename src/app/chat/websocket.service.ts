import { Injectable, inject, PLATFORM_ID, NgZone, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { Client, IMessage } from '@stomp/stompjs';

export type WsMessageHandler = (payload: any) => void;

/**
 * WebSocketService manages the real-time communication between the frontend and the backend.
 * It uses the STOMP protocol over WebSockets to send and receive messages instantly.
 */
@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {

  // Native WebSocket URL — ws:// instead of http:// eliminates SockJS polling entirely
  private readonly WS_URL   = 'ws://localhost:8080/ws';
  private readonly platform = inject(PLATFORM_ID);
  private readonly ngZone   = inject(NgZone);

  private client: Client | null = null;

  /** Fires true when connected, false when disconnected/not yet started */
  readonly connected$ = new BehaviorSubject<boolean>(false);

  // ── Connect / Disconnect ──────────────────────────────────────────────────

  connect(userId: string, token: string): void {
    if (!isPlatformBrowser(this.platform)) return;
    if (this.client?.active) return;   // already connected

    this.client = new Client({
      // Native WebSocket — no SockJS, no /ws/info polling.
      // The reactive gateway proxies this directly to websocket-handler:8087 via ws://
      brokerURL: this.WS_URL,

      // Pass JWT and userId in STOMP CONNECT headers
      connectHeaders: {
        Authorization: `Bearer ${token}`,
        'X-User-Id':   userId,
      },

      reconnectDelay: 5000,

      // All STOMP callbacks run OUTSIDE Angular's NgZone by default.
      // We must re-enter the zone so Angular's change detection triggers.

      onConnect: () => {
        // Defer to next tick — prevents NG0100 if CD is already running
        setTimeout(() => this.ngZone.run(() => {
          console.log('[WS] Connected to WebSocket handler');
          this.connected$.next(true);
        }), 0);
      },

      onDisconnect: () => {
        setTimeout(() => this.ngZone.run(() => {
          console.log('[WS] Disconnected');
          this.connected$.next(false);
        }), 0);
      },

      onStompError: (frame) => {
        this.ngZone.run(() => {
          console.error('[WS] STOMP error:', frame.headers['message']);
        });
      },
    });

    // Run the client activation outside NgZone to keep WebSocket polling
    // from triggering unnecessary Angular change detection cycles.
    this.ngZone.runOutsideAngular(() => {
      this.client!.activate();
    });
  }

  disconnect(): void {
    this.client?.deactivate();
    this.client = null;
    this.connected$.next(false);
  }

  // ── Subscribe to topics ───────────────────────────────────────────────────

  /**
   * Subscribe to a STOMP topic and call handler on each message.
   * Handler is always called INSIDE NgZone so Angular re-renders immediately.
   * Returns an unsubscribe function — call it when leaving the room.
   */
  subscribe(topic: string, handler: WsMessageHandler): () => void {
    if (!this.client?.active) {
      console.warn('[WS] subscribe() called before connection is ready:', topic);
      return () => {};
    }

    const sub = this.client.subscribe(topic, (frame: IMessage) => {
      // Re-enter Angular zone so change detection fires after handler modifies state
      this.ngZone.run(() => {
        try {
          const payload = JSON.parse(frame.body);
          handler(payload);
        } catch {
          handler(frame.body);   // plain text fallback
        }
      });
    });

    return () => sub.unsubscribe();
  }

  // ── Publish to /app/** endpoints ──────────────────────────────────────────

  /**
   * Sends a chat message to the server via WebSocket.
   * This handles both text and media messages (images, videos).
   */
  sendChatMessage(
    roomId:     string,
    content:    string,
    replyToId?: string,
    mediaUrl?:  string,
    mediaType?: 'IMAGE' | 'VIDEO' | 'FILE',
    senderName?: string    // display name forwarded to message-service and broadcast envelope
  ): void {
    this.publish('/app/chat.send', {
      roomId,
      content,
      type:       mediaType ?? 'TEXT',
      replyToId,
      mediaUrl:   mediaUrl   ?? null,
      mediaType:  mediaType  ?? null,
      // Pass the sender's display name so the WS handler can store it in the DB
      // and embed it in the broadcast — bypasses the broken auth-service Feign call.
      senderName: senderName ?? null,
    });
  }

  /** Send TYPING_INDICATOR frame to /app/chat.typing */
  sendTyping(roomId: string, isTyping: boolean): void {
    this.publish('/app/chat.typing', { roomId, isTyping });
  }

  /** Send READ_RECEIPT frame to /app/chat.read */
  sendReadReceipt(roomId: string, upToMessageId: string): void {
    this.publish('/app/chat.read', { roomId, upToMessageId });
  }

  /** Send REACTION frame to /app/chat.react */
  sendReaction(messageId: string, emoji: string): void {
    this.publish('/app/chat.react', { messageId, emoji });
  }

  private publish(destination: string, body: object): void {
    if (!this.client?.active) {
      console.warn('[WS] publish() called but not connected:', destination);
      return;
    }
    this.client.publish({
      destination,
      body: JSON.stringify(body),
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}