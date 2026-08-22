# Sprint Lifecycle

> **This describes what the code does as of `1b6292d` (2026-08-22).** The
> `/start` guard and the delete gate specified here were absent until commits
> A4 and A5; they are now implemented and tested. Two places where the code
> deliberately supersedes the older spec are marked **superseded** with the
> reason.

## Statuses

```
planning → active → completed
```

`completed` is terminal. There is no path back.

A sprint also has an independent soft-delete tombstone (`deleted_at`), which is
orthogonal to status.

## planning → active — `POST /api/sprints/:id/start`

Requires `sprint.manage` (space admin or org admin).

Enforced, in order:

1. **Source status must be `planning`.** An `active` sprint returns 400
   `"This sprint is already active."`; a `completed` one returns 400
   `"A completed sprint cannot be restarted."` The two are distinguished
   deliberately — they are different mistakes.
2. **Only one active sprint per space.** Returns 400
   `"A sprint is already active in this space."`
3. `start_date` is set to `NOW()` **only if it is currently null**
   (`COALESCE(start_date, NOW())`). An explicitly planned start date is
   preserved.
4. `sprint_started` fires to every space member, fire-and-forget.

### Why this is a transaction

The obvious implementation — `UPDATE ... WHERE NOT EXISTS (active sprint)` —
is **not sufficient**, and the concurrency test proves it rather than arguing
it. Under READ COMMITTED two parallel starts each fail to see the other's
uncommitted row, both pass the condition, and both go active. Measured: 3 of 3
succeeded.

So `/start` opens an explicit transaction, takes `SELECT ... FOR UPDATE` on the
**space** row to serialise starts within that space, re-checks, updates, and
commits. A dedicated client is required because `q()` uses the pool and would
release the lock at statement end.

If you touch this route, keep the lock. `tests/suites/03-concurrency.js` fires
three simultaneous starts and asserts exactly one wins **and** that the
database agrees afterwards.

## active → completed — `POST /api/sprints/:id/complete`

Requires `sprint.manage`. All side effects live in `lib/sprint-complete.js` so
this route and the automatic end-date sweeper cannot diverge. Order matters and
no step may be skipped:

1. Guard: the sprint must be `active` and not tombstoned, else 400
   `"Sprint is not active"`.
2. Velocity: `SUM(story_points) WHERE sprint_id=$1 AND status='Done'`,
   coalesced to 0.
3. `UPDATE sprints SET status='completed', velocity=$2, completed_at=NOW()`.
   **Superseded:** the older spec said `end_date=NOW()`. The code writes
   `completed_at` instead and leaves `end_date` as the *planned* window, because
   the backlog's date-range display and due-date validation must keep showing
   what was planned, not when someone clicked Complete.
4. Capture the non-`Done` issues, then `UPDATE issues SET sprint_id=NULL WHERE
   sprint_id=$1 AND status!='Done'`.
5. Write one `field_name='spillover'` history row per moved issue. This is
   distinct from the `field_name='sprint_id'` row that a manual mid-sprint move
   writes, and the Spillover and Scope Change reports depend on telling them
   apart.
6. `sprint_completed` to every space member.

### After completion

- `Done` issues keep their `sprint_id`, so historical reports still resolve.
- Non-`Done` issues are in the backlog and **keep their status**.
- `sprints.velocity` is frozen. `GET /api/reports/velocity` reads the stored
  column and never recalculates. Editing an issue's points afterwards does not
  move a completed sprint's number — there is a test asserting exactly this.

## Deleting a sprint — `DELETE /api/sprints/:id`

Requires `sprint.manage`. **Only allowed while `status='planning'`.**

- `active` → 400 `"An active sprint cannot be deleted. Complete it first."`
- `completed` → 400
  `"A completed sprint cannot be deleted; it is the historical record."`
  Completed is refused because its issue set and frozen velocity are what the
  velocity chart and burndown read; deleting it would silently drop a row from
  every report.

**Superseded:** the older spec said "move all issues to backlog, then delete the
sprint row". The delete is a **soft** delete:

- `sprints.deleted_at=NOW()`, `deleted_by=<actor>` — the sprint lands in
  Deleted Items and an org admin can restore it.
- Its issues **are** still detached: `sprint_id=NULL`, with
  `former_sprint_id` remembering where they came from so a restore can put them
  back. A binned sprint must not hold tickets out of the backlog.

## The backlog

- Backlog = `sprint_id IS NULL AND deleted_at IS NULL`.
- Backlog issues can be moved into any `planning` or `active` sprint.
- `position` orders within the backlog and is updated on drag.
- Deciding an issue's sprint by hand clears `former_sprint_id`, so restoring an
  old deleted sprint will not yank it back.

## Automatic completion

`startSprintAutoCompleter` closes any active sprint whose `end_date` 23:59
local has passed, through the same `completeSprint` path, with the automatic
wording on the notification. This is why fixtures and tests must use a
**future** `end_date` — a past one lets the sweeper mutate the sprint mid-test.

## What is NOT writable through `PUT /api/sprints/:id`

`status` and `velocity` are **not** in `UPDATE_WHITELIST.sprints`. They belong
to the lifecycle endpoints that own the ordered side effects above. Writable
through the generic PUT they were a second unguarded door: a space admin could
set `status='completed'` with no velocity calculation, no backlog move and no
notifications, or reactivate a sprint after the `/start` guard landed.

The whitelist is: `name`, `goal`, `start_date`, `end_date`, `position`,
`developer_ids`, `qa_ids`, `public_holidays`, `developer_leaves`,
`achievements`. A PUT carrying only `status` and/or `velocity` matches nothing
and returns 400 `"Nothing to update"`.

## Reporting

- `GET /api/reports/velocity` — reads `sprints.velocity` for `completed`,
  non-tombstoned sprints. Never recalculates.
- `GET /api/reports/burndown/:sprintId` — recalculates daily from
  `issue_history` status changes. Read-only; writes nothing.

## Known gaps, deliberately not implemented

- **No cross-space active-sprint limit.** The one-active rule is per space by
  design; a user may have many active sprints across different spaces.
- **`/start` does not validate that the sprint has issues.** Starting an empty
  sprint is allowed.
