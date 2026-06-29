# Skill: Issue Triage

## Description
Given a newly created or unclassified issue, analyze its title and description and suggest the correct type, priority, assignee, epic/parent, and sprint placement. Also flags issues that are too vague to act on.

## Trigger Patterns
- "triage this issue"
- "classify this issue"
- "what priority should this be?"
- "who should own this?"
- "help me fill in the issue fields"
- "is this a bug or a task?"

## Behavior

### Step 1 — Classify Type
Read title + description:
- Contains "crash", "error", "broken", "not working", "500", "fails" → `bug`
- Describes a large cross-cutting feature involving multiple issues → `epic`
- Small scoped piece of work under an epic → `story` or `task`
- A step inside another issue → `subtask` (ask for `parent_id`)
- Default for ambiguous → `task`

### Step 2 — Suggest Priority
| Signal | Priority |
|--------|----------|
| Production down / data loss / security | highest |
| Core feature broken, no workaround | high |
| Feature degraded, workaround exists | medium |
| Minor inconvenience / cosmetic | low |
| Nice to have / future idea | lowest |

### Step 3 — Suggest Assignee
Load space members from `GET /api/data`. Match by:
- Skill/area keywords in the issue description vs. members' past issues
- Member with fewest open `In Progress` issues (least loaded)
- If issue mentions a name explicitly → suggest that person

### Step 4 — Suggest Epic / Parent
Scan existing epics in the space. If the issue fits under an open epic (status != 'Done'), suggest setting `parent_id`.

### Step 5 — Sprint or Backlog
- If an active sprint exists and the issue is `high` or `highest` priority → suggest adding to active sprint
- Otherwise → recommend backlog with story points estimate

### Step 6 — Vagueness Check
If title is fewer than 5 words AND description is empty → flag: "This issue needs more detail before it can be triaged. Ask the reporter: What is the expected behavior? What actually happens? Steps to reproduce?"

### Output Format
```md
## Triage Result — [Issue Title]

| Field | Suggestion | Reason |
|-------|------------|--------|
| Type | bug | Contains "not working" in description |
| Priority | high | Core feature broken |
| Assignee | @name | Least loaded, matches frontend work |
| Parent | KEY-12 (Epic: Notifications) | Issue relates to notification flow |
| Placement | Active sprint | High priority, fits capacity |
| Story Points | 3 | Estimated scope: 1 component fix |

**Action needed:** [any missing fields or vagueness flags]
```
