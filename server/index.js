const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const imapService = require('./imap.service');
const smtpService = require('./smtp.service');

const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:4000'],
  credentials: true,
}));

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24h
  },
}));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (!req.session.credentials) {
    return res.status(401).json({ error: 'Non authentifie' });
  }
  next();
}

// --- Auth routes ---

app.post('/api/auth/login', async (req, res) => {
  const { email, password, imapHost, imapPort, smtpHost, smtpPort } = req.body;

  if (!email || !password || !imapHost || !smtpHost) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  const credentials = {
    email,
    password,
    imapHost,
    imapPort: imapPort || 993,
    smtpHost,
    smtpPort: smtpPort || 465,
  };

  try {
    // Test IMAP connection
    await imapService.getConnection(req.sessionID, credentials);

    // Store credentials in session
    req.session.credentials = credentials;

    res.json({
      success: true,
      user: { email },
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(401).json({ error: 'Connexion echouee: ' + err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  if (req.sessionID) {
    await imapService.closeConnection(req.sessionID);
  }
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth/status', (req, res) => {
  if (req.session.credentials) {
    res.json({
      authenticated: true,
      user: { email: req.session.credentials.email },
    });
  } else {
    res.json({ authenticated: false });
  }
});

// --- Folder routes ---

app.get('/api/folders', requireAuth, async (req, res) => {
  try {
    const folders = await imapService.listFolders(req.sessionID, req.session.credentials);
    res.json(folders);
  } catch (err) {
    console.error('List folders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/folders/:folder/status', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const status = await imapService.getFolderStatus(req.sessionID, req.session.credentials, folder);
    res.json(status);
  } catch (err) {
    console.error('Folder status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    await imapService.createFolder(req.sessionID, req.session.credentials, name);
    res.json({ success: true });
  } catch (err) {
    console.error('Create folder error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/folders/:folder', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    await imapService.deleteFolder(req.sessionID, req.session.credentials, folder);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete folder error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Email routes ---

app.get('/api/emails/:folder', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 25;
    const query = req.query.q;

    let result;
    if (query) {
      result = await imapService.searchEmails(req.sessionID, req.session.credentials, folder, query);
    } else {
      result = await imapService.fetchEmails(req.sessionID, req.session.credentials, folder, page, pageSize);
    }

    res.json(result);
  } catch (err) {
    console.error('Fetch emails error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email/:folder/:uid', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const uid = parseInt(req.params.uid);
    const email = await imapService.fetchEmail(req.sessionID, req.session.credentials, folder, uid);
    res.json(email);
  } catch (err) {
    console.error('Fetch email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/:folder/:uid/flag', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const uid = parseInt(req.params.uid);
    const { flag, value } = req.body;
    await imapService.setFlag(req.sessionID, req.session.credentials, folder, uid, flag, value);
    res.json({ success: true });
  } catch (err) {
    console.error('Set flag error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/:folder/:uid/move', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const uid = parseInt(req.params.uid);
    const { destination } = req.body;
    await imapService.moveEmail(req.sessionID, req.session.credentials, folder, uid, destination);
    res.json({ success: true });
  } catch (err) {
    console.error('Move email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/email/:folder/:uid', requireAuth, async (req, res) => {
  try {
    const folder = decodeURIComponent(req.params.folder);
    const uid = parseInt(req.params.uid);
    const trashFolder = req.query.trash || null;
    await imapService.deleteEmail(req.sessionID, req.session.credentials, folder, uid, trashFolder);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Send email route ---

app.post('/api/send', requireAuth, async (req, res) => {
  try {
    const result = await smtpService.sendEmail(req.session.credentials, req.body);
    res.json(result);
  } catch (err) {
    console.error('Send email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Start server ---

app.listen(PORT, () => {
  console.log(`MailFlow backend running on http://localhost:${PORT}`);
});
