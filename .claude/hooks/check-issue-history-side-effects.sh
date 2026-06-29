#!/bin/bash
# PostToolUse hook — after editing server.js, warns if an issue UPDATE route
# is missing the issue_history INSERT side-effect.
# Exit 0 = always allow (warning only)

FILE="$CLAUDE_TOOL_RESULT_FILE_PATH"

if [ -z "$FILE" ] || [ "$FILE" != "server.js" ]; then
  exit 0
fi

# Check if the file contains a PUT /api/issues route
if ! grep -q "app.put.*api/issues" server.js 2>/dev/null; then
  exit 0
fi

# Count UPDATE issues queries
UPDATE_COUNT=$(grep -c "UPDATE issues SET" server.js 2>/dev/null || echo 0)

# Count issue_history INSERTs
HISTORY_COUNT=$(grep -c "INSERT.*issue_history" server.js 2>/dev/null || echo 0)

if [ "$UPDATE_COUNT" -gt 0 ] && [ "$HISTORY_COUNT" -eq 0 ]; then
  echo "WARNING: server.js has UPDATE queries on 'issues' but no INSERT into 'issue_history'."
  echo "Every tracked field change (status, assignee_id, priority, sprint_id, due_date, story_points)"
  echo "must write a row to issue_history. Check PUT /api/issues/:id."
fi

# Check if createNotif is called alongside issue updates
if grep -q "UPDATE issues SET" server.js 2>/dev/null; then
  if ! grep -q "createNotif" server.js 2>/dev/null; then
    echo "WARNING: Issue UPDATE routes found but no createNotif() call detected in server.js."
    echo "Assignee and status changes must fire notifications."
  fi
fi

exit 0
