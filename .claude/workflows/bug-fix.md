# Workflow: Bug Fix

A repeatable blueprint for diagnosing and fixing bugs.

## Steps

### 1. Reproduce
- Identify the exact steps to reproduce the bug
- Note: which page/route, what input, what error (UI or console or server log)
- Confirm: is this a client-side error, API error, or data error?

### 2. Locate
- For UI bugs: read the component in `src/components/<domain>/`
- For API bugs: read `src/app/api/<resource>/route.ts`
- For data bugs: read `src/lib/` helpers and Prisma queries
- Use Grep to find all usages of the broken function/component

### 3. Diagnose
- Read the relevant files end-to-end
- Check: types, null handling, missing auth, wrong Prisma query
- If external library is suspected → delegate to `@research` agent

### 4. Fix
- Make the minimal change that fixes the bug — do not refactor surrounding code
- If the fix touches an API route → run `@security-reviewer` on the diff

### 5. Verify
- Add a regression test via `@test-writer` covering the exact bug scenario
- Run `npm run lint` and `npm run build`

### 6. PR
- Run `/project:review` on the changed files
- Run `/project:pr-description` — type should be `fix`
- PR description must include: reproduction steps + root cause + fix summary
