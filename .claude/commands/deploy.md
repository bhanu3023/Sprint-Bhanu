# /project:deploy — Deploy Command

Run the full pre-deploy checklist and build the production bundle.

## Usage
```
/project:deploy
/project:deploy --check-only
```

## Steps
```
1. git status — confirm no uncommitted changes
2. npm run lint — must pass with 0 errors
3. npx tsc --noEmit — must pass with 0 type errors
4. npm run build — must succeed
5. Report: bundle size, any warnings
6. If $ARGUMENTS contains "--check-only": stop here and report results
7. Otherwise: prompt user to confirm before pushing
8. git push origin main (only after explicit confirmation)
```

## Pre-Deploy Checklist
- [ ] All tests pass
- [ ] `DATABASE_URL` points to production DB
- [ ] `NEXTAUTH_SECRET` is set in production env
- [ ] `NEXTAUTH_URL` is set to the production URL
- [ ] No `.env.local` secrets committed
- [ ] Prisma migrations are applied: `npx prisma migrate deploy`

## Rollback
If deploy fails after push:
```
git revert HEAD
git push origin main
```
