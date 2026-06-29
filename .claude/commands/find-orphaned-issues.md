# /project:find-orphaned-issues — Find Issues Needing Attention

Finds issues that are stuck, unassigned, unestimated, or past due across all spaces.

## Usage
```
/project:find-orphaned-issues
/project:find-orphaned-issues $ARGUMENTS
```
Example: `/project:find-orphaned-issues space=PROJ`

## What It Finds

### 1. Unassigned Issues in Active Sprints
```sql
SELECT i.* FROM issues i
JOIN sprints s ON s.id = i.sprint_id
WHERE s.status = 'active'
AND i.assignee_id IS NULL
AND i.deleted_at IS NULL
```
Risk: Nobody owns these — they will slip.

### 2. Unestimated Issues in Active Sprints
```sql
WHERE sprint_id IN (active) AND (story_points IS NULL OR story_points = 0)
AND deleted_at IS NULL
```
Risk: Velocity calculation will be inaccurate.

### 3. Overdue Issues (due_date in the past, not Done)
```sql
WHERE due_date < NOW() AND status != 'Done' AND deleted_at IS NULL
```

### 4. Stale In-Progress Issues (no update in >7 days)
```sql
WHERE status = 'In Progress' AND updated_at < NOW() - INTERVAL '7 days'
AND deleted_at IS NULL
```
Risk: Blocked or forgotten work.

### 5. Subtasks with Deleted or Completed Parent
```sql
WHERE parent_id IN (
  SELECT id FROM issues WHERE deleted_at IS NOT NULL OR status = 'Done'
) AND status != 'Done' AND deleted_at IS NULL
```
Risk: Orphaned subtasks nobody will notice.

### 6. Issues in Completed Sprints (non-Done)
```sql
JOIN sprints ON sprints.id = issues.sprint_id
WHERE sprints.status = 'completed' AND issues.status != 'Done'
AND issues.deleted_at IS NULL
```
Risk: Should have been moved to backlog on sprint complete — data integrity issue.

## Output
```md
## Orphaned Issues Report — [date]

### 🔴 Overdue (X issues)
| Key | Title | Due Date | Assignee | Space |

### 🟡 Unassigned in Active Sprint (X issues)
...

### 🟡 Unestimated in Active Sprint (X issues)
...

### ⚪ Stale In-Progress >7 days (X issues)
...

### 🔴 Data Integrity: Issues in Completed Sprint (X issues)
...
```
