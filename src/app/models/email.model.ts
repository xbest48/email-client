export interface EmailAddress {
  name: string;
  email: string;
}

export interface Email {
  uid: number;
  folder: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  snippet: string;
  body: string;
  htmlBody: string;
  date: string;
  flags: string[];
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  attachments: Attachment[];
  size: number;
  messageId?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ImapFolder {
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  specialUse: string | null;
  listed: boolean;
  subscribed: boolean;
}

export interface FolderStatus {
  path: string;
  messages: number;
  unseen: number;
  recent: number;
}

export interface EmailListResponse {
  emails: Email[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchFilter {
  query: string;
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
  after: string;
  before: string;
  isUnread: boolean;
}
