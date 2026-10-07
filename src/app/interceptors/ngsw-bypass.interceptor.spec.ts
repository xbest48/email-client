import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ngswBypassInterceptor } from './ngsw-bypass.interceptor';
import { environment } from '../environments/environment';

describe('ngswBypassInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ngswBypassInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('bypasses the service worker for multipart API uploads', () => {
    const formData = new FormData();
    formData.append('files', new Blob(['%PDF']), 'facture.pdf');
    http.post(`${environment.apiUrl}/send`, formData).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/send`);
    expect(req.request.headers.get('ngsw-bypass')).toBe('true');
    expect(req.request.body).toBe(formData);
    req.flush({});
  });

  it('leaves non-API requests to the service worker', () => {
    http.get('/assets/i18n/fr.json').subscribe();

    const req = httpMock.expectOne('/assets/i18n/fr.json');
    expect(req.request.headers.has('ngsw-bypass')).toBe(false);
    req.flush({});
  });
});
