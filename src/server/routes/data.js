const { requireAuth } = require('../auth');
const { wrap } = require('../core');
const { q } = require('../db');
const { retentionDays } = require('../deps');
const { app } = require('../express-app');
const { sanitizeOrgRow } = require('../files');
// ── Bulk Load ─────────────────────────────────────────────
app.get('/api/data', requireAuth, wrap(async (req, res) => {
  const sid = req.query.space_id;
  const userId = req.user.user_id;
  const userRole = req.user.role;
  const isAdmin = userRole === 'admin' || userRole === 'owner';

  // Scope in SQL, not in JS. This used to load every row of users and
  // space_members on every bulk load and then filter them down in JS, so a
  // member of one space still pulled the whole org across the wire into the
  // Node process before most of it was thrown away.
  //
  // Admin path is deliberately UNCHANGED: an org admin legitimately receives
  // every user and every membership, so there is nothing to scope and no
  // reason to risk a different row order in their response.
  //
  // Non-admin scoping reproduces exactly what the JS filter computed:
  //   spaces        = non-archived spaces this user is a member of
  //   space_members = every membership OF those spaces (not just the users own)
  //   users         = the user themselves, plus everyone who is a member of
  //                   any of those spaces
  const mySpaceIds = isAdmin ? null : (await q(
    'SELECT space_id FROM space_members WHERE user_id=$1', [userId]
  )).rows.map(function (m) { return m.space_id; });

  const [org, users, spacesR, smR, sf, issueFavs] = await Promise.all([
    q('SELECT * FROM organizations LIMIT 1'),
    isAdmin
      ? q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users')
      : q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users WHERE id = $1 OR id IN (SELECT user_id FROM space_members WHERE space_id = ANY($2::varchar[]))', [userId, mySpaceIds]),
    isAdmin
      ? q('SELECT * FROM spaces WHERE is_archived=false')
      : q('SELECT * FROM spaces WHERE is_archived=false AND id = ANY($1::varchar[])', [mySpaceIds]),
    isAdmin
      ? q('SELECT * FROM space_members')
      : q('SELECT * FROM space_members WHERE space_id = ANY($1::varchar[])', [mySpaceIds]),
    q('SELECT * FROM space_favorites'),
    q('SELECT issue_id, created_at FROM issue_favorites WHERE user_id=$1 ORDER BY created_at DESC', [userId])
  ]);

  const spaces = spacesR.rows;
  const space_members = smR.rows;
  const scopedUsers = users.rows;

  // Determine which space IDs to load issues/sprints for
  const visibleSpaceIds = spaces.map(function(s) { return s.id; });

  const sf1 = sid ? ' WHERE space_id=$1' : '';
  const p = sid ? [sid] : [];
  const queries = [
    q('SELECT * FROM sprints' + (sf1 ? sf1 + ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'), p),
    q('SELECT id,space_id,sprint_id,parent_id,key,title,type,status,priority,assignee_id,reporter_id,story_points,labels,position,start_date,due_date,original_estimate,time_spent,team,product_type,created_at,updated_at FROM issues' + (sf1 ? sf1 + ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'), p),
    q('SELECT * FROM custom_fields' + sf1, p),
    q('SELECT * FROM saved_filters' + sf1, p),
    q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]),
  ];
  // Only load issue_field_values when scoped to a space (avoids full-table scan on initial load)
  if (sid) queries.push(q('SELECT * FROM issue_field_values WHERE issue_id IN (SELECT id FROM issues WHERE space_id=$1 AND deleted_at IS NULL)', p));

  const [sprints, issues, cf, filters, notifs, ifv] = await Promise.all(queries);

  // Filter issues/sprints to only non-archived visible spaces (everyone, including admins)
  let filteredIssues = issues.rows.filter(function(i) { return visibleSpaceIds.includes(i.space_id); });
  const filteredSprints = sprints.rows.filter(function(s) { return visibleSpaceIds.includes(s.space_id); });

  // Always include the user's starred issues in the cache (even when scoped to one space)
  const favIds = issueFavs.rows.map(function (f) { return f.issue_id; });
  if (favIds.length) {
    const loadedIds = new Set(filteredIssues.map(function (i) { return i.id; }));
    const missingFavIds = favIds.filter(function (id) { return !loadedIds.has(id); });
    if (missingFavIds.length) {
      const extraIssues = await q(
        `SELECT id,space_id,sprint_id,parent_id,key,title,type,status,priority,assignee_id,reporter_id,story_points,labels,position,start_date,due_date,original_estimate,time_spent,team,product_type,created_at,updated_at
         FROM issues WHERE deleted_at IS NULL AND id = ANY($1::varchar[])`,
        [missingFavIds]
      );
      extraIssues.rows.forEach(function (i) {
        if (visibleSpaceIds.includes(i.space_id) && !loadedIds.has(i.id)) {
          filteredIssues.push(i);
          loadedIds.add(i.id);
        }
      });
    }
  }

  res.json({
    org: sanitizeOrgRow(org.rows[0] || null, isAdmin), users: scopedUsers, spaces: spaces,
    space_members: space_members, space_favorites: sf.rows,
    issue_favorites: issueFavs.rows,
    sprints: filteredSprints,
    issues: filteredIssues, worklogs: [], comments: [],
    custom_fields: cf.rows, saved_filters: filters.rows, notifications: notifs.rows,
    issue_field_values: ifv ? ifv.rows : [],
    // So delete dialogs can state the real retention window instead of hardcoding "30 days".
    bin_retention_days: retentionDays()
  });
}));

