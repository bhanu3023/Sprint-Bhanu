#!/bin/bash
# PostToolUse hook — warns when SQL string interpolation is written to server.js.
# Claude Code passes tool input/output as JSON via stdin.
# Exit 0 = always allow (warning only)

INPUT=$(cat)

# Get the file path
FILEPATH=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null)

# Only check server.js
if [[ "$FILEPATH" != *"server.js"* ]]; then
  exit 0
fi

# Get the content written
CONTENT=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
tool_input = data.get('tool_input', {})
print(tool_input.get('new_string', '') + tool_input.get('content', ''))
" 2>/dev/null)

# Check for template literal interpolation inside a query string
if echo "$CONTENT" | grep -qE 'pool\.query.*\$\{'; then
  echo "WARNING: SQL string interpolation detected — this is a SQL injection risk."
  echo "Replace: pool.query(\`SELECT * FROM issues WHERE id='\${id}'\`)"
  echo "With:    pool.query('SELECT * FROM issues WHERE id=\$1', [id])"
fi

exit 0
