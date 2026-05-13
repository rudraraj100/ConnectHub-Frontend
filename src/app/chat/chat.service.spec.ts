import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ChatService, RoomResponse, MessageResponse } from './chat.service';
import { PLATFORM_ID } from '@angular/core';

describe('ChatService', () => {
  let service: ChatService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ChatService,
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    });
    service = TestBed.inject(ChatService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.setItem('jwt_token', 'mock-token');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch user rooms', () => {
    const mockRooms: RoomResponse[] = [
      { roomId: '1', name: 'Room 1', type: 'GROUP' } as any
    ];

    service.getMyRooms().subscribe(rooms => {
      expect(rooms.length).toBe(1);
      expect(rooms[0].name).toBe('Room 1');
    });

    const req = httpMock.expectOne('http://localhost:8080/rooms/my');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer mock-token');
    req.flush({ success: true, data: mockRooms });
  });

  it('should send a message', () => {
    const mockMsg: MessageResponse = { messageId: 'm1', content: 'hello' } as any;

    service.sendMessage('r1', 'hello').subscribe(msg => {
      expect(msg?.messageId).toBe('m1');
    });

    const req = httpMock.expectOne('http://localhost:8080/messages/room/r1');
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, data: mockMsg });
  });

  it('should update user status', () => {
    service.updateStatus('AWAY').subscribe(res => {
      expect(res).toBeTruthy();
    });

    const req = httpMock.expectOne('http://localhost:8080/auth/status');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.status).toBe('AWAY');
    req.flush({ success: true, data: { status: 'AWAY' } });
  });
});
