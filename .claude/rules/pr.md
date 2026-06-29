# Pull Request Standards

## PR Title Format
```
<type>(<scope>): <short description>
```
Types: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `perf`
Scope: the feature area, e.g. `board`, `issues`, `auth`, `sla`, `api`

Examples:
- `feat(board): add drag-and-drop reordering within columns`
- `fix(auth): redirect to login on expired session`
- `chore(deps): upgrade Prisma to v5.22`

## PR Description Template
```md
## Summary
- What changed and why (bullets, not paragraphs)

## Changes
- [ ] File/component affected and how
- [ ] Database schema changes (if any)
- [ ] API contract changes (if any)

## Test Plan
- [ ] Unit tests added/updated
- [ ] Manually tested: [steps to verify]
- [ ] Edge cases considered: [list]

## Screenshots
(For UI changes — before / after)

## Notes
Any reviewer callouts, follow-up tickets, or known limitations.
```

## Review Checklist
Before requesting review, confirm:
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] `npm run db:generate` run after schema changes
- [ ] No `.env` or secrets committed
- [ ] No `console.log` statements left in production code
- [ ] Auth/permission checks present in new API routes
- [ ] Zod validation present for new request bodies

## Merge Strategy
- Squash and merge for feature branches.
- Merge commit for release branches.
- Never force-push to `main`.
