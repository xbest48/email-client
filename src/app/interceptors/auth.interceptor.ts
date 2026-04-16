import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();
  const requestWithToken = token && authService.shouldAttachAccessToken(req.url)
    ? req.clone({
        headers: req.headers.set('Authorization', `Bearer ${token}`),
      })
    : req;

  return next(requestWithToken).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !authService.shouldAttemptRefresh(req.url)) {
        return throwError(() => error);
      }

      return from(authService.refreshAccessToken()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            return throwError(() => error);
          }

          const freshToken = authService.getToken();
          if (!freshToken) {
            return throwError(() => error);
          }

          const retryRequest = req.clone({
            headers: req.headers.set('Authorization', `Bearer ${freshToken}`),
          });

          return next(retryRequest);
        }),
        catchError(() => throwError(() => error)),
      );
    }),
  );
};
