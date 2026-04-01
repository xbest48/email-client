const nodemailer = require('nodemailer');

/**
 * Send an email via SMTP.
 */
async function sendEmail(credentials, { to, cc, bcc, subject, text, html, inReplyTo, references }) {
  const transporter = nodemailer.createTransport({
    host: credentials.smtpHost,
    port: credentials.smtpPort || 465,
    secure: credentials.smtpPort === 587 ? false : true,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: credentials.email,
    to,
    subject,
    text,
  };

  if (cc) mailOptions.cc = cc;
  if (bcc) mailOptions.bcc = bcc;
  if (html) mailOptions.html = html;
  if (inReplyTo) mailOptions.inReplyTo = inReplyTo;
  if (references) mailOptions.references = references;

  const info = await transporter.sendMail(mailOptions);
  transporter.close();

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

/**
 * Verify SMTP connection.
 */
async function verifySmtp(credentials) {
  const transporter = nodemailer.createTransport({
    host: credentials.smtpHost,
    port: credentials.smtpPort || 465,
    secure: credentials.smtpPort === 587 ? false : true,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    await transporter.verify();
    return true;
  } finally {
    transporter.close();
  }
}

module.exports = {
  sendEmail,
  verifySmtp,
};
