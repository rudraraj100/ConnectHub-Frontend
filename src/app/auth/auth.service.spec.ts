import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService, AuthResponse } from './auth.service';
import { PLATFORM_ID } from '@angular/core';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should save tokens to localStorage', () => {
    const user = { userId: '123', username: 'testuser' } as any;
    service.saveTokens('token123', 'refresh123', user);
    
    expect(localStorage.getItem('jwt_token')).toBe('token123');
    expect(localStorage.getItem('refresh_token')).toBe('refresh123');
    expect(localStorage.getItem('current_user')).toContain('testuser');
  });

  it('should return true for isLoggedIn if token exists', () => {
    localStorage.setItem('jwt_token', 'exists');
    expect(service.isLoggedIn()).toBe(true);
  });

  it('should clear tokens on logout', () => {
    localStorage.setItem('jwt_token', 'exists');
    service.clearTokens();
    expect(localStorage.getItem('jwt_token')).toBeNull();
  });

  it('should perform login and save tokens', () => {
    const mockResponse: AuthResponse = {
      success: true,
      message: 'Login successful',
      data: {
        token: 'new-token',
        refreshToken: 'new-refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: { userId: '1', username: 'test' } as any
      }
    };

    service.login({ email: 'test@test.com', password: 'password' }).subscribe(res => {
      expect(res.success).toBe(true);
      expect(localStorage.getItem('jwt_token')).toBe('new-token');
    });

    const req = httpMock.expectOne('http://localhost:8080/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush(mockResponse);
  });
});
