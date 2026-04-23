import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ChatService, UserProfile, RoomResponse, RoomMemberResponse, MessageResponse } from './chat.service';

interface Contact {
  id: string; name: string; avatar: string; status: string;
  lastMsg: string; time: string; unread: number;
  role?: string; location?: string; phone?: string; email?: string;
  avatarUrl?: string;
}
interface LocalMessage {
  id: number | string; text: string; time: string; mine: boolean;
  avatar?: string; sender?: string; senderId?: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  // ── Current user ──────────────────────────────────────────────
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

  // ── Panels ────────────────────────────────────────────────────
  showProfile  = false;
  showSettings = false;

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

  // ── Messages ──────────────────────────────────────────────────
  messages: LocalMessage[] = [];
  newMessage = '';
  isLoadingMessages = false;

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

  // ── Getters ───────────────────────────────────────────────────
  get filteredContacts() {
    return this.contacts.filter(c =>
      c.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
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

    this.isProfileLoading = true;
    this.chatSvc.getMyProfile().pipe(takeUntil(this.destroy$)).subscribe({
      next: p => {
        if (p) { localStorage.setItem('current_user', JSON.stringify(p)); this.applyProfile(p); }
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
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.chatSvc.updateStatus('AWAY').subscribe();
  }

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
    this.chatSvc.markRoomAsRead(r.roomId).subscribe();
  }

  private loadRoomMessages(roomId: string) {
    this.isLoadingMessages = true;
    this.chatSvc.getRoomMessages(roomId).pipe(takeUntil(this.destroy$)).subscribe({
      next: msgs => {
        // API returns newest-first; reverse for chronological display
        this.messages = [...msgs].reverse().map(m => ({
          id:       m.messageId,
          text:     m.isDeleted ? '[Message deleted]' : m.content,
          time:     this.formatTime(m.createdAt),
          mine:     m.senderId === this.userId,
          avatar:   m.senderName?.charAt(0).toUpperCase() || '?',
          sender:   m.senderName?.split(' ')[0] || '',
          senderId: m.senderId
        }));
        this.isLoadingMessages = false;
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

  // ── Individual Contacts (People → Message) ────────────────────
  selectContact(c: Contact) {
    this.selectedContact = c;
    this.selectedRoom    = null;
    this.activeTab       = 'chat';
    this.chatMode        = 'individual';
    this.messages        = [
      { id: 1, text: `Hi ${this.fullName || 'there'}! How are you?`, time: this.nowTime(), mine: false, avatar: c.avatar, sender: c.name.split(' ')[0] }
    ];
    c.unread = 0;
  }

  messagePerson(u: UserProfile) {
    const existing = this.contacts.find(c => c.email === u.email);
    if (existing) { this.selectContact(existing); }
    else {
      const nc: Contact = {
        id:        u.userId,
        name:      u.fullName || u.username,
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
      this.selectContact(nc);
    }
    this.activeTab = 'chat';
  }

  // ── Send Message ──────────────────────────────────────────────
  sendMessage() {
    if (!this.newMessage.trim()) return;

    if (this.selectedRoom) {
      // Send to room via API
      const text = this.newMessage.trim();
      this.newMessage = '';
      this.chatSvc.sendRoomMessage(this.selectedRoom.roomId, text)
        .pipe(takeUntil(this.destroy$)).subscribe(msg => {
          if (msg) {
            this.messages.push({
              id: msg.messageId, text: msg.content,
              time: this.formatTime(msg.createdAt), mine: true
            });
            this.scrollToBottom();
          }
        });
    } else {
      // Local-only for individual chat (DM API will be added with message service)
      this.messages.push({ id: Date.now(), text: this.newMessage.trim(), time: this.nowTime(), mine: true });
      this.newMessage = '';
      this.scrollToBottom();
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
      const d = new Date(iso);
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
    setTimeout(() => {
      const el = document.querySelector('.messages-body');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  logout() {
    this.chatSvc.logout().subscribe();
    if (isPlatformBrowser(this.platform)) {
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('current_user');
    }
    this.router.navigate(['/login']);
  }

  goAdmin() { this.router.navigate(['/admin']); }
}
