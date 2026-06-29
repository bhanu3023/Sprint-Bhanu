# Workflow: Feature Build

A repeatable blueprint for building a new feature end-to-end.

## Steps

### 1. Research & Design
- Clarify requirements with the user (what does the feature do? what are the edge cases?)
- If a new library is needed → delegate to `@research` agent
- Define the data model changes (new Prisma models or fields)
- Define the API contract (endpoints, request/response shapes)
- Define the UI components needed

### 2. Data Layer
- Update `prisma/schema.prisma` with new models/fields
- Run `npm run db:migrate -- --name <feature-name>` to create migration
- Run `npm run db:generate` to regenerate the Prisma client
- Add Zod schema to `src/lib/validations/<feature>.schema.ts`
- Add types to `src/types/index.ts`

### 3. API Layer
- Create API route handlers following `.claude/rules/api-conventions.md`
- Include: auth check → permission check → Zod validation → DB operation → audit log
- Test routes with curl or Thunder Client before building UI

### 4. UI Layer
- Build Server Component page (`src/app/(app)/<feature>/page.tsx`)
- Build Client Component view (`src/components/<feature>/<Feature>View.tsx`)
- Use Radix UI primitives and Tailwind — match existing component patterns
- Add navigation entry to `Sidebar.tsx` if needed

### 5. Testing
- Delegate to `@test-writer` agent with the new file paths
- Review generated tests and ensure they pass

### 6. Review
- Run `/project:review` on all changed files
- Delegate security review to `@security-reviewer` if API routes were added
- Run `npm run lint && npm run build`

### 7. PR
- Run `/project:review` → fix any issues
- Run `/project:pr-description` to generate PR description
- Push and open PR following `.claude/rules/pr.md`
