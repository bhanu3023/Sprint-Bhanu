#!/bin/bash
# PostToolUse hook — warns when an issue UPDATE is written without issue_history INSERT.
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

# Check for UPDATE on issues without issue_history
HAS_UPDATE=$(echo "$CONTENT" | grep -i "UPDATE issues SET" | wc -l)
HAS_HISTORY=$(echo "$CONTENT" | grep -i "issue_history" | wc -l)

if [ "$HAS_UPDATE" -gt 0 ] && [ "$HAS_HISTORY" -eq 0 ]; then
  echo "WARNING: You updated the 'issues' table but did not write to 'issue_history'."
  echo "Every change to status, assignee_id, priority, sprint_id, due_date, or story_points"
  echo "must INSERT a row into issue_history for audit tracking."
fi

exit 0
