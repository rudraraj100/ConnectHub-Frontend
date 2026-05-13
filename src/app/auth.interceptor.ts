import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { catchError, throwError } from 'rxjs';

/**
 * Global HTTP interceptor — handles suspension / session revocation.
 *
 * When the API Gateway detects a suspended account it returns:
 *   403 Forbidden  { message: "Account suspended" }
 *
 * This interceptor catches every 403 globally, clears all local auth
 * state, and hard-redirects the user to /login?error=suspended so they
 * see a clear, actionable message instead of a raw error screen.
 *
 * 401 Unauthorized (expired token) is handled the same way — clear state
 * and redirect to login so the user can re-authenticate.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router   = inject(Router);
  const platform = inject(PLATFORM_ID);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (!isPlatformBrowser(platform)) return throwError(() => err);

      if (err.status === 403) {
        // Skip the redirect if this is the login attempt or a verification flow —
        // the LoginComponent already shows the error inline.
        const isLoginAttempt = req.url.includes('/auth/login');
        const isVerifyFlow   = req.url.includes('/auth/resend-verification') ||
                               req.url.includes('/auth/verify-otp');
        if (!isLoginAttempt && !isVerifyFlow) {
          // Active session suspended mid-use — clear all auth state and redirect
          localStorage.removeItem('jwt_token');
          localStorage.removeItem('refresh_token');
          router.navigate(['/login'], { queryParams: { error: 'suspended' } });
        }
      } else if (err.status === 401) {
        // Token expired or invalid — skip auth/verify endpoints to avoid redirect loops
        const isAuthEndpoint = req.url.includes('/auth/login')    ||
                               req.url.includes('/auth/refresh')  ||
                               req.url.includes('/auth/register') ||
                               req.url.includes('/auth/resend-verification') ||
                               req.url.includes('/auth/verify-otp') ||
                               req.url.includes('/auth/reports')  ||
                               req.url.includes('/auth/admin/reports');

        if (!isAuthEndpoint) {
          localStorage.removeItem('jwt_token');
          localStorage.removeItem('refresh_token');
          router.navigate(['/login']);
        }
      }

      return throwError(() => err);
    })
  );
};
