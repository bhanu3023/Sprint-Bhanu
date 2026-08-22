# Audit findings — what is a bug, what is not

A read-only audit produced a list of suspected defects. Some were real and are
fixed. **One was not a bug at all**, and this file exists so nobody re-opens it
on the strength of the original audit note.

Rule of thumb this list enforces: *a missing definition is not a broken feature
until you prove the call site executes.*

---

## NOT A BUG — investigated, unreachable dead code, no fix required

### `_updateDateBadge` — `src/client/event-bindings.js:419`

**Audit claim:** called but never defined, so All Work date filters throw a
ReferenceError, set state and never re-render.

**Verdict: not a bug.** The call site never executes. Do not "fix" this.

Runtime evidence, gathered against the running app in a browser:

| Check | Result |
|---|---|
| The 8 element ids the handler binds to (`awCreatedFrom`, `awCreatedTo`, `awUpdatedFrom`, `awUpdatedTo`, `awDueDateFrom`, `awDueDateTo`, `awStartDateFrom`, `awStartDateTo`) | **0 hits** in `index.html`; no JS creates them; the only references anywhere are inside the `dateInputMap` literal itself |
| Present in the live DOM on the All Work tab | **0 of 8** |
| Consequence | `var el = $(elId); if (!el) return;` returns for all eight, so the `change` listener is **never attached** |
| `typeof window._updateDateBadge` at runtime | `undefined` — but never invoked, so **no ReferenceError is ever thrown** |
| Console during a full All Work session incl. date filtering | **zero warnings, zero errors** |

**Date filtering already works.** The live path is
`window._awSetDate` (`src/client/pages/space/all-work.js:329`), which the
advanced filter panel renders inline as
`onchange="window._awSetDate('created','from',this.value)"`. It sets
`S.awFilters[...]` **and calls `renderAllWork()`**. Proven live:

```
_awSetDate('created','from','2030-01-01')  ->  table rows 50 -> 0
_awSetDate('created','from','')            ->  table rows back to 50
```

`all-work.js:518` documents the same thing in a comment.

**Why no code was written:** defining the function would change nothing
observable, because nothing calls it. There is also no badge element for it to
update — the panel re-renders wholesale. Writing an implementation against a
dead call site, targeting elements that do not exist, would be inventing
behaviour.

---

## Proven-dead deletion candidate — for a separate, deliberate pass

### The `dateInputMap` block — `src/client/event-bindings.js:401-422`

22 lines. Superseded by the advanced filter panel (`_awRenderPanel` +
`_awSetDate`). Unreachable for the reasons proven above: none of the 8 element
ids it looks up exist, so the loop body never runs past `if (!el) return;`.

It survives because the structural refactor's rule was that dead code **moves
with the code, never gets deleted** — removing it is a content change, not a
move. It should be removed deliberately, with its own verification, or not at
all. Do not delete it as a drive-by.

---

## Lines vs split elements — a counting distinction, not a discrepancy

`src/client/components/global-search.js` is described in two places as 476 lines
and as covering original `app.js` range `16819-17295`, which is 477. **Neither
number is wrong; they count different things.**

- **476** = newline characters in the file (`wc -l`).
- **477** = elements of `content.split('\n')`, the last being the empty string
  after the file's final newline.

The manifest's `from`/`to` ranges are expressed in **split-element space**,
which is what `catdiff` compares against. Pristine `app.js` is 17,294 newlines
and 17,295 split elements, and the sum of `wc -l` across all 42 client files is
17,294 — consistent throughout. Do not "correct" either number.

---

## Follow-up list — open, deliberately not fixed yet

| Item | Note |
|---|---|
| `dev-login.html` | **KEEP.** Local-only, untracked, in `.git/info/exclude`, 0 entries in `git archive`, served only when `ALLOW_DEV_LOGIN=1`. `login.html` is Microsoft-OAuth only, so this is the only local password login. If a cleanup pass flags it, the answer is keep. |
| `lib/schema-check.js:50,106` | Operator advice naming `001-production-schema.sql` and `003-product-team-combination.sql`, neither of which has ever existed. |
| Stale files on the production server | The deploy extracts over `/opt/Sprint-Board` without wiping, so files deleted from git persist on disk and get baked into each image. Needs a one-time `rm` or `--delete` handling. Unreachable over HTTP thanks to the static allowlist. |
| No auth audit logging | Failed logins are recorded nowhere and there is no request logging at all, so an attack on the login endpoint leaves no trace. Prevention exists; detection does not. |
| Login rate limiter is per-process | In-memory counters, so the effective limit multiplies by instance count behind more than one container. Single container today. |
| `[3]` DOM check is data-thin on PTM | PTM has no sprints, so its board/reports/MBR pages render "No sprints found." identically before and after any change and contribute almost no discriminating power. Real coverage rests on ENG. Known, accepted. |
