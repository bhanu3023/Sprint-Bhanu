#!/bin/bash
# Runs after Write or Edit tool use — formats the modified file with Prettier.
# Exit 0 = allow, Exit 2 = block

FILE="$CLAUDE_TOOL_RESULT_FILE_PATH"

if [ -z "$FILE" ]; then
  exit 0
fi

# Only format TypeScript/TSX/CSS files
if echo "$FILE" | grep -qE '\.(ts|tsx|css|json)$'; then
  if command -v npx &>/dev/null; then
    npx prettier --write "$FILE" --log-level silent 2>/dev/null || true
  fi
fi

exit 0
