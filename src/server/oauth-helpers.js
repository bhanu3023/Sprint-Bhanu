const { https } = require('./deps');

// ── Microsoft OAuth2 config (set these env vars on the server) ────────────
const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID     || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT_ID     = process.env.MICROSOFT_TENANT_ID     || '';
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI  || 'https://sprintboard.cftools.live/api/auth/callback/microsoft';
const APP_BASE_URL     = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
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
      headers: { Authorization: `Bearer ${accessToken}` }
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}


module.exports = { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, MS_REDIRECT_URI, APP_BASE_URL, msTokenExchange, msGraphMe };
