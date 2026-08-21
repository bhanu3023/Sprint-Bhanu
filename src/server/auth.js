const crypto = require('crypto');
const { q } = require('./db');
// ── Auth Utilities ────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return derived === hash;
  } catch { return false; }
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Auth Middleware ────────────────────────────────────────
async function resolveSessionFromToken(token) {
  const r = await q(`SELECT s.user_id, u.name, u.email, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=$1 AND s.expires_at>NOW()`, [token]);
  if (!r.rows[0] || !r.rows[0].is_active) return null;
  const user = r.rows[0];
  user.id = user.user_id;
  return user;
}

/** Bearer header or ?t= session token (for img/a tags that cannot send Authorization). */
async function requireAuthFile(req, res, next) {
  let token = null;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.query && req.query.t) token = String(req.query.t);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const user = await resolveSessionFromToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: 'Auth error' }); }
}

async function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  try {
    const user = await resolveSessionFromToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: 'Auth error' }); }
}

module.exports = { hashPassword, verifyPassword, generateToken, resolveSessionFromToken, requireAuth, requireAuthFile };
