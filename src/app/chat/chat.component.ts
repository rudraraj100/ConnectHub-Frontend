import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, HostListener, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, filter, takeUntil, timer, catchError, of } from 'rxjs';
import { ChatService, UserProfile, RoomResponse, RoomMemberResponse, MessageResponse } from './chat.service';
import { MediaService, MediaFile } from './media.service';
import { PresenceService } from './presence.service';
import { NotificationService, AppNotification } from './notification.service';
import { WebSocketService } from './websocket.service';
import { AdminService } from '../admin/admin.service';

interface Contact {
    id: string; name: string; avatar: string; status: string;
    lastMsg: string; time: string; unread: number;
    userId?: string;   // backend userId for DM conversation
    role?: string; location?: string; phone?: string; email?: string;
    avatarUrl?: string;
    avatarImgError?: boolean; // true when the avatar image 404s → fallback to letter
    username?: string; // @handle for display
}
interface LocalMessage {
    id: number | string; text: string; time: string; mine: boolean;
    avatar?: string;
    /** Display name — full name preferred, falls back to @username */
    sender?: string;
    senderId?: string;
    deliveryStatus?: 'SENT' | 'DELIVERED' | 'READ';
    isEdited?: boolean;
    replyToMessageId?: string;
    replyPreview?: string;
    isDeleted?: boolean;
    mediaUrl?: string;
    mediaType?: 'IMAGE' | 'VIDEO' | 'FILE';
    reactions?: Record<string, number>;   // emoji → count
    isPinned?: boolean;                   // PREMIUM feature: pinned banner in room chat
}


/**
 * ChatComponent is the heart of the ConnectHub frontend.
 * It manages the entire chat interface, including room switching, message sending,
 * real-time presence tracking, and media uploads.
 */
@Component({
    selector: 'app-chat',
    standalone: true,
    imports: [CommonModule, FormsModule, DatePipe],
    templateUrl: './chat.component.html',
    styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
    private router = inject(Router);
    private platform = inject(PLATFORM_ID);
    private chatSvc = inject(ChatService);
    private adminSvc = inject(AdminService);
    private destroy$ = new Subject<void>();
    private searchSub$ = new Subject<string>();
    private memberSearchSub$ = new Subject<string>();
    private msgPoll$ = new Subject<void>();
    private mediaSvc = inject(MediaService);
    private presenceSvc = inject(PresenceService);
    private notifSvc = inject(NotificationService);
    private wsSvc = inject(WebSocketService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    /** Unsubscribes from the current room's WS topic when switching rooms */
    private roomUnsub: (() => void) | null = null;
    /** Unsubscribes from /topic/user/{userId} on WS reconnect */
    private personalUnsub: (() => void) | null = null;
    /** Unsubscribes from /topic/presence on WS reconnect */
    private presenceUnsub: (() => void) | null = null;

    /** Exposes the presence map to the template */
    get presenceMap() { return this.presenceSvc.presence$.value; }

    /** Exposes notification list to the template */
    get notifications() { return this.notifSvc.notifications$.value; }
    get unreadNotifCount() { return this.notifSvc.unreadCount$.value; }

    // ── Current user ──────────────────────────────────────────────
    private readonly GATEWAY = 'http://localhost:8080';
    userId = '';
    username = '';
    fullName = '';
    email = '';
    isAdmin = false;
    avatarLetter = 'U';
    avatarUrl = '';
    myAvatarFailed = false; // true when the logged-in user's own avatar 404s
    userLocation = '';
    userPhone = '';
    isProfileLoading = false;
    currentStatus: 'ONLINE' | 'AWAY' | 'DND' | 'INVISIBLE' = 'ONLINE';
    /** Whether the logged-in user has an active PREMIUM subscription. */
    isPremium = false;
    /** Custom presence text set by premium users (null = not set). */
    customStatusText = '';

    // ── Panels ──────────────────────────────────────────────
    showProfile = false;
    showSettings = false;
    showNotifications = false;
    /** The notification currently shown in the fullscreen detail modal. */
    selectedNotif: AppNotification | null = null;

    // ── Premium Celebration Modal ───────────────────────────────
    showPremiumModal = false;
    showConfetti     = false;  // guard flag to prevent double-launch
    /** Canvas element holding the active confetti animation (null when idle). */
    private confettiCanvas: HTMLCanvasElement | null = null;
    private confettiAnimId = 0;
    private confettiCleanupTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Notification toast (3-second popup next to bell) ─────────────────
    toastNotif: AppNotification | null = null;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Presence options ──────────────────────────────────────────
    readonly presenceOptions = [
        { value: 'ONLINE', label: 'Online', desc: 'You appear online to everyone' },
        { value: 'AWAY', label: 'Away', desc: 'Show as away / be right back' },
        { value: 'DND', label: 'Do Not Disturb', desc: 'Mute notifications, appear busy' },
        { value: 'INVISIBLE', label: 'Invisible', desc: 'Appear offline to others' },
    ] as const;

    // ── Report form ───────────────────────────────────────────────
    reportUsername = '';
    reportReason = '';
    reportDetails = '';
    isReporting = false;
    reportSuccess = false;
    reportError = '';
    readonly reportReasons = [
        'Spam', 'Harassment', 'Hate Speech', 'Impersonation',
        'Inappropriate Content', 'Other'
    ];

    // ── Edit profile form (Settings panel) ─────────────────────────────
    editFullName = '';
    editUsername = '';
    editBio = '';
    editAvatarUrl = '';
    editCountry = '';
    editCity = '';
    editCountryCode = '';
    editPhone = '';
    isSavingProfile = false;
    profileSaveSuccess = false;

    // ── Navigation ────────────────────────────────────────────────
    activeTab: 'home' | 'people' | 'chat' | 'files' = 'chat';

    // ── Chat mode + search ────────────────────────────────────────
    chatMode: 'individual' | 'room' = 'individual';
    searchQuery = '';

    // ── Individual contacts (built from People tab) ───────────────
    contacts: Contact[] = [];
    selectedContact: Contact | null = null;

    // ── Rooms (from API) ──────────────────────────────────────────
    rooms: RoomResponse[] = [];
    selectedRoom: RoomResponse | null = null;
    isLoadingRooms = false;

    // ── Mobile responsive — true when chat thread is open on small screens
    mobileShowChat = false;
    mobileShowMedia = false;   // bottom sheet for media on mobile

    // ── Typing indicator ─────────────────────────────────────────
    /** roomId → Set of senderNames currently typing */
    typingUsers = new Map<string, Set<string>>();
    private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Used to debounce the stop-typing frame sent after the user pauses */
    private typingStopTimeout: ReturnType<typeof setTimeout> | null = null;
    /** Stable string property — avoids NG0100 caused by getter reading a mutable Map */
    typingLabel = '';

    /**
     * Dynamically builds the "is typing..." label based on the current set of typing users.
     */
    private updateTypingLabel(): void {
        const roomId = this.selectedRoom?.roomId
            ?? (this.selectedContact?.userId && this.userId
                ? this.getDmRoomId(this.selectedContact.userId) : null);
        if (!roomId) { this.typingLabel = ''; return; }
        const names = this.typingUsers.get(roomId);
        if (!names || names.size === 0) { this.typingLabel = ''; return; }
        const list = [...names];
        if (list.length === 1) { this.typingLabel = `${list[0]} is typing…`; return; }
        if (list.length === 2) { this.typingLabel = `${list[0]} and ${list[1]} are typing…`; return; }
        this.typingLabel = 'Several people are typing…';
    }

    /**
     * Called on every keystroke in the message input.
     * Sends a TYPING_INDICATOR(isTyping=true) immediately on the first keystroke,
     * then debounces a TYPING_INDICATOR(isTyping=false) 2 s after the user stops.
     * The backend broadcasts both frames to /topic/room/{roomId} so other members
     * see the "… is typing" label appear and disappear automatically.
     */
    onMessageInput(): void {
        const roomId = this.selectedRoom?.roomId
            ?? (this.selectedContact?.userId && this.userId
                ? this.getDmRoomId(this.selectedContact.userId) : null);
        if (!roomId || !this.wsSvc.connected$.value) return;

        // Send start-typing frame (only once per burst — subsequent keystrokes are no-ops
        // for the server because it just keeps the user in the typing set)
        this.wsSvc.sendTyping(roomId, true);

        // Reset the stop-typing debounce timer
        if (this.typingStopTimeout !== null) {
            clearTimeout(this.typingStopTimeout);
        }
        this.typingStopTimeout = setTimeout(() => {
            if (roomId && this.wsSvc.connected$.value) {
                this.wsSvc.sendTyping(roomId, false);
            }
            this.typingStopTimeout = null;
        }, 2000);
    }

    /**
     * Immediately cancels the pending stop-typing debounce and sends a
     * TYPING_INDICATOR(isTyping=false) frame right now.
     * Called whenever typing must stop instantly:
     *   - message sent / file uploaded
     *   - user switches rooms or contacts
     *   - component destroyed
     */
    private stopTypingNow(): void {
        if (this.typingStopTimeout !== null) {
            clearTimeout(this.typingStopTimeout);
            this.typingStopTimeout = null;
        }
        const roomId = this.selectedRoom?.roomId
            ?? (this.selectedContact?.userId && this.userId
                ? this.getDmRoomId(this.selectedContact.userId) : null);
        if (roomId && this.wsSvc.connected$.value) {
            this.wsSvc.sendTyping(roomId, false);
        }
    }

    // -- Messages --
    messages: LocalMessage[] = [];
    newMessage = '';
    isLoadingMessages = false;

    // -- Message actions: edit / reply / search / context menu --
    editingMessageId: string | null = null;
    editContent = '';
    replyTo: LocalMessage | null = null;
    showMsgSearch = false;
    msgSearchQuery = '';
    msgSearchResults: LocalMessage[] = [];
    activeContextMenu: string | null = null;


    // ── Room Members Panel (right side) ───────────────────────────
    roomMembers: RoomMemberResponse[] = [];
    isLoadingMembers = false;
    myRoomRole = 'MEMBER'; // ADMIN | MEMBER — current user's role in selectedRoom

    // ── Create Room Modal ─────────────────────────────────────────
    showCreateRoom = false;
    showUpgradeModal = false;   // shown when FREE user clicks locked create-room btn
    isPaymentLoading = false;   // true while Razorpay order is being created

    newRoomName = '';
    newRoomDesc = '';
    memberSearch = '';
    memberResults: UserProfile[] = [];
    pendingMembers: UserProfile[] = [];
    isCreatingRoom = false;
    memberSearching = false;

    // ── People tab ────────────────────────────────────────────────
    searchResults: UserProfile[] = [];
    peopleSearch = '';
    isPeopleLoading = false;
    peopleSearched = false;

    // ── Media ─────────────────────────────────────────────────────
    roomMedia: MediaFile[] = [];
    isMediaLoading = false;
    selectedFile: File | null = null;
    filePreview: string | null = null;

    // ── Emoji picker ─────────────────────────────────────────
    showEmojiPicker = false;
    readonly emojiList = [
        // Faces
        '😀', '😂', '😄', '😆', '😉', '😊', '😍', '😘', '😜', '😛', '😝', '🤩',
        '😐', '😑', '😒', '😔', '😖', '😢', '😭', '😤', '😠', '😡', '🤬', '😈',
        // Gestures
        '👍', '👎', '👏', '👋', '✌️', '🤟', '🖐️', '👌', '❤️', '🔥', '✨', '🎉',
        // Common
        '🙏', '💀', '💩', '👀', '💯', '💪', '🌈', '⚡', '🌟', '🚀', '🏆', '📢',
        '🔔', '📞', '📧', '📌', '💬', '💡', '💰', '🤔', '😅', '🥳', '🙌', '👊',
    ];

    insertEmoji(e: string) {
        this.newMessage += e;
        this.showEmojiPicker = false;
    }

    // ── Lightbox ──────────────────────────────────────────────────
    lightboxUrl: string | null = null;
    /**
     * Bug 2 fix: track the media type so the lightbox template can render
     * <img> for images and <video controls> for videos.
     * Without this, clicking a video thumbnail opened the lightbox but showed
     * a broken <img> tag instead of a playable video element.
     */
    lightboxMediaType: 'IMAGE' | 'VIDEO' | null = null;

    // ── Getters ───────────────────────────────────────────────────
    get filteredContacts() {
        return this.contacts.filter(c =>
            c.id !== this.userId && c.email !== this.email &&
            c.name.toLowerCase().includes(this.searchQuery.toLowerCase())
        );
    }
    get filteredRooms() {
        return this.rooms.filter(r =>
            r.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    get totalUnread() {
        const c = this.contacts.reduce((a, x) => a + (x.unread ?? 0), 0);
        const r = this.rooms.reduce((a, x) => a + (x.unreadCount ?? 0), 0);
        return Math.max(0, c + r);
    }
    get recentChats() { return this.contacts.slice(0, 3); }

    // ── Lifecycle ─────────────────────────────────────────────────
    ngOnInit() {
        if (!isPlatformBrowser(this.platform)) return;
        const token = localStorage.getItem('jwt_token');
        if (!token) { this.router.navigate(['/login']); return; }

        // Restore from cache, then refresh
        const raw = localStorage.getItem('current_user');
        if (raw) { try { this.applyProfile(JSON.parse(raw)); } catch { /**/ } }

        // ── One-time migration: purge the legacy generic 'ch_contacts' key.
        // This key was shared across users which caused new users to see other
        // users' chat stubs. Remove it unconditionally — each user now has their
        // own namespaced key: ch_contacts_{userId}.
        localStorage.removeItem('ch_contacts');

        // ── Restore persisted DM contacts so previous chats are visible on reload
        this.restoreContacts();

        this.isProfileLoading = true;
        this.chatSvc.getMyProfile().pipe(takeUntil(this.destroy$)).subscribe({
            next: p => {
                if (p) {
                    localStorage.setItem('current_user', JSON.stringify(p));
                    this.applyProfile(p);
                    // Connect to WebSocket handler once we have userId + token
                    const token = localStorage.getItem('jwt_token') || '';
                    this.wsSvc.connect(this.userId, token);
                    // Start notification polling AFTER userId is confirmed from the API.
                    // Calling startPolling earlier (before profile loads) would subscribe to
                    // /topic/notifications/ (empty userId) and miss all real-time pushes.
                    this.notifSvc.startPolling(this.userId);
                }
                this.isProfileLoading = false;
            },
            error: () => { this.isProfileLoading = false; }
        });

        // Wire debounce for People search
        this.searchSub$.pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$))
            .subscribe(k => this.doSearchUsers(k));

        // Wire debounce for member-add search inside create-room modal
        this.memberSearchSub$.pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
            .subscribe(k => this.doMemberSearch(k));

        // Load rooms immediately
        this.loadMyRooms();

        // ── Subscribe to personal & presence topics — re-establish on every WS reconnect ──
        // take(1) was REMOVED: with it, after a network drop the personal topic subscription
        // was never re-created, so room notifications and presence stopped working until
        // the user refreshed the page.
        this.wsSvc.connected$.pipe(
            filter(c => c),
            takeUntil(this.destroy$)
        ).subscribe(() => {
            // Unsubscribe previous subscriptions before re-creating (reconnect path)
            this.personalUnsub?.();
            this.presenceUnsub?.();

            // Personal notifications (DM pings, room invites, NEW_MESSAGE for rooms)
            if (this.userId) {
                this.personalUnsub = this.wsSvc.subscribe(`/topic/user/${this.userId}`, (frame: any) => {
                    const type = frame.type || '';
                    if (type === 'NEW_MESSAGE') {
                        const roomId = frame.roomId;
                        const isCurrentRoom = this.selectedRoom?.roomId === roomId;
                        const isCurrentDm = this.selectedContact?.userId
                            ? this.getDmRoomId(this.selectedContact.userId) === roomId
                            : false;

                        // ── Group room ───────────────────────────────────────────────
                        const room = this.rooms.find(r => r.roomId === roomId);
                        if (room && !isCurrentRoom) {
                            room.unreadCount = (room.unreadCount ?? 0) + 1;
                            this.notifSvc.pushRoomNotification(room.name, frame.message ?? '');
                        }

                        // ── DM contact ───────────────────────────────────────────────
                        // DM rooms (dm_{id1}_{id2}) are NOT in this.rooms (room-service only
                        // stores group rooms). So we look up the contact by their userId and
                        // match via getDmRoomId() to know which conversation to badge.
                        if (!isCurrentDm && roomId?.startsWith('dm_')) {
                            const dmContact = this.contacts.find(c =>
                                !!c.userId && this.getDmRoomId(c.userId) === roomId
                            );

                            if (dmContact) {
                                // Known contact — just badge it
                                dmContact.unread = (dmContact.unread ?? 0) + 1;
                                dmContact.lastMsg = frame.message ?? dmContact.lastMsg;
                                dmContact.time    = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                                this.notifSvc.pushRoomNotification(
                                    dmContact.name || 'Direct Message',
                                    frame.message ?? ''
                                );

                            } else if (frame.senderId && frame.senderId !== this.userId) {
                                // ── Auto-discover: first DM from an unknown user ──────
                                // Build a minimal contact immediately from the WS frame so
                                // the conversation appears in User B's list without any action.
                                const senderId   = frame.senderId as string;
                                const senderName = (frame.senderName as string) || senderId;
                                const initials   = senderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

                                const autoContact: Contact = {
                                    id:       senderId,
                                    userId:   senderId,
                                    name:     senderName,
                                    username: '',
                                    avatar:   initials || senderName.charAt(0).toUpperCase(),
                                    status:   'online',
                                    lastMsg:  frame.message ?? 'New message',
                                    time:     new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
                                    unread:   1,
                                    avatarUrl: '',
                                    email:    '',
                                };
                                // Prepend so it's the first item in the list
                                this.contacts = [autoContact, ...this.contacts];
                                this.persistContacts();
                                this.notifSvc.pushRoomNotification(senderName, frame.message ?? '');

                                // Async enrich: fetch the full profile so name/avatar/email are accurate
                                this.chatSvc.getUserById(senderId)
                                    .pipe(takeUntil(this.destroy$))
                                    .subscribe(profile => {
                                        if (!profile) return;
                                        const idx = this.contacts.findIndex(c => c.userId === senderId);
                                        if (idx === -1) return;
                                        const enriched: Contact = {
                                            ...this.contacts[idx],
                                            name:     profile.fullName || profile.username || senderName,
                                            username: profile.username || '',
                                            avatar:   (profile.fullName || profile.username || senderName).charAt(0).toUpperCase(),
                                            email:    profile.email || '',
                                            avatarUrl: profile.avatarUrl || '',
                                        };
                                        const updated = [...this.contacts];
                                        updated[idx] = enriched;
                                        this.contacts = updated;
                                        this.persistContacts();
                                        this.cdr.markForCheck();
                                    });
                            }
                        }

                        // Force CD so all badges re-render immediately.
                        this.cdr.detectChanges();

                    } else if (type === 'ROOM_INVITE') {
                        this.loadMyRooms();
                    }
                });
            }

            // Real-time presence — replaces 30s REST polling
            this.presenceUnsub = this.wsSvc.subscribe('/topic/presence', (frame: any) => {
                if (frame.userId && frame.status) {
                    const current  = this.presenceSvc.presence$.value;
                    const previous = current.get(frame.userId);
                    const updated  = new Map(current);
                    updated.set(frame.userId, { userId: frame.userId, status: frame.status, lastSeenAt: frame.lastSeenAt ?? null });
                    this.presenceSvc.presence$.next(updated);

                    // When our current DM contact comes ONLINE, upgrade all SENT→DELIVERED
                    // so the sender sees double tick without needing to send a new message.
                    if (frame.status === 'ONLINE' &&
                        (!previous || previous.status !== 'ONLINE') &&
                        this.selectedContact?.userId === frame.userId) {
                        this.messages = this.messages.map(m =>
                            (m.mine && m.deliveryStatus === 'SENT')
                                ? { ...m, deliveryStatus: 'DELIVERED' as const }
                                : m
                        );
                    }
                }
            });
        });

        // ── Presence ───────────────────────────────────────────────────
        // 1. Send heartbeat immediately → writes this user's key to Redis
        this.presenceSvc.startHeartbeat();

        // 2. Wait 3 s for all users' heartbeats to land, then fetch contact dots
        timer(3_000).pipe(takeUntil(this.destroy$))
            .subscribe(() => this.refreshPresence());

        // 3. Keep dots fresh — re-fetch every 30 s
        timer(30_000, 30_000)
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => this.refreshPresence());

        // NOTE: notifSvc.startPolling() is now called inside getMyProfile callback above
        // so it always receives the confirmed userId, not an empty string.

        // ── Notification toast — show 3-second popup for every incoming push ──
        this.notifSvc.toast$.pipe(takeUntil(this.destroy$)).subscribe(n => {
            this.ngZone.run(() => {
                this.toastNotif = n;
                if (this.toastTimer) clearTimeout(this.toastTimer);
                this.toastTimer = setTimeout(() => {
                    this.toastNotif = null;
                    this.cdr.markForCheck();
                }, 3000);
                this.cdr.markForCheck();
            });
        });
    }

    ngOnDestroy() {
        this.stopTypingNow();       // send stop-typing before disconnecting
        // Clear all typing auto-clear timers to prevent post-destroy callbacks
        this.typingTimers.forEach(t => clearTimeout(t));
        this.typingTimers.clear();
        if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; }
        this.roomUnsub?.();        // unsubscribe from current room topic
        this.personalUnsub?.();    // unsubscribe from /topic/user/{userId}
        this.presenceUnsub?.();    // unsubscribe from /topic/presence
        this.msgPoll$.next();
        this.msgPoll$.complete();
        this.destroy$.next();
        this.destroy$.complete();
        this.wsSvc.disconnect();    // close STOMP connection
        this.chatSvc.updateStatus('AWAY').pipe(catchError(() => of(null))).subscribe();
        this.presenceSvc.setStatus('OFFLINE').subscribe();
        this.presenceSvc.stopHeartbeat();
    }

    // ── Notification helpers ────────────────────────────────
    openNotifications(): void {
        this.showNotifications = !this.showNotifications;
        this.showProfile = false;
        this.showSettings = false;
    }
    closeNotifications(): void { this.showNotifications = false; }
    onMarkAsRead(id: number): void { this.notifSvc.markAsRead(id); }
    onMarkAllRead(): void { this.notifSvc.markAllRead(); }
    onDeleteNotif(id: number): void { this.notifSvc.deleteNotification(id); }

    /** Open the fullscreen detail modal and mark the notification as read. */
    openNotifDetail(n: AppNotification): void {
        this.selectedNotif = n;
        if (!n.isRead) { this.notifSvc.markAsRead(n.notificationId); }
    }

    closeNotifDetail(): void { this.selectedNotif = null; }

    /**
     * Navigate to the chat linked to the selected notification:
     *  • DM room (dm_{id1}_{id2}) → open the Individual contact
     *  • Group room               → open the Room Chat tab
     */
    notifGoToChat(): void {
        const n = this.selectedNotif;
        if (!n?.roomId) { this.closeNotifDetail(); return; }
        this.selectedNotif = null;
        this.showNotifications = false;

        const roomId = n.roomId;
        this.activeTab = 'chat';

        if (roomId.startsWith('dm_')) {
            // Format: dm_{uuid36}_{uuid36}  — extract the other user's ID
            const without = roomId.slice(3);        // strip leading 'dm_'
            const uid1    = without.slice(0, 36);   // first UUID (always 36 chars)
            const uid2    = without.slice(37);      // second UUID (after the '_')
            const otherId = uid1 === this.userId ? uid2 : uid1;
            this.chatMode = 'individual';
            const existing = this.contacts.find(c => c.userId === otherId);
            if (existing) {
                this.selectContact(existing);
            } else {
                // Profile not yet in contacts — fetch and auto-add
                this.chatSvc.getUserById(otherId)
                    .pipe(takeUntil(this.destroy$))
                    .subscribe(profile => { if (profile) this.messagePerson(profile); });
            }
        } else {
            // Group room
            this.chatMode = 'room';
            const room = this.rooms.find(r => r.roomId === roomId);
            if (room) { this.selectRoom(room); }
            else { this.loadMyRooms(); }  // rooms not yet loaded — will appear after fetch
        }
    }

    applyProfile(u: any) {
        this.userId = u?.userId || '';
        this.username = u?.username || '';
        this.fullName = u?.fullName || u?.name || '';
        this.email = u?.email || '';
        this.avatarUrl = u?.avatarUrl || '';
        this.myAvatarFailed = false; // reset so a newly uploaded avatar is tried
        this.userLocation = [u?.city, u?.country].filter(Boolean).join(', ');
        this.userPhone = u?.countryCode ? `${u.countryCode} ${u.phoneNumber || ''}` : u?.phoneNumber || '';
        this.isAdmin = this.email === 'rudrar2002@gmail.com';
        this.isPremium = u?.plan === 'PREMIUM';
        this.customStatusText = u?.customStatus || '';
        const display = this.fullName || this.username || 'U';
        this.avatarLetter = display.charAt(0).toUpperCase();
    }

    // ── Profile panel ─────────────────────────────────────────────
    openProfile() { this.showProfile = true; this.showSettings = false; }
    closeProfile() { this.showProfile = false; }

    // ── Settings panel ────────────────────────────────────────────
    openSettings() {
        this.showSettings = true;
        this.showProfile = false;
        this.reportSuccess = false;
        this.profileSaveSuccess = false;
        // Pre-populate the edit form with current values
        this.editFullName = this.fullName;
        this.editUsername = this.username;
        this.editBio = '';
        this.editAvatarUrl = this.avatarUrl;
        this.editCountry = '';
        this.editCity = '';
        this.editCountryCode = '';
        this.editPhone = '';
        // Fetch fresh profile to get bio/location/phone
        this.chatSvc.getMyProfile().pipe(takeUntil(this.destroy$)).subscribe(p => {
            if (p) {
                this.editBio = (p as any).bio || '';
                this.editCountry = (p as any).country || '';
                this.editCity = (p as any).city || '';
                this.editCountryCode = (p as any).countryCode || '';
                this.editPhone = (p as any).phoneNumber || '';
            }
        });
    }
    closeSettings() { this.showSettings = false; }

    // ── Save profile ───────────────────────────────────────────────
    saveProfile() {
        if (this.isSavingProfile) return;
        this.isSavingProfile = true;
        this.profileSaveSuccess = false;

        const patch = {
            fullName: this.editFullName.trim() || undefined,
            username: this.editUsername.trim() || undefined,
            bio: this.editBio.trim() || undefined,
            avatarUrl: this.editAvatarUrl.trim() || undefined,
            country: this.editCountry.trim() || undefined,
            city: this.editCity.trim() || undefined,
            countryCode: this.editCountryCode.trim() || undefined,
            phoneNumber: this.editPhone.trim() || undefined,
        };

        this.chatSvc.updateProfile(patch)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: updated => {
                    this.isSavingProfile = false;
                    if (updated) {
                        // Sync the component's displayed state
                        this.applyProfile(updated);
                        this.profileSaveSuccess = true;
                        setTimeout(() => this.profileSaveSuccess = false, 4000);
                    }
                },
                error: () => { this.isSavingProfile = false; }
            });
    }

    // ── Custom Status (PREMIUM only) ───────────────────────────────────
    saveCustomStatus() {
        if (!this.isPremium) return;
        this.chatSvc.updateProfile({ customStatus: this.customStatusText })
            .pipe(takeUntil(this.destroy$))
            .subscribe(updated => { if (updated) this.applyProfile(updated); });
    }

    // ── Presence ──────────────────────────────────────────────────
    setStatus(status: 'ONLINE' | 'AWAY' | 'DND' | 'INVISIBLE') {
        this.currentStatus = status;
        this.chatSvc.updateStatus(status).pipe(takeUntil(this.destroy$)).subscribe();
    }

    // ── Close Chat ─────────────────────────────────────────────
    closeChat() {
        this.selectedContact = null;
        this.selectedRoom    = null;
        this.messages        = [];
        this.msgPoll$.next(); // stop any active polling
    }

    // ── Delete contact from chat list ───────────────────────────
    deleteContact(c: Contact, event: Event) {
        event.stopPropagation();
        this.contacts = this.contacts.filter(x => x.id !== c.id);
        // If this conversation was open, close it
        if (this.selectedContact?.id === c.id) {
            this.closeChat();
        }
        this.persistContacts();
    }

    // ── Premium modal ────────────────────────────────────────────
    openPremiumModal()  { this.showPremiumModal = true; this.showConfetti = false; }
    closePremiumModal() {
        this._stopConfetti();
        this.showPremiumModal = false;
    }

    /** Stops and removes any running confetti canvas. */
    private _stopConfetti() {
        if (this.confettiCleanupTimer) clearTimeout(this.confettiCleanupTimer);
        cancelAnimationFrame(this.confettiAnimId);
        this.confettiCanvas?.remove();
        this.confettiCanvas = null;
        this.showConfetti   = false;
    }

    /**
     * Launches a golden confetti burst from the center of the viewport.
     * Renders on a transparent fixed canvas so it overlays everything cleanly
     * without any background color — particles explode outward from the middle
     * exactly like a champagne-popper effect.
     */
    launchConfetti() {
        if (this.showConfetti) return;          // prevent double-fire
        this.showConfetti = true;

        // ── Create transparent full-screen canvas ─────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
            position:      'fixed',
            inset:         '0',
            width:         '100vw',
            height:        '100vh',
            pointerEvents: 'none',
            zIndex:        '9500',
            background:    'transparent',
        } as CSSStyleDeclaration);
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        this.confettiCanvas = canvas;

        const ctx = canvas.getContext('2d')!;
        const cx  = canvas.width  / 2;
        const cy  = canvas.height / 2;

        // Golden / champagne palette
        const COLORS = ['#ffd700','#f59e0b','#fbbf24','#f0c030','#ffe566',
                        '#d4af37','#f97316','#ffec85','#e8b923'];

        interface Grain {
            x: number; y: number;
            vx: number; vy: number;
            color: string;
            w: number; h: number;
            rot: number; rotV: number;
            alpha: number; decay: number;
        }

        // ── Spawn particles ────────────────────────────────────────────────
        const grains: Grain[] = [];
        for (let i = 0; i < 160; i++) {
            const angle = Math.random() * Math.PI * 2;
            // burst: fast initial speed, slightly biased upward for the "pop" look
            const speed = 4 + Math.random() * 10;
            const w     = 6 + Math.random() * 10;
            grains.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - (2 + Math.random() * 4), // upward bias
                color:  COLORS[Math.floor(Math.random() * COLORS.length)],
                w, h: w * (0.3 + Math.random() * 0.35),
                rot:  Math.random() * 360,
                rotV: (Math.random() - 0.5) * 8,
                alpha: 1,
                decay: 0.012 + Math.random() * 0.012,
            });
        }

        // ── Animation loop ────────────────────────────────────────────────
        const GRAVITY = 0.18;
        const tick = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = 0;
            for (const g of grains) {
                if (g.alpha <= 0) continue;
                alive++;
                g.vy  += GRAVITY;
                g.vx  *= 0.988;   // gentle air resistance
                g.x   += g.vx;
                g.y   += g.vy;
                g.rot += g.rotV;
                g.alpha = Math.max(0, g.alpha - g.decay);

                ctx.save();
                ctx.globalAlpha = g.alpha;
                ctx.translate(g.x, g.y);
                ctx.rotate((g.rot * Math.PI) / 180);
                ctx.fillStyle = g.color;
                // rounded ribbon shape
                ctx.beginPath();
                const rx = g.w / 2, ry = g.h / 2;
                ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            if (alive > 0) {
                this.confettiAnimId = requestAnimationFrame(tick);
            } else {
                this._stopConfetti();
            }
        };
        this.confettiAnimId = requestAnimationFrame(tick);

        // Hard safety cutoff at 7 s
        this.confettiCleanupTimer = setTimeout(() => this._stopConfetti(), 7000);
    }

    // ── Report ────────────────────────────────────────────────────
    submitReport() {
        if (!this.reportUsername.trim() || !this.reportReason || this.isReporting) return;
        this.isReporting = true;
        this.reportError = '';

        // Strip leading '@' — the placeholder suggests "@username" but the
        // backend looks up the bare username without the prefix.
        const cleanUsername = this.reportUsername.trim().replace(/^@/, '');

        this.adminSvc.submitReport(
            cleanUsername,
            this.reportReason,
            this.reportDetails
        ).subscribe({
            next: (ok) => {
                this.ngZone.run(() => {
                    this.isReporting = false;
                    if (ok) {
                        this.reportSuccess = true;
                        this.reportError   = '';
                        setTimeout(() => {
                            this.reportUsername = '';
                            this.reportReason   = '';
                            this.reportDetails  = '';
                            this.reportSuccess  = false;
                            this.cdr.markForCheck();
                        }, 4000);
                    } else {
                        this.reportError = 'User not found or report failed. Please check the username and try again.';
                    }
                    // Defer markForCheck to after current CD cycle to avoid NG0100
                    Promise.resolve().then(() => this.cdr.markForCheck());
                });
            },
            error: () => {
                this.ngZone.run(() => {
                    this.isReporting = false;
                    this.reportError = 'Something went wrong. Please try again.';
                    Promise.resolve().then(() => this.cdr.markForCheck());
                });
            }
        });
    }


    // ── Rooms API ─────────────────────────────────────────────────
    loadMyRooms() {
        this.isLoadingRooms = true;
        this.chatSvc.getMyRooms().pipe(takeUntil(this.destroy$)).subscribe({
            next: rooms => { this.rooms = rooms; this.isLoadingRooms = false; },
            error: () => { this.isLoadingRooms = false; }
        });
    }

    selectRoom(r: RoomResponse) {
        this.stopTypingNow();       // cancel pending typing indicator for the previous room
        this.selectedRoom = r;
        this.selectedContact = null;
        this.activeTab = 'chat';
        this.chatMode = 'room';
        this.myRoomRole = r.currentUserRole;
        this.messages = [];
        this.typingLabel = '';    // clear stale typing state from previous chat
        this.mobileShowChat = true;   // show thread on mobile
        this.loadRoomMessages(r.roomId);
        this.loadRoomMembers(r.roomId);
        this.loadRoomMedia(r.roomId);
        this.chatSvc.markRoomAsRead(r.roomId).subscribe();
        this.subscribeToRoomTopic(r.roomId);
    }

    private loadRoomMessages(roomId: string) {
        this.isLoadingMessages = true;
        this.chatSvc.getMessages(roomId, 0, 50).pipe(takeUntil(this.destroy$)).subscribe({
            next: res => {
                // Clear spinner FIRST — before any mapping that could throw
                this.isLoadingMessages = false;
                try {
                    const msgs = (res as any).content ?? [];
                    this.messages = [...msgs].reverse().map((m: any) => ({
                        id: m.messageId,
                        text: m.isDeleted ? '[Message deleted]' : m.content,
                        time: this.formatTime(m.sentAt || m.createdAt),
                        mine: m.senderId === this.userId,
                        avatar: m.senderAvatarUrl ? undefined : (m.senderName?.charAt(0).toUpperCase() || '?'),
                        // senderName is now always non-null from the backend (fullName → username → UUID).
                        // Removed the old '-' UUID-rejection check — it was discarding valid data.
                        sender: m.senderName || m.senderUsername || 'User',
                        senderId: m.senderId,
                        deliveryStatus: (m.deliveryStatus as 'SENT' | 'DELIVERED' | 'READ') || 'SENT',
                        isEdited: m.isEdited || false,
                        isDeleted: m.isDeleted || false,
                        isPinned: m.isPinned || false,
                        replyToMessageId: m.replyToMessageId,
                        mediaUrl: m.mediaUrl || undefined,
                        // mediaType comes from backend; fall back to deriving it from `type` for old messages
                        mediaType: m.mediaType || (m.type === 'IMAGE' ? 'IMAGE' : m.type === 'VIDEO' ? 'VIDEO' : m.type === 'FILE' ? 'FILE' : undefined)
                    }));

                    this.scrollToBottom();
                    // Tell the sender their messages were read
                    this.markMessagesRead(roomId);
                    // Update the room slide preview with the latest message content
                    const last = this.messages[this.messages.length - 1];
                    if (last) this.updateRoomLastMessage(roomId, last.text ?? '');
                } catch (e) {
                    console.error('[Chat] Error mapping messages:', e);
                    this.messages = [];
                }
                // Defer markForCheck to after current CD cycle to avoid NG0100
                Promise.resolve().then(() => this.cdr.markForCheck());
            },
            error: () => { this.isLoadingMessages = false; Promise.resolve().then(() => this.cdr.markForCheck()); }
        });
    }

    /** Updates the last-message preview on the matching room slide. */
    private updateRoomLastMessage(roomId: string, text: string) {
        const room = this.rooms.find(r => r.roomId === roomId);
        if (room) room.lastMessage = text?.length > 45 ? text.substring(0, 45) + '…' : (text || '');
    }

    /** Subscribe to /topic/room/{roomId} via WebSocket for instant message delivery */
    private subscribeToRoomTopic(roomId: string) {
        // Unsubscribe from previous room immediately
        this.roomUnsub?.();
        this.roomUnsub = null;

        // Stop any existing REST poll
        this.msgPoll$.next();

        // If WS is already disconnected, start REST polling immediately as a fallback.
        // It will be cancelled automatically by msgPoll$.next() when WS reconnects (see below).
        if (!this.wsSvc.connected$.value) {
            this.startMessagePolling(roomId);
        }

        // Re-subscribe every time the connection comes up (handles reconnects).
        // takeUntil(destroy$) cleans up when the component is destroyed.
        // The inner guard ensures we don't subscribe to a stale roomId if the
        // user switched rooms while the connection was being (re-)established.
        this.wsSvc.connected$.pipe(
            filter(connected => connected),
            takeUntil(this.destroy$)
        ).subscribe(() => {
            // Guard: make sure this room is still the active one after waiting
            const currentRoomId = this.selectedRoom?.roomId
                ?? (this.selectedContact?.userId ? this.getDmRoomId(this.selectedContact.userId) : null);
            if (currentRoomId !== roomId) return; // user switched rooms while waiting

            // WS is now live — stop the REST poll fallback.
            // Do NOT reload messages here: the REST response would arrive after WS
            // messages and overwrite any that were delivered in the interim.
            this.msgPoll$.next();

            // Unsubscribe any previous sub before creating a new one (reconnect path)
            this.roomUnsub?.();

            this.roomUnsub = this.wsSvc.subscribe(
                `/topic/room/${roomId}`,
                (frame: any) => {
                    const type = frame.type || 'CHAT_MESSAGE';

                    if (type === 'CHAT_MESSAGE' || frame.content) {
                        const isMine = frame.senderId === this.userId;

                        if (isMine) {
                            // Replace the optimistic temp message with the confirmed message from server.
                            // Both text (sendMessage) and media (uploadAndSend) optimistic messages
                            // use the 'temp_' prefix so this single check handles both.
                            const tempIdx = this.messages.findIndex(m => String(m.id).startsWith('temp_'));
                            const realMessage = {
                                id: frame.messageId || Date.now(),
                                text: frame.content,
                                time: this.formatTime(frame.sentAt || new Date().toISOString()),
                                mine: true,
                                sender: this.fullName || this.username,
                                senderId: frame.senderId,
                                // Only show DELIVERED (double tick) if the DM recipient is currently online.
                                // For group rooms, show SENT (single tick) since we can't know which members got it.
                                deliveryStatus: ((this.selectedContact &&
                                    this.presenceMap.get(this.selectedContact.userId ?? '')?.status === 'ONLINE')
                                    ? 'DELIVERED' : 'SENT') as 'SENT' | 'DELIVERED',
                                mediaUrl: frame.mediaUrl,
                                mediaType: frame.mediaType
                            };
                            if (tempIdx !== -1) {
                                // Replace temp with confirmed — use new array reference so Angular detects the change
                                const updated = [...this.messages];
                                updated[tempIdx] = realMessage;
                                this.messages = updated;
                            } else {
                                // No temp found — avoid duplicate by checking real messageId
                                const alreadyReal = this.messages.some(m => String(m.id) === String(frame.messageId));
                                if (!alreadyReal) this.messages = [...this.messages, realMessage];
                            }
                        } else {
                            // Message from another user — append only if not already shown.
                            // Use a new array reference so Angular's *ngFor always detects
                            // the change without needing a user click to trigger CD.
                            const alreadyKnown = this.messages.some(m => String(m.id) === String(frame.messageId));
                            if (!alreadyKnown) {
                                this.messages = [...this.messages, {
                                    id: frame.messageId || Date.now(),
                                    text: frame.content,
                                    time: this.formatTime(frame.sentAt || new Date().toISOString()),
                                    mine: false,
                                    // senderName from the WS broadcast envelope is enriched by message-service.
                                    // Fallback chain: senderName → senderUsername → senderId (UUID)
                                    sender: frame.senderName || frame.senderUsername || frame.senderId || 'User',
                                    senderId: frame.senderId,
                                    deliveryStatus: 'DELIVERED',
                                    mediaUrl: frame.mediaUrl,
                                    mediaType: frame.mediaType
                                }];
                            }
                        }
                        this.scrollToBottom();
                        this.markMessagesRead(roomId);
                        const preview = frame.content ?? '';
                        this.updateRoomLastMessage(roomId, preview);
                        this.ngZone.run(() => this.cdr.markForCheck());
                    } else if (type === 'TYPING_INDICATOR') {
                        const sender = frame.senderName || frame.senderId || 'Someone';
                        if (!this.typingUsers.has(roomId)) this.typingUsers.set(roomId, new Set());
                        const set = this.typingUsers.get(roomId)!;
                        if (frame.isTyping) {
                            set.add(sender);
                        } else {
                            set.delete(sender);
                        }
                        this.updateTypingLabel();
                        // Auto-clear after 4s in case the 'stop' frame never arrives
                        const timerKey = `${roomId}:${sender}`;
                        if (this.typingTimers.has(timerKey)) clearTimeout(this.typingTimers.get(timerKey)!);
                        if (frame.isTyping) {
                            this.typingTimers.set(timerKey, setTimeout(() => {
                                this.typingUsers.get(roomId)?.delete(sender);
                                this.ngZone.run(() => this.updateTypingLabel());
                            }, 4000));
                        }
                    } else if (type === 'REACTION') {
                        // Update emoji on the specific message — new array + new item reference
                        // so Angular detects both the array and the item changed.
                        const idx = this.messages.findIndex(m => String(m.id) === String(frame.messageId));
                        if (idx !== -1) {
                            const msg = this.messages[idx];
                            const reactions = { ...(msg.reactions ?? {}), [frame.emoji]: (msg.reactions?.[frame.emoji] ?? 0) + 1 };
                            const updated = [...this.messages];
                            updated[idx] = { ...msg, reactions };
                            this.messages = updated;
                            this.cdr.detectChanges();
                        }
                    } else if (type === 'READ_RECEIPT') {
                        // Mark MY sent messages as READ when the other person reads them.
                        const upTo = String(frame.upToMessageId);
                        let upToIdx = -1;
                        for (let i = this.messages.length - 1; i >= 0; i--) {
                            if (String(this.messages[i].id) === upTo) { upToIdx = i; break; }
                        }
                        const cutoff = upToIdx !== -1 ? upToIdx : this.messages.length - 1;
                        this.messages = this.messages.map((m: LocalMessage, i: number) =>
                            i <= cutoff && m.mine ? { ...m, deliveryStatus: 'READ' as const } : m
                        );
                        this.cdr.detectChanges();
                    }
                }
            );
        });
    }

    /** Fallback REST polling every 3s when WebSocket is not available */
    private startMessagePolling(roomId: string) {
        this.msgPoll$.next();
        timer(3000, 3000)
            .pipe(takeUntil(this.msgPoll$), takeUntil(this.destroy$))
            .subscribe(() => {
                this.chatSvc.getMessages(roomId, 0, 50)
                    .pipe(takeUntil(this.msgPoll$), takeUntil(this.destroy$))
                    .subscribe(res => {
                        const raw = (res as any).content ?? [];
                        const incoming: any[] = [...raw].reverse();
                        const knownIds = new Set(this.messages.map(m => String(m.id)));
                        const newMsgs = incoming
                            .filter(m => !knownIds.has(String(m.messageId)))
                            .map((m: any) => ({
                                id: m.messageId, text: m.isDeleted ? '[Message deleted]' : m.content,
                                time: this.formatTime(m.sentAt || m.createdAt),
                                mine: m.senderId === this.userId,
                                avatar: m.senderAvatarUrl ? undefined : (m.senderName?.charAt(0).toUpperCase() || '?'),
                                sender: m.senderName || m.senderUsername || 'User',
                                senderId: m.senderId,
                                deliveryStatus: (m.deliveryStatus as 'SENT' | 'DELIVERED' | 'READ') || 'SENT',
                                isEdited: m.isEdited || false, isDeleted: m.isDeleted || false,
                                replyToMessageId: m.replyToMessageId,
                                mediaUrl: m.mediaUrl || undefined,
                                mediaType: m.mediaType || (m.type === 'IMAGE' ? 'IMAGE' : m.type === 'VIDEO' ? 'VIDEO' : m.type === 'FILE' ? 'FILE' : undefined)
                            }));
                        if (newMsgs.length > 0) {
                            this.messages = [...this.messages, ...newMsgs];
                            this.scrollToBottom();
                        }
                    });
            });
    }


    /**
     * Sends a WS READ_RECEIPT for the last visible message.
     * - Turns the sender's tick from grey ✓✓ → blue ✓✓
     * - WS handler also persists READ to DB so the tick survives page refresh
     */
    private markMessagesRead(roomId: string): void {
        if (!this.wsSvc.connected$.value) return;
        // Find the last message from the OTHER person — that's the one we mark as read.
        // Iterating backwards is O(1) in the common case (last msg is theirs).
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i];
            if (!m.mine && m.id) {
                this.wsSvc.sendReadReceipt(roomId, String(m.id));
                return;
            }
        }
    }

    private loadRoomMembers(roomId: string) {
        this.isLoadingMembers = true;
        this.chatSvc.getRoomMembers(roomId).pipe(takeUntil(this.destroy$)).subscribe({
            next: members => { this.roomMembers = members; this.isLoadingMembers = false; },
            error: () => { this.isLoadingMembers = false; }
        });
    }

    private loadRoomMedia(roomId: string) {
        this.isMediaLoading = true;
        this.mediaSvc.getRoomMedia(roomId).pipe(takeUntil(this.destroy$)).subscribe({
            // Wrap in setTimeout(0) to push the assignment out of the current
            // change-detection cycle — prevents NG0100 ExpressionChangedAfterItHasBeenCheckedError
            // caused by roomMedia.length changing while Angular is still checking the view.
            next: media => setTimeout(() => {
                this.roomMedia = media;
                this.isMediaLoading = false;
            }, 0),
            error: () => setTimeout(() => { this.isMediaLoading = false; }, 0)
        });
    }

    // ── Create Room ───────────────────────────────────────────────
    openCreateRoom() {
        this.showCreateRoom = true;
        this.newRoomName = '';
        this.newRoomDesc = '';
        this.memberSearch = '';
        this.memberResults = [];
        this.pendingMembers = [];
    }

    closeCreateRoom() { this.showCreateRoom = false; }

    openUpgradeModal()  { this.showUpgradeModal = true;  }
    closeUpgradeModal() { this.showUpgradeModal = false; }

    /**
     * Why no separate payment component?
     * ─────────────────────────────────
     * Razorpay checkout.js (loaded from their CDN in index.html) renders its own
     * complete hosted payment UI in a popup/iframe. We only need to:
     *   1. Call our backend to get a Razorpay orderId
     *   2. Call new Razorpay(options).open() — Razorpay handles everything else
     *   3. In the handler callback, verify the signature on our backend
     *   4. Swap the JWT so isPremium becomes true immediately
     *
     * A separate Angular component would just be empty boilerplate.
     */
    initiatePayment() {
        if (this.isPaymentLoading) return;
        this.isPaymentLoading = true;

        this.chatSvc.createPaymentOrder()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (order) => {
                    this.isPaymentLoading = false;
                    if (!order) { alert('Could not create order. Please try again.'); return; }

                    // Razorpay options — their JS popup reads these and renders its own UI
                    const options: any = {
                        key:         order.keyId,
                        amount:      order.amount,
                        currency:    order.currency,
                        name:        'ConnectHub',
                        description: 'Premium Subscription',
                        order_id:    order.razorpayOrderId,
                        prefill: {
                            name:  this.fullName || this.username,
                            email: this.email
                        },
                        theme: { color: '#7c3aed' },

                        // ── IMPORTANT: wrap in ngZone.run() ───────────────────────────
                        // Razorpay's handler fires from their own JS context, completely
                        // outside Angular's NgZone. Without ngZone.run(), mutations like
                        // isPremium=true never trigger Angular change detection and the
                        // UI stays stale even though state changed in memory.
                        handler: (response: any) => {
                            this.ngZone.run(() => {
                                this.chatSvc.verifyPayment({
                                    razorpayOrderId:   response.razorpay_order_id,
                                    razorpayPaymentId: response.razorpay_payment_id,
                                    razorpaySignature: response.razorpay_signature
                                }).pipe(takeUntil(this.destroy$)).subscribe({
                                    next: (result) => {
                                        this.ngZone.run(() => {
                                            if (result?.verified) {
                                                // Swap JWT — plan=PREMIUM baked in
                                                if (result.newToken) {
                                                    localStorage.setItem('jwt_token', result.newToken);
                                                }
                                                this.isPremium = true;
                                                this.isPaymentLoading = false;
                                                this.closeUpgradeModal();
                                                // Re-fetch profile to sync sidebar (name, avatar, email).
                                                // After applyProfile we force isPremium=true because:
                                                // (a) the DB update travels via Feign and may have a small
                                                //     propagation delay on the first request after startup
                                                // (b) we already have cryptographic proof of payment from
                                                //     Razorpay's HMAC signature — this is authoritative.
                                                this.chatSvc.getMyProfile()
                                                    .pipe(takeUntil(this.destroy$))
                                                    .subscribe(p => {
                                                        if (p) {
                                                            this.applyProfile(p);
                                                            // Guard: never downgrade a just-confirmed payment
                                                            this.isPremium = true;
                                                            this.cdr.markForCheck();
                                                        }
                                                    });
                                                this.cdr.markForCheck();
                                            } else {
                                                alert('Payment received but plan upgrade failed. Please contact support.');
                                            }
                                        });
                                    },
                                    error: () => {
                                        this.ngZone.run(() => {
                                            this.isPaymentLoading = false;
                                            this.cdr.markForCheck();
                                            alert('Payment verified but plan upgrade failed. Please contact support.');
                                        });
                                    }
                                });
                            });
                        },

                        modal: {
                            ondismiss: () => {
                                // Also runs outside Angular zone
                                this.ngZone.run(() => {
                                    this.isPaymentLoading = false;
                                    this.cdr.markForCheck();
                                });
                            }
                        }
                    };

                    // Open Razorpay's hosted checkout popup (their UI, not ours)
                    const rzp = new (window as any).Razorpay(options);
                    rzp.open();
                    this.closeUpgradeModal();
                },
                error: () => {
                    this.isPaymentLoading = false;
                    this.cdr.markForCheck();
                    alert('Could not reach payment service. Please try again.');
                }
            });
    }



    onMemberSearchInput(value: string) {
        this.memberSearch = value;
        this.memberSearchSub$.next(value);
    }

    private doMemberSearch(keyword: string) {
        if (!keyword.trim()) { this.memberResults = []; return; }
        this.memberSearching = true;
        this.chatSvc.searchUsers(keyword).pipe(takeUntil(this.destroy$)).subscribe({
            next: users => {
                this.memberResults = users.filter(u =>
                    u.email !== this.email &&
                    !this.pendingMembers.find(p => p.userId === u.userId)
                );
                this.memberSearching = false;
            },
            error: () => { this.memberSearching = false; }
        });
    }

    addPendingMember(u: UserProfile) {
        if (!this.pendingMembers.find(p => p.userId === u.userId)) {
            this.pendingMembers.push(u);
        }
        this.memberResults = this.memberResults.filter(r => r.userId !== u.userId);
        this.memberSearch = '';
    }

    removePendingMember(userId: string) {
        this.pendingMembers = this.pendingMembers.filter(p => p.userId !== userId);
    }

    submitCreateRoom() {
        if (!this.newRoomName.trim() || this.isCreatingRoom) return;
        this.isCreatingRoom = true;

        this.chatSvc.createRoom(this.newRoomName.trim(), this.newRoomDesc.trim()).pipe(
            takeUntil(this.destroy$)
        ).subscribe({
            next: room => {
                if (!room) { this.isCreatingRoom = false; return; }

                // Add each pending member sequentially
                const adds = this.pendingMembers.map(m => () =>
                    this.chatSvc.addMemberToRoom(room.roomId, m.userId, 'MEMBER').pipe(takeUntil(this.destroy$)).subscribe()
                );
                adds.forEach(fn => fn());

                // Wait 500ms then refresh room list and open the new room
                setTimeout(() => {
                    this.loadMyRooms();
                    this.showCreateRoom = false;
                    this.isCreatingRoom = false;
                    // small delay so loadMyRooms can finish
                    setTimeout(() => {
                        const created = this.rooms.find(r => r.roomId === room.roomId);
                        if (created) this.selectRoom(created);
                        else this.selectRoom(room); // fallback
                    }, 800);
                }, 500);
            },
            error: () => { this.isCreatingRoom = false; }
        });
    }

    // ── Room Admin actions ─────────────────────────────────────────
    removeMemberFromRoom(userId: string) {
        if (!this.selectedRoom || this.myRoomRole !== 'ADMIN') return;
        if (userId === this.userId) return; // can't remove yourself
        this.chatSvc.removeMember(this.selectedRoom.roomId, userId)
            .pipe(takeUntil(this.destroy$)).subscribe(ok => {
                if (ok) this.loadRoomMembers(this.selectedRoom!.roomId);
            });
    }

    makeAdmin(userId: string) {
        if (!this.selectedRoom || this.myRoomRole !== 'ADMIN') return;
        this.chatSvc.changeMemberRole(this.selectedRoom.roomId, userId, 'ADMIN')
            .pipe(takeUntil(this.destroy$)).subscribe(updated => {
                if (updated) this.loadRoomMembers(this.selectedRoom!.roomId);
            });
    }

    removeAdmin(userId: string) {
        if (!this.selectedRoom || this.myRoomRole !== 'ADMIN') return;
        this.chatSvc.changeMemberRole(this.selectedRoom.roomId, userId, 'MEMBER')
            .pipe(takeUntil(this.destroy$)).subscribe(updated => {
                if (updated) this.loadRoomMembers(this.selectedRoom!.roomId);
            });
    }

    leaveRoom() {
        if (!this.selectedRoom) return;
        if (!confirm(`Leave ${this.selectedRoom.name}?`)) return;
        this.chatSvc.leaveRoom(this.selectedRoom.roomId)
            .pipe(takeUntil(this.destroy$)).subscribe(ok => {
                if (ok) {
                    this.rooms = this.rooms.filter(r => r.roomId !== this.selectedRoom!.roomId);
                    this.selectedRoom = null;
                    this.messages = [];
                    this.roomMembers = [];
                }
            });
    }

    // -- Individual Contacts (People -> Message) --
    selectContact(c: Contact) {
        this.stopTypingNow();       // cancel pending typing indicator for the previous DM
        this.selectedContact = c;
        this.selectedRoom = null;
        this.activeTab = 'chat';
        this.chatMode = 'individual';
        this.messages = [];
        this.replyTo = null;
        this.editingMessageId = null;
        this.typingLabel = '';    // clear stale typing state from previous chat
        this.mobileShowChat = true;   // show thread on mobile
        c.unread = 0;
        if (c.userId && this.userId) {
            const dmId = this.getDmRoomId(c.userId);
            this.loadRoomMessages(dmId);
            this.loadRoomMedia(dmId);
            this.subscribeToRoomTopic(dmId);
        }
    }

    /** Mobile back — return to contact/room list */
    mobileBack() {
        this.mobileShowChat = false;
        this.selectedContact = null;
        this.selectedRoom = null;
    }

    messagePerson(u: UserProfile) {
        const existing = this.contacts.find(c => c.email === u.email);
        if (existing) { this.selectContact(existing); }
        else {
            const nc: Contact = {
                id: u.userId,
                userId: u.userId,
                name: u.fullName || u.username,
                username: u.username,
                avatar: (u.fullName || u.username || '?').charAt(0).toUpperCase() +
                    ((u.fullName || u.username || '').split(' ')[1]?.charAt(0) || ''),
                status: u.status?.toLowerCase() || 'offline',
                lastMsg: '',
                time: 'Now',
                unread: 0,
                role: u.bio || '',
                location: [u.city, u.country].filter(Boolean).join(', '),
                phone: u.phoneNumber || '',
                email: u.email,
                avatarUrl: u.avatarUrl || ''
            };
            this.contacts.unshift(nc);
            this.persistContacts();
            this.selectContact(nc);
            this.refreshPresence();  // fetch presence for the newly added contact
        }
        this.activeTab = 'chat';
    }

    // -- File Upload Logic --
    onFileSelected(event: any) {
        const file: File = event.target.files?.[0];
        if (!file) return;

        // Validate type — accept images and videos only
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) {
            alert(`Unsupported file type: ${file.type || 'unknown'}.\nPlease select an image or video file.`);
            // Reset input so user can try again
            event.target.value = '';
            return;
        }

        this.selectedFile = file;

        // Create preview
        const reader = new FileReader();
        reader.onload = () => this.filePreview = reader.result as string;
        reader.readAsDataURL(file);
    }

    cancelFile() {
        this.selectedFile = null;
        this.filePreview = null;
    }

    /**
     * Uploads the selected file, then broadcasts the media message via WebSocket.
     *
     * Bug 2 fix — old code:
     *   mediaSvc.upload() → chatSvc.sendMessage() (REST only)
     *   REST saves to DB but never broadcasts. The other user had to refresh.
     *
     * New flow:
     *   mediaSvc.upload() → wsSvc.sendChatMessage(…, mediaUrl, mediaType)
     *   WS handler saves to DB + broadcasts to room → receiver renders instantly.
     *
     * Optimistic local insert:
     *   We push a local message immediately so the sender sees their image/video
     *   without waiting for the WS echo (which may take 100–300 ms).
     *   The echo arrives shortly after and is de-duplicated by content/time.
     *
     * REST fallback:
     *   If WS is disconnected (e.g. network drop), we fall back to chatSvc.sendMessage()
     *   which at least persists the message so it's visible on next refresh.
     */
    uploadAndSend(): void {
        if (!this.selectedFile) return;
        this.stopTypingNow();   // immediately end typing indicator on all peers' screens

        // Safely resolve roomId — never proceed with null/undefined
        let roomId: string | null = null;
        if (this.selectedRoom) {
            roomId = this.selectedRoom.roomId;
        } else if (this.selectedContact?.userId) {
            roomId = this.getDmRoomId(this.selectedContact.userId);
        }

        if (!roomId) {
            alert('Please open a conversation before uploading.');
            return;
        }

        const resolvedRoomId = roomId;   // capture for use inside callbacks
        const fileToUpload = this.selectedFile;

        this.mediaSvc.upload(fileToUpload, resolvedRoomId).subscribe({
            next: media => {
                const text = this.newMessage.trim() ||
                    (media.mimeType.startsWith('image/') ? '[Image]'
                        : media.mimeType.startsWith('video/') ? '[Video]'
                            : '[File]');

                // Derive a typed mediaType for the WS payload and local render
                const mediaType: 'IMAGE' | 'VIDEO' | 'FILE' =
                    media.mimeType.startsWith('image/') ? 'IMAGE'
                        : media.mimeType.startsWith('video/') ? 'VIDEO'
                            : 'FILE';

                this.newMessage = '';
                this.cancelFile();

                if (this.wsSvc.connected$.value) {
                    // ── Happy path: WebSocket is live ────────────────────────────
                    // 1. Optimistic local insert so sender sees image immediately.
                    //    Use 'temp_' prefix (same as text sendMessage) so the WS echo
                    //    handler's findIndex(startsWith('temp_')) finds and replaces it
                    //    instead of pushing a duplicate.
                    this.messages = [...this.messages, {
                        id: `temp_${Date.now()}`,
                        text,
                        time: this.formatTime(new Date().toISOString()),
                        mine: true,
                        sender: this.fullName || this.username,
                        deliveryStatus: 'SENT',
                        mediaUrl: media.url,
                        mediaType,
                    }];
                    this.loadRoomMedia(resolvedRoomId);
                    this.scrollToBottom();

                    // 2. Send through WS — handler saves to DB and broadcasts to room
                    this.wsSvc.sendChatMessage(resolvedRoomId, text, undefined, media.url, mediaType, this.fullName || this.username);

                } else {
                    // ── Fallback: WS disconnected — REST save only ───────────────
                    // Message is persisted but the other user won't see it in real-time.
                    // They will see it on next refresh (or when polling kicks in).
                    console.warn('[Chat] WS disconnected — falling back to REST for media send');
                    this.chatSvc.sendMessage(resolvedRoomId, text, {
                        mediaUrl: media.url,
                        mediaType,
                    }).subscribe(msg => {
                        if (msg) {
                            this.messages.push({
                                id: (msg as any).messageId,
                                text: (msg as any).content,
                                time: this.formatTime((msg as any).sentAt || (msg as any).createdAt),
                                mine: true,
                                sender: this.fullName || this.username,
                                deliveryStatus: 'SENT',
                                mediaUrl: (msg as any).mediaUrl,
                                mediaType: (msg as any).mediaType,
                            });
                            this.loadRoomMedia(resolvedRoomId);
                            this.scrollToBottom();
                        }
                    });
                }
            },
            error: err => {
                console.error('[Chat] Upload failed', err);
                alert('Upload failed. Please try again.');
            },
        });
    }

    // -- Send Message — routes through WebSocket, NOT REST --
    // WebSocket handler (port 8087) receives /app/chat.send, saves to message-service,
    // then broadcasts the saved message to /topic/room/{roomId}.
    // Using REST (chatSvc.sendMessage) would save the message but NEVER broadcast it —
    // the other user would only see it after a page refresh.
    sendMessage() {
        if (!this.newMessage.trim()) return;
        this.stopTypingNow();   // immediately end typing indicator on all peers' screens
        const text = this.newMessage.trim();
        this.newMessage = '';

        if (this.selectedRoom) {
            const roomId = this.selectedRoom.roomId;
            const replyToId = this.replyTo ? String(this.replyTo.id) : undefined;
            this.replyTo = null;

            if (this.wsSvc.connected$.value) {
                // ── WebSocket path (real-time) ──────────────────────────────────────
                // Optimistically show the message immediately on the sender's side.
                // The broadcast from websocket-handler will arrive back via /topic/room/{roomId}
                // and be deduplicated by messageId (alreadyKnown check).
                const tempId = `temp_${Date.now()}`;
                this.messages = [...this.messages, {
                    id: tempId, text, time: this.nowTime(), mine: true,
                    sender: this.fullName || this.username, deliveryStatus: 'SENT',
                    replyToMessageId: replyToId
                }];
                this.scrollToBottom();
                this.updateRoomLastMessage(roomId, text);
                this.wsSvc.sendChatMessage(roomId, text, replyToId, undefined, undefined, this.fullName || this.username);
            } else {
                // ── REST fallback (WS not connected) ──────────────────────────────
                this.chatSvc.sendMessage(roomId, text,
                    replyToId ? { replyToMessageId: replyToId } : undefined
                ).pipe(takeUntil(this.destroy$)).subscribe(msg => {
                    if (msg) {
                        this.messages = [...this.messages, {
                            id: (msg as any).messageId, text: (msg as any).content,
                            time: this.formatTime((msg as any).sentAt || (msg as any).createdAt),
                            mine: true, sender: this.fullName || this.username, deliveryStatus: 'SENT',
                        }];
                        this.scrollToBottom();
                    }
                });
            }

        } else if (this.selectedContact?.userId && this.userId) {
            // ── DM chat ──────────────────────────────────────────────────────────
            const dmId = this.getDmRoomId(this.selectedContact.userId);
            const replyToId = this.replyTo ? String(this.replyTo.id) : undefined;
            this.replyTo = null;

            if (this.wsSvc.connected$.value) {
                // Optimistic display
                const tempId = `temp_${Date.now()}`;
                this.messages = [...this.messages, {
                    id: tempId, text, time: this.nowTime(), mine: true,
                    sender: this.fullName || this.username, deliveryStatus: 'SENT',
                    replyToMessageId: replyToId
                }];
                this.scrollToBottom();
                // Update contact preview
                if (this.selectedContact) {
                    this.selectedContact.lastMsg = text;
                    this.selectedContact.time = this.nowTime();
                    this.persistContacts();
                }
                this.wsSvc.sendChatMessage(dmId, text, replyToId, undefined, undefined, this.fullName || this.username);
            } else {
                // REST fallback
                this.chatSvc.sendMessage(dmId, text,
                    replyToId ? { replyToMessageId: replyToId } : undefined
                ).pipe(takeUntil(this.destroy$)).subscribe(msg => {
                    if (msg) {
                        if (this.selectedContact) {
                            this.selectedContact.lastMsg = text;
                            this.selectedContact.time = this.nowTime();
                            this.persistContacts();
                        }
                        this.messages = [...this.messages, {
                            id: (msg as any).messageId, text: (msg as any).content,
                            time: this.formatTime((msg as any).sentAt || (msg as any).createdAt),
                            mine: true, sender: this.fullName || this.username, deliveryStatus: 'SENT',
                        }];
                        this.scrollToBottom();
                    }
                });
            }

        } else {
            // Fallback: local-only (no userId known yet)
            this.messages.push({
                id: Date.now(), text, time: this.nowTime(), mine: true,
                sender: this.fullName || this.username, deliveryStatus: 'SENT'
            });
            this.scrollToBottom();
        }
    }

    // -- Edit Message --
    startEdit(m: LocalMessage) {
        if (!m.mine || m.isDeleted) return;
        this.editingMessageId = String(m.id);
        this.editContent = m.text;
        this.activeContextMenu = null;
    }
    cancelEdit() { this.editingMessageId = null; this.editContent = ''; }
    confirmEdit() {
        if (!this.editingMessageId || !this.editContent.trim()) return;
        const id = this.editingMessageId;
        this.chatSvc.editMessage(id, this.editContent.trim())
            .pipe(takeUntil(this.destroy$)).subscribe(() => {
                const idx = this.messages.findIndex(m => String(m.id) === id);
                if (idx !== -1) { this.messages[idx].text = this.editContent.trim(); this.messages[idx].isEdited = true; }
                this.cancelEdit();
            });
    }

    // -- Delete Message --
    deleteOwnMessage(m: LocalMessage) {
        if (!m.mine || m.isDeleted) return;
        this.activeContextMenu = null;
        this.chatSvc.deleteMessage(String(m.id))
            .pipe(takeUntil(this.destroy$)).subscribe(ok => {
                if (ok) {
                    const idx = this.messages.findIndex(x => x.id === m.id);
                    if (idx !== -1) { this.messages[idx].text = '[Message deleted]'; this.messages[idx].isDeleted = true; }
                }
            });
    }

    // ── Pin Message (PREMIUM feature) ────────────────────────────────────
    /** The currently-pinned message in this room (derived from loaded messages, no extra call). */
    get pinnedMessage(): LocalMessage | null {
        if (!this.selectedRoom) return null;
        return this.messages.find(m => m.isPinned && !m.isDeleted) ?? null;
    }

    pinMessage(m: LocalMessage) {
        if (!this.selectedRoom) return;
        this.activeContextMenu = null;
        this.chatSvc.pinRoomMessage(this.selectedRoom.roomId, String(m.id))
            .pipe(takeUntil(this.destroy$))
            .subscribe(ok => {
                if (ok) {
                    // Create a NEW array so Angular's change detection sees the update.
                    // In-place forEach mutation does NOT trigger the pinnedMessage getter.
                    this.messages = this.messages.map(msg =>
                        msg.id === m.id
                            ? { ...msg, isPinned: true }
                            : { ...msg, isPinned: false }
                    );
                    this.cdr.markForCheck();
                }
            });
    }

    unpinMessage() {
        if (!this.selectedRoom) return;
        this.chatSvc.unpinRoomMessage(this.selectedRoom.roomId)
            .pipe(takeUntil(this.destroy$))
            .subscribe(ok => {
                if (ok) {
                    // New array reference so Angular detects the change
                    this.messages = this.messages.map(msg => ({ ...msg, isPinned: false }));
                    this.cdr.markForCheck();
                }
            });
    }


    // -- Reply --
    startReply(m: LocalMessage) { this.replyTo = m; this.activeContextMenu = null; this.editingMessageId = null; }
    cancelReply() { this.replyTo = null; }

    // -- Search in Room --
    toggleMsgSearch() {
        this.showMsgSearch = !this.showMsgSearch;
        if (!this.showMsgSearch) { this.msgSearchQuery = ''; this.msgSearchResults = []; }
    }
    doMsgSearch() {
        if (!this.selectedRoom || !this.msgSearchQuery.trim()) { this.msgSearchResults = []; return; }
        this.chatSvc.searchMessages(this.selectedRoom.roomId, this.msgSearchQuery)
            .pipe(takeUntil(this.destroy$)).subscribe(results => {
                this.msgSearchResults = results.map((m: any) => ({
                    id: m.messageId, text: m.content, time: this.formatTime(m.sentAt),
                    mine: m.senderId === this.userId, sender: m.senderName, deliveryStatus: m.deliveryStatus
                }));
            });
    }
    toggleContextMenu(msgId: string) {
        this.activeContextMenu = this.activeContextMenu === msgId ? null : msgId;
    }
    closeContextMenu() { this.activeContextMenu = null; this.showEmojiPicker = false; }

    deliveryIcon(status: string | undefined): 'read' | 'delivered' | 'sent' {
        switch (status) {
            case 'READ': return 'read';
            case 'DELIVERED': return 'delivered';
            default: return 'sent';
        }
    }


    // ── People tab search ─────────────────────────────────────────
    onPeopleSearch(keyword: string) {
        this.peopleSearch = keyword;
        this.searchSub$.next(keyword);
    }

    private doSearchUsers(keyword: string) {
        if (!keyword.trim()) { this.searchResults = []; this.peopleSearched = false; return; }
        this.isPeopleLoading = true;
        this.peopleSearched = true;
        this.chatSvc.searchUsers(keyword).pipe(takeUntil(this.destroy$)).subscribe({
            next: users => { this.searchResults = users.filter(u => u.email !== this.email); this.isPeopleLoading = false; },
            error: () => { this.isPeopleLoading = false; }
        });
    }

    get displayedPeople(): UserProfile[] {
        return this.peopleSearched ? this.searchResults : [];
    }

    // ── Utilities ─────────────────────────────────────────────────
    getAvatarLetter(u: UserProfile): string {
        return (u.fullName || u.username || '?').charAt(0).toUpperCase();
    }

    getMemberAvatarLetter(m: RoomMemberResponse): string {
        return (m.fullName || m.username || '?').charAt(0).toUpperCase();
    }

    getStatusClass(status: string): string {
        switch ((status || '').toUpperCase()) {
            case 'ONLINE': return 'status-online';
            case 'AWAY': return 'status-away';
            default: return 'status-offline';
        }
    }

    getRoomInitial(room: RoomResponse): string {
        return room.name.charAt(0).toUpperCase();
    }

    getRoomColor(room: RoomResponse): string {
        // Deterministic color from roomId
        const colors = ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4'];
        const idx = room.roomId.charCodeAt(0) % colors.length;
        return colors[idx];
    }

    private formatTime(iso: string): string {
        if (!iso) return '';
        try {
            // Handle both ISO string and LocalDateTime array from Spring
            const d = Array.isArray(iso) ? new Date((iso as any)[0], (iso as any)[1] - 1, (iso as any)[2], (iso as any)[3] || 0, (iso as any)[4] || 0) : new Date(iso);
            const h = d.getHours(), m = d.getMinutes();
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
        } catch { return ''; }
    }



    private nowTime(): string {
        const d = new Date();
        const h = d.getHours(), m = d.getMinutes();
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }

    private scrollToBottom() {
        // Two-step: first tick lets Angular render, second ensures layout is settled
        setTimeout(() => {
            const el = document.querySelector('.messages-body');
            if (el) {
                el.scrollTop = el.scrollHeight;
                // Second pass for images or dynamic content that shifts layout
                setTimeout(() => { el.scrollTop = el.scrollHeight; }, 120);
            }
        }, 50);
    }

    logout() {
        this.chatSvc.logout().subscribe();
        if (isPlatformBrowser(this.platform)) {
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('current_user');
            // Remove stale generic key so it never leaks into another user's session
            localStorage.removeItem('ch_contacts');
        }
        this.router.navigate(['/login']);
    }

    goAdmin() { this.router.navigate(['/admin']); }

    getDmRoomId(otherUserId: string): string {
        // Stable, sorted conversation key shared by both users
        const ids = [this.userId, otherUserId].sort();
        return `dm_${ids[0]}_${ids[1]}`;
    }

    // ── Contact Persistence ───────────────────────────────────────
    /** Save the current DM contact list to localStorage. */
    private persistContacts(): void {
        if (!isPlatformBrowser(this.platform)) return;
        try {
            if (this.userId) {
                localStorage.setItem(`ch_contacts_${this.userId}`, JSON.stringify(this.contacts));
            }
        } catch { /* quota exceeded — silent */ }
    }

    /** Restore DM contacts from localStorage on init. */
    private restoreContacts(): void {
        if (!isPlatformBrowser(this.platform)) return;
        try {
            // Only restore contacts that belong to this specific user — never fall back
            // to the legacy generic 'ch_contacts' key which could contain another user's data.
            const raw = localStorage.getItem(`ch_contacts_${this.userId}`);
            if (raw) {
                const parsed: Contact[] = JSON.parse(raw);
                parsed.forEach(saved => {
                    const isSelf = saved.userId === this.userId || saved.email === this.email;
                    const alreadyIn = this.contacts.some(c => c.userId && c.userId === saved.userId);
                    if (!isSelf && !alreadyIn) {
                        this.contacts.push(saved);
                    }
                });
            }
        } catch { /* corrupted data — ignore */ }
    }

    /** Fetch bulk presence for all known contacts and refresh the map. */
    private refreshPresence(): void {
        const ids = this.contacts
            .map(c => c.userId)
            .filter((id): id is string => !!id && id !== this.userId);
        if (ids.length) {
            this.presenceSvc.loadBulk(ids)
                .pipe(takeUntil(this.destroy$))
                .subscribe();
        }
    }

    // ── Lightbox ──────────────────────────────────────────────────
    /**
     * Opens the lightbox for an image or video.
     *
     * Bug 2 fix: accepts an optional mediaType so the template can render
     * a <video> element instead of a broken <img> when the user clicks a video.
     */
    openLightbox(url: string, mediaType?: 'IMAGE' | 'VIDEO' | string | null): void {
        this.lightboxUrl = this.resolveMediaUrl(url);
        this.lightboxMediaType = (mediaType === 'VIDEO') ? 'VIDEO' : 'IMAGE';
    }

    closeLightbox(): void {
        this.lightboxUrl = null;
        this.lightboxMediaType = null;
    }

    @HostListener('document:keydown.escape')
    onEscapeKey() {
        if (this.lightboxUrl) this.closeLightbox();
    }

    /**
     * Resolves a media URL to an absolute URL via the gateway.
     *
     * Handles three historical formats stored in the DB:
     *  1. Absolute:  http://localhost:8080/media/view/UUID.jpg  — returned as-is
     *  2. Relative:  /media/view/UUID.jpg                       — prefixed with GATEWAY
     *  3. Bare file: UUID.jpg (old records before the fix)      — prefixed with /media/view/
     */
    resolveMediaUrl(url: string | null | undefined): string {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        if (url.startsWith('/'))   return `${this.GATEWAY}${url}`;
        return `${this.GATEWAY}/media/view/${url}`;
    }
}