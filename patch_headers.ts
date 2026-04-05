import * as fs from 'fs';

const path = 'src/app/services/email.service.ts';
let content = fs.readFileSync(path, 'utf8');

// The issue is that the NestJS backend expects `x-account-id` in the headers.
// The frontend never actually sent it anywhere except maybe it was implied in early drafts.

// Helper function to add headers
const helper = `
  private getHeaders() {
    const accountId = this.settingsService.activeAccountId();
    let headers = new HttpHeaders();
    if (accountId) {
      headers = headers.set('x-account-id', accountId);
    }
    return headers;
  }
`;

content = content.replace(
  "import { HttpClient, HttpParams } from '@angular/common/http';",
  "import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';"
);

content = content.replace(
  "  private trashFolder = '';",
  "  private trashFolder = '';\n" + helper
);

content = content.replace(/\{ withCredentials: true \}/g, "{ headers: this.getHeaders(), withCredentials: true }");
content = content.replace(/\{ params, withCredentials: true \}/g, "{ params, headers: this.getHeaders(), withCredentials: true }");

fs.writeFileSync(path, content);
