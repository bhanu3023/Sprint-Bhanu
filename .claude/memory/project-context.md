# Project Context

## What This Project Is
Sprint Board — a Jira-like sprint management tool. Users can create projects, manage issues across sprints, view kanban boards, configure SLAs, and receive notifications when assigned or mentioned.

## Current State
- Core features implemented: auth, projects, issues, board, backlog, sprints, reports, SLA, notifications, admin.
- GitHub: https://github.com/bhanu3023/Sprint-Bhanu.git
- Running on Next.js 14 App Router + Prisma + PostgreSQL.

## Key Design Decisions
- **App Router** selected over Pages Router for server components and improved data fetching.
- **NextAuth v4** used because `@auth/prisma-adapter` was stable at project start.
- **Zustand** for global client state (e.g., notification count, active project).
- **Zod** schemas live in `src/lib/validations/` and are shared between API and form validation.
- **SLA logic** kept pure in `src/lib/sla.ts` — no DB calls — to allow easy unit testing.

## Active Work Areas
(Update this as work progresses)
- [ ] E2E test setup with Playwright
- [ ] Real-time notifications via WebSocket or Server-Sent Events
- [ ] Sprint velocity chart improvements

## Known Constraints
- Prisma does not support array fields in SQLite — production must use PostgreSQL.
- NextAuth session is stored in the DB via Prisma adapter — session table must exist.
- `@hello-pangea/dnd` requires `"use client"` on the Board component tree.
