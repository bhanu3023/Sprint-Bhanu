# Sprint Lifecycle Rules

## Sprint Statuses
`planning` → `active` → `completed`

## Planning → Active (`POST /api/sprints/:id/start`)
- Only ONE sprint per space can be `active` at any time
- Before setting `status='active'`, query: `SELECT id FROM sprints WHERE space_id=$1 AND status='active'`
- If a row exists → 400: "A sprint is already active in this space"
- On success: set `status='active'`, fire `createNotif` to all space members with type `sprint_started`
- `start_date` should be set to `NOW()` if not already provided

## Active → Completed (`POST /api/sprints/:id/complete`)
Order of operations — do NOT skip any step:
1. Calculate velocity: `SELECT COALESCE(SUM(story_points), 0) FROM issues WHERE sprint_id=$1 AND status='Done'`
2. Write velocity: `UPDATE sprints SET velocity=$1, status='completed', end_date=NOW() WHERE id=$2`
3. Move incomplete issues to backlog: `UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1 AND status != 'Done'`
4. Notify all space members: `createNotif(userId, spaceId, 'sprint_completed', ...)` for each member — fire-and-forget
5. Return the completed sprint with its velocity

## Completed sprints
- Cannot be restarted — `completed` is terminal
- Issues that were `Done` in the sprint keep their `sprint_id` pointing to the completed sprint (for historical reports)
- The `velocity` field is the single source of truth for sprint reporting — never recalculate from issues after completion

## Deleting a Sprint
- Only allowed if `status='planning'` (not active, not completed)
- Move all issues to backlog first: `UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1`
- Then delete the sprint row

## Backlog
- Issues with `sprint_id=NULL` and `deleted_at IS NULL` are in the backlog
- Backlog issues can be dragged into any `planning` or `active` sprint
- `position` field controls order within the backlog — update on drag

## Velocity & Reporting
- `sprints.velocity` = story points of `Done` issues at completion time, never updated after that
- `GET /api/reports/velocity` reads `sprints.velocity` for history — never recalculates
- `GET /api/reports/burndown/:sprintId` recalculates daily from `issue_history` (status changes) — this is read-only and does not modify any data
