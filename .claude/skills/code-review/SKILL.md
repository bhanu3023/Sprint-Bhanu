# Skill: Code Review

## Description
Perform a structured code review of changed files, checking for correctness bugs, security issues, and code quality. Auto-triggered when the user asks to "review", "check", or "audit" code.

## Trigger Patterns
- "review this file"
- "check my changes"
- "is this code correct?"
- "audit the PR"
- "any issues with this?"

## Behavior
1. Read the target file(s) using the Read tool.
2. Check each file against:
   - `src/lib/validations/` — is input validated?
   - `src/lib/permissions.ts` — are permissions checked?
   - `src/lib/auth.ts` — is the session verified?
   - TypeScript types — any implicit `any` or unsafe casts?
   - React patterns — correct hooks usage, key props, server vs client boundary
3. Output findings in a structured table (Critical / High / Medium / Low).
4. Offer to apply fixes.

## Scope
One job: review for correctness and security. Do not refactor or add features during a review unless explicitly asked.
