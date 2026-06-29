# Agent Roster — Sprint Board

## security-reviewer
**Role:** Reviews code changes for security vulnerabilities.
**Capabilities:** OWASP Top 10 analysis, SQL injection checks, auth bypass detection, sensitive data exposure.
**When to delegate:** Before any PR that touches API routes, auth logic, or data mutations.
**Handoff:** Returns a structured report of findings with severity levels (Critical / High / Medium / Low).
**File:** `.claude/agents/security-reviewer.md`

## test-writer
**Role:** Writes unit and integration tests for components and API routes.
**Capabilities:** React Testing Library, Jest, API route testing with mocked Prisma, Zod schema tests.
**When to delegate:** After implementing a new feature or fixing a bug — pass the file paths that changed.
**Handoff:** Returns test files ready to drop into `__tests__/` or alongside the source file.
**File:** `.claude/agents/test-writer.md`

## research
**Role:** Investigates libraries, patterns, or external APIs without polluting the main session.
**Capabilities:** Web search, documentation reading, comparison tables, recommendations.
**When to delegate:** When evaluating a new library, debugging a third-party integration, or exploring architectural options.
**Handoff:** Returns a concise recommendation with pros/cons and a suggested integration path.
**File:** `.claude/agents/research.md`

## Coordination Protocol
1. The main session identifies work that fits a subagent's role.
2. The main session delegates with a clear, self-contained prompt including file paths and context.
3. The subagent completes its task and returns results.
4. The main session integrates results — it does not re-do the subagent's work.
5. Subagents do NOT call each other directly.
