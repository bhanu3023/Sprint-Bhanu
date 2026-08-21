const { requireAuth } = require('../auth');
const { wrap } = require('../core');
const { q } = require('../db');
const { getMemberSpaceIds, getVisibleSpaceIds, isOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── My Issues (fast, cross-space) ────────────────────────
app.get('/api/my-issues', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id;
  const admin = isOrgAdmin(req.user.role);
  const spaceIds = admin ? null : await getVisibleSpaceIds(q, req.user);
  if (!admin && (!spaceIds || !spaceIds.length)) {
    return res.json({ assigned: [], reported: [], recent: [] });
  }
  const scopeSql = admin ? '' : ' AND i.space_id = ANY($2)';
  const scopeParams = admin ? [userId] : [userId, spaceIds];
  const [assigned, reported, recent] = await Promise.all([
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.assignee_id = $1 AND i.deleted_at IS NULL${scopeSql}
       ORDER BY i.updated_at DESC`, scopeParams),
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.reporter_id = $1 AND i.deleted_at IS NULL${scopeSql}
       ORDER BY i.updated_at DESC`, scopeParams),
    q(`SELECT DISTINCT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       LEFT JOIN comments c ON c.issue_id = i.id AND c.user_id = $1
       WHERE i.deleted_at IS NULL
         AND (i.assignee_id = $1 OR i.reporter_id = $1 OR c.id IS NOT NULL)${scopeSql}
       ORDER BY i.updated_at DESC LIMIT 20`, scopeParams)
  ]);
  res.json({ assigned: assigned.rows, reported: reported.rows, recent: recent.rows });
}));

// Activity in spaces the current user belongs to (dashboard — last 24h, includes self)
app.get('/api/dashboard/activity', requireAuth, wrap(async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const spaceIds = await getMemberSpaceIds(q, req.user);
  if (!spaceIds.length) return res.json([]);

  const [created, history] = await Promise.all([
    q(`SELECT i.id AS issue_id, i.reporter_id AS user_id, i.created_at,
              u.name AS user_name, u.color AS user_color,
              i.key AS issue_key, i.title AS issue_title, i.space_id,
              s.key AS project_key, s.name AS space_name,
              'created' AS activity_type, NULL AS field_name, NULL AS old_value, NULL AS new_value
       FROM issues i
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = i.reporter_id
       WHERE i.deleted_at IS NULL
         AND i.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
         AND i.space_id = ANY($1)
       ORDER BY i.created_at DESC
       LIMIT $3`, [spaceIds, hours, limit]),
    q(`SELECT h.issue_id, h.user_id, h.field_name, h.old_value, h.new_value, h.created_at,
              u.name AS user_name, u.color AS user_color,
              i.key AS issue_key, i.title AS issue_title, i.space_id,
              s.key AS project_key, s.name AS space_name,
              'update' AS activity_type
       FROM issue_history h
       JOIN issues i ON i.id = h.issue_id AND i.deleted_at IS NULL
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
         AND i.space_id = ANY($1)
         AND h.field_name NOT IN ('restored', 'created')
       ORDER BY h.created_at DESC
       LIMIT $3`, [spaceIds, hours, limit])
  ]);

  const combined = created.rows.concat(history.rows)
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
    .slice(0, limit);
  res.json(combined);
}));

