#!/bin/bash
# PostToolUse hook — after editing server.js, scans for SQL string interpolation.
# Template literals (${var}) inside pool.query strings are a SQL injection risk.
# Exit 0 = always allow (warning only)

FILE="$CLAUDE_TOOL_RESULT_FILE_PATH"

if [ -z "$FILE" ] || [ "$FILE" != "server.js" ]; then
  exit 0
fi

# Find lines where pool.query contains a template literal with ${ }
# This catches cases like: pool.query(`SELECT * FROM issues WHERE id='${id}'`)
HITS=$(grep -n 'pool\.query' server.js 2>/dev/null | grep '\${' | grep -v '^\s*//')

if [ -n "$HITS" ]; then
  echo "⚠️  POTENTIAL SQL INJECTION — unparameterized query detected in server.js:"
  echo "$HITS"
  echo ""
  echo "Replace string interpolation with parameterized values:"
  echo "  WRONG:  pool.query(\`SELECT * FROM issues WHERE id='\${id}'\`)"
  echo "  RIGHT:  pool.query('SELECT * FROM issues WHERE id=\$1', [id])"
fi

exit 0
