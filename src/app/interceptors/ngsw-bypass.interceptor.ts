import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../environments/environment';

/**
 * Keeps API calls out of the Angular service worker.
 *
 * ngsw intercepts every same-origin fetch and replays it with
 * `fetch(event.request)`. Safari (iOS especially) loses part of a FormData
 * body on that replay, so attachment uploads reached busboy truncated and
 * failed with "Multipart: Unexpected end of form". ngsw-config.json defines
 * no dataGroups, so the SW never caches API responses anyway: bypassing it
 * costs nothing.
 */
export const ngswBypassInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiUrl(req.url)) return next(req);
  return next(req.clone({ headers: req.headers.set('ngsw-bypass', 'true') }));
};

function isApiUrl(url: string): boolean {
  const apiUrl = environment.apiUrl;
  return url === apiUrl || url.startsWith(`${apiUrl}/`);
}
