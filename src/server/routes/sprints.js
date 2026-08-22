const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { pool, q } = require('../db');
const { buildDynamicUpdate, completeSprint, denyUnlessCanAct, getSprintSpaceId } = require('../deps');
const { app } = require('../express-app');
const { createNotif, sprintDeps } = require('../notify');
// ── Sprints ───────────────────────────────────────────────
app.get('/api/sprints', requireAuth, wrap(async (req, res) => {
  const spaceId = req.query.space_id;
  if (!spaceId) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.read'))) return;
  const r = await q('SELECT * FROM sprints WHERE space_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [spaceId]);
  res.json(r.rows);
}));

app.post('/api/sprints', requireAuth, wrap(async (req, res) => {
  const { space_id, name, goal, start_date, end_date, developer_ids, qa_ids, public_holidays, developer_leaves } = req.body;
  if (!space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'sprint.manage'))) return;
  const r = await q('INSERT INTO sprints(id,space_id,name,goal,start_date,end_date,developer_ids,qa_ids,public_holidays,developer_leaves) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *',
    [uid(), space_id, name, goal, start_date || null, end_date || null, developer_ids || [], qa_ids || [], public_holidays || [], JSON.stringify(developer_leaves || {})]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/sprints/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getSprintSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.manage'))) return;
  const upd = buildDynamicUpdate('sprints', req.body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE sprints SET ${upd.set} WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/sprints/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getSprintSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.manage'))) return;
  // sprint-lifecycle.md: deleting a sprint is only allowed while it is in
  // planning. There was no status gate, so an ACTIVE sprint could be binned
  // mid-sprint and every issue in it detached to the backlog -- the same
  // data-integrity hole as the unguarded /start, reached from the other side.
  // A completed sprint is refused too: its issues and velocity are the
  // historical record the reports read.
  const target = (await q('SELECT status FROM sprints WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: 'Sprint not found' });
  if (target.status !== 'planning') {
    return res.status(400).json({ error: target.status === 'active'
      ? 'An active sprint cannot be deleted. Complete it first.'
      : 'A completed sprint cannot be deleted; it is the historical record.' });
  }
  // Soft delete so the sprint lands in Deleted Items and an org admin can restore
  // it. Its issues are still detached to the backlog (unchanged behaviour) — a
  // binned sprint must not keep tickets out of the backlog — but former_sprint_id
  // remembers where they came from so a restore can put them back.
  await q('UPDATE issues SET sprint_id=NULL, former_sprint_id=$1 WHERE sprint_id=$1', [req.params.id]);
  await q('UPDATE sprints SET deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/sprints/:id/start', requireAuth, wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'sprint.manage'))) return;
  // sprint-lifecycle.md: only ONE sprint per space may be active, and
  // `completed` is terminal. Neither was enforced -- this route ran an
  // unconditional UPDATE, so a second sprint could go active alongside the
  // first and a completed sprint could be dragged back to active, discarding
  // the meaning of its recorded velocity.
  //
  // The source-status check comes first: re-activating a completed sprint is a
  // different mistake from starting a second one, and the caller deserves to
  // know which.
  if (sprint.status !== 'planning') {
    return res.status(400).json({ error: sprint.status === 'active'
      ? 'This sprint is already active.'
      : 'A completed sprint cannot be restarted.' });
  }
  // A single UPDATE ... WHERE NOT EXISTS is NOT sufficient here, and the
  // concurrency test proves it: under READ COMMITTED two parallel starts each
  // fail to see the other's uncommitted row, both pass the check, and both go
  // active (measured: 3 of 3 succeeded). So the starts are serialised per space
  // by locking the space row inside a transaction. `q` uses the pool and would
  // release the lock at statement end, hence an explicit client.
  let r;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [sprint.space_id]);
    const active = await client.query(
      "SELECT id FROM sprints WHERE space_id=$1 AND status='active' AND deleted_at IS NULL",
      [sprint.space_id]);
    if (active.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A sprint is already active in this space.' });
    }
    // start_date is set only when absent, per the spec.
    const upd = await client.query(
      `UPDATE sprints SET status='active', start_date=COALESCE(start_date, NOW())
       WHERE id=$1 AND status='planning' AND deleted_at IS NULL RETURNING *`,
      [req.params.id]);
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This sprint is no longer in planning.' });
    }
    await client.query('COMMIT');
    r = upd;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [sprint.space_id])).rows[0];
  const sprintLink = spaceRow ? '/space/' + encodeURIComponent(spaceRow.key) + '/board' : null;
  const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
  members.rows.forEach(function(m) {
    createNotif({ user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_started',
      title: sprint.name + ' has started',
      body: 'Sprint is now active. Time to get to work!',
      link: sprintLink });
  });
  res.json(r.rows[0]);
}));

app.post('/api/sprints/:id/complete', requireAuth, wrap(async (req, res) => {
  const sid = req.params.id;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1 AND deleted_at IS NULL', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'sprint.manage'))) return;
  // Every side effect lives in lib/sprint-complete.js so this route and the
  // 23:59 auto-complete sweeper can never diverge — see the notes there.
  const completed = await completeSprint(sprintDeps, sid, req.user ? req.user.id : null);
  if (!completed) return res.status(400).json({ error: 'Sprint is not active' });
  res.json(completed);
}));

