# Dead code inventory

Result of a dead-code investigation across `src/client/` and `src/server/`.
**Almost nothing was removed, deliberately.** This file exists so the next person
does not redo the work, and does not delete things that were considered and
consciously kept.

One deletion was made: `src/server/routes/notifications.js:5`, an unused
`sendEmail` require. Everything else below **stays**, with the reason recorded.

## Why the code stays: the 42/42 guarantee

`catdiff` currently proves that all **42 files under `src/client/` are byte-identical**
to the original 17,295-line `app.js` (with one declared relocation). That is
mechanical proof that the frontend is exactly what it was before any refactoring
started.

`catdiff` has **no `modified` flag** — zero occurrences in the file. Deleting even
one line inside a client file makes `[A]` and `[C]` fail outright, so the only way
to delete client code is to add a `modified` concept, exactly as `serverdiff` has.
The server tree shows what that costs: it began at 32/32 byte-verified and is now
**21/32**, and the erosion is permanent — once a file is flagged, byte-identity for
it can never be re-established.

The decision: **~300 lines of code that nothing calls, and that costs nothing at
runtime, is not worth trading the 42/42 guarantee for.** Do not re-litigate this
without a concrete reason that outweighs it.

---

## Client candidates — all PROVEN DEAD, all KEPT

18 symbols. Each has **zero** static references (its own declaration is the only
hit), is absent from all 429 inline handlers, and was **never invoked** during a
runtime probe covering 7 global views, 8 space tabs, the issue drawer, the
create-issue modal and the theme control.

| symbol | location | window-exported | note |
|---|---|---|---|
| `getProductTeamSpaceId` | `components/drawer-panels.js:733` | no | |
| `renderIssueCombinationField` | `components/drawer-panels.js:856` | no | one-line alias: `return renderIssueProductTypeSets(spaceId)`. The target has 3 live callers; the alias has none. Rename leftover. |
| `getOrCreateDescImageTray` | `components/space-context-menu.js:421` | no | |
| `addDescInlineImageChip` | `components/space-context-menu.js:453` | no | |
| `countAssignedPlusReported` | `components/space-header.js:11` | no | four unused counters in one file |
| `countOpenAssignedIssues` | `components/space-header.js:19` | no | |
| `getOpenAssignedCountLocal` | `components/space-header.js:24` | no | |
| `getMyIssueCountFromLocalData` | `components/space-header.js:30` | no | |
| `isSpaceMemberOnly` | `crud/space.js:23` | no | |
| `isSpaceOwner` | `crud/space.js:73` | no | |
| `richInsertImage` | `pages/admin-settings.js:1246` | no | |
| `renderTimeline` | `pages/space/timeline.js:27` | no | there is no `view-timeline` container in index.html. **`barChart` in the same file is LIVE** (called twice from `pages/space/summary.js:91,92`), so the file is not dead — only this function. |
| `isFavorited` | `services/data-helpers.js:136` | no | |
| `getRecentlyViewedCount24h` | `services/recently-viewed.js:120` | no | |
| `toggleTheme` | `services/theme.js:9` | no | |
| `goBackToSavedPage` | `components/modal-drawer.js:52` | **YES** (L86) | independently recorded in `scripts/refactor-verify/manifest.json` note 3 |
| `_copyIssueUrl` | `pages/admin-settings.js:1348` | **YES** | |
| `navigateToYourWorkOpen` | `services/recently-viewed.js:242` | **YES** (L265) | |

Deleting the three window-exported ones would legitimately shrink the 690-name
`[2b]` probe list by exactly 3, to 687. That has not been done.

## The `dateInputMap` block — PROVEN DEAD, KEPT

`src/client/event-bindings.js:401-422`, 22 lines. Superseded by the advanced
filter panel (`_awRenderPanel` + `_awSetDate`). None of the 8 element ids it binds
to (`awCreatedFrom` … `awStartDateTo`) exist anywhere, so `if (!el) return;`
returns for all eight and the listener is never attached. Full evidence in
`AUDIT-FINDINGS.md`, including why `_updateDateBadge` is **not** a bug.

Kept for the same reason as everything else above: it is inside a client file.

---

## Server — unused requires

One was removed. Three remain because removing a single name from a multi-name
destructure means **editing a line, not deleting one**:

| location | unused name(s) | status |
|---|---|---|
| `routes/notifications.js:5` | `sendEmail` | **REMOVED** — whole line |
| `routes/auth.js:2` | `crypto` | kept — `uid`, `wrap` are live on that line |
| `routes/oauth.js:1` | `hashPassword`, `requireAuth`, `verifyPassword` | kept — `generateToken` is live on that line |
| `routes/oauth.js:4` | `requireOrgAdmin` | kept — `oauthStates` is live on that line |

## Server — "dead exports" that are NOT dead

Nine names appear in a `module.exports` and are never imported anywhere else.
**Every one is used inside its own module**, so the function is live and only the
export entry is spare. Deleting the function breaks its module; deleting the name
edits the exports line. Both were declined.

`resolveSessionFromToken` (`auth.js`, 3 in-file refs) · `RESERVED_FIELD_NAMES` (`core.js`, 2) ·
`normalizeFieldName` (`core.js`, 3) · `purgeIssueCascade` (`deps.js`, 2) ·
`getEmailSettings` (`email.js`, 2) · `emailWrapper` (`email.js`, 2) ·
`getFileLinkedSpaceIds` (`files.js`, 2) · `MAX_UPLOAD_REQUEST_BYTES` (`files.js`, 3) ·
`MS_CLIENT_SECRET` (`oauth-helpers.js`, 2)

The `lib/*` modules have the same shape (`builtin-issue-fields.js`, `migrate.js`,
`permissions.js`, `retention.js`, `sprint-complete.js`).

**"Not imported" is not "unused".** Check in-file usage before believing a tool here.

## Server routes — UNPROVABLE, all kept

Of 112 route registrations, 12 had no first-party client reference. Three were
cleared as live:

- `POST /api/auth/login` — `dev-login.html` posts to it. A scan of `index.html` +
  `login.html` alone misses this.
- `GET /api/auth/callback/microsoft` — reached by the external Microsoft redirect;
  `login.html` links `/auth/microsoft` in 4 places.
- `GET /api/reports/cycle-time` — `scripts/test-scenarios.js:172`, run by
  `npm run test-scenarios`.

The remaining seven have no first-party caller **and cannot be proven dead** — a
route is reachable by anything holding a token: curl, an integration, a bookmark.
`UNPROVABLE` means it stays.

`GET /api/filters` · `POST /api/filters` · `PUT /api/filters/:id` ·
`DELETE /api/filters/:id` (the saved-filters feature has **no client wiring at
all**) · `POST /api/issues/bulk` · `GET /api/reports/priority` ·
`GET /api/reports/workload` · `POST /api/spaces/recover`

## `/api/debug/spaces` — a security question, not a dead-code one

`src/server/routes/spaces.js:62`. Tracked separately because the issue is not
deadness.

It has `requireAuth` (401 unauthenticated) but **no role or membership check**, and
returns every space in the org. Demonstrated with a `viewer` who belongs to exactly
one space:

```
/api/debug/spaces  ->  200, count:5, all spaces with id, name, key, is_archived
/api/data          ->  1 space [DEM]
```

So it bypasses the space scoping every other read path enforces. No secrets and no
issue data, but space ids are the handle other endpoints take as `space_id` (those
endpoints do their own permission checks). Options: gate it to org admin, or remove
it. Either is a behaviour change and needs its own decision.

---

## Not investigated

**Unused function parameters and unused local declarations.** Deliberately skipped:
same cost as everything above, less value, and high noise.

## Two tooling failures worth knowing about

Recorded because both would have caused real damage, and the next person will
likely write the same tools.

1. **A symbol scanner reported `$` with 0 references. It has 1,145.** `\b` word
   boundaries do not work on `$`, because `$` is not a word character. Acting on
   that output would have deleted the most-used helper in the codebase. Any
   identifier scanner here must special-case `$`, `_` and other
   non-word-character names.

2. **A runtime probe reported two known-live controls (`barChart`, `renderAllWork`)
   as never invoked.** The wrappers were installed *after* page load, and every
   view render fires during load, so full-page navigation lost every call. Fixed by
   wrapping once and then navigating through the app's own router
   (`navigateTo` / `navigateToSpace`) so no reload occurs. Only after that did the
   controls register (`statusBadge` 155, `barChart` 2, `renderAllWork` 1) and the
   candidate zeros become meaningful.

**Always include known-live controls in a deadness probe.** If a control reads zero,
the probe is broken, not the code.

## Inline handler census

**429 inline handlers**: 121 in `index.html` + `login.html`, and **308 built inside
JS template literals**. A grep of `.js` files alone misses the HTML ones; a grep of
HTML alone misses the larger set. Any reachability claim must cover both.

## Dynamic access — bounded, re-confirmed

`eval`, `new Function`, string-argument `setTimeout`/`setInterval` and dynamic
`require`: **zero occurrences**.

Computed `window[...]` access **does** exist, at three sites, but is bounded to four
literal keys:

- `components/drawer-panels.js:1344-1345` — read and write of `window[stateKey]`,
  where `stateKey` is `config.stateKey || '_issuePtComboSel'` and the only call
  sites pass `'_issuePtComboSel'` (L852) and `'_drawerPtComboSel'` (L922)
- `utils/index.js:190` — read of `window[origKey]`, a ternary between
  `'_drawerDescOriginalHtml'` and `'_drawerFixDescOriginalHtml'`

All four are underscore-prefixed **state slots**, not function names, so no function
is reachable through computed access. Two of them (`_drawerDescOriginalHtml`,
`_drawerFixDescOriginalHtml`) are live window state written in
`components/issue-drawer.js` at 6 sites and read dynamically — anything touching
those must account for the dynamic read.

If a future change introduces computed access to an arbitrary key, this conclusion
is void and every window-exported symbol needs individual clearance again.
