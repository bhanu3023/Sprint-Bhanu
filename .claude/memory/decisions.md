# Architectural Decisions — Sprint Board

## ADR-001: Single server.js (no MVC split)
All Express routes and business logic in one file. Rapid prototype origin; splitting adds indirection without current benefit. Navigate by route string/HTTP method. Do not create separate route files unless explicitly asked.

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
