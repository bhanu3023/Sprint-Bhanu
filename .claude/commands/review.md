# /project:review — Code Review

Review changed routes or files in server.js / app.js for correctness, security, and conventions.

## Usage
```
/project:review
/project:review server.js
/project:review $ARGUMENTS
```

## Steps
1. Read the target file or run `git diff HEAD` if no argument
2. For each changed route in `server.js`, check:
   - Is `authenticate` middleware present?
   - Is there a permission check (org role or space-member lookup)?
   - Is SQL parameterized (`$1, $2`)? Flag any string interpolation as **Critical**
   - Is `password_hash` or `token` excluded from the response SELECT?
   - Does issue update write to `issue_history` for tracked fields?
   - Is `createNotif()` fire-and-forget (not awaited in response path)?
   - Does route have `try/catch` returning `{ error: 'Internal server error' }` on 500?
3. For worklog routes: verify `user_id` is NOT accepted from `req.body`
4. For sprint complete route: verify velocity calc and backlog move
5. Delegate full security pass to `@security-reviewer`
6. Output findings table by severity

## Output Format
```md
## Review: <file or "current diff">

| Severity | Route | Line | Issue | Fix |
|----------|-------|------|-------|-----|
| Critical | PUT /api/issues/:id | 416 | SQL string interpolation | Use $1 param |
| High | POST /api/worklogs | 537 | Accepts user_id from body | Use req.user.id |

**Verdict:** Ready / Needs changes
```
