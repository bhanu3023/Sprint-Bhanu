# Sprint Board — Claude Project Context

## Project Overview
A Jira-like sprint management application. Teams can create projects, manage issues, run sprints, view kanban boards, track SLAs, and receive notifications.

GitHub: https://github.com/bhanu3023/Sprint-Bhanu.git

## Tech Stack
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Auth | NextAuth v4 + @auth/prisma-adapter |
| ORM | Prisma 5 |
| Database | PostgreSQL |
| UI | Radix UI + Tailwind CSS + shadcn/ui |
| State | Zustand |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| DnD | @hello-pangea/dnd |

## Project Structure
```
src/
  app/
    (app)/          # Authenticated routes (dashboard, projects, board…)
    (auth)/         # Public auth routes (login, signup, forgot-password)
    api/            # Next.js API route handlers
  components/
    admin/          # Admin-only UI
    auth/           # Auth forms
    backlog/        # Backlog view
    board/          # Kanban board (BoardCard, BoardColumn, BoardView)
    issues/         # Issue detail, list, create dialog
    layout/         # Sidebar, Topbar
    notifications/
    projects/
    reports/
    sla/            # SLA badge, config, report
    users/
  lib/
    api-helpers.ts  # Fetch wrappers used in client components
    auth.ts         # NextAuth config
    permissions.ts  # Role-based permission helpers
    prisma.ts       # Singleton Prisma client
    sla.ts          # SLA calculation logic
    validations/    # Zod schemas (auth, issue, project, sprint)
    hooks/          # React custom hooks
  types/index.ts    # Shared TypeScript types
prisma/
  schema.prisma     # Data model
  seed.ts           # Seed script
```

## Architecture Notes
- All API routes live under `src/app/api/` and follow REST conventions.
- Auth is session-based via NextAuth; check session server-side with `getServerSession(authOptions)`.
- Prisma client is a singleton in `src/lib/prisma.ts` — never import `PrismaClient` directly.
- Permission checks use helpers from `src/lib/permissions.ts` — always check before mutating data.
- SLA logic is pure and lives in `src/lib/sla.ts` — keep it free of Prisma calls.
- Zod schemas in `src/lib/validations/` are shared between API and client-side form validation.

## Coding Conventions
- Use TypeScript strict mode; avoid `any`.
- Prefer `async/await` over `.then()` chains.
- Server Components by default; add `"use client"` only when hooks or events are needed.
- API responses: `{ data }` on success, `{ error: string }` on failure with appropriate HTTP status.
- All DB mutations must go through an API route — never call Prisma from a Client Component.
- Use `cn()` from `src/lib/utils.ts` for conditional class names.
- Imports: absolute paths via `@/` alias.

## Hard Rules
- Never commit `.env` or `.env.local` — only `.env.example` is committed.
- Never use `prisma.$queryRawUnsafe` without parameterized input.
- Never skip NextAuth session validation in API routes that mutate data.
- Run `npm run lint` before committing.
- Run `npm run db:generate` after any schema change.
