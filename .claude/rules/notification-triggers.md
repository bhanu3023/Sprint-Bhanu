# Notification Triggers

## The 5 Notification Types and When They Fire

### `issue_assigned`
**When:** `assignee_id` changes on an issue (creation with assignee OR update)
**Who gets it:** The NEW assignee (not the old one, not the reporter)
**Must NOT fire:** If the new assignee is the same as the person making the change (`req.user.id === newAssigneeId`)
**Link format:** `/issues/${issue.key}`
**Title:** `"You've been assigned: ${issue.key}"`
**Body:** `"${req.user.name} assigned you to: ${issue.title}"`

### `status_changed`
**When:** `status` field changes on an issue
**Who gets it:** The current `assignee_id` (if set)
**Must NOT fire:** If there is no assignee, or if the assignee made the change themselves
**Link format:** `/issues/${issue.key}`
**Title:** `"Issue status updated: ${issue.key}"`
**Body:** `"Status changed from '${oldStatus}' to '${newStatus}' on: ${issue.title}"`

### `comment_added`
**When:** A new comment is created (`POST /api/comments`)
**Who gets it:** The issue's `assignee_id` AND `reporter_id` — separately, deduplicated (don't send twice if they're the same person)
**Must NOT fire:** To the person who wrote the comment (`req.user.id`)
**Link format:** `/issues/${issue.key}#comments`
**Title:** `"New comment on ${issue.key}"`
**Body:** `"${req.user.name}: ${comment.body.substring(0, 100)}..."`

### `sprint_started`
**When:** `POST /api/sprints/:id/start` succeeds
**Who gets it:** ALL active members of the space (every row in `space_members` for this `space_id`)
**Link format:** `/spaces/${spaceId}/board`
**Title:** `"Sprint started: ${sprint.name}"`
**Body:** `"${req.user.name} started sprint '${sprint.name}' in ${space.name}"`

### `sprint_completed`
**When:** `POST /api/sprints/:id/complete` succeeds
**Who gets it:** ALL active members of the space
**Link format:** `/spaces/${spaceId}/reports`
**Title:** `"Sprint completed: ${sprint.name}"`
**Body:** `"Sprint '${sprint.name}' completed. Velocity: ${velocity} points"`

## createNotif() Signature
```js
createNotif(userId, spaceId, type, title, body, link)
// Always called without await — fire and forget
// The function has its own internal try/catch and never throws
```

## Rules That Always Apply
- Never `await` `createNotif()` in the request path — it must never block the response
- Never INSERT directly into `notifications` table outside of `createNotif()`
- Never send a notification to `req.user.id` (the person who triggered the action)
- Deduplication: if assignee === reporter on `comment_added`, send only one notification
- The `is_read` field always defaults to `false` on INSERT
- Notifications are never updated — only read (`PUT /notifications/:id/read`) or deleted
