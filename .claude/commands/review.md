# /project:review — Code Review Command

Review the current git diff or a specific file/PR for correctness, security, and style.

## Usage
```
/project:review
/project:review src/app/api/issues/route.ts
/project:review $ARGUMENTS
```

## What This Command Does
1. Reads the target file(s) or runs `git diff` if no argument given.
2. Checks against `.claude/rules/code-style.md` and `.claude/rules/api-conventions.md`.
3. Delegates security checks to the `security-reviewer` agent.
4. Reports findings grouped by: **Critical** → **High** → **Medium** → **Low / Style**.
5. For each finding: file path + line number, description, suggested fix.

## Steps
```
1. Read target files or `git diff HEAD`
2. Check: TypeScript types, missing auth checks, raw Prisma queries, unvalidated input
3. Check: React hooks rules, missing keys, incorrect "use client" usage
4. @security-reviewer: run security pass on the diff
5. Output structured findings table
6. Ask: "Apply fixes automatically?" — if yes, edit files, then re-run lint
```

## Output Format
```md
## Review Results — <filename or "current diff">

### Critical
| Line | Issue | Fix |
|------|-------|-----|

### High
...

### Style
...

**Verdict:** Ready to merge / Needs changes
```
