# Code Style — Sprint Board

## JavaScript (server.js)
- Use `async/await` — never `.then()` chains inside route handlers
- Use `const` for everything except loop counters; no `var`
- Always destructure from `req.body`, `req.params`, `req.query` at the top of the handler:
  ```js
  const { title, description, type, status, priority, assignee_id } = req.body
  const { id } = req.params
  ```
- Required field validation before any DB call:
  ```js
  if (!title || !space_id) return res.status(400).json({ error: 'title and space_id are required' })
  ```
- Never use `==` — always `===`
- Use template literals for SQL strings (multi-line), never string concatenation

## SQL Queries
- Always parameterized — `$1, $2, ...` with values array:
  ```js
  const result = await pool.query(
    'UPDATE issues SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [status, id]
  )
  ```
- Column aliases in SELECT use snake_case matching the JS field names
- For conditional WHERE clauses build arrays:
  ```js
  const conditions = ['space_id=$1']
  const params = [spaceId]
  if (status) { conditions.push(`status=$${params.length+1}`); params.push(status) }
  const sql = `SELECT * FROM issues WHERE ${conditions.join(' AND ')}`
  ```
- Never SELECT * in production queries — list columns explicitly to avoid returning sensitive fields

## Naming Conventions
- Route handlers: descriptive inline `async (req, res) =>` — no named function expressions
- Variables: `camelCase` (JS), `snake_case` matches DB column names when destructuring results
- Constants: `SCREAMING_SNAKE_CASE` at module top (e.g. `STATUS_COLORS`, `PRIORITY_COLORS`)
- Helper functions: `camelCase` verb + noun (e.g. `createNotif`, `sendEmail`, `authenticate`)

## Error Handling
- Every async route must have `try/catch`
- `catch (err)`: `console.error(err)` then `res.status(500).json({ error: 'Internal server error' })`
- Never expose `err.message` or stack trace in the response
- Specific errors before the catch: 400 (bad input), 401 (no/expired session), 403 (permission), 404 (not found), 409 (conflict — e.g. duplicate email)

## Frontend (app.js)
- All API calls go through the `api()` helper — never use raw `fetch` directly
- DOM updates: query the element, check it exists, then set `.innerHTML` or `.textContent`
- Event listeners added via `addEventListener` — never inline `onclick=` in dynamically generated HTML (XSS risk)
- State changes: update global `S` object then call the relevant render function

## Comments
- Only add a comment for non-obvious WHY: a workaround, a constraint, an invariant
- Never comment what the code does — the code shows that
- Microsoft OAuth2 CSRF workaround and email TLS workaround are already documented; don't re-explain them
