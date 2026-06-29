#!/bin/bash
# PreToolUse hook — warns if code being written contains a hard DELETE on the issues table.
# Issues must always be soft-deleted via deleted_at=NOW(), never hard-deleted.
# Exit 0 = allow (warn only), Exit 2 = block

CONTENT="$CLAUDE_TOOL_INPUT_CONTENT"

if [ -z "$CONTENT" ]; then
  exit 0
fi

# Detect hard DELETE targeting the issues table
if echo "$CONTENT" | grep -qiE "DELETE\s+FROM\s+issues|pool\.query\s*\(\s*['\"]DELETE\s+FROM\s+issues"; then
  echo "BLOCKED: Hard DELETE on the 'issues' table is not allowed."
  echo "Use soft-delete instead: UPDATE issues SET deleted_at=NOW(), deleted_by=req.user.id WHERE id=\$1"
  echo "Hard DELETE is only permitted in maintenance scripts, not in API route handlers."
  exit 2
fi

exit 0
