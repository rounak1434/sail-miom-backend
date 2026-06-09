const nodemailer = require('nodemailer');

// Amazon SES SMTP transport via Nodemailer. Configured entirely from env.
// If SMTP_* are unset the app still runs — sendEmail() logs and returns, so the
// escalation email stays a fail-soft channel (same behaviour as before).
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/2587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Signature unchanged: sendEmail(to, subject, text, html). `to` may be a string
// or an array of addresses (SLA escalation passes an array of admin emails).
const sendEmail = async (to, subject, text, html) => {
  if (!transporter) {
    console.warn('Email skipped: SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS).');
    return;
  }
  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'SAIL MIOM'}" <${process.env.FROM_EMAIL}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('Email error:', error.message);
  }
};

// Last known SMTP state for health/observability. No secrets — just a status word.
let smtpStatus = transporter ? 'unknown' : 'unconfigured';

// Verify SMTP connectivity at startup. Logs a clear result and NEVER throws —
// a bad/absent SMTP config must not crash the app (email is a fail-soft channel).
const verifyEmail = async () => {
  if (!transporter) {
    console.warn('✉️  SMTP not configured — escalation email disabled (set SMTP_HOST/SMTP_USER/SMTP_PASS).');
    smtpStatus = 'unconfigured';
    return false;
  }
  try {
    await transporter.verify();
    smtpStatus = 'up';
    console.log(`✅ SMTP ready — ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'}`);
    return true;
  } catch (error) {
    smtpStatus = 'down';
    console.error(`❌ SMTP verify failed (${process.env.SMTP_HOST}): ${error.message}. Email disabled; app continues.`);
    return false;
  }
};

const getSmtpStatus = () => smtpStatus;

module.exports = { sendEmail, verifyEmail, getSmtpStatus };
