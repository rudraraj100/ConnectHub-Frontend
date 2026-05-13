import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AdminService, AdminUser, AdminRoom, UserReport } from './admin.service';
import { PLATFORM_ID } from '@angular/core';
import { of } from 'rxjs';

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminService,
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.setItem('jwt_token', 'mock-token');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch all users and normalize isActive', () => {
    const mockResponse = {
      data: [
        { userId: 'u1', username: 'user1', active: true },
        { userId: 'u2', username: 'user2', isActive: false }
      ]
    };

    service.getUsers().subscribe(users => {
      expect(users.length).toBe(2);
      expect(users[0].isActive).toBe(true);
      expect(users[1].isActive).toBe(false);
    });

    const req = httpMock.expectOne('http://localhost:8080/auth/admin/users');
    expect(req.request.method).toBe('GET');
    req.flush(mockResponse);
  });

  it('should toggle user status', () => {
    const mockUser = { userId: 'u1', username: 'user1', active: false };
    const mockResponse = { data: { ...mockUser, active: true } };

    service.toggleUser('u1').subscribe(user => {
      expect(user?.isActive).toBe(true);
    });

    const req = httpMock.expectOne('http://localhost:8080/auth/admin/users/u1/toggle');
    expect(req.request.method).toBe('PATCH');
    req.flush(mockResponse);
  });

  it('should broadcast system message', () => {
    service.broadcast(['u1', 'u2'], 'Title', 'Message').subscribe(success => {
      expect(success).toBe(true);
    });

    const req = httpMock.expectOne('http://localhost:8080/notifications/broadcast');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      recipientIds: ['u1', 'u2'],
      title: 'Title',
      message: 'Message'
    });
    req.flush({ success: true });
  });

  it('should fetch reports', () => {
    const mockReports: UserReport[] = [
      { reportId: 'r1', reporterUsername: 'rep1', reportedUsername: 'bad1', reason: 'Spam', status: 'PENDING', createdAt: '' } as any
    ];
    const mockResponse = { data: mockReports };

    service.getReports().subscribe(reports => {
      expect(reports.length).toBe(1);
      expect(reports[0].reportId).toBe('r1');
    });

    const req = httpMock.expectOne('http://localhost:8080/auth/admin/reports');
    expect(req.request.method).toBe('GET');
    req.flush(mockResponse);
  });
});
