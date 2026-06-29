# Sprint Board — Claude Project Context

## What This Project Is
A Jira-like sprint management tool: Express.js REST API + PostgreSQL + single-page app (Vanilla JS).
Teams create Spaces (projects), manage Issues, run Sprints, view Kanban boards, log work time, track SLAs, upload attachments, and get notifications.

GitHub: https://github.com/bhanu3023/Sprint-Bhanu.git

## Tech Stack
| Layer | Technology |
|---|---|
| Server | Node.js + Express.js (`server.js`) |
| Database | PostgreSQL — raw `pg` pool queries, NO ORM |
| Auth | scrypt password hashing + 32-byte hex session tokens + Microsoft OAuth2 |
| Frontend | Vanilla JavaScript SPA (`app.js`) served from `index.html` |
| File Uploads | Multer (max 20 files per issue, stored in `uploads/`) |
| Email | Nodemailer — SMTP config from DB `organizations.email_settings` jsonb OR env vars |

## Database Tables & Key Fields
```
users             id (usr-{uuid}), org_id, name, email, avatar_url, color,
                  role (owner/admin/member), password_hash, is_active, last_login, theme

spaces            id, org_id, name, key (e.g. "PROJ"), description, icon, color,
                  space_type (scrum/kanban/hybrid), visibility (private/team/org),
                  owner_id, is_archived, issue_counter, created_at, updated_at

space_members     id, space_id, user_id, role (site_admin/manager/member/viewer)

sprints           id, space_id, name, goal, start_date, end_date,
                  status (planning/active/completed), velocity, position

issues            id, space_id, sprint_id, parent_id,
                  key (e.g. "PROJ-42"), title, description,
                  type (epic/story/task/bug/subtask),
                  status (To Do / In Progress / In Review / Done),
                  priority (highest/high/medium/low/lowest),
                  assignee_id, reporter_id, story_points, labels[],
                  start_date, due_date, original_estimate, time_spent (minutes),
                  position, team, product_type, deleted_at, deleted_by

comments          id, issue_id, user_id, body, created_at, updated_at
worklogs          id, issue_id, user_id, time_spent (minutes), work_date, description, is_billable
issue_history     id, issue_id, user_id, field_name, old_value, new_value, created_at
issue_links       id, source_id, target_id, link_type (relates_to)
issue_attachments id, issue_id, filename, original_name, size, mime_type, uploaded_by
custom_fields     id, space_id, name, field_type (text/textarea/number/date/select/multi_select/user/checkbox),
                  options (jsonb), is_required, position, show_in[]
issue_field_values id, issue_id, field_id, value
roadmap_items     id, title, description, status (planned), start_date, end_date,
                  space_id, issue_id, color, priority, assigned_to, group_name, category, milestone
notifications     id, user_id, space_id,
                  type (sprint_started/sprint_completed/issue_assigned/status_changed/comment_added),
                  title, body, is_read, link
sessions          id, user_id, token (32-byte hex), expires_at (7-day TTL)
invitations       id, email, org_id, invited_by, role, token, status (pending/accepted/expired/cancelled)
organizations     id, name, slug, logo_url, email_settings (jsonb)
audit_logs        id, space_id, user_id, action, entity_type, entity_id, details (jsonb)
saved_filters     id, space_id, user_id, name, conditions (jsonb), is_shared
```

## Issue Key Generation
`{SPACE_KEY}-{issue_counter}` (e.g. `PROJ-42`). `issue_counter` lives on `spaces` and is incremented atomically on every `POST /api/issues`.

## ID Conventions
- Users: `usr-{uuid}` prefix
- Sessions: `ses-{uuid}` prefix
- All other entities: plain UUID string

## Express Route Pattern (server.js)
```js
app.METHOD('/api/resource', authenticate, async (req, res) => {
  try {
    // 1. role / space-member permission check
    // 2. validate required fields → 400
    // 3. pool.query(sql, [params])  ← always parameterized
    // 4. createNotif(...)           ← fire-and-forget, never await in main path
    // 5. audit_logs INSERT if needed
    // 6. res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

## Auth Flow
- Login: `POST /api/auth/login` → scrypt verify → INSERT session → return `{ token, user }`
- Protected routes: `authenticate` middleware reads `Authorization: Bearer <token>` → queries `sessions` → attaches `req.user`
- Microsoft OAuth2: CSRF state validated in `GET /api/auth/callback/microsoft`
- **Worklogs always use `req.user.id`** — never accept user_id from the request body

## Role Hierarchy
- Org roles: `owner` > `admin` > `member`
- Space roles: `site_admin` > `manager` > `member` > `viewer`
- Permission check pattern: `req.user.role !== 'admin' && req.user.role !== 'owner'`

## Issue Update Side-Effects (must always maintain)
When `PUT /api/issues/:id` is called:
1. Fetch old field values from DB first
2. Run UPDATE
3. For each tracked changed field → INSERT into `issue_history`
4. If `assignee_id` changed → `createNotif(newAssignee, 'issue_assigned')`
5. If `status` changed → `createNotif(assignee, 'status_changed')`

## Sprint Complete Side-Effects
1. SUM story_points WHERE status='Done' → write to `sprints.velocity`
2. Move all non-Done issues → `sprint_id = NULL` (back to backlog)
3. Notify every space member: `sprint_completed`

## Frontend SPA (app.js)
- Global state object `S`: `currentUser`, `currentSpace`, `currentView`, `currentTab`, `drawerIssueId`, `awFilters`
- `api(url, method, body)` — fetch wrapper with `Bearer token` from localStorage
- `toast(msg, type)` — ephemeral notification toast
- `openDrawer(issueId)` — opens issue detail side pane
- `confirmDialog(msg)` — modal confirmation dialog
- STATUS_COLORS: `To Do=#42526e`, `In Progress=#0052cc`, `In Review=#ff991f`, `Done=#00875a`
- PRIORITY_COLORS: `highest=#dc2626`, `high=#ef4444`, `medium=#f59e0b`, `low=#3b82f6`, `lowest=#6b7280`

## Numeric Field Units
- `time_spent`, `original_estimate` → integers in **minutes**
- `story_points` → integer
- `position` → 0-based integer for ordering

## Array & JSON Columns
- `issues.labels` → PostgreSQL `text[]`
- `custom_fields.options`, `saved_filters.conditions`, `organizations.email_settings` → `jsonb`

## Hard Rules
- **Never string-interpolate SQL** — always use parameterized queries: `pool.query(sql, [p1, p2, ...])`
- **Never return 500 with raw error text** — always `{ error: 'Internal server error' }`
- **Never include `password_hash` or session `token` in any response**
- **Never accept `user_id` from request body for worklog creation** — use `req.user.id`
- **`createNotif()` is always fire-and-forget** — wrap in try/catch inside, never await in request path
- Soft-delete issues via `deleted_at` — never hard-DELETE without checking `deleted_at` null first
- Run `node --check server.js && node --check app.js` before committing
