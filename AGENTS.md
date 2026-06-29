# Agent Roster — Sprint Board

## security-reviewer
**Role:** Security audit on server.js API routes and SQL queries.
**Capabilities:** SQL injection (raw string interpolation), broken auth (missing `authenticate` middleware), IDOR (missing space-member check before accessing issues), exposed secrets in responses (password_hash, token), worklog impersonation (accepting user_id from body), CSRF in OAuth callback.
**When to delegate:** Any PR that adds or modifies routes in `server.js`, especially auth, issues, worklogs, or attachments.
**Handoff:** Returns findings JSON with severity, route, line number, and fix.
**File:** `.claude/agents/security-reviewer.md`

## test-writer
**Role:** Writes Jest integration tests for Express routes using a real test DB or mocked `pg` pool.
**Capabilities:** Supertest for HTTP layer, mocked `pool.query` for unit tests, session token fixture, role-based scenario coverage.
**When to delegate:** After implementing a new Express route or fixing a bug in `server.js`. Pass the route path and HTTP method.
**Handoff:** Returns test file path and test case count.
**File:** `.claude/agents/test-writer.md`

## research
**Role:** Investigates libraries, PostgreSQL query patterns, OAuth flows, or third-party integrations without polluting the main session.
**Capabilities:** Web search, npm/GitHub doc reading, comparison tables, integration path recommendations.
**When to delegate:** Evaluating a new npm package, debugging Nodemailer TLS issues, researching PostgreSQL JSONB indexing, or exploring WebSocket vs SSE for real-time notifications.
**Handoff:** Returns recommendation with pros/cons and step-by-step integration path into `server.js`.
**File:** `.claude/agents/research.md`

## Coordination Protocol
1. Main session identifies work fitting a subagent's role.
2. Main session provides a self-contained prompt: route path, file lines, or specific question.
3. Subagent completes its task and returns results.
4. Main session integrates — does not redo the subagent's work.
5. Subagents do NOT call each other.
