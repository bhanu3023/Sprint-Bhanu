# API Conventions — Sprint Board

## Route Registration (server.js)
All routes follow this exact structure:
```js
app.METHOD('/api/resource', authenticate, async (req, res) => {
  try {
    // 1. Permission check (org role or space-member role)
    // 2. Input validation → 400
    // 3. pool.query(parameterized SQL)
    // 4. Side-effects: createNotif(), audit_logs INSERT
    // 5. res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

## Authentication Middleware
- All non-public routes must pass `authenticate` as the second argument
- `authenticate` reads `Authorization: Bearer <token>`, looks up `sessions` table, checks `expires_at`, attaches `req.user`
- Public routes (no `authenticate`): `POST /api/auth/login`, `GET /auth/microsoft`, `GET /api/auth/callback/microsoft`, `GET /api/auth/invite/:token`, `POST /api/auth/accept-invite`

## Permission Patterns
### Org-level (admin-only operations)
```js
if (req.user.role !== 'admin' && req.user.role !== 'owner') {
  return res.status(403).json({ error: 'Forbidden' })
}
```
### Space-member check (before returning space data)
```js
const membership = await pool.query(
  'SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2',
  [spaceId, req.user.id]
)
if (!membership.rows[0] && req.user.role !== 'admin') {
  return res.status(403).json({ error: 'Not a member of this space' })
}
```

## Response Shapes
```js
// 200 OK (list)
res.json({ items: rows, total: count })

// 200 OK (single resource)
res.json(row)

// 201 Created
res.status(201).json(newRow)

// 204 No Content (DELETE success)
res.status(204).send()

// 400 Bad Request
res.status(400).json({ error: 'title is required' })

// 401 Unauthorized
res.status(401).json({ error: 'Unauthorized' })

// 403 Forbidden
res.status(403).json({ error: 'Forbidden' })

// 404 Not Found
res.status(404).json({ error: 'Issue not found' })

// 409 Conflict
res.status(409).json({ error: 'Email already in use' })

// 500 Internal
res.status(500).json({ error: 'Internal server error' })
```

## Issue-Specific Rules
- Issue key generated server-side: fetch `spaces.issue_counter`, increment atomically, format as `{key}-{counter}`
- `PUT /api/issues/:id` must: fetch old values → update → write `issue_history` for each changed field → fire notifications
- Tracked fields for `issue_history`: `status`, `assignee_id`, `priority`, `sprint_id`, `due_date`, `story_points`
- Soft-delete: SET `deleted_at=NOW()`, `deleted_by=req.user.id` — never hard DELETE unless explicitly cleaning up

## Worklog Rules
- `user_id` for new worklogs = `req.user.id` always — never from `req.body.user_id`
- Only worklog owner or org admin/owner can PUT/DELETE a worklog
- `time_spent` stored in minutes; convert from "1h 30m" format before inserting

## Sprint Rules
- Only one sprint per space can have `status='active'` at a time
- `POST /api/sprints/:id/start`: check no existing active sprint for that space
- `POST /api/sprints/:id/complete`: calculate velocity (SUM story_points WHERE status='Done'), move incomplete issues to backlog (sprint_id=NULL), notify all space members

## Notifications
- Use `createNotif(userId, spaceId, type, title, body, link)` — never write INSERT directly into notifications outside this helper
- Always fire-and-forget — wrap in its own try/catch, never throw
- Types: `sprint_started`, `sprint_completed`, `issue_assigned`, `status_changed`, `comment_added`

## Audit Logs
- INSERT into `audit_logs` after any create/update/delete on issues, spaces, sprints
- Fields: `space_id`, `user_id=req.user.id`, `action` (created/updated/deleted), `entity_type` (issue/sprint/space), `entity_id`, `details` (jsonb with changed fields)

## Bulk Data Load
- `GET /api/data` — single endpoint that bulk-loads everything for the SPA on startup
- Returns: organizations, users, spaces (role-filtered), issues, sprints, worklogs, comments, notifications, custom_fields, saved_filters
- Never add slow JOINs here — the SPA joins in memory
