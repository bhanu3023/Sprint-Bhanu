const { generateToken, requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { requireOrgAdmin } = require('../deps');
const { escapeHtml, sendEmail, sendInviteEmail } = require('../email');
const { app } = require('../express-app');
// ── Description recovery ──────────────────────────────────
// Every description edit is written to issue_history (field_name='description')
// by PUT /api/issues/:id and never deleted, so the full edit trail survives even
// when the live issues.description column has since been overwritten with
// something else (including blank). This is the read-only recovery view for
// that trail: one row per issue, in the requester's own org only, each with its
// full sequence of description changes so a wiped or wrong description can be
// traced back to its last good value and to who/when changed it.
app.get('/api/admin/description-history', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can view description history.')) return;
  const issues = (await q(
    `SELECT i.id, i.key, i.title, i.description, s.key AS space_key, s.name AS space_name
       FROM issues i
       JOIN spaces s ON s.id = i.space_id
      WHERE s.org_id = $1 AND i.deleted_at IS NULL
      ORDER BY s.key, i.key`, [req.user.org_id])).rows;
  const history = (await q(
    `SELECT h.issue_id, h.created_at, h.old_value, h.new_value, u.name AS user_name
       FROM issue_history h
       JOIN issues i ON i.id = h.issue_id
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = h.user_id
      WHERE s.org_id = $1 AND h.field_name = 'description'
      ORDER BY h.created_at ASC`, [req.user.org_id])).rows;
  const byIssue = {};
  history.forEach(function (h) {
    (byIssue[h.issue_id] = byIssue[h.issue_id] || []).push({
      created_at: h.created_at, user_name: h.user_name || 'Unknown',
      old_value: h.old_value, new_value: h.new_value
    });
  });
  res.json(issues.map(function (i) {
    return {
      id: i.id, key: i.key, title: i.title, description: i.description,
      space_key: i.space_key, space_name: i.space_name,
      history: byIssue[i.id] || []
    };
  }));
}));

// ── Admin Audit Log ───────────────────────────────────────
// FIX: was capped at 100 rows total with no date window at all, so "the last
// week" silently lost anything past the 100 most recent org-wide changes --
// and was not scoped to the requester's org (LEFT JOIN issues, no spaces join
// at all), so an admin with more than one organization in the same database
// could see every other org's history too. Both fixed together: org-scoped
// via spaces.org_id (INNER JOIN -- a history row that cannot be attributed to
// an issue/space/org is not this org's history, unlike the recovery tool
// above which also excludes soft-deleted issues on purpose; an audit log's
// job is showing what happened, including to since-deleted tickets, so
// deleted_at is deliberately NOT filtered here), and a real ?days= window
// (default 7, i.e. "the last week") instead of an arbitrary row count. ?ticket=
// filters to one issue's key. The row cap is now a safety ceiling (3000),
// not the everyday limit -- a week of one org's activity should never
// approach it.
app.get('/api/admin/audit-log', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
  const limit = Math.min(parseInt(req.query.limit) || 3000, 3000);
  const ticket = (req.query.ticket || '').trim();
  const params = [req.user.org_id, days];
  let ticketClause = '';
  if (ticket) { params.push('%' + ticket + '%'); ticketClause = `AND i.key ILIKE $${params.length}`; }
  params.push(limit);
  const r = await q(`SELECT h.*, u.name AS user_name, u.color AS user_color,
      i.key AS issue_key, i.title AS issue_title
    FROM issue_history h
    JOIN issues i ON i.id=h.issue_id
    JOIN spaces s ON s.id=i.space_id
    LEFT JOIN users u ON u.id=h.user_id
    WHERE s.org_id=$1 AND h.created_at >= NOW() - make_interval(days => $2) ${ticketClause}
    ORDER BY h.created_at DESC
    LIMIT $${params.length}`, params);
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

