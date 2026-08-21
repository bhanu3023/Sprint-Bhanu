const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { denyUnlessCanAct, isOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── Product Roadmap ───────────────────────────────────────
app.get('/api/roadmap', requireAuth, wrap(async (req, res) => {
  const { space_id, status } = req.query;
  let sql = `SELECT r.*, u.name AS assigned_name, i.key AS issue_key, i.title AS issue_title,
               s.name AS space_name, cb.name AS created_by_name
             FROM roadmap_items r
             LEFT JOIN users u  ON u.id  = r.assigned_to
             LEFT JOIN issues i ON i.id  = r.issue_id
             LEFT JOIN spaces s ON s.id  = r.space_id
             LEFT JOIN users cb ON cb.id = r.created_by
             WHERE 1=1`;
  const params = [];
  if (space_id) {
    if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;
    params.push(space_id); sql += ` AND r.space_id=$${params.length}`;
  } else if (!isOrgAdmin(req.user.role)) {
    params.push(req.user.user_id || req.user.id);
    sql += ` AND r.space_id IN (SELECT space_id FROM space_members WHERE user_id=$${params.length})`;
  }
  if (status)   { params.push(status);   sql += ` AND r.status=$${params.length}`; }
  sql += ' ORDER BY r.start_date ASC NULLS LAST, r.created_at ASC';
  res.json((await q(sql, params)).rows);
}));

app.post('/api/roadmap', requireAuth, wrap(async (req, res) => {
  const { title, description, status, start_date, end_date, space_id, issue_id, color, priority, assigned_to, group_name, category, milestone } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;

  // Auto-create a backlog issue in the linked space (sprint_id=null = backlog)
  let linkedIssueId = issue_id || null;
  if (space_id && !linkedIssueId) {
    try {
      const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [space_id])).rows[0];
      if (spaceRow) {
        const cnt = (await q('SELECT COUNT(*)::int AS c FROM issues WHERE space_id=$1', [space_id])).rows[0].c;
        const issueKey = `${spaceRow.key}-${cnt + 1}`;
        const issueId = uid();
        await q(
          `INSERT INTO issues(id,key,space_id,title,description,type,priority,assignee_id,reporter_id,start_date,due_date)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [issueId, issueKey, space_id, title, description||null,
           'task', priority||'medium', assigned_to||null, req.user.user_id,
           start_date||null, end_date||null]
        );
        linkedIssueId = issueId;
      }
    } catch(e) { console.error('Auto-create backlog issue failed:', e.message); }
  }

  const id = 'rm_' + Date.now() + Math.random().toString(36).slice(2, 7);
  const row = (await q(
    `INSERT INTO roadmap_items (id,title,description,status,start_date,end_date,space_id,issue_id,color,priority,assigned_to,created_by,group_name,category,milestone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [id, title, description||null, status||'planned', start_date||null, end_date||null,
     space_id||null, linkedIssueId, color||'#4d90e0', priority||'medium', assigned_to||null,
     req.user.user_id, group_name||'General', category||'Items', milestone||false]
  )).rows[0];
  res.json(row);
}));

app.put('/api/roadmap/:id', requireAuth, wrap(async (req, res) => {
  const { title, description, status, start_date, end_date, space_id, issue_id, color, priority, assigned_to, group_name, category, milestone } = req.body;
  const existing = (await q('SELECT space_id FROM roadmap_items WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.space_id && !(await denyUnlessCanAct(q, req.user, res, existing.space_id, 'roadmap.manage'))) return;
  if (space_id && space_id !== existing.space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;
  const row = (await q(
    `UPDATE roadmap_items SET title=$2,description=$3,status=$4,start_date=$5,end_date=$6,
     space_id=$7,issue_id=$8,color=$9,priority=$10,assigned_to=$11,
     group_name=$12,category=$13,milestone=$14,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [req.params.id, title, description||null, status||'planned', start_date||null, end_date||null,
     space_id||null, issue_id||null, color||'#4d90e0', priority||'medium', assigned_to||null,
     group_name||'General', category||'Items', milestone||false]
  )).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

app.delete('/api/roadmap/:id', requireAuth, wrap(async (req, res) => {
  const existing = (await q('SELECT space_id FROM roadmap_items WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.space_id && !(await denyUnlessCanAct(q, req.user, res, existing.space_id, 'roadmap.manage'))) return;
  await q('DELETE FROM roadmap_items WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Roadmap Colors ────────────────────────────────────────
app.get('/api/roadmap/colors', requireAuth, wrap(async (req, res) => {
  const rows = (await q('SELECT color_key, color FROM roadmap_colors WHERE created_by=$1', [req.user.user_id])).rows;
  const result = {};
  rows.forEach(function(r) { result[r.color_key] = r.color; });
  res.json(result);
}));

app.post('/api/roadmap/colors', requireAuth, wrap(async (req, res) => {
  const { color_key, color } = req.body;
  if (!color_key || !color) return res.status(400).json({ error: 'color_key and color required' });
  await q(
    `INSERT INTO roadmap_colors (color_key, color, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (color_key, created_by) DO UPDATE SET color=$2`,
    [color_key, color, req.user.user_id]
  );
  res.json({ ok: true });
}));

