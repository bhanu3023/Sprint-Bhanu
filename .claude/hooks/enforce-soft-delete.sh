#!/bin/bash
# PreToolUse hook — blocks hard DELETE on the issues table.
# Claude Code passes tool input as JSON via stdin.
# Exit 0 = allow, Exit 2 = block

INPUT=$(cat)

# Extract the content being written (new_string for Edit, content for Write)
CONTENT=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
tool_input = data.get('tool_input', {})
print(tool_input.get('new_string', '') + tool_input.get('content', ''))
" 2>/dev/null)

if [ -z "$CONTENT" ]; then
  exit 0
fi

# Block hard DELETE on the issues table
if echo "$CONTENT" | grep -qiE "DELETE FROM issues|pool\.query.*DELETE FROM issues"; then
  echo "BLOCKED: Hard DELETE on 'issues' table is not allowed."
  echo "Use soft-delete: UPDATE issues SET deleted_at=NOW(), deleted_by=req.user.id WHERE id=\$1"
  exit 2
fi

exit 0
