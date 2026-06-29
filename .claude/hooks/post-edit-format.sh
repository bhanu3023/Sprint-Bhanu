#!/bin/bash
# Runs after Write or Edit — formats JS/JSON files with prettier if available.
# Exit 0 = always allow

FILE="$CLAUDE_TOOL_RESULT_FILE_PATH"

if [ -z "$FILE" ]; then
  exit 0
fi

# Format JS and JSON files
if echo "$FILE" | grep -qE '\.(js|json)$'; then
  if command -v npx &>/dev/null && npx prettier --version &>/dev/null 2>&1; then
    npx prettier --write "$FILE" --log-level silent 2>/dev/null || true
  fi
fi

exit 0
