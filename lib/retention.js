/**
 * Deleted Items retention — soft-deleted rows are purged for good once they have
 * been in the bin longer than the retention window (30 days by default,
 * overridable with BIN_RETENTION_DAYS).
 *
 * Design notes:
 *  - Only rows that are ALREADY soft-deleted are eligible. A live row can never
 *    be touched by this sweep, whatever the window is set to.
 *  - Archived SPACES are deliberately never auto-purged. Archiving is not
 *    deleting: a space is a container for other people's work, and quietly
 *    destroying one (plus every issue, sprint and comment in it) after a month
 *    is not a recoverable mistake. Spaces stay archived until a human acts.
 *  - The sweep is chatty in the log on purpose — an automatic destructive job
 *    should leave a trail of exactly what it removed.
 */

const DEFAULT_RETENTION_DAYS = 30;

/**
 * The one and only issue-purge cascade, shared by the manual permanent-delete
 * routes and the retention sweep, so the two can never drift apart and leave
 * orphaned comments/worklogs behind. Caller decides whether the purge is allowed;
 * this just removes the rows.
 */
async function purgeIssueRows(q, id) {
  await q('UPDATE issues SET parent_id=NULL WHERE parent_id=$1', [id]);
  await q('DELETE FROM issue_field_values WHERE issue_id=$1', [id]);
  await q('DELETE FROM issue_links WHERE source_id=$1 OR target_id=$1', [id]);
  await q('DELETE FROM issue_attachments WHERE issue_id=$1', [id]);
  await q('DELETE FROM issue_favorites WHERE issue_id=$1', [id]).catch(() => {});
  await q('DELETE FROM comments WHERE issue_id=$1', [id]);
  await q('DELETE FROM worklogs WHERE issue_id=$1', [id]);
  await q('UPDATE roadmap_items SET issue_id=NULL WHERE issue_id=$1', [id]).catch(() => {});
  await q('DELETE FROM issue_history WHERE issue_id=$1', [id]);
  await q('DELETE FROM issues WHERE id=$1', [id]);
}

function retentionDays() {
  const raw = parseInt(process.env.BIN_RETENTION_DAYS, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Purge everything whose time in the bin has run out.
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[], rowCount: number}>} q
 * @returns {Promise<{days: number, issues: number, sprints: number}>}
 */
async function purgeExpired(q) {
  const days = retentionDays();
  const cutoff = `NOW() - INTERVAL '${days} days'`;   // days is an integer we produced, never user input
  const out = { days, issues: 0, sprints: 0 };

  // ── Sprints ────────────────────────────────────────────────
  // Before dropping a sprint row, detach anything still pointing at it so no
  // ticket is left referencing a sprint that no longer exists.
  const sprints = (await q(
    `SELECT id, name FROM sprints WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`
  )).rows;
  for (const s of sprints) {
    await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [s.id]);
    await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [s.id]);
    await q('DELETE FROM sprints WHERE id=$1', [s.id]);
    out.sprints++;
    console.log(`[retention] purged sprint "${s.name}" (${days}+ days in the bin)`);
  }

  // ── Issues ─────────────────────────────────────────────────
  // Same cascade as a manual permanent delete. Parents are handled by nulling
  // children's parent_id, so a purged epic never orphans a FK.
  const issues = (await q(
    `SELECT id, key FROM issues WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`
  )).rows;
  for (const i of issues) {
    await purgeIssueRows(q, i.id);
    out.issues++;
    console.log(`[retention] purged ticket ${i.key} (${days}+ days in the bin)`);
  }

  if (out.issues || out.sprints) {
    console.log(`[retention] done — ${out.issues} ticket(s), ${out.sprints} sprint(s) past the ${days}-day window.`);
  }
  return out;
}

/**
 * Run the sweep now and then on an interval. Never throws into the caller: a
 * failed sweep must not take the server down, it just retries next tick.
 */
function startRetentionSweeper(q, opts) {
  opts = opts || {};
  const everyMs = opts.intervalMs || 6 * 60 * 60 * 1000;   // 6h
  const tick = () => purgeExpired(q).catch(err => console.error('[retention] sweep failed:', err.message));
  setTimeout(tick, opts.startDelayMs != null ? opts.startDelayMs : 15000);
  const timer = setInterval(tick, everyMs);
  if (timer.unref) timer.unref();   // don't hold the process open in tests
  console.log(`[retention] bin retention ${retentionDays()} days; sweeping every ${Math.round(everyMs / 3600000)}h.`);
  return timer;
}

module.exports = {
  purgeExpired, startRetentionSweeper, retentionDays, purgeIssueRows, DEFAULT_RETENTION_DAYS
};
