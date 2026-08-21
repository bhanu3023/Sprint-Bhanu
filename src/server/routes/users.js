const { hashPassword, requireAuth, verifyPassword } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { requireOrgAdmin } = require('../deps');
const { sendActivationEmail, sendPasswordResetEmail, sendRoleChangeEmail } = require('../email');
const { app } = require('../express-app');
// ── User Management ────────────────────────────────────────
app.get('/api/users', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,created_at,theme FROM users ORDER BY created_at');
  res.json(r.rows);
}));

app.put('/api/users/:id', requireAuth, wrap(async (req, res) => {
  const isSelf = req.user.user_id === req.params.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { name, email, role, is_active, theme, color, avatar_url } = req.body;
  const before = (await q('SELECT name,email,role,is_active,theme FROM users WHERE id=$1', [req.params.id])).rows[0];

  // Build dynamic update — self can only update name/theme/color/avatar; admins can also update role/is_active
  const setClauses = [], vals = [];
  const push = (col, val) => { setClauses.push(`${col}=$${vals.length + 1}`); vals.push(val); };

  if (name     !== undefined) push('name', name);
  if (email    !== undefined && isAdmin && !isSelf) push('email', email);
  if (theme    !== undefined) push('theme', theme);
  if (color    !== undefined) push('color', color);
  if (avatar_url !== undefined) push('avatar_url', avatar_url);
  if (isAdmin) {
    if (role     !== undefined) push('role', role);
    if (is_active !== undefined) push('is_active', is_active);
  }
  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.id);
  const r = await q(`UPDATE users SET ${setClauses.join(',')} WHERE id=$${vals.length} RETURNING id,name,email,role,is_active,color,avatar_url,theme`, vals);
  const updated = r.rows[0];
  if (updated && isAdmin && before) {
    if (role && before.role !== role) sendRoleChangeEmail(updated, role).catch(()=>{});
    if (typeof is_active === 'boolean' && before.is_active !== is_active) sendActivationEmail(updated, is_active).catch(()=>{});
  }
  res.json(updated);
}));

app.put('/api/users/:id/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  const userId = req.params.id;
  if (req.user.user_id !== userId && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Forbidden' });
  if (req.user.user_id === userId && current_password) {
    const r = await q('SELECT password_hash FROM users WHERE id=$1', [userId]);
    if (r.rows[0]?.password_hash && !verifyPassword(current_password, r.rows[0].password_hash))
      return res.status(400).json({ error: 'Current password is incorrect' });
  }
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), userId]);
  // Send password reset notification if admin reset someone else's password
  if (req.user.user_id !== userId) {
    const user = (await q('SELECT name,email FROM users WHERE id=$1', [userId])).rows[0];
    if (user) sendPasswordResetEmail(user).catch(()=>{});
  }
  res.json({ ok: true });
}));

app.post('/api/users', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can create users' });
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  const ex = await q('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  if (ex.rows.length) return res.status(409).json({ error: 'User with this email already exists' });
  const orgR = await q('SELECT id FROM organizations LIMIT 1');
  const orgId = orgR.rows[0]?.id;
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const userId = `usr-${uid()}`;
  const hash = hashPassword(password);
  const r = await q(
    `INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING id,name,email,role,is_active`,
    [userId, orgId, name, email.toLowerCase().trim(), color, role || 'member', hash]
  );
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/users/:id', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can delete users' });
  const { id } = req.params;
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  const ex = await q('SELECT id FROM users WHERE id=$1', [id]);
  if (!ex.rows.length) return res.status(404).json({ error: 'User not found' });
  // Clear all FK references before deleting user
  await q('UPDATE issues SET assignee_id=NULL WHERE assignee_id=$1', [id]).catch(()=>{});
  await q('UPDATE issues SET reporter_id=NULL WHERE reporter_id=$1', [id]).catch(()=>{});
  await q('UPDATE roadmap_items SET created_by=NULL WHERE created_by=$1', [id]).catch(()=>{});
  await q('UPDATE roadmap_items SET assigned_to=NULL WHERE assigned_to=$1', [id]).catch(()=>{});
  await q('UPDATE worklogs SET user_id=NULL WHERE user_id=$1', [id]).catch(()=>{});
  await q('UPDATE spaces SET owner_id=$1 WHERE owner_id=$2', [req.user.id, id]).catch(()=>{});
  await q('DELETE FROM saved_filters WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM space_favorites WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM space_members WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM comments WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM notifications WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM issue_field_values WHERE issue_id IN (SELECT id FROM issues WHERE assignee_id=$1 OR reporter_id=$1)', [id]).catch(()=>{});
  await q('DELETE FROM invitations WHERE invited_by=$1', [id]).catch(()=>{});
  await q('DELETE FROM sessions WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM audit_logs WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM roadmap_colors WHERE created_by=$1', [id]).catch(()=>{});
  await q('DELETE FROM users WHERE id=$1', [id]);
  res.json({ success: true });
}));

