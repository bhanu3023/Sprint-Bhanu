const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { UPDATE_WHITELIST, buildDynamicUpdate, denyUnlessCanAct, getIssueSpaceId, isBuiltinSelectValueAllowed, isOrgAdmin, pickAllowed, purgeIssueRows, requireOrgAdmin, retentionDays, upsertIssueFieldValue } = require('../deps');
const { app } = require('../express-app');
const { createNotif } = require('../notify');
// ── Issues ────────────────────────────────────────────────
app.get('/api/issues', requireAuth, wrap(async (req, res) => {
  const { space_id, sprint_id, type, status, assignee_id, priority, search } = req.query;
  if (space_id) {
    if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'issue.read'))) return;
  } else if (!isOrgAdmin(req.user.role)) {
    return res.status(400).json({ error: 'space_id is required' });
  }
  // Binned (soft-deleted) issues must never appear in a normal list. Every other
  // read path already filters this; this one did not, so deleted tickets still
  // showed up in All Work and anything else backed by GET /api/issues.
  let where = ['i.deleted_at IS NULL'], params = [], n = 1;
  const add = (col, val) => { where.push(`${col}=$${n++}`); params.push(val); };
  if (space_id) add('i.space_id', space_id);
  else if (!isOrgAdmin(req.user.role)) {
    where.push(`i.space_id IN (SELECT space_id FROM space_members WHERE user_id=$${n++})`);
    params.push(req.user.id);
  }
  if (sprint_id) {
    if (sprint_id === 'null') where.push('i.sprint_id IS NULL');
    else add('i.sprint_id', sprint_id);
  }
  if (type) add('i.type', type);
  if (status) add('i.status', status);
  if (assignee_id) add('i.assignee_id', assignee_id);
  if (priority) add('i.priority', priority);
  if (search) { where.push(`(i.title ILIKE $${n} OR i.key ILIKE $${n})`); params.push(`%${search}%`); n++; }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q(`SELECT i.*,
      a.name AS assignee_name, a.color AS assignee_color,
      rep.name AS reporter_name, rep.color AS reporter_color,
      s.key AS project_key, p.key AS parent_key, p.title AS parent_title
    FROM issues i
    LEFT JOIN users a ON a.id=i.assignee_id
    LEFT JOIN users rep ON rep.id=i.reporter_id
    LEFT JOIN spaces s ON s.id=i.space_id
    LEFT JOIN issues p ON p.id=i.parent_id${w}
    ORDER BY i.key DESC`, params);
  res.json(r.rows);
}));

// Delete bin — org admin sees every space; a space admin sees only the spaces
// they administer (read-only: restore and permanent delete below are admin-only).
// `can_restore` tells the UI whether to render the action buttons at all, so the
// client never has to re-derive the rule.
app.get('/api/issues/deleted', requireAuth, wrap(async (req, res) => {
  const orgAdmin = isOrgAdmin(req.user.role);
  let scopeIds = null;
  if (!orgAdmin) {
    const userId = req.user.id || req.user.user_id;
    const rows = (await q(
      `SELECT space_id FROM space_members WHERE user_id=$1 AND role IN ('site_admin','manager','owner','admin')`,
      [userId]
    )).rows;
    scopeIds = rows.map(function (r) { return r.space_id; });
    if (!scopeIds.length) {
      return res.status(403).json({ error: 'Only a space admin can view the deleted items bin.' });
    }
  }
  // Typed bin: tickets, sprints, and archived spaces in one list. `entity_type`
  // tells the UI which restore/purge route to call, so adding a future type only
  // means adding a branch here and in the two handlers below.
  const params = orgAdmin ? [] : [scopeIds];
  const scope = orgAdmin ? '' : ' AND i.space_id = ANY($1::varchar[])';
  // The counts drive the "here is exactly what a permanent delete destroys" list in
  // the confirm dialog. Cheap correlated subqueries — this list is capped at 500.
  const tickets = await q(`SELECT i.id, i.key AS label, i.key, i.title, i.status, i.type,
      i.space_id, i.deleted_at, i.deleted_by,
      s.name AS space_name, u.name AS deleted_by_name,
      a.name AS assignee_name,
      (SELECT COUNT(*)::int FROM comments          c  WHERE c.issue_id  = i.id) AS comment_count,
      (SELECT COUNT(*)::int FROM worklogs          w  WHERE w.issue_id  = i.id) AS worklog_count,
      (SELECT COALESCE(SUM(w.time_spent),0)::int FROM worklogs w WHERE w.issue_id = i.id) AS logged_minutes,
      (SELECT COUNT(*)::int FROM issue_attachments at WHERE at.issue_id = i.id) AS attachment_count,
      (SELECT COUNT(*)::int FROM issues            ch WHERE ch.parent_id = i.id) AS subtask_count
    FROM issues i
    LEFT JOIN spaces s ON s.id = i.space_id
    LEFT JOIN users u ON u.id = i.deleted_by
    LEFT JOIN users a ON a.id = i.assignee_id
    WHERE i.deleted_at IS NOT NULL` + scope + `
    ORDER BY i.deleted_at DESC LIMIT 500`, params);

  // restorable_issues = tickets that would come back if this sprint were restored:
  // the ones still in the backlog carrying its breadcrumb. Shown in the bin so an
  // admin knows what a restore will do before clicking it.
  const sprints = await q(`SELECT sp.id, sp.name AS label, sp.goal AS title, sp.status, sp.space_id,
      sp.deleted_at, sp.deleted_by, s.name AS space_name, u.name AS deleted_by_name,
      (SELECT COUNT(*)::int FROM issues i2
        WHERE i2.former_sprint_id = sp.id AND i2.sprint_id IS NULL AND i2.deleted_at IS NULL
      ) AS restorable_issues
    FROM sprints sp
    LEFT JOIN spaces s ON s.id = sp.space_id
    LEFT JOIN users u ON u.id = sp.deleted_by
    WHERE sp.deleted_at IS NOT NULL` + (orgAdmin ? '' : ' AND sp.space_id = ANY($1::varchar[])') + `
    ORDER BY sp.deleted_at DESC LIMIT 500`, params);

  // Spaces are archived rather than tombstoned (no deleted_at column on spaces),
  // so is_archived IS the bin state for them. updated_at is the closest thing to
  // a deletion timestamp. Org admin only — a space admin has no business seeing
  // other spaces, and cannot delete a space anyway.
  const spaces = orgAdmin
    ? await q(`SELECT sp.id, sp.key AS label, sp.name AS title, 'archived' AS status, sp.id AS space_id,
        sp.updated_at AS deleted_at, NULL AS deleted_by, sp.name AS space_name, NULL AS deleted_by_name
      FROM spaces sp WHERE sp.is_archived = true ORDER BY sp.updated_at DESC LIMIT 200`)
    : { rows: [] };

  // days_left = how long before the retention sweeper purges it for good. Archived
  // spaces are never auto-purged, so they get null and the UI shows nothing.
  const days = retentionDays();
  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null;
    const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86400000;
    return Math.max(0, Math.ceil(days - elapsed));
  };
  const tag = (rows, type) => rows.map(function (r) {
    return Object.assign({
      entity_type: type,
      days_left: type === 'space' ? null : daysLeft(r.deleted_at)
    }, r);
  });
  const items = tag(tickets.rows, 'ticket')
    .concat(tag(sprints.rows, 'sprint'))
    .concat(tag(spaces.rows, 'space'))
    .sort(function (a, b) { return new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0); });

  res.json({ can_restore: orgAdmin, retention_days: days, items: items });
}));

// Shared by both restore routes below — one cascade, two callers, same reasoning
// as purgeIssueRows in lib/retention.js. DELETE /api/issues/:id soft-deletes an
// issue AND its subtasks (parent_id=$1) together in one UPDATE, so they share the
// exact same deleted_at timestamp from that statement. Restoring only needs to
// bring back subtasks whose deleted_at matches the parent's — that is precisely
// "deleted together with this parent" and excludes a subtask that happened to
// already be in the bin from an earlier, unrelated delete of its own.
//
// The match is done with a subquery INSIDE the UPDATE rather than by fetching
// the parent's deleted_at into JS first and passing it back as a parameter.
// issues.deleted_at is `timestamp without time zone` (local server clock), but
// node-pg's default type parser hands it back as a JS Date assumed to be UTC —
// so a round-tripped value silently drifts by the server's UTC offset and never
// matches the raw column again. A subquery never leaves Postgres, so there is
// nothing to drift: both sides of the comparison are the same on-disk value.
async function restoreIssueRows(id, userId) {
  const check = (await q('SELECT key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
  if (!check) return null;
  const restored = await q(
    `UPDATE issues SET deleted_at=NULL, deleted_by=NULL, updated_at=NOW()
     WHERE id=$1
        OR (parent_id=$1 AND deleted_at = (SELECT deleted_at FROM issues WHERE id=$1))
     RETURNING id, key`,
    [id]
  );
  for (const r of restored.rows) {
    q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
       VALUES($1,$2,$3,'restored',NULL,$4)`, [uid(), r.id, userId, r.key]).catch(() => {});
  }
  return { key: check.key, restoredSubtasks: restored.rows.length - 1 };
}

app.post('/api/issues/:id/restore', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can restore deleted issues.')) return;
  // Restores in place: space_id/status were never changed by the soft delete, so
  // clearing the tombstone returns the issue to its original space and state.
  const result = await restoreIssueRows(req.params.id, req.user.id);
  if (!result) return res.status(404).json({ error: 'Deleted issue not found' });
  res.json({ ok: true, restored_subtasks: result.restoredSubtasks });
}));

// ── Generic bin restore / purge (org admin only) ─────────────
// One route per verb, typed by :type, so the UI calls the same pair for every
// kind of binned thing. The issue-specific routes above are kept for
// compatibility with anything already calling them.
app.post('/api/bin/:type/:id/restore', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can restore deleted items.')) return;
  const { type, id } = req.params;
  if (type === 'ticket') {
    const result = await restoreIssueRows(id, req.user.id);
    if (!result) return res.status(404).json({ error: 'That ticket is not in the bin.' });
    return res.json({ ok: true, label: result.key, restored_subtasks: result.restoredSubtasks });
  }
  if (type === 'sprint') {
    const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'That sprint is not in the bin.' });
    await q('UPDATE sprints SET deleted_at=NULL, deleted_by=NULL WHERE id=$1', [id]);
    // Refill it with the tickets the delete pushed to the backlog — but only the
    // ones still sitting there. `sprint_id IS NULL` is the whole safety rule: if
    // someone re-planned a ticket into another sprint meanwhile, that decision
    // wins and the restore leaves it alone.
    const refilled = await q(`UPDATE issues SET sprint_id=$1, former_sprint_id=NULL, updated_at=NOW()
      WHERE former_sprint_id=$1 AND sprint_id IS NULL
      RETURNING id, key, deleted_at`, [id]);
    const live = refilled.rows.filter(function (r) { return !r.deleted_at; });
    live.forEach(function (r) {
      q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
         VALUES($1,$2,$3,'sprint_id',NULL,$4)`, [uid(), r.id, req.user.id, String(id)]).catch(() => {});
    });
    // Anything left pointing at this sprint was moved elsewhere by hand; drop the
    // breadcrumb so a future delete/restore cycle starts clean.
    await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [id]);
    return res.json({ ok: true, label: row.name, restored_issues: live.length });
  }
  if (type === 'space') {
    const row = (await q('SELECT name FROM spaces WHERE id=$1 AND is_archived=true', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'That space is not archived.' });
    await q('UPDATE spaces SET is_archived=false, updated_at=NOW() WHERE id=$1', [id]);
    return res.json({ ok: true, label: row.name });
  }
  res.status(400).json({ error: 'Unknown item type: ' + type });
}));

// Bulk permanent delete — the UI's multi-select "Delete forever (N)" action.
// Body: { items: [{ type, id }, ...] }. Spaces are rejected up front (same reason
// as the single-item route) rather than silently skipped, so the count the admin
// confirmed is the count that actually happens.
app.post('/api/bin/purge', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete items.')) return;
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
  if (!items || !items.length) return res.status(400).json({ error: 'Nothing selected to delete.' });
  if (items.length > 500) return res.status(400).json({ error: 'Too many items in one request (max 500).' });
  if (items.some(function (it) { return it && it.type === 'space'; })) {
    return res.status(400).json({ error: 'Spaces cannot be permanently deleted. Deselect the archived space(s) and try again.' });
  }
  const bad = items.find(function (it) { return !it || !it.id || (it.type !== 'ticket' && it.type !== 'sprint'); });
  if (bad) return res.status(400).json({ error: 'Unsupported item in selection.' });

  const purged = [];
  const skipped = [];
  for (const it of items) {
    if (it.type === 'sprint') {
      const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [it.id])).rows[0];
      if (!row) { skipped.push(it.id); continue; }
      await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [it.id]);
      await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [it.id]);
      await q('DELETE FROM sprints WHERE id=$1', [it.id]);
      purged.push(row.name);
    } else {
      const row = (await q('SELECT key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [it.id])).rows[0];
      if (!row) { skipped.push(it.id); continue; }
      await purgeIssueRows(it.id);
      purged.push(row.key);
    }
  }
  res.json({ ok: true, purged: purged.length, skipped: skipped.length, labels: purged });
}));

app.delete('/api/bin/:type/:id', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete items.')) return;
  const { type, id } = req.params;
  if (type === 'ticket') {
    return purgeIssue(id, req, res);
  }
  if (type === 'sprint') {
    const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Sprint is not in the bin — delete it first.' });
    // Detach anything still pointing at it — including the former_sprint_id
    // breadcrumb, which would otherwise dangle at a sprint id that no longer exists.
    await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [id]);
    await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [id]);
    await q('DELETE FROM sprints WHERE id=$1', [id]);
    return res.json({ ok: true, label: row.name });
  }
  if (type === 'space') {
    // Deliberately not implemented: purging a space would cascade through every
    // issue, sprint, field and comment it owns. Archive is the terminal state.
    return res.status(400).json({
      error: 'Spaces cannot be permanently deleted from here. Restore it, or leave it archived.'
    });
  }
  res.status(400).json({ error: 'Unknown item type: ' + type });
}));

// Shared by DELETE /api/bin/ticket/:id and the legacy /api/issues/:id/permanent.
// Only ever purges something already in the bin, so one call can't destroy a live
// issue. Callers must have already checked org-admin.
async function purgeIssue(id, req, res) {
  const row = (await q('SELECT id, key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Issue is not in the bin — restore or delete it first.' });
  await purgeIssueRows(id);
  return res.json({ ok: true, key: row.key, label: row.key });
}

app.delete('/api/issues/:id/permanent', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete issues.')) return;
  return purgeIssue(req.params.id, req, res);
}));

app.get('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const param = req.params.id;
  const issue = (await q(`SELECT i.*,
      a.name AS assignee_name, a.color AS assignee_color,
      rep.name AS reporter_name, rep.color AS reporter_color,
      s.key AS project_key, s.name AS space_name,
      p.key AS parent_key, p.title AS parent_title, p.type AS parent_type
    FROM issues i
    LEFT JOIN users a ON a.id=i.assignee_id
    LEFT JOIN users rep ON rep.id=i.reporter_id
    LEFT JOIN spaces s ON s.id=i.space_id
    LEFT JOIN issues p ON p.id=i.parent_id
    WHERE (i.id=$1 OR UPPER(i.key)=UPPER($1)) AND i.deleted_at IS NULL`, [param])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issue.space_id, 'issue.read'))) return;
  const issueId = issue.id;
  const [worklogs, comments, links, subtasks, cfv, history, attachments] = await Promise.all([
    q(`SELECT w.*, u.name AS user_name, u.color AS user_color FROM worklogs w
      LEFT JOIN users u ON u.id=w.user_id WHERE w.issue_id=$1 ORDER BY w.created_at DESC`, [issueId]),
    q(`SELECT c.*, u.name AS user_name, u.avatar_url, u.color AS user_color
      FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.issue_id=$1 ORDER BY c.created_at`, [issueId]),
    // Inner join, not LEFT: a link whose counterpart is soft-deleted (or gone)
    // used to still render as a row that 404s when clicked, because
    // GET /api/issues/:id filters deleted_at but this query didn't. Links are
    // intentionally left in the table so restoring the issue restores them.
    q(`SELECT l.*, t.key AS target_key, t.title AS target_title, t.status AS target_status, t.type AS target_type
      FROM issue_links l
      JOIN issues t ON t.id = CASE WHEN l.source_id=$1 THEN l.target_id ELSE l.source_id END
      WHERE (l.source_id=$1 OR l.target_id=$1) AND t.deleted_at IS NULL`, [issueId]),
    q(`SELECT id, key, title, status, type, priority, assignee_id, story_points
      FROM issues WHERE parent_id=$1 ORDER BY position, created_at`, [issueId]),
    q(`SELECT v.*, f.name AS field_name, f.field_type
      FROM issue_field_values v JOIN custom_fields f ON f.id=v.field_id WHERE v.issue_id=$1`, [issueId]),
    q(`SELECT h.*, u.name AS user_name, u.color AS user_color,
              cf.name AS custom_field_name, cf.field_key AS custom_field_key
      FROM issue_history h LEFT JOIN users u ON u.id=h.user_id
      LEFT JOIN custom_fields cf ON h.field_name LIKE 'custom_field_%'
             AND cf.id = substring(h.field_name FROM 14)
      WHERE h.issue_id=$1 ORDER BY h.created_at DESC`, [issueId]),
    q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
      LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [issueId])
  ]);
  issue.worklogs = worklogs.rows;
  issue.comments = comments.rows;
  issue.links = links.rows;
  issue.subtasks = subtasks.rows;
  issue.custom_field_values = cfv.rows;
  issue.history = history.rows;
  issue.attachments = attachments.rows;
  res.json(issue);
}));

// Shared by POST /api/issues (one ticket, one HTTP call) and POST
// /api/issues/bulk-import (many, one CSV) so both go through the exact same
// validation and the exact same key-allocation retry loop -- extracted
// unchanged from what used to be the single-create route body, not
// reimplemented, so bulk import cannot silently diverge from what a person
// clicking Save one at a time gets. Throws a structured Error with a `status`
// on the caller's behalf: the single route turns that into its own
// res.status().json(), and bulk-import turns it into one row's failure entry
// without aborting the rest of the batch.
async function createIssueRow(spaceId, actorUserId, fields) {
  const b = fields;
  const spaceKeyRow = (await q('SELECT key FROM spaces WHERE id=$1', [spaceId])).rows[0];
  if (!spaceKeyRow) throw Object.assign(new Error('Invalid space_id'), { status: 400 });
  const spaceKey = spaceKeyRow.key;
  const finalType = b.type || 'task';
  const finalPriority = b.priority || 'medium';
  if (!(await isBuiltinSelectValueAllowed(spaceId, 'type', finalType))) {
    throw Object.assign(new Error('Not a configured type for this space: ' + finalType), { status: 400 });
  }
  if (!(await isBuiltinSelectValueAllowed(spaceId, 'priority', finalPriority))) {
    throw Object.assign(new Error('Not a configured priority for this space: ' + finalPriority), { status: 400 });
  }
  const id = uid();
  // -- Issue key allocation: read-then-insert, retried on conflict ------
  // The key is MAX(existing number) + 1, computed with a plain SELECT and no
  // lock, so two creates in the same space that overlap read the same MAX and
  // build the same key. issues_key_key UNIQUE means the database never actually
  // stores a duplicate -- integrity was never at risk -- but the loser INSERT
  // raised a unique violation that fell through wrap() as a bare 500
  // {"error":"Internal server error"}, with nothing retried. Measured on the
  // unfixed code: 12 concurrent creates in one space gave 5 x 201 and 7 x 500.
  //
  // Retry rather than a transaction, deliberately:
  //   - No route handler here checks out a client or runs BEGIN/COMMIT; every
  //     one uses the bare q helper. Adding transaction plumbing to exactly one
  //     handler, with its own release-on-error path, is more surface than the
  //     bug it fixes.
  //   - SELECT ... FOR UPDATE on the space row would serialize correctly, but
  //     holds a row lock across the whole create -- including both
  //     isBuiltinSelectValueAllowed round trips -- so every create in a space
  //     queues behind every other. A retry only costs anything when a
  //     collision actually happened.
  //   - issues_key_key stays the real guarantee. This loop only decides what
  //     the caller sees when it fires.
  // Only 23505 on issues_key_key is retried; any other error propagates
  // untouched. The jitter stops a burst re-colliding in lockstep. A bulk
  // import creating many rows in the same space back-to-back is exactly the
  // burst this loop exists for.
  const KEY_RETRIES = 25;
  let r = null, key = null, lastConflict = null;
  for (let attempt = 0; attempt < KEY_RETRIES; attempt++) {
    const maxRow = (await q(
      "SELECT COALESCE(MAX(CAST(SPLIT_PART(key, '-', 2) AS INTEGER)), 0) AS mx FROM issues WHERE space_id=$1 AND key ~ ($2 || '-[0-9]+$')",
      [spaceId, spaceKey]
    )).rows[0];
    key = spaceKey + '-' + (maxRow.mx + 1);
    try {
      r = await q(`INSERT INTO issues(id,key,space_id,sprint_id,parent_id,title,description,type,priority,
        assignee_id,reporter_id,story_points,labels,start_date,due_date,original_estimate,team,product_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [id, key, spaceId, b.sprint_id || null, b.parent_id || null, b.title, b.description || null,
         finalType, finalPriority, b.assignee_id || null, b.reporter_id || null,
         b.story_points || b.points || null, b.labels || null, b.start_date || null, b.due_date || null,
         b.original_estimate || null, b.team || null, b.product_type || null]);
      break;
    } catch (e) {
      if (!(e && e.code === '23505' && e.constraint === 'issues_key_key')) throw e;
      lastConflict = e;
      await new Promise(function (resolve) { setTimeout(resolve, Math.floor(Math.random() * 15)); });
    }
  }
  if (!r) {
    console.error('[issues/create] key still conflicting after ' + KEY_RETRIES + ' attempts', lastConflict && lastConflict.detail);
    throw Object.assign(new Error('Could not allocate an issue key, please retry'), { status: 503 });
  }
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'created',NULL,$4)`, [uid(), id, actorUserId, key]).catch(function () {});
  const created = r.rows[0];
  // Notify the assignee/reporter set AT CREATION time too, not just on a
  // later update -- previously issue_assigned only fired from PUT, so
  // creating a ticket with an assignee already picked notified nobody.
  // Shared by both the single-create route and bulk CSV import below, since
  // both go through this function. Skips the actor (self-assignment never
  // notifies) and skips reporter_assigned when the reporter IS the assignee
  // (they already got the assignment notice, a second "you're also the
  // reporter" ping on the same ticket at the same moment is just noise).
  const createLink = '/?issue=' + encodeURIComponent(key);
  if (created.assignee_id && created.assignee_id !== actorUserId) {
    createNotif({ user_id: created.assignee_id, space_id: spaceId, type: 'issue_assigned',
      title: 'You were assigned to ' + key, body: created.title, link: createLink });
  }
  if (created.reporter_id && created.reporter_id !== actorUserId && created.reporter_id !== created.assignee_id) {
    createNotif({ user_id: created.reporter_id, space_id: spaceId, type: 'reporter_assigned',
      title: 'You were set as reporter on ' + key, body: created.title, link: createLink });
  }
  return created;
}

app.post('/api/issues', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, b.space_id, 'issue.create'))) return;
  // createIssueRow throws a structured { status, message } rather than writing
  // the response itself, so it can be reused by bulk-import below without one
  // bad row's 400 short-circuiting the whole batch. Caught explicitly here,
  // not left to the global error handler in errors.js: that handler collapses
  // every 4xx into a generic "Invalid request" and has no 5xx case at all, so
  // letting it through would have silently swapped this route's specific,
  // actionable messages ("Not a configured type for this space: X", "Could
  // not allocate an issue key, please retry") for a useless generic one.
  try {
    const row = await createIssueRow(b.space_id, req.user.id, b);
    res.status(201).json(row);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

app.put('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.update'))) return;
  const upd = buildDynamicUpdate('issues', req.body, 2);
  if (!upd) {
    return res.json((await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0]);
  }
  const keys = upd.keys;
  const oldRow = (await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0];
  // Only a genuine change needs to satisfy the space's CURRENT list — an issue
  // resaved with a value it already had (since removed from that list) must
  // stay exactly as it was, per the "never rewrite stored values" rule.
  if (keys.includes('type') && req.body.type !== oldRow.type &&
      !(await isBuiltinSelectValueAllowed(spaceId, 'type', req.body.type))) {
    return res.status(400).json({ error: 'Not a configured type for this space: ' + req.body.type });
  }
  if (keys.includes('priority') && req.body.priority !== oldRow.priority &&
      !(await isBuiltinSelectValueAllowed(spaceId, 'priority', req.body.priority))) {
    return res.status(400).json({ error: 'Not a configured priority for this space: ' + req.body.priority });
  }
  const r = await q(`UPDATE issues SET ${upd.set},updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  const newRow = r.rows[0];
  // Same rule as PUT /:id/move — deciding this ticket's sprint by hand retires the
  // former_sprint_id breadcrumb, so restoring its old deleted sprint won't yank it back.
  if (keys.includes('sprint_id')) {
    await q('UPDATE issues SET former_sprint_id=NULL WHERE id=$1', [req.params.id]).catch(() => {});
  }
  const TRACKED = ['title','status','priority','assignee_id','reporter_id','sprint_id','labels','story_points','start_date','due_date','description','fix_description'];
  if (oldRow) {
    for (const key of keys) {
      if (!TRACKED.includes(key)) continue;
      const oldVal = oldRow[key] != null ? String(oldRow[key]) : null;
      const newVal = req.body[key] != null ? String(req.body[key]) : null;
      if (oldVal !== newVal) {
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
          [uid(), req.params.id, req.user.id, key, oldVal, newVal]).catch(()=>{});
      }
    }
    const actor = req.user.id;
    const issueKey = oldRow.key || req.params.id;
    const spaceId = oldRow.space_id;
    const link = '/?issue=' + encodeURIComponent(issueKey);
    // Notify new assignee when assignee_id changes
    if (keys.includes('assignee_id') && req.body.assignee_id && req.body.assignee_id !== oldRow.assignee_id) {
      const newAssignee = req.body.assignee_id;
      if (newAssignee !== actor) {
        createNotif({ user_id: newAssignee, space_id: spaceId, type: 'issue_assigned',
          title: 'You were assigned to ' + issueKey,
          body: oldRow.title, link });
      }
    }
    // Notify new reporter when reporter_id changes -- symmetric to the
    // assignee notification above. Skipped when the new reporter IS the
    // (possibly just-set) assignee, same dedup reason as at creation.
    if (keys.includes('reporter_id') && req.body.reporter_id && req.body.reporter_id !== oldRow.reporter_id) {
      const newReporter = req.body.reporter_id;
      if (newReporter !== actor && newReporter !== newRow.assignee_id) {
        createNotif({ user_id: newReporter, space_id: spaceId, type: 'reporter_assigned',
          title: 'You were set as reporter on ' + issueKey,
          body: oldRow.title, link });
      }
    }
    // Notify assignee AND reporter when status changes -- the reporter filed
    // this ticket and cares about it moving, not only whoever it's currently
    // assigned to. Deduplicated the same way comment_added already handles
    // "assignee and reporter are the same person" (comments.js), and the
    // actor is never notified of their own change.
    if (keys.includes('status') && req.body.status !== oldRow.status) {
      const notifyUsers = new Set([newRow.assignee_id, newRow.reporter_id].filter(Boolean));
      notifyUsers.forEach(function (uid_) {
        if (uid_ !== actor) {
          createNotif({ user_id: uid_, space_id: spaceId, type: 'status_changed',
            title: issueKey + ' status changed to ' + req.body.status,
            body: oldRow.title, link });
        }
      });
    }
    // Notify assignee AND reporter when priority changes -- same reasoning
    // and dedup as status above.
    if (keys.includes('priority') && req.body.priority !== oldRow.priority) {
      const notifyUsers = new Set([newRow.assignee_id, newRow.reporter_id].filter(Boolean));
      notifyUsers.forEach(function (uid_) {
        if (uid_ !== actor) {
          createNotif({ user_id: uid_, space_id: spaceId, type: 'priority_changed',
            title: issueKey + ' priority changed to ' + req.body.priority,
            body: oldRow.title, link });
        }
      });
    }
  }
  res.json(newRow);
}));

app.delete('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const issue = (await q('SELECT id, space_id, key FROM issues WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issue.space_id, 'issue.delete'))) return;
  const id = req.params.id;
  await q(`UPDATE issues SET deleted_at=NOW(), deleted_by=$2, updated_at=NOW()
    WHERE (id=$1 OR parent_id=$1) AND deleted_at IS NULL`, [id, req.user.id]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'deleted',NULL,$4)`,
    [uid(), id, req.user.id, issue.key]).catch(() => {});
  res.json({ ok: true });
}));

app.post('/api/issues/bulk', requireAuth, wrap(async (req, res) => {
  const { ids, updates } = req.body;
  if (!ids || !ids.length) return res.json({ ok: true, updated: 0 });
  const picked = pickAllowed(updates || {}, UPDATE_WHITELIST.issues);
  const keys = Object.keys(picked);
  if (!keys.length) return res.json({ ok: true, updated: 0 });
  const issueRows = (await q('SELECT id, space_id FROM issues WHERE id = ANY($1) AND deleted_at IS NULL', [ids])).rows;
  if (issueRows.length !== ids.length) return res.status(404).json({ error: 'Issue not found' });
  const bulkSpaceIds = Array.from(new Set(issueRows.map(function (row) { return row.space_id; })));
  for (let i = 0; i < bulkSpaceIds.length; i++) {
    if (!(await denyUnlessCanAct(q, req.user, res, bulkSpaceIds[i], 'issue.bulk'))) return;
  }
  // A bulk edit writes the same value across every matched issue regardless of
  // what it had before, so (unlike the single-issue PUT) there is no "already
  // had this value" exception here — the value must be configured in EVERY
  // affected space or the whole batch is rejected rather than partially applied.
  if (picked.type != null || picked.priority != null) {
    for (let i = 0; i < bulkSpaceIds.length; i++) {
      if (picked.type != null && !(await isBuiltinSelectValueAllowed(bulkSpaceIds[i], 'type', picked.type))) {
        return res.status(400).json({ error: 'Not a configured type for one of the selected spaces: ' + picked.type });
      }
      if (picked.priority != null && !(await isBuiltinSelectValueAllowed(bulkSpaceIds[i], 'priority', picked.priority))) {
        return res.status(400).json({ error: 'Not a configured priority for one of the selected spaces: ' + picked.priority });
      }
    }
  }
  const upd = buildDynamicUpdate('issues', picked, 2);
  const r = await q(`UPDATE issues SET ${upd.set},updated_at=NOW() WHERE id=ANY($1) RETURNING *`, [ids, ...upd.vals]);
  // A bulk sprint move is still a deliberate move — retire the breadcrumb (see PUT /api/issues/:id).
  if (keys.includes('sprint_id')) {
    await q('UPDATE issues SET former_sprint_id=NULL WHERE id=ANY($1)', [ids]).catch(() => {});
  }
  res.json({ ok: true, updated: r.rowCount, issues: r.rows });
}));

// ── Bulk import from CSV ───────────────────────────────────
// Distinct from POST /api/issues/bulk above on purpose: that one BULK-EDITS
// existing tickets. This one BULK-CREATES new ones, from rows the client has
// already parsed out of a CSV file (parsing happens client-side; this route
// only ever sees plain JSON). One space per request -- the CSV deliberately
// carries no space column at all, the space is chosen once in the UI.
//
// Gated at 'issue.bulk' (site_admin tier, org admin bypasses), the SAME
// action the bulk-edit route above already uses, not a new permission
// entry -- "admin and space admin only" for a structured N-row import is
// exactly what that action already means. This does not and cannot prevent a
// member from creating many tickets one at a time through the plain
// issue.create route above; that has always been open to any member and is
// unrelated to gating the IMPORT FEATURE itself.
//
// Every row is independently resolved and validated here, from the RAW values
// the client sent (an email string, a sprint name, a type name) -- never a
// client-resolved id. The client does the same resolution for instant
// feedback before the user ever confirms, but that is UX only; a forged or
// buggy request body gets no more trust here than the single-create route
// gives any other POST body. Rows are created ONE BY ONE, in order, each
// through the exact same createIssueRow() the single-create route uses, so
// key allocation, the type/priority check, and the issue_history 'created'
// row all behave identically to a person clicking Save by hand. One row
// failing (unresolvable assignee, invalid date, whatever) does not abort the
// rows after it -- the response reports success and failure per row so nothing
// is silently skipped or silently duplicated on a retry.
const BULK_IMPORT_MAX_ROWS = 500;

// Date.parse (and the JS Date constructor generally) does not reject an
// out-of-range calendar date -- it silently rolls it forward, so
// Date.parse('2026-02-30T00:00:00Z') "succeeds" as March 2. A round trip
// through Date.UTC and back is the only way to actually catch that: if the
// year/month/day we asked for don't match what comes back, the input
// overflowed and must be rejected, not silently corrected.
function isRealCalendarDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// Excel silently reformats a typed date into the system's regional format
// when the CSV is saved (09-12-2003, 09/12/2003, ...), so a strict
// YYYY-MM-DD-only check rejects perfectly good dates with a message that does
// not explain why. This also accepts DD-MM-YYYY / DD/MM/YYYY -- always
// day-first, never guessed by magnitude -- since that is this org's own
// convention and a magnitude-based guess (e.g. treating "12-25-2026" as
// month-first only because 25 can't be a month) would be a second implicit
// rule nobody asked for. A day-first value that is not a real calendar date
// (month or day out of range) is still rejected, not silently reinterpreted.
function bulkNormalizeDate(raw, label, rowErrors) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (iso) {
    const year = parseInt(iso[1], 10), month = parseInt(iso[2], 10), day = parseInt(iso[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || !isRealCalendarDate(year, month, day)) {
      rowErrors.push(label + ' is not a real date: "' + s + '"');
      return undefined;
    }
    return iso[1] + '-' + iso[2] + '-' + iso[3];
  }

  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10), year = parseInt(dmy[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || !isRealCalendarDate(year, month, day)) {
      rowErrors.push(label + ' is not a valid date (read as day-first, DD-MM-YYYY): "' + s + '"');
      return undefined;
    }
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  rowErrors.push(label + ' is not a valid date (expected YYYY-MM-DD or DD-MM-YYYY): "' + s + '". ' +
    'Tip: if you are editing this in Excel, format the column as Text before typing dates, ' +
    'otherwise Excel may rewrite them into your regional date format when you save.');
  return undefined;
}

app.post('/api/issues/bulk-import', requireAuth, wrap(async (req, res) => {
  const { space_id, rows } = req.body;
  if (!space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'issue.bulk'))) return;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'At least one row is required' });
  }
  if (rows.length > BULK_IMPORT_MAX_ROWS) {
    return res.status(400).json({ error: 'Too many rows in one import (max ' + BULK_IMPORT_MAX_ROWS + '); split the CSV and import in batches' });
  }
  const spaceRow = (await q('SELECT id FROM spaces WHERE id=$1 AND is_archived=false', [space_id])).rows[0];
  if (!spaceRow) return res.status(400).json({ error: 'Invalid or archived space_id' });

  // Resolved once for the whole batch, not per row: the member list, open
  // sprint list, and custom field configuration for THIS space do not change
  // mid-request.
  const members = (await q(
    `SELECT u.id, u.name, u.email FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=$1 AND u.is_active=true`,
    [space_id])).rows;
  const memberByEmail = new Map(members.map(function (m) { return [String(m.email || '').toLowerCase().trim(), m]; }));
  const sprints = (await q(
    `SELECT id, name, status FROM sprints WHERE space_id=$1 AND deleted_at IS NULL AND status != 'completed'`,
    [space_id])).rows;
  // Same split the client uses (bulk-issue.js): fields that live directly on
  // the issues table row already have their own fixed handling above/below;
  // every other field the space shows on Create -- the builtin Combination
  // field included -- is a "dynamic" field stored via issue_field_values.
  const ISSUES_ROW_FIELD_KEYS = ['title', 'type', 'priority', 'assignee', 'reporter', 'sprint', 'story_points', 'team', 'product_type', 'start_date', 'due_date', 'description'];
  const allFields = (await q('SELECT * FROM custom_fields WHERE space_id=$1', [space_id])).rows;
  const dynamicFields = allFields.filter(function (f) {
    if (f.is_builtin && ISSUES_ROW_FIELD_KEYS.indexOf(f.field_key) !== -1) return false;
    const showIn = f.show_in || [];
    return showIn.indexOf('create') !== -1;
  });
  function resolveEmail(raw, label, rowErrors) {
    if (raw == null || String(raw).trim() === '') return null;
    const email = String(raw).toLowerCase().trim();
    const m = memberByEmail.get(email);
    if (!m) { rowErrors.push(label + ' "' + raw + '" is not a member of this space'); return undefined; }
    return m.id;
  }

  function resolveSprint(raw, rowErrors) {
    if (raw == null || String(raw).trim() === '') return null;
    const name = String(raw).trim().toLowerCase();
    const matches = sprints.filter(function (sp) { return String(sp.name || '').trim().toLowerCase() === name; });
    if (!matches.length) { rowErrors.push('Sprint "' + raw + '" was not found (or is completed) in this space'); return undefined; }
    if (matches.length > 1) { rowErrors.push('Sprint "' + raw + '" matches more than one sprint in this space; rename one or leave this blank'); return undefined; }
    return matches[0].id;
  }

  function customFieldOptionList(field) {
    let raw = field.options;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = []; } }
    if (raw && raw.v === 2 && raw.groups) return Array.isArray(raw.flat) ? raw.flat : [];
    return Array.isArray(raw) ? raw.map(function (o) { return (o && typeof o === 'object') ? String(o.value != null ? o.value : o.label) : String(o); }) : [];
  }

  function isCombinationField(field) {
    return field.field_key === 'combination' || String(field.name || '').toLowerCase().trim() === 'combination';
  }

  // Independently re-validates and resolves every dynamic (non-issues-row)
  // field value the client sent, exactly mirroring the client-side checks in
  // bulk-issue.js's validateBulkRow -- never trusting that the client already
  // did this correctly. Returns { [fieldId]: valueToStore }; entries here are
  // written to issue_field_values via upsertIssueFieldValue after the ticket
  // is created.
  function resolveCustomFieldValues(rawMap, productTypeRaw, rowErrors) {
    const out = {};
    if (!rawMap || typeof rawMap !== 'object') return out;
    for (const field of dynamicFields) {
      const raw = rawMap[field.id];
      const trimmed = raw == null ? '' : String(raw).trim();
      if (!trimmed) continue;

      if (isCombinationField(field)) {
        let parsed = field.options;
        if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; } }
        const flat = customFieldOptionList(field);
        const match = flat.find(function (o) { return String(o).toLowerCase() === trimmed.toLowerCase(); });
        if (!match) { rowErrors.push('"' + field.name + '" value "' + trimmed + '" is not one of this space\'s configured combinations'); continue; }
        const ptVal = String(productTypeRaw || '').trim();
        if (parsed && parsed.groups && ptVal && Array.isArray(parsed.groups[ptVal]) && parsed.groups[ptVal].length &&
            !parsed.groups[ptVal].some(function (o) { return String(o).toLowerCase() === match.toLowerCase(); })) {
          rowErrors.push('"' + field.name + '" value "' + match + '" is not available for Product Type "' + ptVal + '"');
          continue;
        }
        out[field.id] = match;
        continue;
      }

      if (field.field_type === 'select' || field.field_type === 'multi_select') {
        const opts = customFieldOptionList(field);
        const tokens = field.field_type === 'multi_select' ? trimmed.split(';').map(function (s) { return s.trim(); }).filter(Boolean) : [trimmed];
        const resolved = [];
        const bad = [];
        tokens.forEach(function (t) {
          const m = opts.find(function (o) { return String(o).toLowerCase() === t.toLowerCase(); });
          if (m) resolved.push(m); else bad.push(t);
        });
        if (bad.length) { rowErrors.push('"' + field.name + '" value "' + bad.join('", "') + '" not configured for this field'); continue; }
        out[field.id] = resolved.join(',');
      } else if (field.field_type === 'number') {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) { rowErrors.push('"' + field.name + '" must be a number: "' + trimmed + '"'); continue; }
        out[field.id] = String(n);
      } else if (field.field_type === 'date') {
        const d = bulkNormalizeDate(trimmed, field.name, rowErrors);
        if (d) out[field.id] = d;
      } else if (field.field_type === 'checkbox') {
        const b = trimmed.toLowerCase();
        if (['true', 'yes', '1'].indexOf(b) !== -1) out[field.id] = 'true';
        else if (['false', 'no', '0'].indexOf(b) === -1) rowErrors.push('"' + field.name + '" must be true/false, yes/no, or 1/0: "' + trimmed + '"');
      } else if (field.field_type === 'user') {
        const m = memberByEmail.get(trimmed.toLowerCase());
        if (!m) { rowErrors.push('"' + field.name + '" value "' + trimmed + '" is not a member of this space (match by email)'); continue; }
        out[field.id] = m.id;
      } else {
        out[field.id] = trimmed;
      }
    }
    return out;
  }

  const created = [];
  const failed = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {};
    const rowNum = i + 1;
    const rowErrors = [];

    const title = String(raw.title || '').trim();
    if (!title) rowErrors.push('Title is required');
    if (title.length > 500) rowErrors.push('Title is too long (max 500 characters)');

    let storyPoints = null;
    if (raw.story_points != null && String(raw.story_points).trim() !== '') {
      const n = Number(raw.story_points);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        rowErrors.push('Story Points must be a whole number 0 or greater: "' + raw.story_points + '"');
      } else {
        storyPoints = n;
      }
    }

    const assigneeId = resolveEmail(raw.assignee_email, 'Assignee', rowErrors);
    // Reporter defaults to the person running the import, exactly like a
    // blank Reporter field on the normal Create Issue form defaults to
    // whoever is creating the ticket.
    const reporterRaw = raw.reporter_email != null && String(raw.reporter_email).trim() !== '';
    const reporterId = reporterRaw ? resolveEmail(raw.reporter_email, 'Reporter', rowErrors) : req.user.id;
    const sprintId = resolveSprint(raw.sprint, rowErrors);
    const startDate = bulkNormalizeDate(raw.start_date, 'Start Date', rowErrors);
    const dueDate = bulkNormalizeDate(raw.due_date, 'Due Date', rowErrors);
    if (startDate && dueDate && startDate > dueDate) {
      rowErrors.push('Due Date (' + dueDate + ') is before Start Date (' + startDate + ')');
    }
    const customFieldValues = resolveCustomFieldValues(raw.custom_field_values, raw.product_type, rowErrors);

    if (rowErrors.length) {
      failed.push({ row: rowNum, title: title || '(no title)', errors: rowErrors });
      continue;
    }

    try {
      const issueRow = await createIssueRow(space_id, req.user.id, {
        title: title,
        type: raw.type ? String(raw.type).trim().toLowerCase() : undefined,
        priority: raw.priority ? String(raw.priority).trim().toLowerCase() : undefined,
        description: raw.description ? String(raw.description) : null,
        assignee_id: assigneeId,
        reporter_id: reporterId,
        sprint_id: sprintId,
        story_points: storyPoints,
        team: raw.team ? String(raw.team).trim() : null,
        product_type: raw.product_type ? String(raw.product_type).trim() : null,
        start_date: startDate,
        due_date: dueDate
      });
      // Fire-and-forget per this codebase's own convention for post-create side
      // effects, but sequential (not Promise.all) so a single slow field write
      // never overtakes another for the same issue and there is no lock
      // contention on issue_field_values under a large batch.
      for (const fieldId of Object.keys(customFieldValues)) {
        await upsertIssueFieldValue(issueRow.id, fieldId, customFieldValues[fieldId], req.user.id).catch(() => {});
      }
      created.push({ row: rowNum, id: issueRow.id, key: issueRow.key, title: issueRow.title });
    } catch (e) {
      failed.push({ row: rowNum, title: title || '(no title)', errors: [e && e.message ? e.message : 'Could not create this ticket'] });
    }
  }

  res.json({ ok: true, total: rows.length, created: created, failed: failed });
}));

