import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Await the initial load promise if it exists to prevent race conditions on reload
  const initialLoad = authService.getInitialLoadPromise();
  if (initialLoad) {
      await initialLoad;
  } else if (!authService.user() && authService.getToken()) {
      // Fallback
      await authService.checkAuthStatus();
  }

  if (authService.isAuthenticated()) {
    return true;
  }

  // Not authenticated, redirect to login
  return router.createUrlTree(['/login']);
};
