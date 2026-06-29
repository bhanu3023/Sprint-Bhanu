# Testing Standards

## Test Tooling
- **Unit / Component:** Jest + React Testing Library
- **API Routes:** Jest with mocked Prisma client (`jest.mock("@/lib/prisma")`)
- **E2E:** (not yet configured — Playwright is the planned tool)

## File Placement
- Component tests: `src/components/<domain>/__tests__/<ComponentName>.test.tsx`
- API route tests: `src/app/api/<resource>/__tests__/route.test.ts`
- Utility tests: next to the source file, e.g., `src/lib/sla.test.ts`

## What to Test
- Every Zod schema: valid input passes, invalid input fails with correct error paths.
- Every API route: happy path + auth missing (401) + permission denied (403) + not found (404).
- Pure utility functions: all branches (e.g., `src/lib/sla.ts`, `src/lib/permissions.ts`).
- Components: render without crashing, key interactions (click, submit), conditional rendering.

## Mocking Rules
- Mock Prisma at the module level — never let tests hit a real DB.
- Mock `getServerSession` to return a test session or `null` for auth tests.
- Use `msw` for mocking fetch in client component tests (preferred over `jest.fn()` on `fetch`).

## Test Quality
- Tests must read like documentation — describe blocks use feature names, `it` blocks use plain English.
- No `toBeTruthy` / `toBeFalsy` — use specific matchers (`toEqual`, `toHaveBeenCalledWith`, etc.).
- Each test is independent — no shared mutable state between tests.
- Aim for one assertion per test; group related assertions only when they describe a single behaviour.

## Coverage Targets
- Utilities and lib: ≥ 90% line coverage.
- API routes: ≥ 80% line coverage.
- Components: render + key interaction paths covered; snapshot tests are discouraged.
