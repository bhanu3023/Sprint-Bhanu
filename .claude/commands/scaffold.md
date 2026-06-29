# /project:scaffold — Scaffold Command

Generate boilerplate for a new feature: API route + component + Zod schema + types.

## Usage
```
/project:scaffold $ARGUMENTS
```
Example: `/project:scaffold feature=sprint-goal resource=SprintGoal`

## What Gets Created
Given `resource=<Name>` and `feature=<area>`:

1. **Zod schema** — `src/lib/validations/<area>.schema.ts`
   - `create<Name>Schema`, `update<Name>Schema`

2. **Type** — added to `src/types/index.ts`
   - `<Name>` interface matching Prisma model

3. **API routes**
   - `src/app/api/<area>/route.ts` → GET (list) + POST (create)
   - `src/app/api/<area>/[id]/route.ts` → GET + PATCH + DELETE

4. **Component** — `src/components/<feature>/<Name>View.tsx`
   - Client component with loading state, error state, and empty state

5. **Page** — `src/app/(app)/<area>/page.tsx`
   - Server component that passes data to `<Name>View`

## Template Conventions
- API routes include auth check + Zod validation + audit log.
- Components use Tailwind + Radix UI patterns consistent with the rest of the codebase.
- All generated files include a `// TODO: review generated scaffold` comment at the top.
