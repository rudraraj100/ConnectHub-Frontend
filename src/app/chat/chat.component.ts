import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, timer } from 'rxjs';
import { ChatService, UserProfile, RoomResponse, RoomMemberResponse, MessageResponse } from './chat.service';
import { MediaService, MediaFile } from './media.service';
import { PresenceService } from './presence.service';
import { NotificationService, AppNotification } from './notification.service';

interface Contact {
  id: string; name: string; avatar: string; status: string;
  lastMsg: string; time: string; unread: number;
  userId?: string;   // backend userId for DM conversation
  role?: string; location?: string; phone?: string; email?: string;
  avatarUrl?: string;
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
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  private router   = inject(Router);
  private platform = inject(PLATFORM_ID);
  private chatSvc  = inject(ChatService);
  private destroy$ = new Subject<void>();
  private searchSub$       = new Subject<string>();
  private memberSearchSub$ = new Subject<string>();
  private mediaSvc        = inject(MediaService);
  private presenceSvc     = inject(PresenceService);
  private notifSvc        = inject(NotificationService);

  /** Exposes the presence map to the template */
  get presenceMap() { return this.presenceSvc.presence$.value; }

  /** Exposes notification list to the template */
  get notifications()  { return this.notifSvc.notifications$.value; }
  get unreadNotifCount() { return this.notifSvc.unreadCount$.value; }

  // ── Current user ──────────────────────────────────────────────
  private readonly GATEWAY = 'http://localhost:8080';
  userId       = '';
  username     = '';
  fullName     = '';
  email        = '';
  isAdmin      = false;
  avatarLetter = 'U';
  avatarUrl    = '';
  userLocation = '';
  userPhone    = '';
  isProfileLoading = false;
  currentStatus: 'ONLINE' | 'AWAY' | 'DND' | 'INVISIBLE' = 'ONLINE';

  // ── Panels ──────────────────────────────────────────────
  showProfile       = false;
  showSettings      = false;
  showNotifications = false;

  // ── Presence options ──────────────────────────────────────────
  readonly presenceOptions = [
    { value: 'ONLINE',    label: 'Online',    desc: 'You appear online to everyone' },
    { value: 'AWAY',      label: 'Away',      desc: 'Show as away / be right back' },
    { value: 'DND',       label: 'Do Not Disturb', desc: 'Mute notifications, appear busy' },
    { value: 'INVISIBLE', label: 'Invisible', desc: 'Appear offline to others' },
  ] as const;

  // ── Report form ───────────────────────────────────────────────
  reportUsername = '';
  reportReason   = '';
  reportDetails  = '';
  isReporting    = false;
  reportSuccess  = false;
  readonly reportReasons = [
    'Spam', 'Harassment', 'Hate Speech', 'Impersonation',
    'Inappropriate Content', 'Other'
  ];

  // ── Edit profile form (Settings panel) ─────────────────────────────
  editFullName    = '';
  editUsername    = '';
  editBio         = '';
  editAvatarUrl   = '';
  editCountry     = '';
  editCity        = '';
  editCountryCode = '';
  editPhone       = '';
  isSavingProfile  = false;
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
  showCreateRoom   = false;
  newRoomName      = '';
  newRoomDesc      = '';
  memberSearch     = '';
  memberResults: UserProfile[]  = [];
  pendingMembers: UserProfile[] = [];
  isCreatingRoom   = false;
  memberSearching  = false;

  // ── People tab ────────────────────────────────────────────────
  searchResults: UserProfile[] = [];
  peopleSearch     = '';
  isPeopleLoading  = false;
  peopleSearched   = false;

  // ── Media ─────────────────────────────────────────────────────
  roomMedia: MediaFile[] = [];
  isMediaLoading = false;
  selectedFile: File | null = null;
  filePreview: string | null = null;

  // ── Lightbox ──────────────────────────────────────────────────
  lightboxUrl: string | null = null;

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
    return this.contacts.reduce((a, c) => a + c.unread, 0) +
           this.rooms.reduce((a, r) => a + r.unreadCount, 0);
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

    // ── Restore persisted DM contacts so previous chats are visible on reload
    this.restoreContacts();

    this.isProfileLoading = true;
    this.chatSvc.getMyProfile().pipe(takeUntil(this.destroy$)).subscribe({
      next: p => {
        if (p) {
          // Always persist fresh profile — overwrites any stale cached avatarUrl
          localStorage.setItem('current_user', JSON.stringify(p));
          this.applyProfile(p);
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

    // ── Notifications: load + poll every 30 s ───────────────────
    this.notifSvc.startPolling();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.chatSvc.updateStatus('AWAY').subscribe();
    // Mark OFFLINE and stop heartbeat on component teardown
    this.presenceSvc.setStatus('OFFLINE').subscribe();
    this.presenceSvc.stopHeartbeat();
  }

  // ── Notification helpers ────────────────────────────────
  openNotifications(): void {
    this.showNotifications = !this.showNotifications;
    this.showProfile  = false;
    this.showSettings = false;
  }
  closeNotifications(): void { this.showNotifications = false; }
  onMarkAsRead(id: number):    void { this.notifSvc.markAsRead(id); }
  onMarkAllRead():             void { this.notifSvc.markAllRead(); }
  onDeleteNotif(id: number):   void { this.notifSvc.deleteNotification(id); }

  private applyProfile(u: any) {
    this.userId      = u?.userId     || '';
    this.username    = u?.username   || '';
    this.fullName    = u?.fullName   || u?.name || '';
    this.email       = u?.email      || '';
    this.avatarUrl   = u?.avatarUrl  || '';
    this.userLocation = [u?.city, u?.country].filter(Boolean).join(', ');
    this.userPhone    = u?.countryCode ? `${u.countryCode} ${u.phoneNumber || ''}` : u?.phoneNumber || '';
    this.isAdmin     = this.email === 'rudrar2002@gmail.com';
    const display    = this.fullName || this.username || 'U';
    this.avatarLetter = display.charAt(0).toUpperCase();
  }

  // ── Profile panel ─────────────────────────────────────────────
  openProfile()  { this.showProfile = true; this.showSettings = false; }
  closeProfile() { this.showProfile = false; }

  // ── Settings panel ────────────────────────────────────────────
  openSettings() {
    this.showSettings = true;
    this.showProfile  = false;
    this.reportSuccess = false;
    this.profileSaveSuccess = false;
    // Pre-populate the edit form with current values
    this.editFullName    = this.fullName;
    this.editUsername    = this.username;
    this.editBio         = '';
    this.editAvatarUrl   = this.avatarUrl;
    this.editCountry     = '';
    this.editCity        = '';
    this.editCountryCode = '';
    this.editPhone       = '';
    // Fetch fresh profile to get bio/location/phone
    this.chatSvc.getMyProfile().pipe(takeUntil(this.destroy$)).subscribe(p => {
      if (p) {
        this.editBio         = (p as any).bio         || '';
        this.editCountry     = (p as any).country     || '';
        this.editCity        = (p as any).city        || '';
        this.editCountryCode = (p as any).countryCode || '';
        this.editPhone       = (p as any).phoneNumber || '';
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
      fullName:    this.editFullName.trim()    || undefined,
      username:    this.editUsername.trim()    || undefined,
      bio:         this.editBio.trim()         || undefined,
      avatarUrl:   this.editAvatarUrl.trim()   || undefined,
      country:     this.editCountry.trim()     || undefined,
      city:        this.editCity.trim()        || undefined,
      countryCode: this.editCountryCode.trim() || undefined,
      phoneNumber: this.editPhone.trim()       || undefined,
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

  // ── Presence ──────────────────────────────────────────────────
  setStatus(status: 'ONLINE' | 'AWAY' | 'DND' | 'INVISIBLE') {
    this.currentStatus = status;
    this.chatSvc.updateStatus(status).pipe(takeUntil(this.destroy$)).subscribe();
  }

  // ── Report ────────────────────────────────────────────────────
  submitReport() {
    if (!this.reportUsername.trim() || !this.reportReason || this.isReporting) return;
    this.isReporting = true;
    // Fire & forget — backend report endpoint to be wired with auth-service
    setTimeout(() => {
      this.isReporting  = false;
      this.reportSuccess = true;
      // Reset form after 4 s
      setTimeout(() => {
        this.reportUsername = '';
        this.reportReason   = '';
        this.reportDetails  = '';
        this.reportSuccess  = false;
      }, 4000);
    }, 1200);
  }

  // ── Rooms API ─────────────────────────────────────────────────
  loadMyRooms() {
    this.isLoadingRooms = true;
    this.chatSvc.getMyRooms().pipe(takeUntil(this.destroy$)).subscribe({
      next: rooms => { this.rooms = rooms; this.isLoadingRooms = false; },
      error: ()   => { this.isLoadingRooms = false; }
    });
  }

  selectRoom(r: RoomResponse) {
    this.selectedRoom    = r;
    this.selectedContact = null;
    this.activeTab       = 'chat';
    this.chatMode        = 'room';
    this.myRoomRole      = r.currentUserRole;
    this.messages        = [];
    this.loadRoomMessages(r.roomId);
    this.loadRoomMembers(r.roomId);
    this.loadRoomMedia(r.roomId);
    this.chatSvc.markRoomAsRead(r.roomId).subscribe();
  }

  private loadRoomMessages(roomId: string) {
    this.isLoadingMessages = true;
    this.chatSvc.getMessages(roomId, 0, 50).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const msgs = (res as any).content ?? [];
        // API returns newest-first; reverse for chronological display
        this.messages = [...msgs].reverse().map((m: any) => ({
          id:               m.messageId,
          text:             m.isDeleted ? '[Message deleted]' : m.content,
          time:             this.formatTime(m.sentAt || m.createdAt),
          mine:             m.senderId === this.userId,
          // Avatar letter is only used when no avatarUrl is available
          avatar:           m.senderAvatarUrl ? undefined : (m.senderName?.charAt(0).toUpperCase() || '?'),
          // Show full name; fallback to @username so something meaningful always appears
          sender:           (m.senderName && !m.senderName.includes('-')) ? m.senderName : (m.senderUsername || 'Unknown'),
          senderId:         m.senderId,
          deliveryStatus:   (m.deliveryStatus as 'SENT' | 'DELIVERED' | 'READ') || 'SENT',
          isEdited:         m.isEdited  || false,
          isDeleted:        m.isDeleted || false,
          replyToMessageId: m.replyToMessageId,
          mediaUrl:         m.mediaUrl || undefined,
          mediaType:        m.mediaType || undefined
        }));
        this.isLoadingMessages = false;
        // Use a slightly longer timeout to ensure Angular has finished rendering
        this.scrollToBottom();
      },
      error: () => { this.isLoadingMessages = false; }
    });
  }

  private loadRoomMembers(roomId: string) {
    this.isLoadingMembers = true;
    this.chatSvc.getRoomMembers(roomId).pipe(takeUntil(this.destroy$)).subscribe({
      next: members => { this.roomMembers = members; this.isLoadingMembers = false; },
      error: ()     => { this.isLoadingMembers = false; }
    });
  }

  private loadRoomMedia(roomId: string) {
    this.isMediaLoading = true;
    this.mediaSvc.getRoomMedia(roomId).pipe(takeUntil(this.destroy$)).subscribe({
      next: media => { this.roomMedia = media; this.isMediaLoading = false; },
      error: () => { this.isMediaLoading = false; }
    });
  }

  // ── Create Room ───────────────────────────────────────────────
  openCreateRoom() {
    this.showCreateRoom = true;
    this.newRoomName    = '';
    this.newRoomDesc    = '';
    this.memberSearch   = '';
    this.memberResults  = [];
    this.pendingMembers = [];
  }

  closeCreateRoom() { this.showCreateRoom = false; }

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
    this.memberSearch  = '';
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
          this.messages     = [];
          this.roomMembers  = [];
        }
      });
  }

  // -- Individual Contacts (People -> Message) --
  selectContact(c: Contact) {
    this.selectedContact  = c;
    this.selectedRoom     = null;
    this.activeTab        = 'chat';
    this.chatMode         = 'individual';
    this.messages         = [];
    this.replyTo          = null;
    this.editingMessageId = null;
    c.unread = 0;
    // Load persisted DM history from message-service
    if (c.userId && this.userId) {
      const dmId = this.getDmRoomId(c.userId);
      this.loadRoomMessages(dmId);
      this.loadRoomMedia(dmId);
    }
  }

  messagePerson(u: UserProfile) {
    const existing = this.contacts.find(c => c.email === u.email);
    if (existing) { this.selectContact(existing); }
    else {
      const nc: Contact = {
        id:        u.userId,
        userId:    u.userId,
        name:      u.fullName || u.username,
        username:  u.username,
        avatar:    (u.fullName || u.username || '?').charAt(0).toUpperCase() +
                   ((u.fullName || u.username || '').split(' ')[1]?.charAt(0) || ''),
        status:    u.status?.toLowerCase() || 'offline',
        lastMsg:   '',
        time:      'Now',
        unread:    0,
        role:      u.bio || '',
        location:  [u.city, u.country].filter(Boolean).join(', '),
        phone:     u.phoneNumber || '',
        email:     u.email,
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

  uploadAndSend() {
    if (!this.selectedFile) return;

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

    const resolvedRoomId = roomId; // capture for use inside callbacks

    this.mediaSvc.upload(this.selectedFile, resolvedRoomId).subscribe({
      next: media => {
        const text = this.newMessage.trim() ||
                     (media.mimeType.startsWith('image/') ? '[Image]' : '[Video]');
        this.newMessage = '';
        this.cancelFile();

        this.chatSvc.sendMessage(resolvedRoomId, text, {
          mediaUrl: media.url,
          mediaType: media.mimeType.startsWith('image/') ? 'IMAGE' : 'VIDEO'
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
              mediaType: (msg as any).mediaType
            });
            this.loadRoomMedia(resolvedRoomId);
            this.scrollToBottom();
          }
        });
      },
      error: err => {
        console.error('Upload failed', err);
        alert('Upload failed. Please try again.');
      }
    });
  }

  // -- Send Message (now uses message-service) --
  sendMessage() {
    if (!this.newMessage.trim()) return;
    const text = this.newMessage.trim();
    this.newMessage = '';
    if (this.selectedRoom) {
      const opts = this.replyTo ? { replyToMessageId: String(this.replyTo.id) } : undefined;
      this.chatSvc.sendMessage(this.selectedRoom.roomId, text, opts)
        .pipe(takeUntil(this.destroy$)).subscribe(msg => {
          if (msg) {
            this.messages.push({
              id: (msg as any).messageId,
              text: (msg as any).content,
              time: this.formatTime((msg as any).sentAt || (msg as any).createdAt),
              mine: true,
              sender: this.fullName || this.username,
              deliveryStatus: 'SENT',
              replyToMessageId: (msg as any).replyToMessageId
            });
            this.replyTo = null;
            this.scrollToBottom();
          }
        });
    } else if (this.selectedContact?.userId && this.userId) {
      // DM: persist to message-service with a stable conversation ID
      const dmId = this.getDmRoomId(this.selectedContact.userId);
      const opts = this.replyTo ? { replyToMessageId: String(this.replyTo.id) } : undefined;
      this.chatSvc.sendMessage(dmId, text, opts)
        .pipe(takeUntil(this.destroy$)).subscribe(msg => {
          if (msg) {
            // Update lastMsg on the contact and persist
            if (this.selectedContact) {
              this.selectedContact.lastMsg = text;
              this.selectedContact.time = this.nowTime();
              this.persistContacts();
            }
            this.messages.push({
              id: (msg as any).messageId,
              text: (msg as any).content,
              time: this.formatTime((msg as any).sentAt || (msg as any).createdAt),
              mine: true,
              sender: this.fullName || this.username,
              deliveryStatus: 'SENT',
              replyToMessageId: (msg as any).replyToMessageId
            });
            this.replyTo = null;
            this.scrollToBottom();
          }
        });
    } else {
      // Fallback: local-only (no userId known yet)
      this.messages.push({ id: Date.now(), text, time: this.nowTime(), mine: true,
        sender: this.fullName || this.username, deliveryStatus: 'SENT' });
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
  closeContextMenu() { this.activeContextMenu = null; }

  deliveryIcon(status: string | undefined): 'read' | 'delivered' | 'sent' {
    switch (status) {
      case 'READ':      return 'read';
      case 'DELIVERED': return 'delivered';
      default:          return 'sent';
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
    this.peopleSearched  = true;
    this.chatSvc.searchUsers(keyword).pipe(takeUntil(this.destroy$)).subscribe({
      next: users => { this.searchResults = users.filter(u => u.email !== this.email); this.isPeopleLoading = false; },
      error: ()   => { this.isPeopleLoading = false; }
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
      case 'AWAY':   return 'status-away';
      default:       return 'status-offline';
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
      const d = Array.isArray(iso) ? new Date((iso as any)[0], (iso as any)[1]-1, (iso as any)[2], (iso as any)[3]||0, (iso as any)[4]||0) : new Date(iso);
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
      // NOTE: intentionally keep 'ch_contacts' so conversations re-appear on next login
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
      // Try user-specific contacts first, fallback to legacy generic contacts if none found
      const raw = localStorage.getItem(`ch_contacts_${this.userId}`) || localStorage.getItem('ch_contacts');
      if (raw) {
        const parsed: Contact[] = JSON.parse(raw);
        // Merge: avoid duplicates by userId
        parsed.forEach(saved => {
          if (saved.id !== this.userId && saved.email !== this.email && !this.contacts.find(c => c.id === saved.id)) {
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
  openLightbox(url: string) {
    this.lightboxUrl = this.resolveMediaUrl(url);
  }

  closeLightbox() {
    this.lightboxUrl = null;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.lightboxUrl) this.closeLightbox();
  }

  /**
   * Resolves a media URL to an absolute URL via the gateway.
   * Old messages stored relative paths (/media/view/...) before this fix.
   * New uploads store absolute paths (http://localhost:8080/media/view/...).
   */
  resolveMediaUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;          // already absolute
    return `${this.GATEWAY}${url}`;                  // prefix gateway base
  }
}
