export const environment = {
  production: false,
  googleClientId: 'YOUR_GOOGLE_CLIENT_ID',
  gmailApiUrl: 'https://gmail.googleapis.com/gmail/v1',
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
  ].join(' '),
};
