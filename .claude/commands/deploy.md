# /project:deploy — Deploy Checklist

Run pre-deploy validation and confirm the server is ready.

## Usage
```
/project:deploy
/project:deploy --check-only
```

## Steps
1. `node --check server.js` — must pass with zero errors
2. `node --check app.js` — must pass with zero errors
3. Check `.env.example` is up to date with all required vars:
   - `DATABASE_URL`, `SESSION_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (fallback if DB email_settings not set)
4. Verify `uploads/` directory exists and is writable
5. Verify DB connection: `SELECT 1` via pool
6. Check all required tables exist: `users`, `spaces`, `issues`, `sprints`, `sessions`, `notifications`, `audit_logs`
7. If `--check-only`: stop and report results
8. Otherwise: prompt for confirmation before proceeding

## Rollback Plan
```bash
git revert HEAD
pm2 restart sprint-board   # or however the process is managed
```

## Post-Deploy Verify
- `GET /api/auth/me` with a valid token returns user data
- `GET /api/data` returns spaces and issues
- File upload to `POST /api/issues/:id/attachments` succeeds
- `GET /api/notifications` returns correct unread-first list
