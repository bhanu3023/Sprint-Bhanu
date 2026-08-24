const { generateToken, hashPassword, requireAuth, verifyPassword } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { requireOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── Login throttling ──────────────────────────────────────
// In-memory fixed-window counters, deliberately not a new dependency: the
// project's invariant is no dependency changes, and this mirrors the existing
// in-process oauthStates Map + sweeper already used for CSRF state.
//
// Two independent buckets, because one alone is trivially bypassed:
//   per-IP     stops one host spraying many passwords across many accounts
//   per-email  stops a distributed attempt against one specific account
// Only FAILED attempts count, and a success clears both buckets, so ordinary
// users (including a few fat-fingered tries) are never throttled.
//
// Caveat worth stating: this is per-process. Behind multiple instances each
// gets its own counters, so the effective limit multiplies by instance count.
// That is still vastly better than unlimited, and a shared store would be the
// upgrade if this is ever run multi-instance.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP = 20;
const LOGIN_MAX_PER_EMAIL = 8;
const loginFailuresByIp = new Map();    // ip    -> { count, resetAt }
const loginFailuresByEmail = new Map(); // email -> { count, resetAt }

function loginBucket(map, key) {
  const now = Date.now();
  let b = map.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + LOGIN_WINDOW_MS }; map.set(key, b); }
  return b;
}
function loginIsBlocked(ip, email) {
  const a = loginBucket(loginFailuresByIp, ip);
  const b = loginBucket(loginFailuresByEmail, email);
  return a.count >= LOGIN_MAX_PER_IP || b.count >= LOGIN_MAX_PER_EMAIL;
}
function loginRecordFailure(ip, email) {
  loginBucket(loginFailuresByIp, ip).count++;
  loginBucket(loginFailuresByEmail, email).count++;
}
function loginClear(ip, email) {
  loginFailuresByIp.delete(ip);
  loginFailuresByEmail.delete(email);
}
// Same sweep cadence as the oauthStates cleaner, so the maps cannot grow without
// bound from one-off probes against many addresses.
setInterval(() => {
  const now = Date.now();
  for (const m of [loginFailuresByIp, loginFailuresByEmail]) {
    for (const [k, v] of m) if (v.resetAt <= now) m.delete(k);
  }
}, LOGIN_WINDOW_MS).unref();

// Public auth routes (no middleware)
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const loginIp = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const loginEmail = email.toLowerCase().trim();
  if (loginIsBlocked(loginIp, loginEmail)) {
    // Same generic wording as a bad password, so this cannot be used to probe
    // which addresses exist; the 429 only tells the caller to slow down.
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }
  const r = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  const user = r.rows[0];
  if (!user) { loginRecordFailure(loginIp, loginEmail); return res.status(401).json({ error: 'Invalid email or password' }); }
  if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated' });
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    loginRecordFailure(loginIp, loginEmail);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginClear(loginIp, loginEmail);
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)', [`ses-${uid()}`, user.id, token, expires]);
  await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
}));

app.get('/api/auth/invite/:token', wrap(async (req, res) => {
  const r = await q(`SELECT email, role, expires_at, status FROM invitations WHERE token=$1`, [req.params.token]);
  const inv = r.rows[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status !== 'pending') return res.status(410).json({ error: 'This invitation has already been used' });
  if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'This invitation has expired' });
  res.json({ email: inv.email, role: inv.role });
}));

app.get('/api/auth/invitations', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q(`SELECT id, email, role, status, expires_at, invited_by, created_at
    FROM invitations ORDER BY created_at DESC`);
  res.json(r.rows);
}));

app.delete('/api/auth/invitations/:id', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  await q(`UPDATE invitations SET status='cancelled' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/auth/accept-invite', wrap(async (req, res) => {
  const { token, name, password } = req.body;
  if (!token || !name || !password) return res.status(400).json({ error: 'Token, name and password required' });
  const r = await q(`SELECT * FROM invitations WHERE token=$1 AND status='pending' AND expires_at>NOW()`, [token]);
  const inv = r.rows[0];
  if (!inv) return res.status(400).json({ error: 'Invalid or expired invitation' });
  // accept-invite has no authenticated user yet -- the invitation's own
  // org_id (set when it was created) is the correct, and only available,
  // signal here, not a guess at "the" organization.
  const orgId = inv.org_id;
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const userId = `usr-${uid()}`;
  const hash = hashPassword(password);
  await q(`INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
    [userId, orgId, name, inv.email, color, inv.role || 'member', hash]);
  await q(`UPDATE invitations SET status='accepted' WHERE id=$1`, [inv.id]);
  const sessionToken = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)', [`ses-${uid()}`, userId, sessionToken, expires]);
  const newUser = (await q('SELECT id,name,email,role,color,is_active FROM users WHERE id=$1', [userId])).rows[0];
  res.status(201).json({ token: sessionToken, user: newUser });
}));

// Protected auth routes
app.post('/api/auth/logout', requireAuth, wrap(async (req, res) => {
  const token = req.headers['authorization'].slice(7);
  await q('DELETE FROM sessions WHERE token=$1', [token]);
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users WHERE id=$1', [req.user.user_id]);
  res.json(r.rows[0]);
}));

