# Skill: Testing Patterns

## Description
Write Jest tests for Express.js routes in server.js using Supertest and mocked pg pool. Triggered when the user asks to write or add tests.

## Trigger Patterns
- "write tests for this route"
- "add tests for POST /api/issues"
- "test the sprint complete endpoint"
- "improve test coverage"

## For any Express route, generate tests covering:
1. Happy path — valid token, correct body, expected response shape
2. No auth token → 401 `{ error: 'Unauthorized' }`
3. Wrong org role (member doing admin-only) → 403
4. Not a space member → 403
5. Missing required field → 400 with field name in error message
6. Resource not found → 404

## Issue update route — also test:
- `issue_history` INSERT called for each tracked field (status, assignee_id, priority, sprint_id, due_date, story_points)
- `createNotif` called when `assignee_id` changes
- `createNotif` called when `status` changes

## Sprint complete — also test:
- Velocity = SUM story_points WHERE status='Done'
- Incomplete issues get `sprint_id=NULL`
- All space members receive `sprint_completed` notification

## Worklog create — also test:
- `user_id` in request body is ignored; `req.user.id` is used instead

## Mock Setup Template
```js
const request = require('supertest')
const app = require('../../server')
jest.mock('../../db/pool', () => ({ pool: { query: jest.fn() } }))
const { pool } = require('../../db/pool')
jest.mock('../../middleware/authenticate', () => (req, res, next) => {
  req.user = { id: 'usr-test', role: 'member', org_id: 'org-1' }
  next()
})
```

## Output
Complete test file at `tests/routes/<resource>.test.js`. Reports path and test count.
