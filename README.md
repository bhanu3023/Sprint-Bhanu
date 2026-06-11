# SprintBoard — Full-Stack Jira-like Sprint Management

A production-ready, full-stack sprint board application built with **Next.js 14**, **PostgreSQL**, **Prisma**, and **Tailwind CSS**.

---

## Features

- **Authentication** — Sign up, login, forgot/reset password with JWT sessions
- **Role-Based Access Control** — Global roles (Super Admin, Admin, Member) + Project roles (Owner, Admin, Scrum Master, Member, Viewer)
- **Project Management** — Create projects with custom keys (e.g. DEV-1), colors, and team members
- **Scrum Board** — Drag-and-drop Kanban board with workflow transition validation and WIP limits
- **Sprint Lifecycle** — Create → Start → Complete sprints; move incomplete issues to next sprint/backlog
- **Backlog** — Drag issues between sprints and backlog with fractional ordering
- **Issue Tracking** — Full fields: type, priority, status, assignee, reporter, story points, due date, labels, subtasks, comments
- **Workflow Engine** — Custom statuses, allowed transitions, role-restricted transitions
- **Reports** — Burndown chart, velocity tracking, issues by status/type/priority/assignee
- **Notifications** — In-app notification center with 30s polling (assigned, commented, sprint events)
- **Audit Logs** — Full activity history per project
- **Global Search** — Search issues, projects, and users
- **Admin Panel** — System-wide user and project management
- **Dark Mode** — Full light/dark theme toggle
- **Responsive** — Works on desktop and mobile

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma 5 |
| Auth | NextAuth.js v4 (JWT + Credentials) |
| Styling | Tailwind CSS |
| Drag & Drop | @hello-pangea/dnd |
| Charts | Recharts |
| State | Zustand (board) + React state |
| Forms | React Hook Form + Zod |
| Toasts | react-hot-toast |
| Icons | Lucide React |
| Theme | next-themes |

---

## Prerequisites

- **Node.js** v18+ (v20 recommended)
- **PostgreSQL** v14+ running locally or remotely
- **npm** or **yarn** or **pnpm**

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd sprint-board
npm install
```

### 2. Set up environment variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values:

```env
# Database — PostgreSQL connection string
DATABASE_URL="postgresql://postgres:password@localhost:5432/sprintboard"

# NextAuth — generate a secret with: openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-super-secret-key-here"
```

### 3. Set up the database

**Option A: Push schema (recommended for development)**

```bash
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to database (creates tables)
npm run db:seed       # Seed with demo data
```

**Option B: Run migrations**

```bash
npm run db:generate
npm run db:migrate    # Creates and applies migrations
npm run db:seed
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Demo Accounts

After seeding (`npm run db:seed`), the following accounts are available:

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | password123 | Super Admin |
| pm@example.com | password123 | Member (Project Manager in DEV) |
| dev1@example.com | password123 | Member (Developer in DEV) |
| dev2@example.com | password123 | Member (Developer in DEV) |
| designer@example.com | password123 | Member (Designer in DEV) |
| viewer@example.com | password123 | Member (Viewer in DEV) |

The seed also creates:
- **3 projects**: DEV (software team), MKT (marketing), OPS (operations)
- **15 sample issues** across epics, stories, tasks, bugs, subtasks
- **3 sprints**: 1 completed, 1 active (Sprint 2), 1 planned
- **Comments, notifications, audit logs**

---

## Project Structure

```
sprint-board/
├── prisma/
│   ├── schema.prisma          # Full database schema
│   └── seed.ts                # Demo data seeder
├── src/
│   ├── app/
│   │   ├── (auth)/            # Unauthenticated pages (login, signup, etc.)
│   │   ├── (app)/             # Authenticated pages
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   │   ├── [projectKey]/
│   │   │   │   │   ├── board/       # Kanban board
│   │   │   │   │   ├── backlog/     # Sprint backlog
│   │   │   │   │   ├── sprints/     # Sprint list
│   │   │   │   │   ├── issues/      # Issues list + detail
│   │   │   │   │   ├── reports/     # Analytics
│   │   │   │   │   ├── settings/    # Project settings
│   │   │   │   │   └── activity/    # Audit log
│   │   │   ├── users/         # User list + profiles
│   │   │   ├── notifications/ # Notification center
│   │   │   ├── search/        # Global search
│   │   │   ├── profile/       # My profile
│   │   │   └── admin/         # Admin panel
│   │   └── api/               # REST API routes
│   │       ├── auth/          # NextAuth endpoints
│   │       ├── projects/      # Project CRUD + members, columns, workflow
│   │       ├── issues/        # Issue CRUD + comments, transitions, watchers, subtasks
│   │       ├── sprints/       # Sprint lifecycle (start, complete)
│   │       ├── board/         # Board state + drag-drop reorder
│   │       ├── backlog/       # Backlog + move to sprint
│   │       ├── notifications/ # Notification management
│   │       ├── reports/       # Burndown + velocity
│   │       ├── search/        # Global search
│   │       ├── dashboard/     # Dashboard stats
│   │       └── users/         # User management
│   ├── components/
│   │   ├── auth/              # Login, signup, forgot password forms
│   │   ├── board/             # BoardView, BoardColumn, BoardCard
│   │   ├── backlog/           # BacklogView
│   │   ├── issues/            # CreateIssueDialog, IssueDetailSheet, IssueDetailPage, IssuesListView
│   │   ├── reports/           # ReportsView (burndown + charts)
│   │   ├── projects/          # ProjectsView, ProjectSettingsView
│   │   ├── users/             # UsersView
│   │   ├── notifications/     # NotificationsView
│   │   ├── profile/           # ProfileView
│   │   └── layout/            # Sidebar, Topbar
│   ├── lib/
│   │   ├── auth.ts            # NextAuth config + getSession helper
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── utils.ts           # cn(), formatDate, colors, constants
│   │   ├── api-helpers.ts     # Response helpers, generateIssueKey, getProjectRole
│   │   └── permissions.ts     # RBAC: canPerformAction, assertPermission
│   ├── types/
│   │   └── index.ts           # TypeScript types + NextAuth augmentation
│   └── middleware.ts          # Route protection via NextAuth
```

---

## Available Scripts

```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

npm run db:generate  # Generate Prisma client after schema changes
npm run db:push      # Push schema changes to DB (no migration files)
npm run db:migrate   # Create and apply migrations
npm run db:seed      # Seed demo data
npm run db:studio    # Open Prisma Studio (database GUI) at http://localhost:5555
npm run db:reset     # DANGER: Drop all data + re-seed
```

---

## API Reference

All API routes are under `/api/` and return JSON with the shape:

```json
{ "data": <result>, "error": "<message if error>" }
```

### Authentication
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/signin` | NextAuth credential sign in |
| POST | `/api/auth/signup` | Register new user |

### Projects
| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/projects` | List all / create project |
| GET/PATCH/DELETE | `/api/projects/[key]` | Get / update / delete project |
| GET/POST/DELETE | `/api/projects/[key]/members` | Manage project members |
| GET/POST/PUT | `/api/projects/[key]/columns` | Board columns config |
| GET/POST/DELETE | `/api/projects/[key]/workflow` | Statuses & transitions |

### Issues
| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/issues` | List / create issues |
| GET/PATCH/DELETE | `/api/issues/[key]` | Get / update / delete issue |
| GET/POST | `/api/issues/[key]/comments` | Comments |
| POST | `/api/issues/[key]/transitions` | Apply status transition |
| GET/POST/DELETE | `/api/issues/[key]/watchers` | Watch / unwatch issue |
| GET/POST | `/api/issues/[key]/subtasks` | Subtasks |

### Sprints
| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/sprints` | List / create sprints |
| GET/PATCH/DELETE | `/api/sprints/[id]` | Get / update / delete sprint |
| POST | `/api/sprints/[id]/start` | Start sprint |
| POST | `/api/sprints/[id]/complete` | Complete sprint (moves incomplete issues) |

### Board & Backlog
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/board/[key]` | Get board state for active sprint |
| POST | `/api/board/[key]/reorder` | Drag-drop reorder with transition validation |
| GET | `/api/backlog/[key]` | Get backlog + all sprints |
| POST | `/api/backlog/[key]/move` | Move issue between sprint/backlog |

### Reports
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/reports/[key]/burndown?sprintId=` | Burndown chart data |
| GET | `/api/reports/[key]/velocity` | Velocity across sprints |

### Other
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/search?q=&type=` | Global search (issues/projects/users) |
| GET | `/api/dashboard` | Dashboard stats for current user |
| GET/PATCH | `/api/notifications` | List / mark all read |
| PATCH/DELETE | `/api/notifications/[id]` | Mark read / delete notification |
| GET/PATCH | `/api/users/me` | Current user profile |
| GET/PATCH/DELETE | `/api/users/[id]` | User management |

---

## Database Schema Overview

Key models in `prisma/schema.prisma`:

- **User** — Auth + profile, global role (SUPER_ADMIN/ADMIN/MEMBER)
- **Project** — key, name, type, issueCounter for atomic key generation
- **ProjectMember** — user ↔ project with ProjectRole
- **WorkflowStatus** — custom per-project statuses with category (TODO/IN_PROGRESS/DONE)
- **WorkflowTransition** — allowed status transitions (from → to, optional requiredRole)
- **BoardColumn** — one column per status, with optional WIP limit
- **Sprint** — PLANNED/ACTIVE/COMPLETED lifecycle, start/end dates, goal
- **Issue** — full issue model with parent/subtask hierarchy, fractional `order` float
- **Comment** — threaded comments on issues
- **Notification** — per-user in-app notifications
- **AuditLog** — complete audit trail of all actions

---

## Configuration Notes

### Workflow Transitions

Workflow transitions are stored in `WorkflowTransition`. The board enforces that drag-drop moves between columns are only valid if a transition exists from the source status to the target status. Invalid moves are rejected with a 400 error and rolled back on the frontend.

### Issue Key Generation

Issue keys (e.g. `DEV-42`) are generated atomically using a Prisma transaction that increments `Project.issueCounter` and uses the new value as the key. This prevents duplicate keys under concurrent load.

### Optimistic Board Updates

The drag-drop board performs optimistic updates — the UI moves the card immediately, then syncs with the server. If the server rejects the move (e.g. transition not allowed), the board snaps back to the previous state.

---

## Deployment

### PostgreSQL

Ensure your `DATABASE_URL` in production points to your PostgreSQL instance. For production, use migrations rather than `db:push`:

```bash
npx prisma migrate deploy
```

### Environment Variables (production)

```env
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="<strong random secret>"
```

### Vercel

1. Connect your GitHub repo to Vercel
2. Add environment variables in the Vercel dashboard
3. Vercel will auto-run `next build` on each push

---

## License

MIT
