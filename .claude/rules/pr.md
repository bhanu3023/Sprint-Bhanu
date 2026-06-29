# Pull Request Standards — Sprint Board

## PR Title Format
```
<type>(<scope>): <short description>
```
Types: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `perf`
Scopes: `issues` | `sprints` | `board` | `auth` | `worklogs` | `notifications` | `roadmap` | `attachments` | `custom-fields` | `reports` | `filters` | `frontend` | `db`

**Examples:**
- `feat(issues): add bulk status update endpoint`
- `fix(sprints): prevent multiple active sprints per space`
- `fix(worklogs): always use req.user.id instead of body.user_id`
- `feat(notifications): add comment_added notification on new comment`
- `perf(reports): add index on issue_history.issue_id`
- `chore(db): add deleted_at index on issues table`

## PR Description Template
```md
## Summary
- What changed and why (bullet points)

## Changes
- `server.js` lines X–Y: description of change
- DB schema change: (new table/column/index, or none)
- API contract change: (new/modified endpoint, or none)
- Frontend change: (app.js / index.html, or none)

## Side Effects to Verify
- [ ] issue_history INSERT fires for tracked field changes
- [ ] createNotif() called correctly (fire-and-forget)
- [ ] audit_logs INSERT present
- [ ] sprint velocity recalculated on complete
- [ ] soft-delete used (deleted_at), not hard DELETE

## Test Plan
- [ ] Manually tested with Postman / curl: [steps]
- [ ] Tests added in `tests/routes/`
- [ ] Edge cases: missing auth, wrong role, missing required field

## Screenshots
(For frontend changes — before and after)
```

## Pre-PR Checklist
- [ ] `node --check server.js` passes (no syntax errors)
- [ ] No raw string-interpolated SQL (all `$1, $2` parameterized)
- [ ] No `password_hash` or `token` in any response body
- [ ] `authenticate` middleware on every new protected route
- [ ] Space-member permission check before returning space-scoped data
- [ ] `createNotif()` is fire-and-forget (not awaited in request path)
- [ ] `.env` not committed — only `.env.example`
- [ ] No `console.log` debug statements left in production paths

## Merge Strategy
- Squash and merge for feature and fix branches
- Merge commit for release branches
- Never force-push to `main`
