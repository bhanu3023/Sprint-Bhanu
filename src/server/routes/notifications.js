const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { requireOrgAdmin } = require('../deps');
const { app } = require('../express-app');
app.get('/api/notifications', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY is_read ASC, created_at DESC LIMIT 100',
    [req.user.id]);
  res.json(r.rows);
}));

app.post('/api/notifications', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const { user_id, space_id, type, title, body, link } = req.body;
  if (!user_id || !type || !title) return res.status(400).json({ error: 'user_id, type, title required' });
  const r = await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/notifications/:id', requireAuth, wrap(async (req, res) => {
  await q('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.put('/api/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  const r = await q('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(r.rows[0]);
}));

app.put('/api/notifications/read-all', requireAuth, wrap(async (req, res) => {
  await q('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.user.id]);
  res.json({ ok: true });
}));

