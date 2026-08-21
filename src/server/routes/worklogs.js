const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { denyUnlessCanAct, getIssueSpaceId, getVisibleSpaceIds, isOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── Worklogs ──────────────────────────────────────────────
app.get('/api/worklogs', requireAuth, wrap(async (req, res) => {
  const { space_id, user_id, from, to } = req.query;
  if (space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'worklog.read'))) return;
  let where = [], params = [], n = 1;
  if (space_id) {
    where.push(`i.space_id=$${n++}`);
    params.push(space_id);
  } else if (!isOrgAdmin(req.user.role)) {
    const visible = await getVisibleSpaceIds(q, req.user);
    if (!visible.length) return res.json([]);
    where.push(`i.space_id = ANY($${n++})`);
    params.push(visible);
  }
  if (user_id) { where.push(`w.user_id=$${n++}`); params.push(user_id); }
  if (from) { where.push(`w.work_date>=$${n++}`); params.push(from); }
  if (to) { where.push(`w.work_date<=$${n++}`); params.push(to); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q(`SELECT w.*, u.name AS user_name, i.key AS issue_key, i.title AS issue_title, i.space_id
    FROM worklogs w JOIN users u ON u.id=w.user_id JOIN issues i ON i.id=w.issue_id${w}
    ORDER BY w.work_date DESC`, params);
  res.json(r.rows);
}));

// Anyone authenticated can log time on any issue — attributed to the logged-in user (not assignee)
app.post('/api/worklogs', requireAuth, wrap(async (req, res) => {
  const { issue_id, time_spent, work_date, description, is_billable } = req.body;
  const issueSpace = issue_id ? await getIssueSpaceId(q, issue_id) : null;
  if (!issueSpace) return res.status(400).json({ error: 'Valid issue_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, issueSpace, 'worklog.create'))) return;
  const user_id = req.user.id;
  const r = await q(`INSERT INTO worklogs(id,issue_id,user_id,time_spent,work_date,description,is_billable)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [uid(), issue_id, user_id, time_spent, work_date || new Date(), description, is_billable || false]);
  await q('UPDATE issues SET time_spent=COALESCE(time_spent,0)+$2,updated_at=NOW() WHERE id=$1', [issue_id, time_spent]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/worklogs/:id', requireAuth, wrap(async (req, res) => {
  const wl = (await q('SELECT * FROM worklogs WHERE id=$1', [req.params.id])).rows[0];
  if (!wl) return res.status(404).json({ error: 'Not found' });
  if (wl.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Cannot edit another user\'s worklog' });
  const { time_spent, description, work_date, is_billable } = req.body;
  const newTime = time_spent !== undefined ? Number(time_spent) : wl.time_spent;
  const diff = newTime - wl.time_spent;
  if (diff !== 0) {
    await q('UPDATE issues SET time_spent=GREATEST(COALESCE(time_spent,0)+$2,0),updated_at=NOW() WHERE id=$1', [wl.issue_id, diff]);
  }
  const r = await q(
    `UPDATE worklogs SET time_spent=$2,description=$3,work_date=$4,is_billable=$5 WHERE id=$1
     RETURNING *, (SELECT u.name FROM users u WHERE u.id=worklogs.user_id) AS user_name,
                  (SELECT i.key FROM issues i WHERE i.id=worklogs.issue_id) AS issue_key`,
    [req.params.id, newTime,
     description !== undefined ? description : wl.description,
     work_date   !== undefined ? work_date   : wl.work_date,
     is_billable !== undefined ? is_billable : wl.is_billable]
  );
  res.json(r.rows[0]);
}));

app.delete('/api/worklogs/:id', requireAuth, wrap(async (req, res) => {
  const wl = (await q('SELECT * FROM worklogs WHERE id=$1', [req.params.id])).rows[0];
  if (!wl) return res.status(404).json({ error: 'Not found' });
  // Only the owner or admin/owner can delete a worklog
  if (wl.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Cannot delete another user\'s worklog' });
  }
  await q('UPDATE issues SET time_spent=GREATEST(COALESCE(time_spent,0)-$2,0),updated_at=NOW() WHERE id=$1', [wl.issue_id, wl.time_spent]);
  await q('DELETE FROM worklogs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

