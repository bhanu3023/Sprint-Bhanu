# Project Context — Sprint Board

## What This Is
A Jira-like sprint management tool: Express.js + PostgreSQL + Vanilla JS SPA.
Single server file (`server.js`), single frontend (`app.js`), served from `index.html`.

GitHub: https://github.com/bhanu3023/Sprint-Bhanu.git

## Core Entity Relationships
```
organizations → users → spaces (projects)
spaces → space_members (access control + roles)
spaces → sprints → issues
issues → comments, worklogs, issue_history, issue_links, issue_attachments
issues → issue_field_values (for custom_fields)
spaces → custom_fields, saved_filters, roadmap_items
users → notifications, sessions, invitations
```

## Issue Lifecycle
- Created with auto-generated key (`{SPACE_KEY}-{issue_counter}`), default status `To Do`
- Assigned to sprint or stays in backlog (`sprint_id=NULL`)
- Field changes tracked in `issue_history` (status, assignee, priority, sprint, due_date, story_points)
- Soft-deleted via `deleted_at` — never hard-deleted
- Notifications: `issue_assigned`, `status_changed`, `comment_added`

## Sprint Lifecycle
- Created: `status='planning'`
- Started: `POST /api/sprints/:id/start` → `status='active'` (only one per space at a time)
- Completed: `POST /api/sprints/:id/complete` → velocity=SUM(story_points WHERE Done), incomplete issues→backlog, all space members notified

## Auth System
- Email+password: scrypt hash, 32-byte hex token, 7-day session in `sessions` table
- Microsoft OAuth2: state CSRF validated at callback
- Invitations: token-based, one-time use, marked `accepted` on use

## Notification System
- `createNotif()` helper — fire-and-forget, never throws, never awaited in request path
- Fetched via `GET /api/notifications` (limit 100, unread first)
- Types: `sprint_started`, `sprint_completed`, `issue_assigned`, `status_changed`, `comment_added`

## Known Constraints
- All business logic in `server.js` — no controller/service split
- Frontend: Vanilla JS SPA, all state in global `S` object, no framework/bundler
- File uploads: local `uploads/` directory via Multer — not cloud storage
- No real-time: SPA polls for notifications
- PostgreSQL only — uses `text[]` arrays and `jsonb`
