export interface EmailAddress {
  name: string;
  email: string;
}

export interface Email {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  snippet: string;
  body: string;
  htmlBody: string;
  date: string;
  labels: string[];
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  attachments: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Label {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal: number;
  messagesUnread: number;
  color: string;
}

export interface SearchFilter {
  query: string;
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
  label: string;
  after: string;
  before: string;
  isUnread: boolean;
}

export interface EmailListResponse {
  messages: Email[];
  nextPageToken: string;
  resultSizeEstimate: number;
}
