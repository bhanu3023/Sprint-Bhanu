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
  // Start date has no restriction of its own -- a sprint can legitimately be
  // planned to have started in the past -- but an end date before the start
  // date is never meaningful, so it is rejected the moment both are known,
  // not just deferred to whenever the sprint actually starts.
  if (start_date && end_date && end_date < start_date) {
    return res.status(400).json({ error: 'End Date cannot be before Start Date.' });
  }
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
  // Same end->start check as create, but a PUT can touch just one of the two
  // dates -- the field left untouched still has to come from the current
  // row, or editing only end_date could sail past a start_date it was never
  // shown alongside.
  if (upd.keys.includes('start_date') || upd.keys.includes('end_date')) {
    // to_char, not the driver's own DATE parsing: pg hands back a DATE column
    // as a JS Date object built from the session's assumptions, which is a
    // different value than the plain 'YYYY-MM-DD' the client sent for
    // whichever field ISN'T being changed this call (see lib/sprint-complete.js
    // for the same reasoning applied to the auto-completer).
    const current = (await q(
      "SELECT to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date FROM sprints WHERE id=$1",
      [req.params.id]
    )).rows[0];
    const startStr = (upd.keys.includes('start_date') ? req.body.start_date : current && current.start_date) || null;
    const endStr = (upd.keys.includes('end_date') ? req.body.end_date : current && current.end_date) || null;
    if (startStr && endStr && String(endStr).slice(0, 10) < String(startStr).slice(0, 10)) {
      return res.status(400).json({ error: 'End Date cannot be before Start Date.' });
    }
  }
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
  // A completed sprint is refused too, UNLESS it never held any issues: the
  // whole point of the block is that its issue set and frozen velocity are
  // the historical record the reports read, and a sprint that never had an
  // issue (current or spilled-through-former_sprint_id) has no such record to
  // protect. Without this carve-out, a sprint completed empty by mistake --
  // or one the 23:59 auto-completer closed before anyone put work in it --
  // was stuck forever with no path back (completion is terminal) and no way
  // to clear it, which is exactly the "roopa" / "......" case reported.
  const target = (await q('SELECT status FROM sprints WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: 'Sprint not found' });
  if (target.status === 'active') {
    return res.status(400).json({ error: 'An active sprint cannot be deleted. Complete it first.' });
  }
  if (target.status === 'completed') {
    const hasIssues = (await q(
      'SELECT 1 FROM issues WHERE sprint_id=$1 OR former_sprint_id=$1 LIMIT 1', [req.params.id]
    )).rows.length > 0;
    if (hasIssues) {
      return res.status(400).json({ error: 'A completed sprint with issues cannot be deleted; it is the historical record.' });
    }
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
  // Both dates are now required before a sprint can go active -- previously
  // start_date defaulted to NOW() when absent and end_date was never checked
  // at all, so a sprint could start (and later complete) with no planned
  // window on it whatsoever, which is what every report reads to build a
  // timeline. Every existing sprint fixture already sets both, so this is not
  // a behaviour anything relied on being optional.
  if (!sprint.start_date || !sprint.end_date) {
    return res.status(400).json({ error: 'Set a Start Date and an End Date before starting this sprint.' });
  }
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
    // start_date is no longer defaulted here -- the guard above already
    // refused to reach this point without one already set.
    const upd = await client.query(
      `UPDATE sprints SET status='active'
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

