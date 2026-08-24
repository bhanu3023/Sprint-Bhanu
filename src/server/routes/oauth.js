const { generateToken } = require('../auth');
const { crypto, uid, wrap } = require('../core');
const { q } = require('../db');
const { oauthStates } = require('../deps');
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

