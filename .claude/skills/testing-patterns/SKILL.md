# Skill: Testing Patterns

## Description
Generate tests that match the project's testing conventions. Auto-triggered when the user asks to "write tests", "add tests", or "test this".

## Trigger Patterns
- "write tests for this"
- "add unit tests"
- "test this component"
- "test this API route"
- "improve test coverage"

## Behavior

### For API Routes
1. Read the route file.
2. Identify: HTTP methods, auth requirements, Zod schema used, Prisma calls.
3. Generate tests covering:
   - Happy path (mocked Prisma returns valid data)
   - Missing session → 401
   - Insufficient permissions → 403
   - Invalid body → 400 with Zod errors
   - Resource not found → 404
   - Prisma P2002 (unique) → 409

### For Components
1. Read the component file.
2. Identify: props, state, user interactions, conditional rendering.
3. Generate tests covering:
   - Renders without crashing
   - Key props affect output
   - User interactions trigger expected callbacks
   - Loading and error states render correctly

### Mock Setup
Always mock at module level:
```ts
jest.mock("@/lib/prisma")
jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }))
```

## Output
Test file ready to save. Path follows the convention in `.claude/rules/testing-standard.md`.
