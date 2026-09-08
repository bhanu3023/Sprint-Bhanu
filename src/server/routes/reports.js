const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { denyUnlessCanAct, getConfiguredOptions, isOrgAdmin, requireOrgAdmin } = require('../deps');
const { app } = require('../express-app');
// ── Reports ───────────────────────────────────────────────
app.get('/api/reports/sprint/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const stats = (await q(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='Done')::int AS done,
      COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
      COALESCE(SUM(story_points) FILTER (WHERE status='Done'),0)::int AS points_completed,
      COALESCE(SUM(story_points) FILTER (WHERE status!='Done'),0)::int AS points_remaining
    FROM issues WHERE sprint_id=$1 AND deleted_at IS NULL`, [sid])).rows[0];
  res.json({ sprint, ...stats });
}));

app.get('/api/reports/velocity', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q(`SELECT id, name, velocity, start_date, end_date
    FROM sprints WHERE space_id=$1 AND status='completed' AND deleted_at IS NULL ORDER BY end_date`,
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/status', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q('SELECT status, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY status ORDER BY status',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/priority', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q('SELECT priority, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY priority ORDER BY priority',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/workload', requireAuth, wrap(async (req, res) => {
  const spaceId = req.query.space_id;
  if (!spaceId) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'report.view'))) return;
  const r = await q(`SELECT u.id, u.name, COUNT(i.id)::int AS issue_count,
      COALESCE(SUM(i.story_points),0)::int AS total_points
    FROM users u JOIN issues i ON i.assignee_id=u.id
    WHERE i.space_id=$1 GROUP BY u.id, u.name ORDER BY issue_count DESC`,
    [spaceId]);
  res.json(r.rows);
}));

app.get('/api/reports/burndown/:sprintId', requireAuth, wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [req.params.sprintId])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const issues = (await q('SELECT id, story_points AS points, status FROM issues WHERE sprint_id=$1', [sprint.id])).rows;
  const total = issues.length;
  const totalPts = issues.reduce((s, i) => s + (i.points || 0), 0);

  const hist = issues.length
    ? (await q(
        `SELECT issue_id, MIN(created_at) AS done_at FROM issue_history
         WHERE field_name='status' AND new_value='Done' AND issue_id = ANY($1)
         GROUP BY issue_id`,
        [issues.map(i => i.id)]
      )).rows
    : [];

  // Project the x-axis across the FULL sprint (start → end date), not just
  // days elapsed so far — otherwise the ideal line's slope gets divided
  // across only the elapsed days instead of the real sprint length, making
  // it plunge to zero within the first few days of a still-active sprint.
  // Days beyond "today" have no actual data yet, so remaining/remainingPts
  // stay null for them — the chart draws the actual line only up to today
  // and leaves the ideal line spanning the whole range.
  // All arithmetic here uses UTC getters/setters (not local-time
  // getDate/setHours) so the "is this day in the future" check can't drift
  // by a day relative to the toISOString() UTC date label depending on the
  // server's timezone.
  const start = new Date(sprint.start_date);
  const end = sprint.end_date ? new Date(sprint.end_date) : new Date(Math.min(new Date(sprint.end_date), Date.now()));
  const now = new Date();
  const todayDateMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const series = [];
  for (
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    d <= end;
    d = new Date(d.getTime() + 86400000)
  ) {
    const dayDateMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayEndMs = dayDateMs + 86399999; // 23:59:59.999 that day, for done_at comparisons below
    // Compare calendar dates, not "day-end timestamp vs right now" — today's
    // 23:59:59 hasn't happened yet either, so that comparison would wrongly
    // mark today itself as a future day with no data.
    const isFuture = dayDateMs > todayDateMs;
    let remaining = null, remainingPts = null;
    if (!isFuture) {
      const doneRows = hist.filter(h => new Date(h.done_at).getTime() <= dayEndMs);
      const doneCnt = doneRows.length;
      const donePts = doneRows.reduce((s, h) => {
        const iss = issues.find(i => i.id === h.issue_id);
        return s + (iss ? (iss.points || 0) : 0);
      }, 0);
      remaining = total - doneCnt;
      remainingPts = totalPts - donePts;
    }
    series.push({ date: d.toISOString().slice(0,10), remaining, remainingPts, future: isFuture });
  }
  res.json({ sprint, total, totalPts, series });
}));

app.get('/api/reports/cycle-time', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  // Try issue_history first (accurate)
  let rows = (await q(
    `SELECT i.id, i.key, i.title, i.created_at,
            MIN(h.created_at) AS done_at,
            ROUND(EXTRACT(EPOCH FROM (MIN(h.created_at) - i.created_at))/86400, 1)::float AS cycle_days
     FROM issues i
     JOIN issue_history h ON h.issue_id=i.id AND h.field_name='status' AND h.new_value='Done'
     WHERE i.space_id=$1
     GROUP BY i.id, i.key, i.title, i.created_at
     ORDER BY done_at DESC LIMIT 50`,
    [req.query.space_id]
  )).rows;

  // Fallback: use updated_at as proxy for done_at when no history exists
  if (!rows.length) {
    rows = (await q(
      `SELECT id, key, title, created_at,
              updated_at AS done_at,
              ROUND(EXTRACT(EPOCH FROM (updated_at - created_at))/86400, 1)::float AS cycle_days
       FROM issues WHERE space_id=$1 AND status='Done'
       ORDER BY updated_at DESC LIMIT 50`,
      [req.query.space_id]
    )).rows;
  }
  res.json(rows);
}));

// Control Chart — cycle time per completed issue IN A GIVEN SPRINT, measured
// from when it first entered "In Progress" to when it was finally marked
// "Done" (not creation-to-done, which conflates backlog wait time with
// actual work time). Includes assignee and story points so the chart can
// break cycle time down by who worked the ticket.
app.get('/api/reports/control-chart/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const rows = (await q(`
    SELECT i.id, i.key, i.title, i.story_points, i.assignee_id,
      u.name AS assignee_name, u.color AS assignee_color, u.avatar_url AS assignee_avatar,
      sub.started_at, sub.done_at,
      ROUND(EXTRACT(EPOCH FROM (sub.done_at - sub.started_at))/86400, 1)::float AS cycle_days
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    JOIN LATERAL (
      SELECT
        (SELECT MIN(created_at) FROM issue_history
         WHERE issue_id = i.id AND field_name='status' AND new_value='In Progress') AS started_at,
        (SELECT MAX(created_at) FROM issue_history
         WHERE issue_id = i.id AND field_name='status' AND new_value='Done') AS done_at
    ) sub ON true
    WHERE i.sprint_id = $1 AND i.status = 'Done' AND i.deleted_at IS NULL
      AND sub.started_at IS NOT NULL AND sub.done_at IS NOT NULL AND sub.done_at > sub.started_at
    ORDER BY sub.done_at DESC
  `, [sid])).rows;

  const items = rows.map(r => ({
    id: r.id, key: r.key, title: r.title, story_points: r.story_points,
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name, color: r.assignee_color, avatar_url: r.assignee_avatar } : null,
    started_at: r.started_at, done_at: r.done_at, cycle_days: r.cycle_days
  }));
  res.json({ sprint, items });
}));

// Sprint-specific team workload
app.get('/api/reports/team-workload/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const devIds = sprint.developer_ids || [];
  const qaIds = sprint.qa_ids || [];
  const teamIds = Array.from(new Set([...devIds, ...qaIds]));

  const rows = (await q(`
    WITH assignee_stats AS (
      SELECT i.assignee_id AS id,
        COUNT(i.id)::int AS assigned,
        COUNT(i.id) FILTER (WHERE i.status='Done')::int AS completed,
        COUNT(i.id) FILTER (WHERE i.status!='Done')::int AS remaining,
        COALESCE(SUM(i.story_points),0)::int AS assigned_sp,
        COALESCE(SUM(i.story_points) FILTER (WHERE i.status='Done'),0)::int AS completed_sp
      FROM issues i
      WHERE i.sprint_id=$1 AND i.deleted_at IS NULL AND i.assignee_id IS NOT NULL
      GROUP BY i.assignee_id
    ),
    all_ids AS (
      SELECT unnest($2::text[]) AS id
      UNION
      SELECT id FROM assignee_stats
    )
    SELECT u.id, u.name, u.color, u.avatar_url,
      COALESCE(s.assigned,0)::int AS assigned,
      COALESCE(s.completed,0)::int AS completed,
      COALESCE(s.remaining,0)::int AS remaining,
      COALESCE(s.assigned_sp,0)::int AS assigned_sp,
      COALESCE(s.completed_sp,0)::int AS completed_sp
    FROM all_ids a
    JOIN users u ON u.id = a.id
    LEFT JOIN assignee_stats s ON s.id = a.id
    ORDER BY assigned_sp DESC, u.name ASC
  `, [sid, teamIds])).rows;

  const devSet = new Set(devIds);
  const qaSet = new Set(qaIds);
  const leaves = sprint.developer_leaves || {};
  const decorated = rows.map(r => ({
    ...r,
    role: devSet.has(r.id) && qaSet.has(r.id) ? 'Dev + QA' : devSet.has(r.id) ? 'Developer' : qaSet.has(r.id) ? 'QA' : 'Other',
    leave_days: leaves[r.id] || 0
  }));

  res.json({ sprint, rows: decorated });
}));

// Scope change for a sprint (committed vs added/removed after start)
app.get('/api/reports/scope-change/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const current = (await q(
    'SELECT id, key, title, status, type, priority, assignee_id, story_points FROM issues WHERE sprint_id=$1 AND deleted_at IS NULL', [sid]
  )).rows;
  const addedRows = sprint.start_date ? (await q(
    `SELECT DISTINCT issue_id FROM issue_history
     WHERE field_name='sprint_id' AND new_value=$1 AND created_at > $2`,
    [sid, sprint.start_date]
  )).rows : [];
  const addedIds = new Set(addedRows.map(r => r.issue_id));
  const committed = current.filter(i => !addedIds.has(i.id));
  const added = current.filter(i => addedIds.has(i.id));
  const removed = sprint.start_date ? (await q(
    `SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.type, i.priority, i.assignee_id, i.story_points
     FROM issue_history ih
     JOIN issues i ON i.id=ih.issue_id
     WHERE ih.field_name='sprint_id' AND ih.old_value=$1 AND ih.created_at > $2
       AND (i.sprint_id IS NULL OR i.sprint_id != $1) AND i.deleted_at IS NULL
     ORDER BY i.id, ih.created_at DESC`,
    [sid, sprint.start_date]
  )).rows : [];
  res.json({ sprint, committed, added, removed });
}));

// Bug summary for a sprint
app.get('/api/reports/bugs/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT space_id FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  // "Critical" = this space's most-severe configured priority (list order is
  // severity order, migration 016) — not the literal string 'highest', which
  // an admin may have renamed or reordered.
  const priorityOpts = await getConfiguredOptions(q, sprint.space_id, 'priority');
  const criticalPriority = priorityOpts[0] || 'highest';
  const r = (await q(`
    SELECT
      COUNT(*) FILTER (WHERE status!='Done')::int AS open_bugs,
      COUNT(*) FILTER (WHERE status='Done')::int AS closed_bugs,
      COUNT(*)::int AS total_bugs,
      COUNT(*) FILTER (WHERE priority=$2)::int AS critical_bugs
    FROM issues WHERE sprint_id=$1 AND type='bug' AND deleted_at IS NULL
  `, [sid, criticalPriority])).rows[0];
  res.json(r);
}));

// Spillover report — issues that were in a sprint but not completed
// Issues an org admin has removed from this sprint's spillover record. Kept in
// audit_logs rather than issue_history: the history row is deleted (it is what the
// report reads), and this is the permanent trail of who corrected the record.
// Both query paths below must honour it, otherwise removing the last spillover row
// flips the report to its legacy fallback and the removed issues reappear.
async function spilloverExcludedIds(sprintId) {
  const rows = (await q(
    `SELECT entity_id FROM audit_logs
      WHERE action='spillover.remove' AND entity_type='issue' AND details->>'sprint_id' = $1`,
    [sprintId]
  )).rows;
  return rows.map(function (r) { return r.entity_id; });
}

app.get('/api/reports/spillover/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const excluded = await spilloverExcludedIds(sid);

  let spillover = [];
  if (sprint.status === 'completed') {
    // Approach 1: issues explicitly recorded in history as spilled out by
    // Complete Sprint (field_name='spillover', distinct from the generic
    // 'sprint_id' entries that PUT /api/issues/:id writes for manual moves
    // to backlog — this keeps genuine end-of-sprint spillover from being
    // confused with tickets a user dragged to backlog mid-sprint).
    // This works for sprints completed after the fix was deployed.
    const fromHistory = (await q(`
      SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.priority, i.type,
        i.story_points, i.assignee_id, ih.created_at AS spilled_at
      FROM issue_history ih
      JOIN issues i ON i.id = ih.issue_id
      WHERE ih.field_name = 'spillover'
        AND ih.old_value = $1
        AND (ih.new_value IS NULL OR ih.new_value = '' OR ih.new_value = 'null')
        AND i.deleted_at IS NULL
        AND NOT (i.id = ANY($2::varchar[]))
      ORDER BY i.id, ih.created_at DESC
    `, [sid, excluded])).rows;

    if (fromHistory.length > 0) {
      spillover = fromHistory;
    } else {
      // Fallback for old sprints: find backlog issues that were ever assigned to this sprint
      // (recorded as new_value=sprintId in history) and are now not Done
      spillover = (await q(`
        SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.priority, i.type,
          i.story_points, i.assignee_id, ih.created_at AS spilled_at
        FROM issue_history ih
        JOIN issues i ON i.id = ih.issue_id
        WHERE ih.field_name = 'sprint_id'
          AND ih.new_value = $1
          AND i.sprint_id IS NULL
          AND i.status != 'Done'
          AND i.deleted_at IS NULL
          AND NOT (i.id = ANY($2::varchar[]))
        ORDER BY i.id, ih.created_at DESC
      `, [sid, excluded])).rows;
    }
  } else {
    // Active/planning sprint: projected spillover = current non-done issues
    spillover = (await q(`
      SELECT i.id, i.key, i.title, i.status, i.priority, i.type,
        i.story_points, i.assignee_id, NULL AS spilled_at
      FROM issues i
      WHERE i.sprint_id = $1 AND i.status != 'Done' AND i.deleted_at IS NULL
        AND NOT (i.id = ANY($2::varchar[]))
      ORDER BY i.key
    `, [sid, excluded])).rows;
  }

  // Per-space, per-type/per-role toggles (Settings > Reports). Defaults match
  // what the report always showed before this setting existed, so adding the
  // feature doesn't change anyone's numbers until they touch a toggle.
  const spaceRow = (await q('SELECT spillover_settings FROM spaces WHERE id=$1', [sprint.space_id])).rows[0];
  const rawSettings = (spaceRow && spaceRow.spillover_settings) || {};
  const settings = Object.assign({
    show_issues_with_points: true,
    show_tasks: true,
    show_bugs: true,
    include_qa_assigned: false,
    include_unassigned: true
  }, rawSettings);
  // Carry forward a space's prior "stories with points" choice the first time
  // it's read under the new, type-agnostic key — otherwise a board that had
  // deliberately turned this off would see it silently flip back on.
  if (rawSettings.show_issues_with_points === undefined && rawSettings.show_stories_with_points !== undefined) {
    settings.show_issues_with_points = rawSettings.show_stories_with_points;
  }
  const devIds = sprint.developer_ids || [];
  const qaIds = sprint.qa_ids || [];
  const qaOnlySet = new Set(qaIds.filter(id => !devIds.includes(id)));

  // "Spilled Issues (With Points)" is type-agnostic — a pointed story, task,
  // or bug all count. It's checked first: any ticket with points shows if
  // it's on, no matter its type. Tasks/bugs without points fall to their own
  // toggle. The QA/unassigned toggles only ADD tickets nothing else covers
  // (e.g. an unpointed story, or an epic/subtask) — they never take away a
  // ticket already included above.
  const beforeFilter = spillover.length;
  spillover = spillover.filter(i => {
    const hasPts = Number(i.story_points) > 0;
    if (hasPts && settings.show_issues_with_points) return true;
    let typeIncluded;
    if (i.type === 'task') typeIncluded = settings.show_tasks;
    else if (i.type === 'bug') typeIncluded = settings.show_bugs;
    else typeIncluded = false; // unpointed stories, epics/subtasks have no dedicated toggle
    if (typeIncluded) return true;
    if (!i.assignee_id) return !!settings.include_unassigned;
    if (qaOnlySet.has(i.assignee_id)) return !!settings.include_qa_assigned;
    return false;
  });
  const hiddenByFilterCount = beforeFilter - spillover.length;

  const assigneeIds = [...new Set(spillover.map(i => i.assignee_id).filter(Boolean))];
  let userMap = {};
  if (assigneeIds.length) {
    const users = (await q('SELECT id, name, color FROM users WHERE id = ANY($1)', [assigneeIds])).rows;
    users.forEach(u => { userMap[u.id] = u; });
  }

  const totalPts = spillover.reduce((s, i) => s + (Number(i.story_points) || 0), 0);
  res.json({
    sprint,
    spillover: spillover.map(i => ({ ...i, assignee: userMap[i.assignee_id] || null })),
    count: spillover.length,
    totalPts,
    spillover_settings: settings,
    hidden_by_settings_count: hiddenByFilterCount,
    // Lets the UI show the Remove control only to those who can actually use it.
    can_edit_spillover: isOrgAdmin(req.user.role)
  });
}));

// MBR (Monthly Business Review) — trends across every sprint in a space,
// rather than the single-sprint scope every other report above uses. One
// endpoint serves both the Overview and Comparison Trends tabs so switching
// between them never needs a second round-trip.
//
// Spillover/committed-vs-completed/comparison numbers only ever cover
// COMPLETED sprints — an in-flight sprint hasn't spilled anything yet, so
// showing a "projected" figure for it next to real, closed-sprint numbers
// was misleading. The Overview trend is the one place an active sprint still
// shows up, as its live completed-so-far points, clearly distinct in color.
app.get('/api/reports/mbr/:spaceId', requireAuth, wrap(async (req, res) => {
  const spaceId = req.params.spaceId;
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'report.view'))) return;

  const sprints = (await q(`
    SELECT id, name, status, start_date, end_date, velocity, developer_ids, qa_ids, achievements
    FROM sprints
    WHERE space_id=$1 AND status IN ('completed','active') AND deleted_at IS NULL
    ORDER BY COALESCE(end_date, start_date, created_at)
  `, [spaceId])).rows;

  const allIds = sprints.map(s => s.id);
  const completedIds = sprints.filter(s => s.status === 'completed').map(s => s.id);
  const activeIds = sprints.filter(s => s.status === 'active').map(s => s.id);
  const ISSUE_COLS = 'i.id, i.key, i.title, i.status, i.priority, i.type, i.story_points, i.assignee_id, i.sprint_id';

  // Done issues across every sprint (completed sprints keep sprint_id pointing
  // at themselves for Done issues even after completion — see sprint-lifecycle
  // rules) — this is what "completed_points" drills down into everywhere.
  let doneRows = [];
  if (allIds.length) {
    doneRows = (await q(`
      SELECT ${ISSUE_COLS} FROM issues i
      WHERE i.sprint_id = ANY($1::varchar[]) AND i.status='Done' AND i.deleted_at IS NULL
    `, [allIds])).rows;
  }

  // Live full scope for any active sprint (typically 0 or 1) — its
  // "committed" figure until it closes is just everything currently in it.
  let activeAllRows = [];
  if (activeIds.length) {
    activeAllRows = (await q(`
      SELECT sprint_id, story_points FROM issues WHERE sprint_id = ANY($1::varchar[]) AND deleted_at IS NULL
    `, [activeIds])).rows;
  }
  const activeCommittedBySprintId = {};
  activeAllRows.forEach(r => {
    activeCommittedBySprintId[r.sprint_id] = (activeCommittedBySprintId[r.sprint_id] || 0) + (Number(r.story_points) || 0);
  });

  // Spillover across every completed sprint at once — same detection the
  // single-sprint Spillover report uses (issue_history field_name='spillover'),
  // batched instead of looped, honouring the same org-admin corrections.
  let spilloverRows = [];
  if (completedIds.length) {
    const excludedRows = (await q(
      `SELECT entity_id, details->>'sprint_id' AS sprint_id FROM audit_logs
       WHERE action='spillover.remove' AND entity_type='issue' AND details->>'sprint_id' = ANY($1::varchar[])`,
      [completedIds]
    )).rows;
    const excludedSet = new Set(excludedRows.map(r => r.sprint_id + '::' + r.entity_id));

    spilloverRows = (await q(`
      SELECT DISTINCT ON (i.id, ih.old_value) ih.old_value AS spilled_from_sprint_id, ${ISSUE_COLS}
      FROM issue_history ih
      JOIN issues i ON i.id = ih.issue_id
      WHERE ih.field_name = 'spillover'
        AND ih.old_value = ANY($1::varchar[])
        AND (ih.new_value IS NULL OR ih.new_value = '' OR ih.new_value = 'null')
        AND i.deleted_at IS NULL
      ORDER BY i.id, ih.old_value, ih.created_at DESC
    `, [completedIds])).rows.filter(r => !excludedSet.has(r.spilled_from_sprint_id + '::' + r.id));
  }

  // Bugs across every completed sprint (any status, not just Done/spilled) —
  // feeds the Bug Summary section: overall totals plus per-sprint,
  // per-assignee, and per-reporter breakdowns.
  let bugRows = [];
  if (completedIds.length) {
    bugRows = (await q(`
      SELECT id, key, title, status, priority, assignee_id, reporter_id, sprint_id, product_type
      FROM issues WHERE sprint_id = ANY($1::varchar[]) AND type='bug' AND deleted_at IS NULL
    `, [completedIds])).rows;
  }

  // Bugs by Combination, sprint-wise — only when this space actually has a
  // Combination field configured (same detection custom-fields.js uses:
  // field_key='combination', or a plain field literally named that for
  // spaces that predate the built-in field_key). A bug's combination value
  // lives in issue_field_values, not a column on issues itself, and a bug
  // with no value set (or the field missing entirely) is grouped under
  // "No Combination" rather than dropped, so the sprint's full bug count
  // still reconciles against the Bug Summary total above.
  const combinationField = (await q(
    `SELECT id, options FROM custom_fields WHERE space_id=$1 AND (field_key='combination' OR LOWER(name)='combination') LIMIT 1`,
    [spaceId]
  )).rows[0];
  let bugCombinationByIssueId = {};
  // Nested combo -> role -> upgrader row, since one combination can now have
  // an upgrader per role (migration 024) instead of exactly one.
  let upgraderByComboRole = {};
  // combination string -> the Product Type it's grouped under in the field's
  // own options (see combination-options.js's {v:2, groups:{productType:[...]}}
  // shape) -- a combination belongs to exactly one product type group, so this
  // is a stable per-combination fact, not something that varies per bug.
  let productTypeByCombination = {};
  let upgraderRoleRows = [];
  if (combinationField && bugRows.length) {
    const valueRows = (await q(
      `SELECT issue_id, value FROM issue_field_values WHERE field_id=$1 AND issue_id = ANY($2::varchar[])`,
      [combinationField.id, bugRows.map(r => r.id)]
    )).rows;
    valueRows.forEach(r => { bugCombinationByIssueId[r.issue_id] = r.value; });

    const upgraderRows = (await q(
      `SELECT cu.combination, cu.role, cu.user_id, u.name AS user_name, u.email AS user_email
       FROM combination_upgraders cu LEFT JOIN users u ON u.id = cu.user_id
       WHERE cu.field_id=$1`,
      [combinationField.id]
    )).rows;
    upgraderRows.forEach(r => {
      if (!upgraderByComboRole[r.combination]) upgraderByComboRole[r.combination] = {};
      upgraderByComboRole[r.combination][r.role] = r;
    });

    upgraderRoleRows = (await q(
      `SELECT name, key FROM combination_upgrader_roles WHERE field_id=$1 ORDER BY position, name`,
      [combinationField.id]
    )).rows;

    let rawOptions = combinationField.options;
    if (typeof rawOptions === 'string') { try { rawOptions = JSON.parse(rawOptions); } catch (_) { rawOptions = null; } }
    if (rawOptions && rawOptions.v === 2 && rawOptions.groups && typeof rawOptions.groups === 'object') {
      Object.keys(rawOptions.groups).forEach(pt => {
        (rawOptions.groups[pt] || []).forEach(combo => { productTypeByCombination[combo] = pt; });
      });
    }
  }
  const doneBySprintId = {};
  doneRows.forEach(r => { (doneBySprintId[r.sprint_id] = doneBySprintId[r.sprint_id] || []).push(r); });
  const spilloverBySprintId = {};
  spilloverRows.forEach(r => { (spilloverBySprintId[r.spilled_from_sprint_id] = spilloverBySprintId[r.spilled_from_sprint_id] || []).push(r); });
  const bugsBySprintId = {};
  bugRows.forEach(r => { (bugsBySprintId[r.sprint_id] = bugsBySprintId[r.sprint_id] || []).push(r); });

  // All sprints (completed + active) — feeds the Overview trend only, which
  // just needs "how many points landed", regardless of whether the sprint is
  // finished yet.
  const allSprintRows = sprints.map(sp => {
    const completedIssues = doneBySprintId[sp.id] || [];
    const completedPts = completedIssues.reduce((s, i) => s + (Number(i.story_points) || 0), 0);
    const spillIssues = spilloverBySprintId[sp.id] || [];
    const committedPts = sp.status === 'active'
      ? (activeCommittedBySprintId[sp.id] || 0)
      : completedPts + spillIssues.reduce((s, i) => s + (Number(i.story_points) || 0), 0);
    return {
      id: sp.id, name: sp.name, status: sp.status, start_date: sp.start_date, end_date: sp.end_date,
      completed_points: completedPts, committed_points: committedPts,
      completed_issues: completedIssues
    };
  });

  // Completed sprints only — feeds every Comparison Trends chart.
  const completedSprintRows = sprints.filter(sp => sp.status === 'completed').map(sp => {
    const completedIssues = doneBySprintId[sp.id] || [];
    const spillIssues = spilloverBySprintId[sp.id] || [];
    const completedPts = Number(sp.velocity) || 0; // authoritative, never recomputed
    const spillPts = spillIssues.reduce((s, i) => s + (Number(i.story_points) || 0), 0);
    const committedPts = completedPts + spillPts;
    const bugs = bugsBySprintId[sp.id] || [];
    return {
      id: sp.id, name: sp.name, end_date: sp.end_date,
      committed_points: committedPts, completed_points: completedPts,
      spillover_count: spillIssues.length, spillover_points: spillPts,
      completion_pct: committedPts > 0 ? Math.round((completedPts / committedPts) * 100) : 0,
      completed_issues: completedIssues,
      spillover_issues: spillIssues,
      achievements: Array.isArray(sp.achievements) ? sp.achievements : [],
      bug_count: bugs.length,
      bugs_open: bugs.filter(b => b.status !== 'Done').length,
      bugs_closed: bugs.filter(b => b.status === 'Done').length,
      bugs: bugs
    };
  });

  // Previous vs last completed sprint — the two most recent by end_date.
  const completedSorted = completedSprintRows.slice().sort((a, b) => new Date(b.end_date) - new Date(a.end_date));
  const previousVsLast = {
    last: completedSorted[0] || null,
    previous: completedSorted[1] || null
  };

  // Per-user spillover across every completed sprint — seeded with everyone
  // tagged as a Developer or QA on any of these sprints (not the whole
  // space roster, and not just people who happen to have spilled
  // something), so a sprint participant with zero spillover still shows up
  // with 0s instead of vanishing or dragging in unrelated space members.
  const rosterIds = [...new Set(
    sprints.filter(sp => sp.status === 'completed')
      .flatMap(sp => [...(sp.developer_ids || []), ...(sp.qa_ids || [])])
  )];
  // A spillover issue's assignee is not guaranteed to be on the sprint's own
  // Developer/QA roster (that roster and an issue's Assignee field are two
  // separate things) — resolving names ONLY for rosterIds left anyone else
  // hardcoded as the literal string 'Unknown' below, even though they are a
  // real, known user. Fetching every spillover assignee's name too (still
  // ONE query, still keyed off real ids) fixes that without touching which
  // rows get seeded up front or in what order.
  const spilloverAssigneeIds = completedSprintRows.flatMap(sp => sp.spillover_issues.map(i => i.assignee_id)).filter(Boolean);
  const nameIds = [...new Set([...rosterIds, ...spilloverAssigneeIds])];
  const members = nameIds.length
    ? (await q('SELECT id, name, color FROM users WHERE id = ANY($1)', [nameIds])).rows
    : [];
  const userNameById = {};
  members.forEach(u => { userNameById[u.id] = u; });
  const byUser = {};
  rosterIds.forEach(id => {
    if (userNameById[id]) byUser[id] = { name: userNameById[id].name, color: userNameById[id].color, per_sprint: {} };
  });
  completedSprintRows.forEach(sp => {
    sp.spillover_issues.forEach(i => {
      if (!i.assignee_id) return;
      if (!byUser[i.assignee_id]) {
        const u2 = userNameById[i.assignee_id];
        byUser[i.assignee_id] = { name: u2 ? u2.name : 'Unknown', color: (u2 && u2.color) || '#6b7280', per_sprint: {} };
      }
      const u = byUser[i.assignee_id];
      const ps = (u.per_sprint[sp.id] = u.per_sprint[sp.id] || { sprint_id: sp.id, sprint_name: sp.name, points: 0, count: 0, issues: [] });
      ps.points += Number(i.story_points) || 0;
      ps.count += 1;
      ps.issues.push(i);
    });
  });
  const spilloverByUser = Object.keys(byUser).map(userId => {
    const u = byUser[userId];
    const perSprintArr = Object.values(u.per_sprint);
    return {
      user_id: userId,
      name: u.name,
      color: u.color,
      total_points: perSprintArr.reduce((s, p) => s + p.points, 0),
      total_count: perSprintArr.reduce((s, p) => s + p.count, 0),
      per_sprint: perSprintArr
    };
  }).sort((a, b) => b.total_points - a.total_points);

  // Bug Summary breakdowns — by assignee and by reporter, sprint-wise. Anyone
  // who assigned/reported a bug can show up here (not scoped to a sprint's
  // Developer/QA lists like spillover is, since a bug's assignee or reporter
  // can genuinely be anyone).
  const bugUserIds = [...new Set(
    bugRows.flatMap(r => [r.assignee_id, r.reporter_id])
      .concat(Object.values(upgraderByComboRole).flatMap(byRole => Object.values(byRole).map(u => u.user_id)))
      .filter(Boolean)
  )];
  const bugUserMap = {};
  if (bugUserIds.length) {
    const users = (await q('SELECT id, name, color FROM users WHERE id = ANY($1)', [bugUserIds])).rows;
    users.forEach(u => { bugUserMap[u.id] = u; });
  }
  const sprintNameById = {};
  completedSprintRows.forEach(sp => { sprintNameById[sp.id] = sp.name; });
  function buildBugBreakdown(keyField) {
    const grouped = {};
    bugRows.forEach(r => {
      const uid = r[keyField];
      if (!uid) return;
      const u = (grouped[uid] = grouped[uid] || { per_sprint: {} });
      const ps = (u.per_sprint[r.sprint_id] = u.per_sprint[r.sprint_id] || { sprint_id: r.sprint_id, sprint_name: sprintNameById[r.sprint_id] || '', count: 0, issues: [] });
      ps.count += 1;
      ps.issues.push(r);
    });
    return Object.keys(grouped).map(uid => {
      const perSprintArr = Object.values(grouped[uid].per_sprint);
      return {
        user_id: uid,
        name: (bugUserMap[uid] && bugUserMap[uid].name) || 'Unknown',
        color: (bugUserMap[uid] && bugUserMap[uid].color) || '#6b7280',
        total_count: perSprintArr.reduce((s, p) => s + p.count, 0),
        per_sprint: perSprintArr
      };
    }).sort((a, b) => b.total_count - a.total_count);
  }
  const bugsByAssignee = buildBugBreakdown('assignee_id');
  const bugsByReporter = buildBugBreakdown('reporter_id');
  const bugSummaryOverall = {
    total_bugs: bugRows.length,
    open_bugs: bugRows.filter(r => r.status !== 'Done').length,
    closed_bugs: bugRows.filter(r => r.status === 'Done').length
  };

  // Bugs by Combination, Upgrader, sprint-wise — mirrors buildBugBreakdown's
  // per-sprint shape but keyed by combination string instead of a user id,
  // with each grouped issue enriched with resolved assignee/reporter names
  // so the client's per-sprint drill-down (ticket, assigned to, raised by)
  // needs no further lookups. A bug is filed under every combination it
  // names, so a value naming more than one combination counts once per
  // combination rather than being silently collapsed into one bucket.
  //
  // The stored value is NOT always a bare string. Picking more than one
  // combination (or one combination alongside more than one Product Type)
  // serializes the whole selection as JSON — {"v":2,"productTypes":[...],
  // "combinations":[...]}, or the older {"v":1,"sets":[{productType,
  // combinations}]} — see serializePtComboSelection/parsePtComboSelection in
  // drawer-panels.js, which this mirrors. Treating that JSON as a bare
  // comma-joined string (the original version of this code did) split the
  // JSON's own syntax apart into garbage rows: {"v":2, "productTypes":
  // ["Message"], "combinations":["Chat - Slack" and "Chat - Team"]} each
  // showing up as their own bogus "combination".
  // Returns combination name strings. A ticket no longer declares a Role
  // (the per-ticket Role picker was removed), so a v3 payload's "roles" key
  // is simply ignored here -- same as parsePtComboSelection's own client-side
  // read of it, see drawer-panels.js.
  function parseCombinationFieldStoredValue(raw) {
    if (!raw) return [];
    const trimmed = String(raw).trim();
    if (trimmed.charAt(0) === '{') {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && (parsed.v === 2 || parsed.v === 3)) {
          return Array.isArray(parsed.combinations) ? parsed.combinations.filter(Boolean) : [];
        }
        if (parsed && parsed.v === 1 && Array.isArray(parsed.sets)) {
          const out = [];
          const seen = {};
          parsed.sets.forEach(s => (s.combinations || []).forEach(c => {
            if (c && !seen[c]) { seen[c] = true; out.push(c); }
          }));
          return out;
        }
        return [];
      } catch (_) { return []; }
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  let bugsByCombination = null;
  if (combinationField) {
    const grouped = {};
    bugRows.forEach(r => {
      const combos = parseCombinationFieldStoredValue(bugCombinationByIssueId[r.id]);
      // Grouped by combination alone -- dedupe in case old data names the
      // same combination more than once (a leftover v3 payload could).
      const comboNames = combos.length ? [...new Set(combos)] : ['No Combination'];
      const enriched = {
        ...r,
        assignee_name: (bugUserMap[r.assignee_id] && bugUserMap[r.assignee_id].name) || null,
        reporter_name: (bugUserMap[r.reporter_id] && bugUserMap[r.reporter_id].name) || null
      };
      comboNames.forEach(name => {
        const g = (grouped[name] = grouped[name] || { combination: name, per_sprint: {} });
        const ps = (g.per_sprint[r.sprint_id] = g.per_sprint[r.sprint_id] || { sprint_id: r.sprint_id, sprint_name: sprintNameById[r.sprint_id] || '', count: 0, issues: [] });
        ps.count += 1;
        ps.issues.push(enriched);
      });
    });
    bugsByCombination = Object.keys(grouped).map(name => {
      const g = grouped[name];
      const perSprintArr = Object.values(g.per_sprint);
      const productType = productTypeByCombination[g.combination] || null;
      // Every configured role for the field gets an entry here, whether or
      // not it has an Upgrader assigned yet, so the client's "show all
      // roles" popup always lists the full set rather than only the ones
      // someone happened to assign.
      const upgradersForCombo = upgraderByComboRole[g.combination] || {};
      const upgraders = upgraderRoleRows.map(roleRow => {
        const u = upgradersForCombo[roleRow.key];
        return {
          role_key: roleRow.key,
          role_name: roleRow.name,
          user_name: (u && u.user_name) || null,
          user_email: (u && u.user_email) || null
        };
      });
      return {
        combination: g.combination,
        product_type: productType,
        upgraders,
        total_count: perSprintArr.reduce((s, p) => s + p.count, 0),
        per_sprint: perSprintArr
      };
    }).sort((a, b) => b.total_count - a.total_count);
  }

  res.json({
    sprints: allSprintRows,
    completed_sprints: completedSprintRows,
    previous_vs_last: previousVsLast,
    spillover_by_user: spilloverByUser,
    bug_summary: bugSummaryOverall,
    bugs_by_assignee: bugsByAssignee,
    bugs_by_reporter: bugsByReporter,
    bugs_by_combination: bugsByCombination
  });
}));

// Take one issue out of a completed sprint's spillover record. Org admin only:
// this rewrites how a finished sprint reads, so it is deliberately not something a
// space admin can do. The issue itself is untouched — only the sprint's spillover
// marker goes, and the correction is recorded in audit_logs.
app.delete('/api/sprints/:sprintId/spillover/:issueId', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can edit a sprint\'s spillover history.')) return;
  const { sprintId, issueId } = req.params;
  const sprint = (await q('SELECT id, name, space_id, status FROM sprints WHERE id=$1', [sprintId])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  const issue = (await q('SELECT id, key, title FROM issues WHERE id=$1', [issueId])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const already = await spilloverExcludedIds(sprintId);
  const removed = await q(
    `DELETE FROM issue_history
      WHERE field_name='spillover' AND old_value=$1 AND issue_id=$2`,
    [sprintId, issueId]
  );
  if (!removed.rowCount && already.indexOf(issueId) >= 0) {
    return res.status(404).json({ error: issue.key + ' has already been removed from this sprint\'s spillover.' });
  }

  // Recorded even when no history row existed, because the legacy fallback query
  // can surface an issue without one and the exclusion is what keeps it out.
  await q(
    `INSERT INTO audit_logs(id,space_id,user_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,'spillover.remove','issue',$4,$5::jsonb)`,
    [uid(), sprint.space_id, req.user.id, issueId, JSON.stringify({
      sprint_id: sprintId,
      sprint_name: sprint.name,
      issue_key: issue.key,
      issue_title: issue.title,
      history_rows_deleted: removed.rowCount
    })]
  );
  res.json({ ok: true, key: issue.key, history_rows_deleted: removed.rowCount });
}));

