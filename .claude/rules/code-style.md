# Code Style Rules

## TypeScript
- Strict mode is on — never use `any`; use `unknown` and narrow types instead.
- Prefer `interface` for object shapes, `type` for unions and aliases.
- Exported types/interfaces go in `src/types/index.ts` unless tightly scoped to one file.
- Use optional chaining (`?.`) and nullish coalescing (`??`) rather than `&&` guards.

## React / Next.js
- Default to Server Components. Add `"use client"` only when browser APIs, hooks, or event handlers are required.
- Keep components small and single-purpose — extract when a component exceeds ~150 lines.
- Props interfaces are named `<ComponentName>Props` and defined in the same file as the component.
- Always pass `key` when rendering lists — never use array index as key if items can reorder.
- Use `cn()` from `src/lib/utils.ts` for all conditional className merging.

## Imports
- Use `@/` absolute imports (configured in `tsconfig.json`).
- Order: React → Next.js → third-party → internal (`@/lib`, `@/components`, `@/types`) → relative.
- No unused imports — ESLint will catch them but remove proactively.

## Naming
- Files/folders: `kebab-case` for pages and utilities; `PascalCase` for component files.
- Components: `PascalCase`.
- Hooks: `useCamelCase`.
- Constants: `SCREAMING_SNAKE_CASE` at module scope, `camelCase` inside functions.

## Formatting
- Prettier is the source of truth — 2-space indent, single quotes, no semicolons in TSX, trailing commas.
- Never manually reformat; let the post-edit hook handle it.

## Comments
- No inline comments that explain WHAT the code does — the code should be self-explanatory.
- Only comment WHY: hidden constraints, non-obvious invariants, workarounds for specific bugs.
