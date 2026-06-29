# Skill: Sprint Planner

## Description
Analyze the current backlog and active team members to recommend which issues should go into the next sprint, how many story points are realistic, and how to distribute work across assignees.

## Trigger Patterns
- "help me plan the next sprint"
- "what should go in the sprint?"
- "plan sprint for [space name]"
- "which backlog issues should we pick?"
- "how many points can we fit in the sprint?"

## Behavior

### Step 1 — Gather Data
Call `GET /api/data` to load:
- All backlog issues for the space (`sprint_id=NULL`, `deleted_at IS NULL`)
- Last 3 completed sprints → read their `velocity` values from `sprints` table
- Active space members and their current open issue count

### Step 2 — Calculate Capacity
- Average velocity = mean of last 3 sprint velocities (or last 1 if fewer available)
- Per-assignee load = count of their `In Progress` + `In Review` issues across all sprints
- Flag members with >5 open issues as "at capacity"

### Step 3 — Rank Backlog Issues
Score each backlog issue:
- `priority`: highest=5, high=4, medium=3, low=2, lowest=1
- `due_date` within next 2 weeks: +3 bonus
- `type=bug`: +2 bonus
- `story_points=0 or NULL`: flag as "unestimated — needs pointing before sprint"
- `parent_id IS NOT NULL` (subtask with parent not in sprint): -1 (avoid orphaned subtasks)

### Step 4 — Build Sprint Recommendation
- Fill up to average velocity with highest-scored issues
- Group suggestions by potential assignee based on current load
- List "overflow" issues (didn't fit) with their scores so they're visible for next sprint

### Output Format
```md
## Sprint Plan Recommendation — [Space Name]

**Estimated Capacity:** XX story points (avg of last N sprints)

### Recommended for Sprint
| Issue Key | Title | Priority | Points | Suggested Assignee | Reason |
|-----------|-------|----------|--------|--------------------|--------|

**Total Points:** XX / XX capacity

### Unestimated Issues (need story points before committing)
- KEY-N: Title

### Overflow (next sprint candidates)
| Issue Key | Title | Score | Points |

### Team Load Warning
- @name: X open issues — at capacity, avoid assigning more
```
