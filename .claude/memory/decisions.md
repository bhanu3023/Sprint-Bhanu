# Architectural Decisions — Sprint Board

## ADR-001: Single server.js (no MVC split) — SUPERSEDED by ADR-008
~~All Express routes and business logic in one file. Rapid prototype origin; splitting adds indirection without current benefit. Navigate by route string/HTTP method. Do not create separate route files unless explicitly asked.~~ Kept for history: the reasoning was sound while the file was small. **Do NOT follow this now — see ADR-008.**

## ADR-002: Raw pg queries (no ORM)
Use `pg` pool with handwritten SQL. Full control over query shape, no ORM overhead. Always use `$1,$2` params; build dynamic WHERE with arrays — never string concatenation.

## ADR-003: scrypt for password hashing
Node's built-in `crypto.scrypt` with random salt. More memory-hard than bcrypt, no dependency. Salt stored with hash separated by `.`. Never use `crypto.createHash` for passwords.

## ADR-004: Stateful session tokens (not JWT)
32-byte hex random tokens in `sessions` table, 7-day TTL. Allows instant revocation. Every request hits the DB via `authenticate` middleware. Never introduce JWTs for session auth.

## ADR-005: Fire-and-forget createNotif()
`createNotif()` called without `await`, handles its own errors internally. A notification failure must never fail the main request. Always call without await in route handlers.

## ADR-006: Soft-delete for issues
Issues soft-deleted via `deleted_at=NOW()`, `deleted_by=req.user.id`. Preserves issue_history, worklogs, comments for audit. All list queries must include `WHERE deleted_at IS NULL`. Hard-DELETE only in cleanup scripts.

## ADR-007: Bulk data load on SPA startup
`GET /api/data` loads all entities in one shot. SPA joins in memory. Add new SPA-needed entities to this endpoint response. Never add heavy JOINs here — keep it fast, let the SPA do relational work client-side.

## ADR-008: Modular src/ tree, server.js as an ordered require list
Supersedes ADR-001. server.js (3,204 lines) and app.js (17,295 lines) were split by a move-only refactor into src/server/ (37 files: core, db, auth, deps, express-app, files, notify, startup, and routes/) and src/client/ (42 files: pages/, components/, crud/, services/, state/, utils/). Root server.js is now a 31-line ordered require list — the order IS the route registration order, so never reorder it casually. No build step: index.html loads the 42 client files as classic <script> tags in that same order. Add a new route file under src/server/routes/ AND a require for it in server.js at the position its routes must register.

## ADR-009: Four files stay at the repository root, deliberately
server.js — the entry point named by package.json (main/start/dev), Dockerfile CMD, start.bat and start-server.bat. Root is the Node convention; moving it means editing all of those.
combination-options.js and hotjar.js — DUAL-ENVIRONMENT. Both are loaded by the browser via <script src> AND require()d by Node (lib/builtin-issue-fields.js and scripts/migrations/003 for the former; scripts/test-hotjar.js for the latter), and both guard on typeof module / typeof window. They belong to neither src/client nor src/server. With no bundler, the root is the shared location.
styles.css — a browser-only asset linked by index.html. Moving it is churn: it would need the link, the static allowlist in src/server/express-app.js, and the deploy required-names check updated for no functional gain. The worthwhile change to that file is splitting 5,254 lines, which is not a move.
Guards that fire if these move: MIN_ROOT_JS=3 in the deploy syntax gate, the archive required-names list, and PUBLIC_ROOT_PATHS in express-app.js.
