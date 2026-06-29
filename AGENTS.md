# Agent Roster — Sprint Board

## db-query-optimizer
**Role:** Analyzes `pool.query()` calls in server.js for missing indexes, slow patterns, and N+1 queries.
**When to delegate:** When a route feels slow, when adding a new table/column, or before a production release.
**Returns:** Table of missing indexes with ready-to-run `CREATE INDEX` SQL + slow query pattern list with rewrites.
**File:** `.claude/agents/db-query-optimizer.md`

## api-documenter
**Role:** Reads all `app.METHOD()` routes in server.js and generates a complete REST API reference.
**When to delegate:** After adding/changing routes, when onboarding a new team member, or when frontend needs API specs.
**Returns:** Full markdown API reference grouped by resource (Auth, Issues, Sprints, Worklogs, etc.) with request/response shapes and side effects documented.
**File:** `.claude/agents/api-documenter.md`

## board-state-debugger
**Role:** Diagnoses kanban board ordering issues, empty columns, sprint assignment bugs, and drag-drop persistence failures.
**When to delegate:** When the board shows wrong order, columns are empty despite data existing, or drag-drop changes don't save.
**Returns:** Root cause diagnosis with the exact server.js or app.js line + specific fix + how to verify.
**File:** `.claude/agents/board-state-debugger.md`

## Coordination Protocol
1. Main session identifies which agent fits the problem.
2. Main session provides a self-contained prompt with symptom, file, and context.
3. Agent returns its structured output.
4. Main session applies the fix — agents do not write code directly unless they have the Write tool.
5. Agents do NOT call each other.
