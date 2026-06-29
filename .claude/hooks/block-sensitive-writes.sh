#!/bin/bash
# Runs before Write or Edit — blocks writes to sensitive files.
# Exit 0 = allow, Exit 2 = block

FILE="$CLAUDE_TOOL_INPUT_FILE_PATH"

if [ -z "$FILE" ]; then
  exit 0
fi

# Block writes to .env files (only .env.example is committed)
if echo "$FILE" | grep -qE '\.env$|\.env\.local$|\.env\.production$'; then
  echo "BLOCKED: Writing to '$FILE' not allowed. Use .env.example for committed templates."
  exit 2
fi

# Block writes to uploaded files directory
if echo "$FILE" | grep -qE '^uploads/'; then
  echo "BLOCKED: Do not write directly to uploads/. Use the file upload API."
  exit 2
fi

# Block manual edits to package-lock.json
if echo "$FILE" | grep -qE 'package-lock\.json$'; then
  echo "BLOCKED: Do not manually edit package-lock.json. Run 'npm install' instead."
  exit 2
fi

exit 0
