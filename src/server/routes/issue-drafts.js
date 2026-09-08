const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { app } = require('../express-app');
// ── Issue Drafts ──────────────────────────────────────────
// Autosaved Create Issue form state, so a refresh, an accidental modal close,
// or just walking away mid-form does not lose whatever was typed. Strictly
// personal — every route below is scoped to req.user.id, with no
// space-permission check, because a draft is not yet a real issue: it never
// touches issue_history, never sends a notification, and never increments a
// space's issue_counter. Ownership is the only gate that makes sense here,
// the same reasoning worklogs.js and comments.js already use for
// author-owned rows.
app.get('/api/issue-drafts', requireAuth, wrap(async (req, res) => {
  const r = await q(
    `SELECT id, space_id, form_data, created_at, updated_at
     FROM issue_drafts WHERE user_id=$1 ORDER BY updated_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
}));

app.post('/api/issue-drafts', requireAuth, wrap(async (req, res) => {
  const id = uid();
  const spaceId = req.body.space_id || null;
  const formData = req.body.form_data && typeof req.body.form_data === 'object' ? req.body.form_data : {};
  const r = await q(
    `INSERT INTO issue_drafts(id, user_id, space_id, form_data) VALUES($1,$2,$3,$4) RETURNING id, space_id, form_data, created_at, updated_at`,
    [id, req.user.id, spaceId, JSON.stringify(formData)]
  );
  res.status(201).json(r.rows[0]);
}));

app.put('/api/issue-drafts/:id', requireAuth, wrap(async (req, res) => {
  const existing = (await q('SELECT id FROM issue_drafts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Draft not found' });
  const spaceId = req.body.space_id || null;
  const formData = req.body.form_data && typeof req.body.form_data === 'object' ? req.body.form_data : {};
  const r = await q(
    `UPDATE issue_drafts SET space_id=$1, form_data=$2, updated_at=NOW() WHERE id=$3 RETURNING id, space_id, form_data, created_at, updated_at`,
    [spaceId, JSON.stringify(formData), req.params.id]
  );
  res.json(r.rows[0]);
}));

app.delete('/api/issue-drafts/:id', requireAuth, wrap(async (req, res) => {
  // Deleting someone else's draft (or one that never existed) is a silent
  // no-op, not a 404 -- this route is called on every successful ticket
  // creation and on discarding a draft from Cancel, and neither caller has
  // any use for "it was already gone."
  await q('DELETE FROM issue_drafts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));
