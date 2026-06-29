# Architectural Decisions

## ADR-001: App Router over Pages Router
**Decision:** Use Next.js App Router (`src/app/`).
**Reason:** Server Components reduce client bundle size. Nested layouts simplify the project/issue hierarchy. Colocated API routes are cleaner than a separate `pages/api/` tree.
**Trade-off:** Some third-party libraries (e.g., `next-auth` v4) have rough edges with App Router. Worked around with `src/app/api/auth/[...nextauth]/route.ts` handler pattern.

## ADR-002: Prisma as ORM
**Decision:** Use Prisma 5 with PostgreSQL.
**Reason:** Type-safe queries, auto-generated client, excellent migration tooling, and `@auth/prisma-adapter` support.
**Trade-off:** Prisma does not support raw array/JSON fields as well as Drizzle. Acceptable for this data model.

## ADR-003: Server-side permissions, not middleware-only
**Decision:** Permission checks happen inside each API route handler, not only in `middleware.ts`.
**Reason:** Middleware handles route-level auth (is the user logged in?). API routes handle resource-level permissions (can this user modify this issue?). Defense in depth.

## ADR-004: Zod schemas shared between API and forms
**Decision:** Zod schemas in `src/lib/validations/` are imported by both API routes and React Hook Form resolvers.
**Reason:** Single source of truth for validation rules. Changes to the schema automatically propagate to both layers.

## ADR-005: No direct Prisma calls from Client Components
**Decision:** Client Components call the API via fetch; only Server Components and API routes use Prisma.
**Reason:** Prisma is a Node.js-only library — importing it in a Client Component would crash the browser bundle.
