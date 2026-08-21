const { uid } = require('./core');
const { q } = require('./db');
const { sendEmail } = require('./email');
// createNotif is a hoisted function declaration further down, so this object can
// be built here and still hold a live reference by the time anything calls it.
const sprintDeps = { q, uid, createNotif: (n) => createNotif(n) };
// ── Notifications ─────────────────────────────────────────

// Helper: create a notification (fire-and-forget, never throws)
async function createNotif({ user_id, space_id, type, title, body, link }) {
  if (!user_id) return;
  try {
    await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  } catch(e) { /* non-fatal */ }
  // Send email for issue-related notifications
  const emailTypes = ['issue_assigned', 'status_changed', 'comment_added', 'mention', 'priority_changed'];
  if (emailTypes.includes(type)) {
    try {
      const userRow = await q('SELECT email FROM users WHERE id=$1', [user_id]);
      const toEmail = userRow.rows[0]?.email;
      if (toEmail) {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const issueLink = link ? appUrl + link : appUrl;
        const emailBody = `
          <h2 style="color:#1e293b;margin-top:0">${title}</h2>
          ${body ? `<p style="color:#475569">${body}</p>` : ''}
          <div style="text-align:center;margin:24px 0">
            <a href="${issueLink}" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">View Issue</a>
          </div>`;
        sendEmail(toEmail, title, emailBody).catch(() => {});
      }
    } catch(e) { /* non-fatal */ }
  }
}


module.exports = { createNotif, sprintDeps };
