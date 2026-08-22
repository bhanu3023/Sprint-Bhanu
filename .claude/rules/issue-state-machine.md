# Issue Statuses

> **This describes what the code does as of `1b6292d` (2026-08-22), not what
> anyone wishes it did.** The previous version of this file specified a
> transition table that was never implemented in any release. It has been
> removed rather than implemented — see "Why there is no transition validation".

## Valid Statuses

Five, enforced by a DB CHECK constraint on `issues.status`:

```
To Do | In Progress | In Review | Done | Blocked
```

`Blocked` is a real status in active use, not a placeholder. The constraint is
the authority:

```sql
CHECK (status IN ('To Do','In Progress','In Review','Done','Blocked'))
```

An unknown status is rejected by postgres, which surfaces as a 400 (SQLSTATE
class 22 is mapped to 400 in `src/server/errors.js`).

## Why there is no transition validation

**Any status may move to any other status.** There is no allowed/forbidden
transition table, in the API or the client, and there never has been.

This is deliberate, not an oversight:

- Real Jira has no fixed transition table either — workflows are per-project,
  and the common default is any-to-any.
- Users drag cards freely between columns today and have for months.
- Enforcing a table now would break working production behaviour to satisfy a
  spec nothing ever implemented.

If per-space workflows are ever wanted, that is a feature with a schema behind
it, not a hardcoded table in a rules file.

## Side effects on a status change — these ARE implemented

All three happen in `PUT /api/issues/:id` whenever `status` actually changes
(`req.body.status !== oldRow.status`). These are load-bearing and covered by
tests; do not regress them.

1. **History row** — `issue_history` gains `field_name='status'`,
   `old_value=<prev>`, `new_value=<new>`, `user_id=<actor>`.
   `src/server/routes/issues.js:448`. `status` is one of the `TRACKED` fields;
   an untracked field changing writes no history.
2. **Notification** — `createNotif({... type: 'status_changed' ...})`, sent to
   the issue's current `assignee_id`, fire-and-forget.
   Skipped when there is no assignee, and skipped when the assignee IS the
   actor. `src/server/routes/issues.js:469`.
3. **`updated_at=NOW()`** — appended to the generated SET clause by the route,
   not by `buildDynamicUpdate`. `src/server/routes/issues.js:434`.

See `notification-triggers.md` for the exact title, body and link.

## Status in sprint context

- Issues appear on the board when they belong to the space's active sprint.
- On sprint completion, every issue that is **not** `Done` gets
  `sprint_id=NULL` (back to the backlog). `Done` issues keep their `sprint_id`
  so historical reports still resolve.
- Backlogged issues **keep their status**. They are not reset to `To Do`.
  A `Blocked` issue that spills over is still `Blocked`.
- Completion also writes a distinct `field_name='spillover'` history row per
  moved issue, so end-of-sprint spillover can be told apart from a manual
  mid-sprint move (which writes `field_name='sprint_id'`). The Spillover and
  Scope Change reports depend on that distinction. `lib/sprint-complete.js`.

## Subtasks

- A subtask (`parent_id IS NOT NULL`, `type='subtask'`) has the same statuses
  and the same absence of transition rules.
- A parent **can** be set to `Done` while subtasks are open. The API does not
  block it and is not intended to. Any warning is UI-side only.

## Deleted issues

- `deleted_at IS NOT NULL` is a soft delete. Such issues are excluded from list
  and read queries throughout (`deleted_at IS NULL` appears in the issues list,
  single-issue read, links, and subtask queries).
- **Status cannot be changed on a deleted issue.** `getIssueSpaceId` filters
  `deleted_at IS NULL`, so `PUT /api/issues/:id` returns 404 for a tombstoned
  issue. Enforced, not merely intended.
- Restore clears the tombstone in place: `deleted_at=NULL`, no status change,
  no space change. Restore is **org-admin only**
  (`POST /api/issues/:id/restore` → `requireOrgAdmin`).

## Known gaps, deliberately not implemented

- **No per-space workflow configuration.** Status values are global and fixed
  by the CHECK constraint, unlike `type` and `priority`, which are per-space
  configurable via `custom_fields`.
