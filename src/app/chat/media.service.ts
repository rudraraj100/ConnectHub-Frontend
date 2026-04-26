import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface MediaFile {
  mediaId: string;
  uploaderId: string;
  roomId: string;
  messageId?: string;
  filename: string;
  originalName: string;
  url: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeKb: number;
  width?: number;
  height?: number;
  uploadedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class MediaService {
  // All requests go through the API gateway — CORS is handled there centrally.
  private baseUrl = 'http://localhost:8080/media';

  private platform = inject(PLATFORM_ID);

  constructor(private http: HttpClient) { }

  // ── Auth header ───────────────────────────────────────────────────
  private authHeaders(): HttpHeaders {
    const token = isPlatformBrowser(this.platform)
      ? localStorage.getItem('jwt_token')
      : null;
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  // ── Upload — goes through gateway (port 8080) ─────────────────────
  upload(file: File, roomId: string, messageId?: string): Observable<MediaFile> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomId', roomId);
    if (messageId) formData.append('messageId', messageId);

    // Send userId as a plain form field so media-service knows the uploader
    // (gateway injects X-User-Id for proxied requests, but multipart proxying
    //  may not preserve custom headers reliably — form field is the safe fallback)
    if (isPlatformBrowser(this.platform)) {
      try {
        const user = JSON.parse(localStorage.getItem('current_user') || '{}');
        if (user?.userId) formData.append('uploaderId', user.userId);
      } catch { /* ignore */ }
    }

    // Browser sets Content-Type: multipart/form-data; boundary=... automatically.
    // Do NOT set Content-Type manually — it would break the boundary.
    return this.http.post<MediaFile>(
      `${this.baseUrl}/upload`,
      formData,
      { headers: this.authHeaders() }
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────
  getRoomMedia(roomId: string): Observable<MediaFile[]> {
    return this.http.get<MediaFile[]>(
      `${this.baseUrl}/room/${roomId}`,
      { headers: this.authHeaders() }
    ).pipe(catchError(() => of([])));
  }

  deleteMedia(mediaId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/${mediaId}`,
      { headers: this.authHeaders() }
    );
  }

  getRoomMediaCount(roomId: string): Observable<number> {
    return this.http.get<number>(
      `${this.baseUrl}/count/room/${roomId}`,
      { headers: this.authHeaders() }
    ).pipe(catchError(() => of(0)));
  }
}
