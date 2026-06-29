# /project:deploy — Pre-Deploy Checklist

Validates the project is ready to deploy to production.

## Usage
```
/project:deploy
/project:deploy --check-only
```

## Steps
1. `node --check server.js` — must pass with zero syntax errors
2. `node --check app.js` — must pass with zero syntax errors
3. Check all required env vars exist in `.env`:
   - `DATABASE_URL`, `SESSION_SECRET`
   - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
4. Verify `uploads/` directory exists and is writable
5. Test DB connection: `SELECT 1` via pool
6. Verify all required tables exist: `users`, `spaces`, `issues`, `sprints`, `sessions`, `notifications`, `audit_logs`, `worklogs`, `comments`, `issue_history`
7. Check no active sessions will break (token format unchanged)
8. If `--check-only` → stop and report. Otherwise prompt for confirmation before proceeding.

## Output
```md
## Deploy Checklist

| Check | Status | Detail |
|-------|--------|--------|
| server.js syntax | ✅ / ❌ | |
| app.js syntax | ✅ / ❌ | |
| Env vars | ✅ / ❌ | Missing: X, Y |
| uploads/ writable | ✅ / ❌ | |
| DB connection | ✅ / ❌ | |
| Required tables | ✅ / ❌ | Missing: X |

**Result:** Ready to deploy / NOT ready — fix X first
```

## Rollback
```bash
git revert HEAD
pm2 restart sprint-board
```
