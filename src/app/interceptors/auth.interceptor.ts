import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // To avoid circular dependency loading issues and race conditions early on,
  // we can also safely read from localStorage directly if authService isn't fully ready
  let token = localStorage.getItem('auth_token');

  if (!token) {
      try {
          const authService = inject(AuthService);
          token = authService.getToken();
      } catch (e) {
          // Ignore
      }
  }

  if (token) {
    const authReq = req.clone({
      headers: req.headers.set('Authorization', `Bearer ${token}`)
    });
    return next(authReq);
  }

  return next(req);
};
