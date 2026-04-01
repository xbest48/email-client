const { ImapFlow } = require('imapflow');

/** @type {Map<string, ImapFlow>} */
const connections = new Map();

/**
 * Get or create an IMAP connection for a session.
 */
async function getConnection(sessionId, credentials) {
  if (connections.has(sessionId)) {
    const client = connections.get(sessionId);
    if (client.usable) return client;
    connections.delete(sessionId);
  }

  const client = new ImapFlow({
    host: credentials.imapHost,
    port: credentials.imapPort || 993,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
    logger: false,
  });

  await client.connect();
  connections.set(sessionId, client);
  return client;
}

/**
 * Close an IMAP connection for a session.
 */
async function closeConnection(sessionId) {
  if (connections.has(sessionId)) {
    const client = connections.get(sessionId);
    try {
      await client.logout();
    } catch {
      // ignore
    }
    connections.delete(sessionId);
  }
}

/**
 * List all IMAP folders/mailboxes.
 */
async function listFolders(sessionId, credentials) {
  const client = await getConnection(sessionId, credentials);
  const folders = await client.list();
  return folders.map((f) => ({
    path: f.path,
    name: f.name,
    delimiter: f.delimiter,
    flags: Array.from(f.flags || []),
    specialUse: f.specialUse || null,
    listed: f.listed,
    subscribed: f.subscribed,
  }));
}

/**
 * Get folder status (message counts).
 */
async function getFolderStatus(sessionId, credentials, folder) {
  const client = await getConnection(sessionId, credentials);
  const status = await client.status(folder, {
    messages: true,
    unseen: true,
    recent: true,
  });
  return {
    path: folder,
    messages: status.messages,
    unseen: status.unseen,
    recent: status.recent,
  };
}

/**
 * Fetch emails from a folder.
 */
async function fetchEmails(sessionId, credentials, folder, page = 1, pageSize = 25) {
  const client = await getConnection(sessionId, credentials);
  const lock = await client.getMailboxLock(folder);

  try {
    const total = client.mailbox.exists;
    if (total === 0) return { emails: [], total: 0, page, pageSize };

    const end = Math.max(total - (page - 1) * pageSize, 0);
    const start = Math.max(end - pageSize + 1, 1);

    if (end <= 0) return { emails: [], total, page, pageSize };

    const emails = [];
    for await (const msg of client.fetch(`${start}:${end}`, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      uid: true,
      size: true,
    })) {
      emails.push(formatEmailSummary(msg, folder));
    }

    // Most recent first
    emails.reverse();

    return { emails, total, page, pageSize };
  } finally {
    lock.release();
  }
}

/**
 * Search emails in a folder.
 */
async function searchEmails(sessionId, credentials, folder, query) {
  const client = await getConnection(sessionId, credentials);
  const lock = await client.getMailboxLock(folder);

  try {
    const searchCriteria = buildSearchCriteria(query);
    const results = await client.search(searchCriteria, { uid: true });

    if (results.length === 0) return { emails: [], total: 0 };

    // Limit to 50 results
    const uids = results.slice(-50).reverse();
    const emails = [];

    for await (const msg of client.fetch(uids, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      uid: true,
      size: true,
    }, { uid: true })) {
      emails.push(formatEmailSummary(msg, folder));
    }

    emails.reverse();
    return { emails, total: results.length };
  } finally {
    lock.release();
  }
}

/**
 * Fetch a single email with full body.
 */
async function fetchEmail(sessionId, credentials, folder, uid) {
  const client = await getConnection(sessionId, credentials);
  const lock = await client.getMailboxLock(folder);

  try {
    const msg = await client.fetchOne(uid, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      uid: true,
      size: true,
      source: true,
    }, { uid: true });

    const { simpleParser } = require('mailparser');
    const parsed = await simpleParser(msg.source);

    return {
      uid: msg.uid,
      folder,
      messageId: msg.envelope.messageId,
      subject: msg.envelope.subject || '(sans objet)',
      from: formatAddress(msg.envelope.from),
      to: formatAddresses(msg.envelope.to),
      cc: formatAddresses(msg.envelope.cc),
      bcc: formatAddresses(msg.envelope.bcc),
      date: msg.envelope.date ? msg.envelope.date.toISOString() : null,
      flags: Array.from(msg.flags || []),
      isRead: msg.flags?.has('\\Seen') || false,
      isStarred: msg.flags?.has('\\Flagged') || false,
      body: parsed.text || '',
      htmlBody: parsed.html || '',
      attachments: (parsed.attachments || []).map((att, i) => ({
        id: String(i),
        filename: att.filename || 'attachment',
        mimeType: att.contentType,
        size: att.size || 0,
      })),
      hasAttachments: (parsed.attachments || []).length > 0,
      size: msg.size,
    };
  } finally {
    lock.release();
  }
}

/**
 * Mark an email as read/unread.
 */
async function setFlag(sessionId, credentials, folder, uid, flag, value) {
  const client = await getConnection(sessionId, credentials);
  const lock = await client.getMailboxLock(folder);

  try {
    if (value) {
      await client.messageFlagsAdd(uid, [flag], { uid: true });
    } else {
      await client.messageFlagsRemove(uid, [flag], { uid: true });
    }
  } finally {
    lock.release();
  }
}

/**
 * Move an email to another folder.
 */
async function moveEmail(sessionId, credentials, fromFolder, uid, toFolder) {
  const client = await getConnection(sessionId, credentials);
  const lock = await client.getMailboxLock(fromFolder);

  try {
    await client.messageMove(uid, toFolder, { uid: true });
  } finally {
    lock.release();
  }
}

/**
 * Delete an email (move to Trash or expunge).
 */
async function deleteEmail(sessionId, credentials, folder, uid, trashFolder) {
  if (trashFolder && folder !== trashFolder) {
    await moveEmail(sessionId, credentials, folder, uid, trashFolder);
  } else {
    const client = await getConnection(sessionId, credentials);
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
      await client.messageDelete(uid, { uid: true });
    } finally {
      lock.release();
    }
  }
}

/**
 * Create a new folder.
 */
async function createFolder(sessionId, credentials, folderPath) {
  const client = await getConnection(sessionId, credentials);
  await client.mailboxCreate(folderPath);
}

/**
 * Delete a folder.
 */
async function deleteFolder(sessionId, credentials, folderPath) {
  const client = await getConnection(sessionId, credentials);
  await client.mailboxDelete(folderPath);
}

// --- Helper functions ---

function formatEmailSummary(msg, folder) {
  const hasAttachments = checkAttachments(msg.bodyStructure);
  return {
    uid: msg.uid,
    folder,
    subject: msg.envelope.subject || '(sans objet)',
    from: formatAddress(msg.envelope.from),
    to: formatAddresses(msg.envelope.to),
    date: msg.envelope.date ? msg.envelope.date.toISOString() : null,
    flags: Array.from(msg.flags || []),
    isRead: msg.flags?.has('\\Seen') || false,
    isStarred: msg.flags?.has('\\Flagged') || false,
    hasAttachments,
    size: msg.size,
    snippet: '',
  };
}

function formatAddress(addresses) {
  if (!addresses || addresses.length === 0) return { name: '', email: '' };
  const addr = addresses[0];
  return {
    name: addr.name || addr.address || '',
    email: addr.address || '',
  };
}

function formatAddresses(addresses) {
  if (!addresses) return [];
  return addresses.map((addr) => ({
    name: addr.name || addr.address || '',
    email: addr.address || '',
  }));
}

function checkAttachments(bodyStructure) {
  if (!bodyStructure) return false;
  if (bodyStructure.disposition === 'attachment') return true;
  if (bodyStructure.childNodes) {
    return bodyStructure.childNodes.some(checkAttachments);
  }
  return false;
}

function buildSearchCriteria(query) {
  if (!query || typeof query === 'string') {
    // Simple text search
    if (!query) return { all: true };

    // Parse query parts
    const criteria = {};
    const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const textParts = [];

    for (const part of parts) {
      if (part.startsWith('from:')) {
        criteria.from = part.slice(5);
      } else if (part.startsWith('to:')) {
        criteria.to = part.slice(3);
      } else if (part.startsWith('subject:')) {
        criteria.subject = part.slice(8);
      } else if (part === 'is:unread') {
        criteria.unseen = true;
      } else if (part === 'has:attachment') {
        // Not directly supported by all IMAP servers, skip
      } else if (part.startsWith('since:') || part.startsWith('after:')) {
        criteria.since = new Date(part.split(':')[1]);
      } else if (part.startsWith('before:')) {
        criteria.before = new Date(part.split(':')[1]);
      } else {
        textParts.push(part);
      }
    }

    if (textParts.length > 0) {
      criteria.or = [
        { subject: textParts.join(' ') },
        { body: textParts.join(' ') },
        { from: textParts.join(' ') },
      ];
    }

    return criteria;
  }

  return query;
}

module.exports = {
  getConnection,
  closeConnection,
  listFolders,
  getFolderStatus,
  fetchEmails,
  searchEmails,
  fetchEmail,
  setFlag,
  moveEmail,
  deleteEmail,
  createFolder,
  deleteFolder,
};
