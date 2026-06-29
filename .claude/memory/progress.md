# Progress Log — Sprint Board

## Implemented
- [x] Auth: email/password (scrypt), session tokens, Microsoft OAuth2, invitation flow
- [x] Organizations: single org, email settings (SMTP from DB or env), logo
- [x] Spaces: create/update/archive, visibility (private/team/org), types (scrum/kanban/hybrid)
- [x] Space Members: roles (site_admin/manager/member/viewer)
- [x] Issues: full CRUD, auto-key `{KEY}-{n}`, soft delete, bulk update
- [x] Issue Detail: subtasks (parent_id), links (relates_to), custom field values
- [x] Issue History: field-level tracking (status, assignee, priority, sprint, due_date, story_points)
- [x] Comments: create/edit/delete, triggers comment_added notification
- [x] Worklogs: time logging in minutes, update/delete (owner or admin only)
- [x] Attachments: Multer upload (max 20), rename, delete
- [x] Sprints: create/start (one active at a time)/complete (velocity + backlog move)/delete
- [x] Kanban Board: status columns, position-based ordering
- [x] Roadmap: items linked to spaces/issues with date ranges
- [x] Custom Fields: per-space typed fields, values in issue_field_values
- [x] Saved Filters: per-user or shared, conditions as jsonb
- [x] Notifications: 5 types, unread-first, mark read/all-read
- [x] Reports: sprint stats, velocity, burndown, status/priority breakdown, workload, cycle time
- [x] Audit Logs: create/update/delete on issues, spaces, sprints
- [x] Search: cross-space ILIKE on title/description
- [x] Admin: user management, roles, deactivation, invitations

## Backlog / Known Gaps
- [ ] Real-time notifications (currently polling) — WebSocket or SSE
- [ ] Email notifications for issue events (only in-app today)
- [ ] Test suite — `tests/` directory does not exist yet
- [ ] Cloud file storage (currently local `uploads/`)
- [ ] Rate limiting on `POST /api/auth/login`
- [ ] PostgreSQL full-text search (currently ILIKE)
- [ ] Multi-org support
- [ ] E2E tests with Playwright

## Session Notes
- 2026-06-29: Claude Code structure created. All .md files rewritten to reflect actual Express.js + PostgreSQL + Vanilla JS stack.
