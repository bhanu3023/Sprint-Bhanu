# Skill: PR Description

## Description
Generate a complete, well-structured PR description from the current git diff. Auto-triggered when the user asks to "write a PR", "describe my changes", or "create PR description".

## Trigger Patterns
- "write a PR description"
- "describe my changes"
- "generate PR title and body"
- "help me write the PR"
- "create PR description"

## Behavior
1. Run `git diff main...HEAD` (or `git diff HEAD~1`) to get changed files.
2. Read key changed files to understand intent.
3. Generate:
   - **Title** following `<type>(<scope>): <description>` from `.claude/rules/pr.md`
   - **Summary** bullets — what changed and why
   - **Changes** — list of affected files with a one-line description each
   - **Test Plan** — manual steps to verify the feature works
   - **Notes** — callouts for reviewers (breaking changes, follow-up tickets)
4. If UI files changed, remind the user to add screenshots.
5. Output the full description in a code block ready to paste into GitHub.

## Output Format
Follows the template in `.claude/rules/pr.md` exactly.
