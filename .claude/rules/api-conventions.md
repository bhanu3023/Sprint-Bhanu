# API Conventions

## Route Structure
All API routes live under `src/app/api/` following resource-based naming:
```
/api/issues            → CRUD on issues
/api/issues/[issueKey] → Single issue operations
/api/board/[projectKey]  → Board data for a project
```

## Request Validation
- Always parse and validate the request body with the appropriate Zod schema from `src/lib/validations/`.
- Return `400` with `{ error: "Validation failed", details: zodError.flatten() }` on invalid input.
- Never trust client-supplied IDs without verifying ownership.

## Auth Enforcement
Every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) must:
1. Call `getServerSession(authOptions)` at the top.
2. Return `401 { error: "Unauthorized" }` if no session.
3. Call the appropriate permission helper from `src/lib/permissions.ts` before acting.

## Response Shape
```ts
// Success
return NextResponse.json({ data: result }, { status: 200 })

// Created
return NextResponse.json({ data: result }, { status: 201 })

// No content (DELETE success)
return new NextResponse(null, { status: 204 })

// Client error
return NextResponse.json({ error: "Human-readable message" }, { status: 400 | 401 | 403 | 404 })

// Server error — never expose raw error messages
return NextResponse.json({ error: "Internal server error" }, { status: 500 })
```

## Prisma Usage
- Import the singleton: `import { prisma } from "@/lib/prisma"`.
- Wrap multi-step mutations in `prisma.$transaction([...])`.
- Use `select` or `include` explicitly — never return full models with sensitive fields.
- Always `catch` Prisma errors; map `P2025` (not found) → 404, `P2002` (unique) → 409.

## Audit & Notifications
- Call `createAuditLog()` from `src/lib/audit.ts` after any issue state change.
- Call `createNotification()` from `src/lib/notifications.ts` when assigning or mentioning a user.
