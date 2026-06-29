#!/bin/bash
# Runs after Claude stops — validates server.js and app.js for syntax errors.
# Exit 0 = allow (warn only)

echo "Running syntax check on server.js and app.js..."

if [ -f "server.js" ]; then
  if ! node --check server.js 2>&1; then
    echo "SYNTAX ERROR in server.js — fix before committing."
  else
    echo "server.js OK"
  fi
fi

if [ -f "app.js" ]; then
  if ! node --check app.js 2>&1; then
    echo "SYNTAX ERROR in app.js — fix before committing."
  else
    echo "app.js OK"
  fi
fi

# Warn on possible unparameterized SQL
if grep -n '\${' server.js 2>/dev/null | grep -i 'pool\.query\|SELECT\|INSERT\|UPDATE\|DELETE' | grep -v '^[[:space:]]*//' | head -5; then
  echo "WARNING: Possible SQL string interpolation detected above — verify all are parameterized."
fi

exit 0
