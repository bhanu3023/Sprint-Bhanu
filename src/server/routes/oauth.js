const { generateToken, hashPassword, requireAuth, verifyPassword } = require('../auth');
const { crypto, uid, wrap } = require('../core');
const { q } = require('../db');
const { oauthStates, requireOrgAdmin } = require('../deps');
const { app } = require('../express-app');
const { APP_BASE_URL, MS_CLIENT_ID, MS_REDIRECT_URI, MS_TENANT_ID, msGraphMe, msTokenExchange } = require('../oauth-helpers');
// ── Microsoft OAuth2 routes ───────────────────────────────
app.get('/auth/microsoft', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: 'openid profile email User.Read',
    response_mode: 'query',
    state
  });
  res.redirect(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/authorize?${params}&prompt=login`);
});

app.get('/api/auth/callback/microsoft', wrap(async (req, res) => {
  const { code, state, error } = req.query;
  const loginErr = (code) => res.redirect(`${APP_BASE_URL}/login.html?error=${code}`);

  // Validate CSRF state
  if (!state || !oauthStates.has(state)) {
    return loginErr('invalid_state');
  }
  oauthStates.delete(state);

  if (error) {
    return res.redirect(`${APP_BASE_URL}/login.html?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return loginErr('no_code');
  }

  // Exchange code for access token
  const tokenData = await msTokenExchange(code);
  if (!tokenData || !tokenData.access_token) {
    console.error('[MS OAuth] Token exchange failed:', tokenData);
    return loginErr('token_exchange_failed');
  }

  // Get user profile from Microsoft Graph
  const profile = await msGraphMe(tokenData.access_token);
  if (!profile) {
    return loginErr('no_email');
  }

  const email = (profile.mail || profile.userPrincipalName || '').toLowerCase().trim();
  if (!email) {
    return loginErr('no_email');
  }

  // Look up user in database — auto-create on first Microsoft login
  let userRows = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email]);
  if (!userRows.rows.length) {
    const displayName = profile.displayName || profile.givenName || email.split('@')[0];
    const orgRow = await q('SELECT id FROM organizations LIMIT 1');
    if (!orgRow.rows.length) {
      console.error('[MS OAuth] No organization found in DB');
      return loginErr('no_org');
    }
    const orgId = orgRow.rows[0].id;
    const newUserId = `usr-${uid()}`;
    const colors = ['#0052cc','#00875a','#ff5630','#ff991f','#6554c0','#00b8d9'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await q(
      `INSERT INTO users (id, org_id, name, email, avatar_url, color, role, password_hash, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,'member',NULL,true)`,
      [newUserId, orgId, displayName, email, null, color]
    );
    console.log('[MS OAuth] Auto-created user:', email, newUserId);
    userRows = await q('SELECT * FROM users WHERE id=$1', [newUserId]);
  }
  const user = userRows.rows[0];

  if (user.is_active === false) {
    return loginErr('account_deactivated');
  }

  // Create session
  const sessionToken = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)',
    [`ses-${uid()}`, user.id, sessionToken, expires]);
  await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

  // Always redirect to APP_URL (avoids wrong port if Azure callback URI differs)
  res.redirect(`${APP_BASE_URL}/?token=${sessionToken}`);
}));

// Public auth routes (no middleware)
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const r = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated' });
  if (!user.password_hash || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
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
  const orgR = await q('SELECT id FROM organizations LIMIT 1');
  const orgId = orgR.rows[0]?.id;
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

