# Workflow: Feature Build — Sprint Board

Blueprint for adding a new feature to this Express.js + PostgreSQL + Vanilla JS project.

## Steps

### 1. Design
- Which entities does this touch? (issues, sprints, spaces, users, custom_fields?)
- DB changes needed: new table, column, or index?
- API contract: endpoint path, method, request body, response shape
- Where does it appear in the SPA? (which view function in app.js?)

### 2. Database
- Write `ALTER TABLE` or `CREATE TABLE` SQL manually (no migration tool exists)
- Add index if the column appears in WHERE or ORDER BY
- Test the SQL directly in psql first
- Document the change in `CLAUDE.md` under "Database Tables & Key Fields"

### 3. API Route (server.js)
Follow the pattern in `.claude/rules/api-conventions.md`:
1. `authenticate` middleware
2. Permission check (org role or space-member lookup)
3. Input validation → 400
4. `pool.query(parameterized SQL)`
5. `createNotif()` fire-and-forget if user-facing event
6. `audit_logs` INSERT
7. `res.json(result)`
- If the SPA needs this on startup, add to `GET /api/data`
- Test with curl before touching frontend

### 4. Frontend (app.js / index.html)
- All API calls through `api()` helper
- Update global `S` state on success, re-render the affected view
- Use `STATUS_COLORS` / `PRIORITY_COLORS` constants for colored elements
- No inline `onclick=` on dynamically built HTML — use `addEventListener`

### 5. Test
- Delegate to `@test-writer` with the new route path and method
- Manually verify with Postman: happy path + 401 + 403 + 400

### 6. Review
- `/project:review` on changed server.js sections
- `@security-reviewer` if new routes added
- `node --check server.js && node --check app.js`

### 7. PR
- `/project:pr-description` to generate description
- Push and open PR following `.claude/rules/pr.md`
