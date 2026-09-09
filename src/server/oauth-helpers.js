const { https } = require('./deps');

// ── Microsoft OAuth2 config (set these env vars on the server) ────────────
const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID     || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT_ID     = process.env.MICROSOFT_TENANT_ID     || '';
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI  || 'https://sprintboard.cftools.live/api/auth/callback/microsoft';
const APP_BASE_URL     = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Neither outbound call had a timeout — a hung response from Microsoft's
// endpoints hung the login callback forever. 10s is generous for a
// same-continent OAuth token/profile call and still bounds the worst case.
const MS_OAUTH_TIMEOUT_MS = 10000;

// ── Microsoft OAuth2 helpers ──────────────────────────────
function msTokenExchange(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: MS_REDIRECT_URI,
      scope: 'openid profile email User.Read'
    }).toString();
    const opts = {
      hostname: 'login.microsoftonline.com',
      path: `/${MS_TENANT_ID}/oauth2/v2.0/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: MS_OAUTH_TIMEOUT_MS
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Microsoft token exchange timed out')); });
    req.write(body);
    req.end();
  });
}

function msGraphMe(accessToken) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com',
      path: '/v1.0/me?$select=displayName,mail,userPrincipalName',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: MS_OAUTH_TIMEOUT_MS
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Microsoft Graph /me request timed out')); });
    req.end();
  });
}

// ── App-only Graph access, for sending mail without a signed-in user ──────
// client_credentials, not authorization_code -- this is the app itself
// acting as itself, not on behalf of whoever is logged into SprintBoard.
// Requires the SAME app registration used for sign-in above to also carry
// the Mail.Send Application permission with admin consent granted; nothing
// here creates or changes that -- it has to be added once, in Entra ID, by
// whoever administers the fuzebot.io tenant.
function msAppOnlyToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default'
    }).toString();
    const opts = {
      hostname: 'login.microsoftonline.com',
      path: `/${MS_TENANT_ID}/oauth2/v2.0/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: MS_OAUTH_TIMEOUT_MS
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Microsoft app-only token request timed out')); });
    req.write(body);
    req.end();
  });
}

// Sends as fromUser via Graph's /sendMail action -- this is what a mailbox's
// legacy SMTP-AUTH block (the 535 error elsewhere in this codebase) doesn't
// touch at all: it's a Graph API call carrying an app-only OAuth bearer
// token, not a username+password SMTP login, so Microsoft's basic-auth
// deprecation and Security Defaults/Conditional Access legacy-auth blocks
// are simply not in play here.
function msGraphSendMail(accessToken, fromUser, toEmail, subject, htmlBody) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: toEmail } }]
      },
      saveToSentItems: false
    });
    const opts = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/users/${encodeURIComponent(fromUser)}/sendMail`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: MS_OAUTH_TIMEOUT_MS
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        // sendMail returns 202 Accepted with an empty body on success.
        if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok: true });
        else resolve({ ok: false, status: r.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Microsoft Graph sendMail request timed out')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, MS_REDIRECT_URI, APP_BASE_URL, msTokenExchange, msGraphMe, msAppOnlyToken, msGraphSendMail };
