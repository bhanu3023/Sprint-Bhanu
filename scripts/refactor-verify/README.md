# Refactor verification harness

Proves that a **pure structural refactor** changed nothing observable. Built for
the `server.js` / `app.js` file split; every phase of that refactor must pass all
four checks below before it is committed.

There is no pre-existing test suite covering application behaviour (`scripts/test-hotjar.js`
covers analytics masking only), so this harness *is* the safety net.

## Requirements

- The app running on `http://localhost:3000` (override with `SB_BASE`)
- Postgres reachable (override with `DATABASE_URL`)
- `playwright` + its Chromium build (already in devDependencies)

## The four checks

| # | Check | Command | Passing means |
|---|---|---|---|
| 1 | **Move purity** | `node scripts/refactor-verify/catdiff.js` | Concatenating the split files in load order is **byte-identical** to the pristine original from git. Proves lines were moved, never edited/reordered/reformatted. |
| 2 | **Global surface** | part of `compare.js` | `Object.keys(window)` and `typeof window[k]` are unchanged. Catches a lost global — the #1 way this refactor breaks silently, since 268 inline handlers depend on them. |
| 3 | **Rendered DOM** | part of `compare.js` | Normalized `document.body.innerHTML` is identical on all 47 captured pages. |
| 4 | **Behaviour** | `node scripts/refactor-verify/flows.js` | The 7 core flows still work end-to-end. |

Plus the existing `node scripts/test-hotjar.js` (138 assertions).

## Usage

```bash
# once, before touching any code
node scripts/refactor-verify/capture.js baseline

# after each phase
node scripts/refactor-verify/catdiff.js
node scripts/refactor-verify/capture.js phaseN
node scripts/refactor-verify/compare.js baseline phaseN
node scripts/refactor-verify/flows.js
node scripts/test-hotjar.js
```

Every command exits non-zero on failure, so they chain with `&&`.

## Files

- `capture.js` — snapshots window surface + per-page DOM into `.refactor-verify/<label>.json`
- `compare.js` — diffs two snapshots; prints the first differing hunks
- `catdiff.js` — the byte-identity proof, driven by `manifest.json`
- `flows.js` — the 7 core flows (login, open space, board, drawer, create issue, log work, report)
- `manifest.json` — `baselineRef` + `originals: { "<original file>": [ ...parts in load order ] }`
- `lib/session.js` — stable reusable test session (see below)
- `lib/normalize.js` — the volatility masks, each with a documented reason
- `lib/pages.js` — the captured page list

## Design notes that matter

**The session token is deliberately stable and stored outside the repo.**
`fileApiUrl()` embeds the live session token directly into `<img src>`, so a fresh
token per run would make every DOM snapshot differ for a reason unrelated to the
refactor. The token lives in the OS temp dir, never in git.

**Two spaces are captured, ordered by sprint count.** A space with no sprints
renders "No sprints found." on the reports/board/MBR tabs — capturing only such a
space would prove those renderers "identical" without ever executing them. The
most sprint-rich space is captured first for real report/burndown/board coverage,
plus a second space whose custom-field config differs.

**Normalization is narrow and anchored, by design.** Each rule in `lib/normalize.js`
masks exactly one genuinely volatile value (session token, ISO timestamp,
relative time, `temp-<epoch>` id, the Sprint Summary `Last Updated:` wall clock)
and states why. Nothing structural — no tag, class, id, attribute or text — is
masked, so a real regression still shows as a diff. Widening a rule weakens the
harness; if a new volatile value appears, add a new anchored rule rather than
loosening an existing one.

**Captures are read-only; only `flows.js` mutates.** A mutating capture would make
the next run differ for reasons unrelated to the refactor. `flows.js` deletes
every row it creates so snapshots stay comparable.

## Harness self-test (performed at build time)

The harness was verified to both **pass when nothing changed** and **fail when
something did**:

- re-capture with no code change → all 47 pages identical, window diff empty
- inject `window.__harnessCanary = 1` → detected as `ADDED (1): __harnessCanary`
- inject `data-harness-canary="1"` on a static element → detected on all 47 pages with exact hunks
- insert **one space** into a split part → `catdiff` failed and pinpointed the byte offset

A harness that only ever passes is worthless; these four results are what make
the "empty diff" claims in each phase meaningful.
