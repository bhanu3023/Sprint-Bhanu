const { generateToken, requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { requireOrgAdmin } = require('../deps');
const { escapeHtml, sendEmail, sendInviteEmail } = require('../email');
const { app } = require('../express-app');
// ── Admin Audit Log ───────────────────────────────────────
app.get('/api/admin/audit-log', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const limit = parseInt(req.query.limit) || 100;
  const r = await q(`SELECT h.*, u.name AS user_name, u.color AS user_color,
      i.key AS issue_key, i.title AS issue_title
    FROM issue_history h
    LEFT JOIN users u ON u.id=h.user_id
    LEFT JOIN issues i ON i.id=h.issue_id
    ORDER BY h.created_at DESC
    LIMIT $1`, [limit]);
  res.json(r.rows);
}));

app.get('/api/admin/email-settings', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q(`SELECT email_settings FROM organizations WHERE id=$1`, [req.user.org_id]);
  const dbCfg = r.rows[0]?.email_settings || {};
  if (dbCfg.smtp_pass) dbCfg.smtp_pass = '••••••••';
  const envActive = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && !process.env.SMTP_USER.includes('your@'));
  res.json({ ...dbCfg, env_active: envActive, env_user: envActive ? process.env.SMTP_USER : null });
}));

app.put('/api/admin/email-settings', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body;
  let passToSave = smtp_pass;
  if (smtp_pass === '••••••••') {
    const existing = (await q(`SELECT email_settings FROM organizations WHERE id=$1`, [req.user.org_id])).rows[0]?.email_settings;
    passToSave = existing?.smtp_pass || '';
  }
  const cfg = { smtp_host, smtp_port: parseInt(smtp_port)||587, smtp_user, smtp_pass: passToSave, smtp_from };
  await q(`UPDATE organizations SET email_settings=$1 WHERE id=$2`, [JSON.stringify(cfg), req.user.org_id]);
  res.json({ ok: true });
}));

app.post('/api/admin/email-test', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const body = `<h2 style="color:#1e293b;margin-top:0">Test Email</h2>
    <p style="color:#475569">Hi <strong>${escapeHtml(req.user.name)}</strong>,</p>
    <p style="color:#475569">This is a test email from SprintBoard. Your SMTP configuration is working correctly!</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px;margin-top:16px">
      <p style="color:#16a34a;margin:0;font-weight:600">✅ Email delivery is configured and working.</p>
    </div>`;
  const result = await sendEmail(req.user.email, 'SprintBoard — Test Email', body);
  res.json(result);
}));

app.post('/api/auth/invite', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can invite users' });
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const ex = await q('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  if (ex.rows.length) return res.status(409).json({ error: 'User with this email already exists' });
  const orgR = await q('SELECT * FROM organizations WHERE id=$1', [req.user.org_id]);
  const org = orgR.rows[0];
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q(`INSERT INTO invitations(id,email,org_id,invited_by,role,token,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [`inv-${uid()}`, email.toLowerCase().trim(), org?.id, req.user.user_id, role || 'member', token, expires]);
  const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?invite=${token}`;
  const emailResult = await sendInviteEmail(email, inviteUrl, req.user.name, org?.name || 'Neutara Technologies');
  res.status(201).json({ ok: true, invite_url: inviteUrl, token, email_sent: emailResult.sent, email_reason: emailResult.reason });
}));

app.post('/api/auth/invitations/:id/resend', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const r = await q(`SELECT * FROM invitations WHERE id=$1`, [req.params.id]);
  const inv = r.rows[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  // Generate new token and reset expiry
  const newToken = generateToken();
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q(`UPDATE invitations SET token=$1, expires_at=$2, status='pending' WHERE id=$3`, [newToken, newExpiry, inv.id]);
  const orgR = await q('SELECT * FROM organizations WHERE id=$1', [inv.org_id]);
  const org = orgR.rows[0];
  const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?invite=${newToken}`;
  const emailResult = await sendInviteEmail(inv.email, inviteUrl, req.user.name, org?.name || 'Neutara Technologies');
  res.json({ ok: true, invite_url: inviteUrl, email_sent: emailResult.sent, email_reason: emailResult.reason });
}));

