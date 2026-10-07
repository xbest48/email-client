import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';

const CHUNK_RELOAD_KEY = 'kyma_chunk_reload_at';

/**
 * A lazy route whose JS chunk no longer exists on the server (new deploy
 * while the app was open) fails to load and the navigation silently dies.
 * Reload the target URL once to fetch the current build; the timestamp guard
 * avoids a reload loop if the chunk is genuinely unreachable (offline).
 */
function reloadOnStaleChunk(error: unknown, url: string): void {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i.test(message);
  if (!isChunkError) return;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still try the reload once.
  }
  document.location.assign(url);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
      withNavigationErrorHandler((error) => reloadOnStaleChunk(error.error, error.url)),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
