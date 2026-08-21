const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { buildDynamicUpdate, denyUnlessCanAct, getFilterSpaceId, getIssueSpaceId, isOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── Saved Filters ─────────────────────────────────────────
app.get('/api/filters', requireAuth, wrap(async (req, res) => {
  if (req.query.space_id && !(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'filter.read'))) return;
  let where = [], params = [], n = 1;
  if (req.query.space_id) { where.push(`space_id=$${n++}`); params.push(req.query.space_id); }
  if (req.query.user_id) {
    if (req.query.user_id !== req.user.id && !isOrgAdmin(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    where.push(`user_id=$${n++}`); params.push(req.query.user_id);
  } else if (!req.query.space_id && !isOrgAdmin(req.user.role)) {
    where.push(`space_id IN (SELECT space_id FROM space_members WHERE user_id=$${n++})`);
    params.push(req.user.user_id || req.user.id);
  }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q('SELECT * FROM saved_filters' + w + ' ORDER BY name', params);
  res.json(r.rows);
}));

app.post('/api/filters', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, b.space_id, 'filter.manage'))) return;
  const r = await q(`INSERT INTO saved_filters(id,space_id,user_id,name,conditions,is_shared)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [uid(), b.space_id, req.user.id, b.name, JSON.stringify(b.conditions || b.filter_config || {}), b.is_shared || false]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/filters/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getFilterSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Filter not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'filter.manage'))) return;
  const body = { ...req.body };
  if (body.conditions && typeof body.conditions === 'object') body.conditions = JSON.stringify(body.conditions);
  const upd = buildDynamicUpdate('saved_filters', body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE saved_filters SET ${upd.set} WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/filters/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getFilterSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Filter not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'filter.manage'))) return;
  await q('DELETE FROM saved_filters WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Move issue (drag/drop backlog ↔ sprint) ───────────────
app.put('/api/issues/:id/move', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.move'))) return;
  const { sprint_id } = req.body;
  const oldRow = (await q('SELECT sprint_id FROM issues WHERE id=$1', [req.params.id])).rows[0];
  // Clearing former_sprint_id: an explicit move is the user's decision about where
  // this ticket belongs, so restoring its old deleted sprint must not undo it.
  const r = await q('UPDATE issues SET sprint_id=$1,former_sprint_id=NULL,updated_at=NOW() WHERE id=$2 RETURNING *',
    [sprint_id || null, req.params.id]);
  if (oldRow) {
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
      [uid(), req.params.id, req.user.id, 'sprint_id',
       oldRow.sprint_id ? String(oldRow.sprint_id) : null,
       sprint_id ? String(sprint_id) : null]).catch(()=>{});
  }
  res.json(r.rows[0]);
}));

