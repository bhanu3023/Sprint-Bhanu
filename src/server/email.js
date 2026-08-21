var __dirname = require("path").dirname(require.resolve("../../package.json"));
const { execSync } = require('child_process');
const { q } = require('./db');
// Install nodemailer if not present
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch(e) {
  try {
    console.log('Installing nodemailer...');
    execSync('npm install nodemailer', { cwd: __dirname, stdio: 'inherit' });
    nodemailer = require('nodemailer');
  } catch(err) { console.error('Could not install nodemailer:', err.message); }
}
// ── Email Helpers ──────────────────────────────────────────
async function getEmailSettings() {
  // DB settings take priority; fall back to .env SMTP_* variables
  const r = await q(`SELECT email_settings FROM organizations LIMIT 1`);
  const dbCfg = r.rows[0]?.email_settings;
  if (dbCfg && dbCfg.smtp_host && dbCfg.smtp_user && dbCfg.smtp_pass) return dbCfg;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
      !process.env.SMTP_USER.includes('your@')) {
    return {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: parseInt(process.env.SMTP_PORT) || 587,
      smtp_user: process.env.SMTP_USER,
      smtp_pass: process.env.SMTP_PASS,
      smtp_from: process.env.SMTP_FROM || process.env.SMTP_USER
    };
  }
  return null;
}

// Escapes a value for interpolation into an email's HTML body. Every template
// below builds HTML with template literals, so any untrusted value dropped in
// raw could close a tag or an attribute -- issue titles and comment text reach
// these bodies through createNotif, so the content is genuinely user-authored.
//
// Applies to HTML bodies ONLY, never to a subject line: a subject is plain
// text, so escaping it would show a literal "&amp;" in the user's inbox.
//
// String(v) rather than coercing null/undefined to '' on purpose -- the existing
// templates render the string "undefined" for a missing value, and this fix is
// not meant to change what renders for input that contains no metacharacters.
function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailWrapper(bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f0f4f8;padding:32px;border-radius:8px">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="color:#174F96;font-size:22px;margin:0">Neutara Technologies</h1>
      <p style="color:#64748b;margin:4px 0 0;font-size:13px">SprintBoard Enterprise</p>
    </div>
    <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e2e8f0">${bodyHtml}</div>
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px">© Neutara Technologies. This is an automated notification.</p>
  </div>`;
}

async function sendEmail(toEmail, subject, bodyHtml) {
  if (!nodemailer) return { sent: false, reason: 'nodemailer not available' };
  const cfg = await getEmailSettings();
  if (!cfg) return { sent: false, reason: 'SMTP not configured' };
  try {
    const isMicrosoft = cfg.smtp_host && (cfg.smtp_host.includes('office365') || cfg.smtp_host.includes('outlook') || cfg.smtp_host.includes('hotmail'));
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port || 587,
      secure: cfg.smtp_port == 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
      ...(isMicrosoft ? { tls: { ciphers: 'SSLv3', rejectUnauthorized: false } } : {})
    });
    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: toEmail,
      subject,
      html: emailWrapper(bodyHtml)
    });
    console.log(`[email] Sent "${subject}" → ${toEmail}`);
    return { sent: true };
  } catch(e) {
    console.error('[email] Send error:', e.message);
    return { sent: false, reason: e.message };
  }
}

async function sendInviteEmail(toEmail, inviteUrl, inviterName, orgName, isResend) {
  const action = isResend ? 'renewed' : 'sent';
  const heading = isResend ? 'Your Invitation Has Been Renewed' : "You've Been Invited!";
  // `heading` is a literal above and intentionally stays unescaped.
  const safeUrl = escapeHtml(inviteUrl);
  const body = `<h2 style="color:#1e293b;margin-top:0">${heading}</h2>
    <p style="color:#475569">${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on SprintBoard.</p>
    <p style="color:#475569">Click the button below to accept your invitation and set up your account:</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${safeUrl}" style="background:#174F96;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Accept Invitation &amp; Set Password</a>
    </div>
    <p style="color:#94a3b8;font-size:12px">This invitation link expires in 7 days.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
    <p style="color:#94a3b8;font-size:11px;margin:0">Or copy: <a href="${safeUrl}" style="color:#174F96">${safeUrl}</a></p>`;
  return sendEmail(toEmail, `You've been invited to join ${orgName} on SprintBoard`, body);
}

async function sendActivationEmail(user, activated) {
  const status = activated ? 'Activated' : 'Deactivated';
  const color = activated ? '#16a34a' : '#dc2626';
  const msg = activated
    ? 'Your account has been <strong>activated</strong>. You can now sign in to SprintBoard.'
    : 'Your account has been <strong>deactivated</strong> by an administrator. Please contact your admin if you believe this is an error.';
  const body = `<h2 style="color:${color};margin-top:0">Account ${status}</h2>
    <p style="color:#475569">Hi <strong>${escapeHtml(user.name)}</strong>,</p>
    <p style="color:#475569">${msg}</p>
    ${activated ? `<div style="text-align:center;margin:24px 0"><a href="http://localhost:3000/login.html" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Sign In Now</a></div>` : ''}`;
  return sendEmail(user.email, `Your SprintBoard account has been ${status.toLowerCase()}`, body);
}

async function sendPasswordResetEmail(user) {
  const body = `<h2 style="color:#1e293b;margin-top:0">Password Reset</h2>
    <p style="color:#475569">Hi <strong>${escapeHtml(user.name)}</strong>,</p>
    <p style="color:#475569">Your SprintBoard password has been <strong>reset by an administrator</strong>.</p>
    <p style="color:#475569">Please sign in with your new password. If you did not expect this change, contact your administrator immediately.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="http://localhost:3000/login.html" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Sign In</a>
    </div>`;
  return sendEmail(user.email, 'Your SprintBoard password has been reset', body);
}

async function sendRoleChangeEmail(user, newRole) {
  const roleColors = { owner: '#7c3aed', admin: '#174F96', member: '#0891b2' };
  const color = roleColors[newRole] || '#174F96';
  const body = `<h2 style="color:#1e293b;margin-top:0">Role Updated</h2>
    <p style="color:#475569">Hi <strong>${escapeHtml(user.name)}</strong>,</p>
    <p style="color:#475569">Your role in SprintBoard has been updated to:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="background:${color};color:#fff;padding:8px 24px;border-radius:20px;font-weight:700;font-size:15px;text-transform:capitalize">${escapeHtml(newRole)}</span>
    </div>
    <p style="color:#94a3b8;font-size:12px">If you have questions about your permissions, contact your administrator.</p>`;
  return sendEmail(user.email, `Your SprintBoard role has been updated to ${newRole}`, body);
}


module.exports = { escapeHtml, sendEmail, sendInviteEmail, sendActivationEmail, sendPasswordResetEmail, sendRoleChangeEmail, getEmailSettings, emailWrapper };
