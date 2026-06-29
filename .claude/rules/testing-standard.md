# Testing Standards — Sprint Board

## Test Tooling
- **HTTP layer:** Supertest (`npm i -D supertest`) against the Express app
- **Unit tests:** Jest with mocked `pg` pool
- **DB integration:** Jest with a real test PostgreSQL database (separate from dev DB)
- **E2E:** Not yet configured — Playwright is planned

## File Placement
```
tests/
  routes/
    issues.test.js      ← PUT/POST/DELETE /api/issues
    sprints.test.js     ← sprint lifecycle tests
    auth.test.js        ← login, token expiry, OAuth
    worklogs.test.js    ← time logging rules
  helpers/
    fixtures.js         ← create test user, space, issue helpers
    pool-mock.js        ← jest mock for pg pool
```

## What to Test Per Route
Every Express route needs:
- **Happy path** — valid token, valid body, correct DB response
- **No token** → 401
- **Expired token** → 401
- **Wrong org role** (member doing admin action) → 403
- **Not a space member** → 403
- **Missing required field** → 400 with clear error message
- **Resource not found** → 404

## Issue-Specific Test Scenarios
- `PUT /api/issues/:id` changing `status` → verify `issue_history` INSERT and `createNotif` called
- `PUT /api/issues/:id` changing `assignee_id` → verify notification to new assignee
- `POST /api/issues` → verify `issue_counter` incremented and key formatted as `{KEY}-{n}`
- Soft delete: `deleted_at` set, issue excluded from list queries

## Sprint-Specific Test Scenarios
- `POST /api/sprints/:id/start` when another sprint is already active → 400
- `POST /api/sprints/:id/complete` → verify velocity calculation, incomplete issues moved to backlog, space members notified

## Worklog Test Scenarios
- `POST /api/worklogs` with `user_id` in body → verify server uses `req.user.id` instead
- `DELETE /api/worklogs/:id` by non-owner non-admin → 403

## Mocking Pattern (pg pool mock)
```js
// tests/helpers/pool-mock.js
const query = jest.fn()
module.exports = { pool: { query } }

// In test:
const { pool } = require('../helpers/pool-mock')
jest.mock('../../db', () => require('../helpers/pool-mock'))

pool.query.mockResolvedValueOnce({ rows: [{ id: 'test-id', ... }] })
```

## Auth Fixture Pattern
```js
// Create a valid session in the test DB or mock the authenticate middleware:
jest.mock('../../middleware/authenticate', () => (req, res, next) => {
  req.user = { id: 'usr-test', role: 'member', org_id: 'org-1' }
  next()
})
```

## Test Quality Rules
- `describe` block = resource name (e.g. `'PUT /api/issues/:id'`)
- `it` block = plain English scenario (e.g. `'returns 403 when user is not a space member'`)
- No shared mutable state between tests — use `beforeEach` to reset mocks
- Never assert `toBeTruthy` — use specific matchers: `toEqual`, `toHaveBeenCalledWith`, `toMatchObject`
- One assertion per `it` unless they describe the same single behavior
