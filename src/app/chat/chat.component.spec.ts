import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatComponent } from './chat.component';
import { ChatService } from './chat.service';
import { WebSocketService } from './websocket.service';
import { PresenceService } from './presence.service';
import { NotificationService } from './notification.service';
import { MediaService } from './media.service';
import { AdminService } from '../admin/admin.service';
import { Router } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { PLATFORM_ID } from '@angular/core';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  // Mock services using Vitest vi.fn()
  const chatSvcMock = {
    getMyProfile: vi.fn(),
    getMyRooms: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    getRoomMembers: vi.fn().mockReturnValue(of([])),
    markRoomAsRead: vi.fn().mockReturnValue(of(null)),
    getUserById: vi.fn().mockReturnValue(of(null)),
    updateStatus: vi.fn().mockReturnValue(of(null))
  };
  const wsSvcMock = {
    connected$: new BehaviorSubject<boolean>(false),
    connect: vi.fn(),
    subscribe: vi.fn(() => (() => {})),
    sendChatMessage: vi.fn(),
    sendTyping: vi.fn(),
    sendReadReceipt: vi.fn(),
    disconnect: vi.fn()
  };

  const presenceSvcMock = { 
    presence$: new BehaviorSubject<any>(new Map()),
    setStatus: vi.fn().mockReturnValue(of(null)),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn()
  };
  const notifSvcMock = { 
    notifications$: new BehaviorSubject<any[]>([]),
    unreadCount$: new BehaviorSubject<number>(0),
    toast$: new BehaviorSubject<any>(null),
    startPolling: vi.fn(),
    markAsRead: vi.fn(),
    markAllRead: vi.fn(),
    deleteNotification: vi.fn()
  };
  const mediaSvcMock = { 
    getFilesByRoom: vi.fn().mockReturnValue(of([])),
    getRoomMedia: vi.fn().mockReturnValue(of([]))
  };
  const adminSvcMock = { getStats: vi.fn() };
  const routerMock = { navigate: vi.fn() };

  beforeEach(async () => {
    localStorage.setItem('jwt_token', 'mock-token');
    chatSvcMock.getMyProfile.mockReturnValue(of({ userId: 'u1', username: 'testuser' }));
    chatSvcMock.getMyRooms.mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [ChatComponent], // Standalone component
      providers: [
        { provide: ChatService, useValue: chatSvcMock },
        { provide: WebSocketService, useValue: wsSvcMock },
        { provide: PresenceService, useValue: presenceSvcMock },
        { provide: NotificationService, useValue: notifSvcMock },
        { provide: MediaService, useValue: mediaSvcMock },
        { provide: AdminService, useValue: adminSvcMock },
        { provide: Router, useValue: routerMock },
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load profile on init', () => {
    fixture.detectChanges();
    expect(component.userId).toBe('u1');
    expect(component.username).toBe('testuser');
  });

  it('should select a room and fetch messages', () => {
    const room = { roomId: 'r1', name: 'Room 1' } as any;
    chatSvcMock.getMessages.mockReturnValue(of({ content: [], totalElements: 0 }));
    
    component.selectRoom(room);
    
    expect(component.selectedRoom).toBe(room);
    expect(component.chatMode).toBe('room');
    expect(chatSvcMock.getMessages).toHaveBeenCalledWith('r1', 0, 50);
  });

  it('should send a message via WebSocket if connected', () => {
    wsSvcMock.connected$.next(true);
    component.selectedRoom = { roomId: 'r1' } as any;
    component.newMessage = 'Hello world';
    component.userId = 'u1';
    component.fullName = 'Test User';
    
    component.sendMessage();
    
    expect(wsSvcMock.sendChatMessage).toHaveBeenCalled();
    expect(component.newMessage).toBe('');
  });
});
