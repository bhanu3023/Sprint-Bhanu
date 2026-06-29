# Skill: Code Review

## Description
Review Express.js route handlers and Vanilla JS frontend changes in this project for correctness, security, and convention compliance.

## Trigger Patterns
- "review this route"
- "check my changes"
- "any issues with server.js?"
- "audit this PR"
- "is this code correct?"

## Behavior

### For server.js routes, check each handler:
1. `authenticate` middleware present?
2. Org role check or space-member lookup before sensitive operations?
3. All SQL uses `$1, $2` parameters — no string interpolation?
4. `password_hash`, `token`, `session` fields excluded from SELECT?
5. Issue updates write to `issue_history` for tracked fields (status, assignee_id, priority, sprint_id, due_date, story_points)?
6. `createNotif()` used (not inline INSERT to notifications table) and fire-and-forget?
7. `try/catch` present with `res.status(500).json({ error: 'Internal server error' })`?
8. Worklog creation uses `req.user.id` not `req.body.user_id`?
9. Soft-delete used (`deleted_at=NOW()`) not hard DELETE for issues?

### For app.js frontend:
1. API calls go through `api()` helper — not raw `fetch`?
2. No inline `onclick=` on dynamically generated HTML (XSS risk)?
3. DOM elements checked for null before mutation?
4. Status/priority colors use `STATUS_COLORS` / `PRIORITY_COLORS` constants?

## Output
Findings table: Severity | Route/Function | Line | Issue | Suggested Fix
Final verdict: Ready to merge / Needs changes
