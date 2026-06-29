# Workflow: Bug Fix — Sprint Board

Blueprint for diagnosing and fixing bugs in server.js / app.js.

## Steps

### 1. Reproduce
- Identify exact steps: which endpoint? request body? response received?
- Server error → check Node console for `console.error` output (raw pg error or JS exception)
- Wrong data → check the `pool.query` SQL and params array order
- Frontend bug → check the relevant view function in app.js

### 2. Locate
- Search server.js by route string: `app.get('/api/issues'` or `app.put('/api/sprints'`
- For permission bugs: check for missing `authenticate` or space-member check
- For notification bugs: check `createNotif()` call — type, userId, link correct?
- For frontend bugs: look at the `api()` call and the state update / re-render

### 3. Common Bug Patterns in This Project
- **Wrong $param order in pool.query** — values array doesn't match SQL `$1,$2` positions
- **Missing `deleted_at IS NULL`** — deleted issues appear in lists
- **issue_history not written** — forgot to fetch old values before UPDATE
- **Sprint active check missing** — multiple active sprints per space
- **`await createNotif()`** — notification failure returns 500 instead of succeeding silently
- **worklog user_id from req.body** — log attributed to wrong user

### 4. Fix
- Minimal change only — no refactoring around the bug
- Test the raw SQL query in psql before deploying
- Verify issue_history / sprint guards are still correct after the fix

### 5. Regression Test
- Delegate to `@test-writer` with the exact failing scenario
- Test must fail before the fix and pass after

### 6. PR
- `/project:review` on changed lines
- PR type = `fix`; description includes reproduction steps + root cause + fix
