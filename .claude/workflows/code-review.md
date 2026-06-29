# Workflow: Code Review — Sprint Board

Blueprint for reviewing a PR or set of changes.

## Steps

### 1. Understand the Change
- Read the PR description or ask what changed
- `git diff main...HEAD` — identify changed files
- Group: DB schema / server.js routes / app.js / index.html

### 2. DB Layer Review
- New columns: nullable? (safe for zero-downtime deploy)
- New indexes: added for WHERE/ORDER BY columns?
- Any DROP or destructive change? Needs explicit sign-off.

### 3. API Layer Review (server.js)
- Every new POST/PUT/DELETE: `authenticate` middleware present?
- Space-scoped routes: space-member lookup before returning data?
- All `pool.query` calls: `$1,$2` parameterized, no string interpolation?
- Issue update: `issue_history` INSERT for each tracked field?
- `createNotif()` called without `await` where needed?
- `audit_logs` INSERT present for create/update/delete?
- Every handler: `try/catch` returning `{ error: 'Internal server error' }`?
- No `password_hash` or `token` in SELECT columns returned to client?
- Worklog create/update: uses `req.user.id`, not `req.body.user_id`?
- Issue deletes: soft (`deleted_at=NOW()`), not hard DELETE?

### 4. Frontend Review (app.js)
- All API calls through `api()` helper?
- No inline `onclick=` on dynamic HTML?
- DOM elements null-checked before mutation?
- Status/priority colors use defined constants?

### 5. Security Pass
- Delegate to `@security-reviewer` with the diff
- Integrate findings before final verdict

### 6. Output
```md
## Review Results

| Severity | Route/Function | Line | Issue | Fix |
|----------|----------------|------|-------|-----|

Verdict: Ready to merge / Needs changes / Do not merge
```
