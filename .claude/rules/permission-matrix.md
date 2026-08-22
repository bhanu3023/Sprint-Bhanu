# Permission Model

> **This describes what the code does as of `1b6292d` (2026-08-22).** The
> previous version documented four space roles with a read-only `viewer`. The
> implementation collapsed to three tiers well before that, and `viewer` has
> full member rights. Treating the old table as spec would have produced
> "bugs" that were nothing of the kind.

## Three tiers, not four

All permission decisions go through `lib/permissions.js`. Nothing does its own
inline role arithmetic any more.

| Tier | Where it lives | What it means |
|---|---|---|
| **Org Admin** | `users.role` is `owner` or `admin` | Full org control. Bypasses every space check. |
| **Space Admin** | `space_members.role` normalizes to `site_admin` | Manages one space: sprints, members, settings, reports. |
| **Member** | `space_members.role` normalizes to `member` | Issues, comments, worklogs. No sprints, reports or settings. |

Space role ranks are literally two values:

```js
const SPACE_ROLE_RANK = { member: 1, site_admin: 2 };
```

### Legacy values normalize

`normalizeSpaceRole()` (`lib/permissions.js:107`) maps stored values onto the
two real ones:

| Stored in `space_members.role` | Behaves as |
|---|---|
| `site_admin`, `manager`, `owner`, `admin` | **site_admin** |
| `member`, `viewer`, anything else | **member** |

Two consequences that surprise people:

- **`viewer` is NOT read-only.** A row with `role='viewer'` can create and edit
  issues, comment, and log work. If a genuinely read-only role is wanted, it
  does not exist yet and must be built.
- **`manager` is a full space admin.** It can start and complete sprints and
  view reports.

Only `member` and `site_admin` may be *assigned* going forward
(`ALLOWED_SPACE_ROLES`); the legacy values are accepted on read only.

### Non-members are not members

`normalizeSpaceRole(null)` returns `'member'`, which looks alarming in
isolation. It is never reached for a non-member: `getSpaceMemberRole` returns
`null` before calling it, and `canActInSpace` returns false on a null role. A
user who is not in `space_members` is refused, whatever their org role — unless
they are an org admin, who bypasses the space check entirely.

## The action table

`ACTION_MIN_ROLE` is the single source of truth. Org admin bypasses all of it.

| Action | Minimum space role |
|---|---|
| `issue.read`, `issue.create`, `issue.update`, `issue.move` | member |
| `issue.delete`, `issue.bulk` | **site_admin** |
| `sprint.read` | member |
| `sprint.manage` (create / start / complete / delete) | **site_admin** |
| `comment.create`, `comment.update` | member (+ ownership, below) |
| `comment.delete` | **site_admin** |
| `worklog.read`, `worklog.create` | member (+ ownership, below) |
| `attachment.read`, `attachment.upload` | member |
| `custom_field.read` | member |
| `custom_field.manage` | **site_admin** |
| `filter.read`, `filter.manage` | member |
| `space_member.read` | member |
| `space_member.manage` | **site_admin** |
| `space.settings` | **site_admin** |
| `report.view` | **site_admin** |
| `roadmap.manage`, `link.manage`, `notification.read` | member |

An action absent from this table is **denied** (`if (!minRole) return false`).

### Stricter than the old doc, and intended

These were previously documented as "own only" for members. They are
site_admin-level, and that is the intended behaviour, not a regression:

- **`issue.delete`** — a member cannot soft-delete even their own issue.
- **`comment.delete`** — a member cannot delete even their own comment.

### Row-level ownership, on top of the tier check

Two resources add an ownership check *after* the tier check passes. The tier
check runs first deliberately, so a non-member gets a membership error rather
than one that confirms the row exists.

| Resource | Rule | Where |
|---|---|---|
| Comment edit | author, **or org admin** | `src/server/routes/comments.js` |
| Worklog edit / delete | author, **or org admin** | `src/server/routes/worklogs.js:47` |

Note the elevated role for both is **org** admin, not space admin. A space
site_admin who did not write the comment cannot edit it.

## Org-level actions (`users.role`)

Checked with `requireOrgAdmin`, which accepts `owner` and `admin`.

| Action | owner | admin | member |
|---|---|---|---|
| Create space | ✅ | ✅ | ❌ |
| Recover space | ✅ | ✅ | ❌ |
| Invite user / change role / deactivate | ✅ | ✅ | ❌ |
| Restore or purge a deleted issue | ✅ | ✅ | ❌ |
| `GET /api/debug/spaces` | ✅ | ✅ | ❌ |
| Create a notification directly | ✅ | ✅ | ❌ |

`owner` and `admin` are not distinguished anywhere in `isOrgAdmin`.

## How to check a permission

Do not write inline role comparisons. Use the helper:

```js
// space-scoped: answers 403 with the action's own message and returns false
if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.create'))) return;

// org-scoped
if (!requireOrgAdmin(req.user, res, 'Only an org admin can do X.')) return;
```

Adding a new action means adding it to **both** `ACTION_MIN_ROLE` and
`ACTION_DENIED_MESSAGE`. A missing entry is a silent deny.

## Known gaps, deliberately not implemented

- **No read-only role.** `viewer` normalizes to `member`. Building one means a
  new rank, not a doc change.
- **`reporter_id` is not role-restricted.** It sits in
  `UPDATE_WHITELIST.issues` with no special handling, so any member may
  reassign who reported an issue. Previously documented as forbidden for
  members; never implemented.
- **`owner` vs `admin` is not distinguished.** The old doc gave only `owner`
  the right to delete a user; `isOrgAdmin` treats them identically.
