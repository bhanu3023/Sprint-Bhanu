# /project:review — Code Review

Reviews changed routes in server.js against all project rules.

## Usage
```
/project:review
/project:review server.js
/project:review $ARGUMENTS
```

## Steps
1. Read the target file or run `git diff HEAD` if no argument given
2. For every changed route check:
   - `authenticate` middleware present?
   - Space-member lookup before returning space-scoped data?
   - All `pool.query` calls parameterized with `$1,$2`? Flag any `${}` interpolation as **Critical**
   - `password_hash` or `token` excluded from SELECT columns?
   - Issue UPDATE routes write to `issue_history` for tracked fields?
   - `createNotif()` called without `await`?
   - `try/catch` present returning `{ error: 'Internal server error' }` on 500?
   - Worklog routes use `req.user.id` not `req.body.user_id`?
   - Issue deletes use soft-delete (`deleted_at=NOW()`) not hard DELETE?
3. Check sprint routes: one-active-sprint guard present? velocity calculated on complete?
4. Check notification routes: actor excluded from broadcast?

## Output
```md
## Review Results — <file>

| Severity | Route | Line | Issue | Fix |
|----------|-------|------|-------|-----|
| Critical | PUT /api/issues/:id | 416 | SQL interpolation | Use $1 param |
| High | POST /api/sprints/:id/complete | 304 | No auth middleware | Add authenticate |

**Verdict:** Ready to merge / Needs changes
```
