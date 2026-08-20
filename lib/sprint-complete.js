/**
 * Sprint completion — the one implementation, shared by the manual
 * POST /api/sprints/:id/complete route and the automatic end-of-day sweeper.
 *
 * Design notes:
 *  - Completing a sprint is not just a status flip. It freezes velocity, spills
 *    unfinished tickets back to the backlog and notifies the space. Those steps
 *    feed the Spillover / Scope Change / Sprint Summary reports, so a second
 *    copy of this logic drifting from the first would quietly corrupt them.
 *    Same reasoning as purgeIssueRows in retention.js: one cascade, two callers.
 *  - The sweeper closes a sprint at 23:59 LOCAL time on its end_date — the
 *    server's own clock, which is what "end of the day" means to the team
 *    reading the board. end_date is read as a plain YYYY-MM-DD string and
 *    rebuilt in local time rather than trusting the driver's DATE parsing,
 *    so a UTC database session can't shift the deadline by a day.
 *  - Sprints already past their end date when this feature shipped are exempt
 *    (see migration 013). Auto-completing months-old sprints on first boot
 *    would spill their tickets and notify everyone out of nowhere; they stay
 *    Active until a human clicks Complete.
 *  - A failed sweep never takes the server down — it just retries next tick.
 */

/** Local-time Date for 23:59:00 on a YYYY-MM-DD string. */
function endOfDayLocal(ymd) {
  const parts = String(ymd || '').split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 0, 0);
}

/**
 * Complete one sprint and run every side effect.
 * Caller decides whether completion is allowed; this just does it.
 *
 * @param {object} deps  { q, uid, createNotif }
 * @param {string} sprintId
 * @param {string|null} actorUserId  null when the sweeper is the actor
 * @param {{ automatic?: boolean }} [opts]
 * @returns {Promise<object|null>} the completed sprint row, or null if it was
 *          not found / not eligible (already completed, or binned)
 */
async function completeSprint(deps, sprintId, actorUserId, opts) {
  const { q, uid, createNotif } = deps;
  opts = opts || {};

  const sprint = (await q(
    "SELECT * FROM sprints WHERE id=$1 AND deleted_at IS NULL AND status='active'", [sprintId]
  )).rows[0];
  if (!sprint) return null;

  const done = await q(
    "SELECT COALESCE(SUM(story_points),0)::int AS pts FROM issues WHERE sprint_id=$1 AND status='Done'", [sprintId]
  );
  const pts = done.rows[0].pts;
  // completed_at is the actual moment this ran — separate from end_date, which
  // stays the PLANNED sprint window (start_date/end_date) so the backlog's
  // date-range display and due-date validation against a completed sprint
  // keep showing what was planned, not when someone happened to click
  // Complete. The backlog page's completed-sprints ordering reads this to
  // show the most recently completed sprint on top.
  await q("UPDATE sprints SET status='completed',velocity=$2,completed_at=NOW() WHERE id=$1", [sprintId, pts]);

  // Capture spillover issues before moving them to backlog
  const spilloverIssues = (await q(
    "SELECT id FROM issues WHERE sprint_id=$1 AND status!='Done' AND deleted_at IS NULL", [sprintId]
  )).rows;
  await q("UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1 AND status!='Done'", [sprintId]);

  // Record this as a distinct 'spillover' history entry (not 'sprint_id') so
  // it can't be confused with a manual mid-sprint removal — PUT /api/issues/:id
  // already logs field_name='sprint_id' for ANY sprint change (drag to
  // backlog, editing the Sprint dropdown, etc.), and both the Spillover and
  // Scope Change reports read issue_history by field_name. Without a
  // separate marker, a sprint's genuine end-of-sprint spillover and any
  // manual backlog move made earlier in that same sprint were
  // indistinguishable, so manually-removed tickets were showing up as
  // "spillover" instead of under Scope Change's "Removed".
  for (const issue of spilloverIssues) {
    q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
       VALUES($1,$2,$3,'spillover',$4,NULL)`,
      [uid(), issue.id, actorUserId || null, sprintId]).catch(() => {});
  }

  // Notify all space members
  const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [sprint.space_id])).rows[0];
  const sprintLink = spaceRow ? '/space/' + encodeURIComponent(spaceRow.key) + '/reports' : null;
  const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
  const body = opts.automatic
    ? 'Sprint reached its end date and closed automatically with ' + pts + ' story points.'
    : 'Sprint completed with ' + pts + ' story points.';
  members.rows.forEach(function (m) {
    createNotif({
      user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_completed',
      title: sprint.name + ' has been completed',
      body: body,
      link: sprintLink
    });
  });

  return (await q('SELECT * FROM sprints WHERE id=$1', [sprintId])).rows[0];
}

/**
 * Close every active sprint whose end_date 23:59 (local) has passed.
 * @returns {Promise<{checked: number, completed: string[]}>}
 */
async function sweepDueSprints(deps) {
  const { q } = deps;
  const out = { checked: 0, completed: [] };

  // to_char, not the driver's DATE parsing: the DB session runs in UTC while
  // the app may not, and a raw Date would land on the wrong calendar day.
  const rows = (await q(`
    SELECT id, name, to_char(end_date, 'YYYY-MM-DD') AS end_ymd
    FROM sprints
    WHERE status = 'active'
      AND deleted_at IS NULL
      AND end_date IS NOT NULL
      AND auto_complete_exempt IS NOT TRUE
  `)).rows;

  const now = new Date();
  for (const row of rows) {
    out.checked++;
    const deadline = endOfDayLocal(row.end_ymd);
    if (!deadline || now < deadline) continue;
    const completed = await completeSprint(deps, row.id, null, { automatic: true });
    if (completed) {
      out.completed.push(row.name);
      console.log(`[sprint-auto] "${row.name}" reached ${row.end_ymd} 23:59 — completed automatically (velocity ${completed.velocity}).`);
    }
  }
  return out;
}

/**
 * Run the sweep now and then on an interval. Never throws into the caller.
 * One minute keeps the 23:59 cutoff accurate to the minute; the query is a
 * single indexed read over active sprints only, so the cost is negligible.
 */
function startSprintAutoCompleter(deps, opts) {
  opts = opts || {};
  const everyMs = opts.intervalMs || 60 * 1000;
  const tick = () => sweepDueSprints(deps).catch(err =>
    console.error('[sprint-auto] sweep failed:', err.message));
  setTimeout(tick, opts.startDelayMs != null ? opts.startDelayMs : 10000);
  const timer = setInterval(tick, everyMs);
  if (timer.unref) timer.unref();   // don't hold the process open in tests
  console.log('[sprint-auto] active sprints close at 23:59 local on their end date; checking every ' +
    Math.round(everyMs / 1000) + 's.');
  return timer;
}

module.exports = { completeSprint, sweepDueSprints, startSprintAutoCompleter, endOfDayLocal };
