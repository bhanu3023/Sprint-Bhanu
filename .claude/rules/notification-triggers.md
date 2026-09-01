# Notification Triggers

> **This describes what the code does after the 2026-09-01 notification-coverage
> pass.** That pass audited every role (assignee, reporter, plain member, space
> admin, org admin) against what actually notified them, closed the gaps found,
> and this file was rewritten to match the result. Nothing about issue statuses,
> permissions, or sprint lifecycle changed alongside it — only who gets told
> about what.

## The signature

`createNotif` takes **one object**, not six positional arguments.

```js
createNotif({ user_id, space_id, type, title, body, link })
```

- `user_id` is required; the call returns immediately if it is falsy.
- `space_id` and `link` are optional — `org_member_joined` (below) has no
  natural single space, so it omits both.
- Always called **without `await`**. It has its own internal try/catch and
  never throws, so it can never fail a request.
- `src/server/notify.js:10`.

## The twelve types

| Type | Fires on | Recipient | Emails? |
|---|---|---|---|
| `issue_assigned` | `assignee_id` is set, on **creation or update** | the assignee | yes |
| `reporter_assigned` | `reporter_id` is set, on **creation or update** | the reporter | yes |
| `status_changed` | `status` changes | assignee **and** reporter | yes |
| `priority_changed` | `priority` changes | assignee **and** reporter | yes |
| `comment_added` | a comment is created | assignee + reporter | yes |
| `mention` | a comment names `mentioned_user_ids` | each mentioned user | yes |
| `sprint_started` | `POST /api/sprints/:id/start` | every space member | no |
| `sprint_completed` | sprint completes (manual or automatic) | every space member | no |
| `space_created` | `POST /api/spaces` | every other active org owner/admin | no |
| `space_member_added` | `POST /api/space-members` | the added member | no |
| `space_role_changed` | `PUT /api/space-members/:id`, role actually changes | the target member | no |
| `org_member_joined` | `POST /api/auth/accept-invite` | every active org owner/admin | no |

The six issue-level types (`issue_assigned`, `reporter_assigned`,
`status_changed`, `priority_changed`, `comment_added`, `mention`) send email
(`emailTypes` in `src/server/notify.js:17`). The two sprint types and the four
admin/space-housekeeping types below them are **in-app only** — they fire more
often per person than a single ticket's lifecycle does, and would be noisy by
email.

## Exact strings

`issueKey` is `issues.key` (e.g. `ENG-42`) falling back to the raw id.
The issue link is `'/?issue=' + encodeURIComponent(issueKey)` for every
issue-level type — **not** `/issues/<key>`.

### `issue_assigned` — `src/server/routes/issues.js:434` (creation) and `:512` (update)
- title: `` `You were assigned to ${issueKey}` ``
- body: the issue title
- Fires whenever `assignee_id` is set to someone who isn't the actor — at
  creation (a ticket made with an assignee already picked) or on a later
  update (assignee changed). Both call sites are the same check; creation is
  not a separate code path with different rules.

### `reporter_assigned` — `src/server/routes/issues.js:438` (creation) and `:523` (update)
- title: `` `You were set as reporter on ${issueKey}` ``
- body: the issue title
- Symmetric to `issue_assigned`, same creation-or-update firing rule.
- **Skipped when the new reporter IS the assignee** (whichever notice applies
  is already firing for that same person on that same change; a second "you're
  also the reporter" ping right alongside it is not useful) — checked against
  `newRow.assignee_id` at update time, `created.assignee_id` at creation time.

### `status_changed` — `src/server/routes/issues.js:537`
- title: `` `${issueKey} status changed to ${newStatus}` ``
- body: the issue title
- Recipients: `new Set([assignee_id, reporter_id])`, actor excluded, same
  dedup shape `comment_added` already used — one person who is both gets
  exactly one notification, not two.

### `priority_changed` — `src/server/routes/issues.js:549`
- title: `` `${issueKey} priority changed to ${newPriority}` ``
- body: the issue title
- Same recipient set and dedup as `status_changed`.

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

### `space_created` — `src/server/routes/spaces.js:78`
- title: `` `${creatorName} created a new space: ${spaceName}` ``
- body: `` `Key: ${key}` ``
- link: `/space/<SPACE_KEY>` (falls through the client's generic
  `spaceId`-present case to the space's Summary tab — there is no
  `/space/<key>` regex of its own in `openNotifTarget`, and it doesn't need one)
- Recipients: every ACTIVE `owner`/`admin` in the creator's org **except the
  creator**. An org admin who did not personally create a space still keeps
  visibility over the whole org this way.

### `space_member_added` — `src/server/routes/spaces.js:211`
- title: `` `You were added to ${spaceName}` ``
- body: `` `${actorName} added you as a ${role}.` `` (underscore in the role
  value replaced with a space, e.g. `site admin`)
- link: `/space/<SPACE_KEY>`
- Skipped if the actor added themself (guarded the same way self-assignment
  is everywhere else, even though the normal path to space membership for a
  space's own creator is a direct INSERT in `POST /api/spaces`, not this route).

### `space_role_changed` — `src/server/routes/spaces.js:235`
- title: `` `Your role in ${spaceName} was changed to ${newRole}` ``
- body: `` `Changed by ${actorName}.` ``
- link: `/space/<SPACE_KEY>`
- Fires only when the role actually changed (`rec.role !== validated.role`)
  and the actor isn't the target.

### `org_member_joined` — `src/server/routes/auth.js` (`POST /api/auth/accept-invite`)
- title: `` `${newUserName} joined your organization` ``
- body: `` `Invited as ${role}. Email: ${email}` ``
- No `space_id`, no `link` — there is no single space this belongs to.
- Recipients: every active `owner`/`admin` in the org, **including whoever
  sent the invitation** — there is no admin "actor" on this route (the person
  accepting isn't one), so nobody is excluded.
- Fires on invitation **acceptance**, not on routine login. A login-based
  version was considered and rejected: it would fire on every single sign-in
  for the life of the account, which is not the "someone new just joined"
  signal an admin actually wants — accept-invite is the one moment that
  signal is real.

## Who does NOT get notified

These guards are implemented and load-bearing. Tests cover the issue-level ones.

- **The actor never notifies themself** on every type above except the two
  sprint types and `org_member_joined` (see below for why those differ). Every
  other call site is wrapped in a `!== actor` check, however that type spells
  "the actor" (`!== actor`, `!== commenter`, `!== req.user.id`).
- **No assignee/reporter, no notification.** `status_changed` and
  `priority_changed` build their recipient Set from whichever of
  `assignee_id`/`reporter_id` is actually set; an issue with neither produces
  no notification at all, not an error.
- **`comment_added` and the status/priority pair are all deduplicated the same
  way.** Recipients are built as a `Set` of `[assignee_id, reporter_id]`, so
  one person who is both gets exactly one notification.
- **`reporter_assigned` is deduplicated against `issue_assigned`.** A newly
  set reporter who is also the assignee gets only the assignment notice.

### The places the actor IS notified

- `sprint_started` and `sprint_completed` go to **every** row in
  `space_members` for the space, including the person who clicked the button.
  This is intentional: a sprint transition is an announcement to the team.
- `org_member_joined` goes to every org admin with no exclusion, because the
  route has no admin actor to exclude — the person triggering it is the
  invitee, who isn't in the recipient list's role filter (`owner`/`admin`)
  regardless.

The blanket "actor never notifies themself" rule applies everywhere else:
the five original issue-level types, `reporter_assigned`, `space_created`,
`space_member_added`, and `space_role_changed`.

## Storage rules

- `is_read` defaults to `false` at the DB level.
- Notifications are **not** edited in place except to mark them read:
  `PUT /api/notifications/:id/read` and `PUT /api/notifications/read-all`.
  Nothing rewrites `title`, `body` or `link` after insert.
- `DELETE /api/notifications/:id` removes one.
- `notifications.type` is a plain `varchar` with no DB `CHECK` constraint, so
  adding a new type (as this pass did, four times) never needs a migration.

## The one direct-INSERT exception

`POST /api/notifications` inserts straight into the table without going through
`createNotif`. It is **org-admin only** (`requireOrgAdmin`) and exists as an
admin utility. Application flows must still use `createNotif` — do not add a
second one.

## Client rendering

- `src/client/components/notifications.js`'s `tIcons`/`tColors` maps give
  each of the twelve types its own icon and color in the notification panel;
  an unmapped future type falls back to a generic bell and a neutral blue,
  which is a safe default, not a bug to fix reactively.
- `_notifTypeMap` (the same file) is the mute-list a user's notification
  preferences can turn off — only the original seven types are wired into it.
  The five newer types (`reporter_assigned`, `space_created`,
  `space_member_added`, `space_role_changed`, `org_member_joined`) are **not**
  in that map, so they render unconditionally, the same as any other
  currently-unmapped type. Giving them their own preference toggles is a
  separate UI change, not something this pass did.
- `openNotifTarget` resolves a click generically: an issue-shaped link or
  title opens the issue directly; `/space/<key>/board` and
  `/space/<key>/reports` have their own regexes; anything else carrying a
  `space_id` (which covers `space_created`, `space_member_added`, and
  `space_role_changed`) falls through to that space's Summary tab.
  `org_member_joined` carries neither, so clicking it shows a "no linked
  destination" toast — an honest result, not a broken one, since there is no
  single page it belongs to.

## Known gaps, deliberately not implemented

- **`is_active` is not filtered on sprint notifications.** Both sprint types
  query `space_members` with no join to `users.is_active`, so a deactivated
  member still accumulates rows. Harmless today (they cannot log in to see
  them) and left alone.
- **`mention` is not deduplicated against `comment_added`.** A mentioned user
  who is also the assignee or reporter receives both. The inline comment at
  `comments.js:38` overstates this as deduped.
- **Bulk operations do not notify.** `POST /api/issues/bulk` (multi-select bulk
  edit) can change many issues' `assignee_id`/`status`/`priority` at once and
  fires no notifications for any of them — extending the single-issue logic
  above to a batch of arbitrary size, and deciding whether that means one
  notification per issue or a consolidated summary, was left as a deliberate
  scope boundary rather than guessed at. `POST /api/issues/bulk-import` (CSV
  create) DOES notify per row, because it creates each row through the same
  shared `createIssueRow()` the single-create route uses.
- **No notification on space-member removal.** `DELETE /api/space-members/:id`
  does not tell the removed person. Being added is a positive, actionable
  event; being removed mostly isn't (they will simply stop seeing the space),
  and a removal notice reads more like a confrontation than a heads-up.
- **No notification on space settings changes.** `PUT /api/spaces/:id`
  (rename, re-color, archive, etc.) does not notify anyone. Scoped out as
  lower-value than the member/role/creation events above, and there is no
  single obvious recipient set for "this space's settings changed" the way
  there is for "you were added" or "your role changed".
