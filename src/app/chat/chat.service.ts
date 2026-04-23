import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

export interface UserProfile {
  userId: string;
  username: string;
  email: string;
  fullName: string;
  avatarUrl: string;
  bio: string;
  status: string;       // ONLINE | OFFLINE | AWAY
  provider: string;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
  country?: string;
  city?: string;
  countryCode?: string;
  phoneNumber?: string;
}

export interface RoomResponse {
  roomId: string;
  name: string;
  description: string;
  type: string;           // GROUP | DM
  avatarUrl: string;
  maxMembers: number;
  memberCount: number;
  createdBy: string;
  inviteLink: string;
  lastMessageAt: string;
  createdAt: string;
  unreadCount: number;
  currentUserRole: string; // ADMIN | MEMBER
}

export interface RoomMemberResponse {
  userId: string;
  username: string;
  fullName: string;
  avatarUrl: string;
  role: string;        // ADMIN | MEMBER
  isMuted: boolean;
  status: string;      // ONLINE | OFFLINE | AWAY
  joinedAt: string;
  lastReadAt: string;
}

export interface MessageResponse {
  messageId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  content: string;
  type: string;
  fileUrl: string;
  isPinned: boolean;
  isDeleted: boolean;
  replyToId: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {

  private readonly GATEWAY  = 'http://localhost:8080';
  private readonly http     = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);

  private authHeaders(): HttpHeaders {
    const token = isPlatformBrowser(this.platform) ? localStorage.getItem('jwt_token') : null;
    return new HttpHeaders({
      Authorization: `Bearer ${token}`
      // X-User-Id is injected by JwtGatewayFilter — never sent from the client
    });
  }

  // ── Auth Service ───────────────────────────────────────────────

  getMyProfile(): Observable<UserProfile | null> {
    return this.http
      .get<any>(`${this.GATEWAY}/auth/profile`, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  searchUsers(keyword: string): Observable<UserProfile[]> {
    if (!keyword.trim()) return of([]);
    return this.http
      .get<any>(`${this.GATEWAY}/auth/search?username=${encodeURIComponent(keyword)}`,
        { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? []), catchError(() => of([])));
  }

  getUserById(userId: string): Observable<UserProfile | null> {
    return this.http
      .get<any>(`${this.GATEWAY}/auth/users/${userId}`, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  updateStatus(status: 'ONLINE' | 'AWAY' | 'DND' | 'INVISIBLE'): Observable<any> {
    return this.http
      .put<any>(`${this.GATEWAY}/auth/status`, { status }, { headers: this.authHeaders() })
      .pipe(catchError(() => of(null)));
  }

  updateProfile(patch: {
    fullName?: string; username?: string; bio?: string; avatarUrl?: string;
    country?: string; city?: string; countryCode?: string; phoneNumber?: string;
  }): Observable<any> {
    return this.http
      .put<any>(`${this.GATEWAY}/auth/profile`, patch, { headers: this.authHeaders() })
      .pipe(
        map((res: any) => res?.data ?? null),
        tap((updated: any) => {
          if (updated && isPlatformBrowser(this.platform)) {
            try {
              const stored = JSON.parse(localStorage.getItem('current_user') || '{}');
              localStorage.setItem('current_user', JSON.stringify({ ...stored, ...updated }));
            } catch { /* ignore */ }
          }
        }),
        catchError(() => of(null))
      );
  }

  logout(): Observable<any> {
    return this.http
      .post<any>(`${this.GATEWAY}/auth/logout`, {}, { headers: this.authHeaders() })
      .pipe(catchError(() => of(null)));
  }

  // ── Room Service ───────────────────────────────────────────────

  /** Get all rooms the current user belongs to */
  getMyRooms(): Observable<RoomResponse[]> {
    return this.http
      .get<any>(`${this.GATEWAY}/rooms/my`, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? []), catchError(() => of([])));
  }

  /** Create a new GROUP room */
  createRoom(name: string, description: string, maxMembers: number = 100): Observable<RoomResponse | null> {
    return this.http
      .post<any>(`${this.GATEWAY}/rooms`,
        { name, description, type: 'GROUP', maxMembers },
        { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  /** Get room details */
  getRoomById(roomId: string): Observable<RoomResponse | null> {
    return this.http
      .get<any>(`${this.GATEWAY}/rooms/${roomId}`, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  /** Get members of a room */
  getRoomMembers(roomId: string): Observable<RoomMemberResponse[]> {
    return this.http
      .get<any>(`${this.GATEWAY}/rooms/${roomId}/members`, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? []), catchError(() => of([])));
  }

  /** Add a member to a room */
  addMemberToRoom(roomId: string, userId: string, role: string = 'MEMBER'): Observable<RoomMemberResponse | null> {
    return this.http
      .post<any>(`${this.GATEWAY}/rooms/${roomId}/members`,
        { userId, role },
        { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  /** Remove a member from a room (Room Admin only) */
  removeMember(roomId: string, userId: string): Observable<boolean> {
    return this.http
      .delete<any>(`${this.GATEWAY}/rooms/${roomId}/members/${userId}`,
        { headers: this.authHeaders() })
      .pipe(map(() => true), catchError(() => of(false)));
  }

  /** Change member's role (Room Admin only) */
  changeMemberRole(roomId: string, userId: string, role: string): Observable<RoomMemberResponse | null> {
    return this.http
      .patch<any>(`${this.GATEWAY}/rooms/${roomId}/members/${userId}/role?role=${role}`,
        {}, { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  /** Send a message to a room */
  sendRoomMessage(roomId: string, content: string): Observable<MessageResponse | null> {
    return this.http
      .post<any>(`${this.GATEWAY}/rooms/${roomId}/messages`,
        { content, type: 'TEXT' },
        { headers: this.authHeaders() })
      .pipe(map(res => res?.data ?? null), catchError(() => of(null)));
  }

  /** Get paginated message history */
  getRoomMessages(roomId: string, page = 0, size = 30): Observable<MessageResponse[]> {
    return this.http
      .get<any>(`${this.GATEWAY}/rooms/${roomId}/messages?page=${page}&size=${size}`,
        { headers: this.authHeaders() })
      .pipe(map(res => res?.data?.content ?? []), catchError(() => of([])));
  }

  /** Mark room as read */
  markRoomAsRead(roomId: string): Observable<any> {
    return this.http
      .post<any>(`${this.GATEWAY}/rooms/${roomId}/read`, {}, { headers: this.authHeaders() })
      .pipe(catchError(() => of(null)));
  }

  /** Leave a room */
  leaveRoom(roomId: string): Observable<boolean> {
    return this.http
      .delete<any>(`${this.GATEWAY}/rooms/${roomId}/leave`, { headers: this.authHeaders() })
      .pipe(map(() => true), catchError(() => of(false)));
  }
}
