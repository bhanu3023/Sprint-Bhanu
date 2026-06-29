#!/bin/bash
# Runs after Claude stops — validates TypeScript and lint.
# Exit 0 = allow, Exit 2 = block (will notify user)

echo "Running post-session validation..."

# Only validate if TypeScript files were modified
if git diff --name-only HEAD 2>/dev/null | grep -qE '\.(ts|tsx)$'; then
  echo "TypeScript files changed. Running type check..."
  if ! npx tsc --noEmit --skipLibCheck 2>&1; then
    echo "⚠️  TypeScript errors found. Run 'npx tsc --noEmit' to see details."
    # Exit 0 (warn, don't block) — user can still review
    exit 0
  fi
  echo "✓ TypeScript OK"
fi

echo "Running lint check..."
if ! npm run lint --silent 2>&1; then
  echo "⚠️  Lint errors found. Run 'npm run lint' to see details."
  exit 0
fi

echo "✓ Lint OK"
exit 0
