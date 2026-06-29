# Issue State Machine

## Valid Statuses
`To Do` → `In Progress` → `In Review` → `Done`

## Allowed Transitions
| From | To | Allowed | Notes |
|---|---|---|---|
| To Do | In Progress | YES | Assignee should be set before moving |
| To Do | Done | NO | Must pass through In Progress |
| To Do | In Review | NO | Must pass through In Progress |
| In Progress | In Review | YES | Normal flow |
| In Progress | To Do | YES | Unstarted/blocked |
| In Progress | Done | YES | Skip review for minor fixes only |
| In Review | Done | YES | Normal approval flow |
| In Review | In Progress | YES | Review rejected — sent back |
| In Review | To Do | NO | Go back to In Progress, not To Do |
| Done | In Progress | YES | Reopening an issue |
| Done | To Do | NO | Reopen always goes to In Progress |

## Side Effects on Every Status Change
These MUST happen in `PUT /api/issues/:id` whenever `status` changes:
1. Write to `issue_history`: `field_name='status'`, `old_value=prev`, `new_value=new`
2. Call `createNotif(assignee_id, space_id, 'status_changed', ...)` — fire-and-forget
3. Update `issues.updated_at = NOW()`

## Status in Sprint Context
- Issues can only be on the board if they belong to the active sprint (`sprint_id = active sprint id`)
- When a sprint is completed, all issues still in `To Do` or `In Progress` or `In Review` → `sprint_id = NULL` (backlog)
- Issues moved back to backlog retain their status — they are NOT reset to `To Do`

## Subtasks
- A subtask (`parent_id IS NOT NULL`, `type='subtask'`) follows the same state machine
- A parent issue should NOT be marked `Done` while any subtask is not `Done`
- This is a UI warning only — the API does not block it

## Deleted Issues
- `deleted_at IS NOT NULL` means soft-deleted — excluded from ALL list queries
- Status of a soft-deleted issue is irrelevant; do not allow status transitions on deleted issues
- Restore is done by setting `deleted_at = NULL` (no status change)
