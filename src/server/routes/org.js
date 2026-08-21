const { requireAuth } = require('../auth');
const { wrap } = require('../core');
const { q } = require('../db');
const { isOrgAdmin } = require('../deps');
const { app } = require('../express-app');
const { sanitizeOrgRow } = require('../files');
// ── Organization ─────────────────────────────────────────
app.get('/api/org', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT * FROM organizations LIMIT 1');
  res.json(sanitizeOrgRow(r.rows[0] || null, isOrgAdmin(req.user.role)));
}));

app.put('/api/org', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can update organization settings' });
  const { name, slug } = req.body;
  const r = await q('UPDATE organizations SET name=COALESCE($1,name), slug=COALESCE($2,slug) WHERE id=(SELECT id FROM organizations LIMIT 1) RETURNING *',
    [name || null, slug || null]);
  res.json(r.rows[0]);
}));

