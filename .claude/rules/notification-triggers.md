# Notification Triggers

> **This describes what the code does as of `1b6292d` (2026-08-22).** The
> previous version documented five types with exact title/body/link strings that
> matched nothing in the codebase, and a positional `createNotif` signature that
> would have thrown. Users see the strings below today, so the code is the
> specification and this file has been rewritten to match it.

## The signature

`createNotif` takes **one object**, not six positional arguments.

```js
createNotif({ user_id, space_id, type, title, body, link })
```

- `user_id` is required; the call returns immediately if it is falsy.
- Always called **without `await`**. It has its own internal try/catch and
  never throws, so it can never fail a request.
- `src/server/notify.js:10`.

## The seven types

| Type | Fires on | Recipient | Emails? |
|---|---|---|---|
| `issue_assigned` | `assignee_id` changes on **update** | the new assignee | yes |
| `status_changed` | `status` changes | current assignee | yes |
| `priority_changed` | `priority` changes | current assignee | yes |
| `comment_added` | a comment is created | assignee + reporter | yes |
| `mention` | a comment names `mentioned_user_ids` | each mentioned user | yes |
| `sprint_started` | `POST /api/sprints/:id/start` | every space member | no |
| `sprint_completed` | sprint completes (manual or automatic) | every space member | no |

The five issue-level types also send email (`emailTypes` in
`src/server/notify.js:17`). The two sprint types are in-app only.

## Exact strings

`issueKey` is `issues.key` (e.g. `ENG-42`) falling back to the raw id.
The issue link is `'/?issue=' + encodeURIComponent(issueKey)` for all five
issue types — **not** `/issues/<key>`.

### `issue_assigned` — `src/server/routes/issues.js:460`
- title: `` `You were assigned to ${issueKey}` ``
- body: the issue title
- **Fires on update only.** Creating an issue with an assignee notifies nobody.

### `status_changed` — `src/server/routes/issues.js:469`
- title: `` `${issueKey} status changed to ${newStatus}` ``
- body: the issue title

### `priority_changed` — `src/server/routes/issues.js:478`
- title: `` `${issueKey} priority changed to ${newPriority}` ``
- body: the issue title

### `comment_added` — `src/server/routes/comments.js:26`
- title: `` `New comment on ${issueKey}` ``
- body: the comment, truncated to **80 characters** with a `…` (single
  ellipsis character) appended when longer
- link: `/?issue=<key>` — no `#comments` fragment

### `mention` — `src/server/routes/comments.js:39`
- title: `` `${commenterName} mentioned you on ${issueKey}` ``
- body: the same 80-character preview
- Driven by `mentioned_user_ids` in the request body, which the client supplies.

### `sprint_started` — `src/server/routes/sprints.js`
- title: `` `${sprint.name} has started` ``
- body: `Sprint is now active. Time to get to work!`
- link: `/space/<SPACE_KEY>/board` — keyed by space **key**, not id

### `sprint_completed` — `lib/sprint-complete.js:93`
- title: `` `${sprint.name} has been completed` ``
- body, manual: `` `Sprint completed with ${points} story points.` ``
- body, automatic (the 23:59 end-date sweeper):
  `` `Sprint reached its end date and closed automatically with ${points} story points.` ``
- link: `/space/<SPACE_KEY>/reports`

## Who does NOT get notified

These guards are implemented and load-bearing. Tests cover them.

- **The actor never notifies themself** on the five issue-level types. Every
  one is wrapped in a `!== actor` / `!== commenter` check.
- **No assignee, no notification.** `status_changed` and `priority_changed` are
  skipped entirely when `assignee_id` is null.
- **`comment_added` is deduplicated.** Recipients are built as a `Set` of
  `[assignee_id, reporter_id]`, so one person who is both gets exactly one.

### The one place the actor IS notified

`sprint_started` and `sprint_completed` go to **every** row in `space_members`
for the space, including the person who clicked the button. This is intentional:
a sprint transition is an announcement to the team, and the previous version of
this file contradicted itself by stating a blanket "never notify `req.user.id`"
alongside per-type rules saying "ALL members". The blanket rule applies to the
five issue types only.

## Storage rules

- `is_read` defaults to `false` at the DB level.
- Notifications are **not** edited in place except to mark them read:
  `PUT /api/notifications/:id/read` and `PUT /api/notifications/read-all`.
  Nothing rewrites `title`, `body` or `link` after insert. (The previous file
  claimed notifications are "never updated" and then named the read route —
  marking-read is the only update.)
- `DELETE /api/notifications/:id` removes one.

## The one direct-INSERT exception

`POST /api/notifications` inserts straight into the table without going through
`createNotif`. It is **org-admin only** (`requireOrgAdmin`) and exists as an
admin utility. Application flows must still use `createNotif` — do not add a
second one.

## Known gaps, deliberately not implemented

- **`is_active` is not filtered on sprint notifications.** Both sprint types
  query `space_members` with no join to `users.is_active`, so a deactivated
  member still accumulates rows. Harmless today (they cannot log in to see
  them) and left alone.
- **`issue_assigned` does not fire on creation.** Creating an issue with an
  assignee set notifies nobody; only a later change does. The old doc claimed
  "creation with assignee OR update".
- **`mention` is not deduplicated against `comment_added`.** A mentioned user
  who is also the assignee or reporter receives both. The inline comment at
  `comments.js:38` overstates this as deduped.
