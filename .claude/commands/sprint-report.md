# /project:sprint-report — Generate Sprint Progress Report

Produces a live progress report for the currently active sprint in a given space.

## Usage
```
/project:sprint-report $ARGUMENTS
```
Example: `/project:sprint-report space=PROJ`

## Steps
1. Find the active sprint: `SELECT * FROM sprints WHERE space_id=$1 AND status='active'`
2. Load all issues in the sprint: `SELECT * FROM issues WHERE sprint_id=$1 AND deleted_at IS NULL`
3. Load worklogs for the sprint date range
4. Calculate:
   - Done %: `count(status='Done') / total * 100`
   - Points done vs total
   - Days elapsed vs sprint duration
   - Burndown: expected vs actual points remaining
   - Assignee breakdown: who has what still open

## Output
```md
## Sprint Report — [Sprint Name]
**Space:** [Space Name]  **Period:** [start] → [end]  **Day X of Y**

### Progress
- Issues: ✅ X Done / 🔄 Y In Progress / ⏳ Z To Do / 👁 W In Review
- Story Points: XX done / YY total (ZZ%)
- Burndown: On track / Ahead / Behind by N points

### By Status
| Status | Count | Points |
|--------|-------|--------|

### By Assignee
| Member | Done | In Progress | To Do | Points Remaining |
|--------|------|-------------|-------|------------------|

### At Risk
Issues with `due_date` before sprint end date and status != 'Done':
- KEY-N: [title] — due [date] — assigned to @name

### Time Logged This Sprint
Total: Xh Ym across N worklogs
```
