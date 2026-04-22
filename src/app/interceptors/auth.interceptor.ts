import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const attachToken = authService.shouldAttachAccessToken(req.url);

  // If a token refresh is already in flight (e.g. triggered by the tab
  // becoming visible again after wake-from-sleep), hold the request until
  // the refresh settles so we attach the freshly-minted access token rather
  // than the expired one — eliminating the 401 spray in the console on wake.
  const prepared$ = from(attachToken ? authService.awaitPendingRefresh() : Promise.resolve()).pipe(
    switchMap(() => {
      const token = authService.getToken();
      const requestWithToken = token && attachToken
        ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
        : req;
      return next(requestWithToken);
    }),
  );

  return prepared$.pipe(
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
