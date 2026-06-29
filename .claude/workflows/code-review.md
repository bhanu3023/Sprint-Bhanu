# Workflow: Code Review

A repeatable blueprint for reviewing a PR or set of changed files.

## Steps

### 1. Understand the Change
- Read the PR description (or ask the user what the change does)
- Run `git diff main...HEAD` to see all changed files
- Group files by layer: schema / API / lib / components / pages

### 2. Data Layer Review
- Schema changes: are new fields nullable? are indexes added for queried fields?
- Migration files: are they additive (safe) or destructive (requires data migration plan)?
- Zod schemas: do they match the Prisma model?

### 3. API Layer Review
- Every mutating route: auth check present? permission check present?
- Input validation: Zod schema applied?
- Error handling: Prisma errors caught and mapped to HTTP status codes?
- Response shape: follows conventions in `.claude/rules/api-conventions.md`?

### 4. UI Layer Review
- Server vs client boundary: is `"use client"` used only when necessary?
- Props typed correctly? No `any`?
- Loading, error, and empty states handled?
- Accessibility: interactive elements have labels, keyboard navigable?

### 5. Security Pass
- Delegate to `@security-reviewer` with the diff
- Integrate findings into the review report

### 6. Output
- Structured findings table (Critical / High / Medium / Low / Style)
- Overall verdict: `✅ Ready to merge` | `🔄 Needs changes` | `❌ Do not merge`
- Offer to apply fixes for Low/Medium findings automatically
