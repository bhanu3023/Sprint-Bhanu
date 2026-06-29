# Skill: Worklog Reporter

## Description
Generate a human-readable time report from the `worklogs` table. Supports filtering by user, space, sprint, date range, and billable status. Auto-triggered when the user asks about time logged or wants a worklog summary.

## Trigger Patterns
- "show me time logged this week"
- "worklog report for [user]"
- "how many hours did the team log on [space]?"
- "billable hours for this sprint"
- "time summary for [date range]"

## Behavior

### Step 1 — Identify Filters
Parse the user's request for:
- `user` — specific person or "all"
- `space_id` — specific space or "all"
- `sprint_id` — link to a sprint's date range
- `date_from`, `date_to` — ISO date strings
- `is_billable` — true / false / both
- Default if none given: current week, all users, all spaces

### Step 2 — Fetch Data
Use `GET /api/worklogs` with the identified query params.
Data includes: `time_spent` (in minutes), `work_date`, `user_id`, `issue_id`, `description`, `is_billable`

### Step 3 — Convert Minutes
All `time_spent` values are stored in minutes.
Display as: `Xh Ym` (e.g., 90 minutes → `1h 30m`)

### Step 4 — Group and Summarize
Group by: **user → issue → date** (most granular)
Roll up to: **user total** and **space total**

### Output Format
```md
## Worklog Report
**Period:** [date_from] → [date_to]
**Space:** [name or All]
**Filter:** [Billable only / All]

### By Team Member
| Member | Issues | Total Time | Billable |
|--------|--------|------------|----------|
| @alice | 4 | 12h 30m | 10h 0m |
| @bob | 2 | 5h 15m | 5h 15m |

### Detail — @alice
| Issue | Date | Time | Billable | Note |
|-------|------|------|----------|------|
| KEY-12 | 2026-06-20 | 2h 0m | ✅ | Fixed auth redirect |

### Totals
- Total logged: 17h 45m
- Billable: 15h 15m (86%)
- Non-billable: 2h 30m
```

## Edge Cases
- If `time_spent = 0` for a worklog → show as `< 1m` and flag as suspicious
- If a user logged time on a `deleted_at IS NOT NULL` issue → still show it, add `[deleted issue]` label
- If no worklogs found for the filters → "No time logged for this period/filter"
