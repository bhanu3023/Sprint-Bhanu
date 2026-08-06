# SprintBoard — QA Test Accounts & Scenarios

## Run seed + tests

```bash
npm run seed-qa          # Add comprehensive QA dummy data
npm run test-scenarios   # Run automated API scenario tests (server must be running)
```

## Test accounts (password: `Test@12345`)

| Email | Role | Use for |
|---|---|---|
| `qa-owner@test.local` | Org owner | Full admin, all spaces, create spaces |
| `qa-admin@test.local` | Org admin | User mgmt, invitations, email settings |
| `qa-member@test.local` | Space member | Day-to-day issue/sprint/comment/worklog tests |
| `qa-viewer@test.local` | Space viewer | Read-only access in QAT space |
| `qa-manager@test.local` | Space manager | Manager permissions in QAT space |
| `qa-siteadmin@test.local` | Space site_admin | Space admin settings |
| `qa-inactive@test.local` | Deactivated | Login should fail (403) |
| `qa-nospaces@test.local` | Member, no spaces | Empty workspace test |
| **`manmadha.jayamangala@cloudfuze.com`** | **Admin (Microsoft login)** | **Your primary account — sign in via Microsoft on login page** |

## Original seed accounts

| Email | Password | Role |
|---|---|---|
| `sarah@neutara.dev` | `password123` | Owner |
| `alex@neutara.dev` | `password123` | Admin |
| `sujana.manapuram@cloudfuze.com` | `Neutara@2025` | Admin |

## QA Test Lab space (key: `QAT`)

- All issue types: epic, story, task, bug, subtask
- All statuses: To Do, In Progress, In Review, Done, Blocked
- 3 sprints: completed, active, planning
- Custom fields (7 types), saved filters, roadmap items
- Invitations: pending, expired, cancelled, accepted
- Notifications: assigned, status_changed, comment, sprint_started/completed, mention
- Soft-deleted issue: `QAT-DEL`
- Archived space: `ARC`

## Manual UI test checklist

1. **Login** — http://localhost:3000/login.html (Microsoft OAuth or API login)
2. **Board** — drag issues between columns (To Do → In Progress → Done)
3. **Sprint** — start/complete sprint in QAT space
4. **Issue drawer** — open QAT-2, edit fields, add comment, log work
5. **Reports** — velocity, burndown, spillover for QA Sprint 2
6. **Roadmap** — view Q1 Platform Launch milestone
7. **Admin** — login as qa-admin, manage users & invitations
8. **Viewer** — login as qa-viewer, confirm limited edit access
9. **Notifications** — bell icon shows QA test notifications

## API login (for Postman/curl)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qa-member@test.local","password":"Test@12345"}'
```

Use returned `token` as `Authorization: Bearer <token>`.
