# Skill: PR Description

## Description
Generate a PR title and description from the current git diff, specific to this Express.js + PostgreSQL project.

## Trigger Patterns
- "write a PR description"
- "describe my changes"
- "generate PR title"
- "help me write the PR"

## Behavior
1. Run `git diff main...HEAD` to see changed files
2. Read `server.js` diffs to identify which routes changed
3. Read `app.js` / `index.html` diffs for frontend impact
4. Check for DB schema changes (new tables, columns, indexes)
5. Generate:
   - **Title:** `<type>(<scope>): <description>` — e.g. `fix(sprints): prevent multiple active sprints per space`
   - **Summary:** bullet points of what changed and why
   - **Changes:** routes affected and what they now do differently
   - **Side Effects to Verify:** if issues/sprints changed, call out `issue_history`, `createNotif`, `audit_logs`
   - **Test Plan:** manual curl/Postman steps to verify
6. If worklog or auth routes changed, flag them for extra security review attention

## Output
Full PR description in a markdown code block, following `.claude/rules/pr.md` template exactly.
