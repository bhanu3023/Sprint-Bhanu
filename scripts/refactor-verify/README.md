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
| 1 | **Move purity** | `node scripts/refactor-verify/catdiff.js` | Four sub-checks, all on **RAW untransformed bytes**: **[A]** each part's bytes equal the original's bytes for the line range it claims; **[B]** the ranges tile 1..N with no gap or overlap; **[C]** concatenating them reproduces the whole original byte-for-byte; **[D]** the `<script src>` order parsed from the *real* `index.html` equals the parts' ascending line order. Order is never trusted from the manifest — a disagreement is reported as the bug. |
| 2 | **Global surface** | part of `compare.js` | `Object.keys(window)` and `typeof window[k]` unchanged. |
| 2b | **Declarative globals** | part of `compare.js` | Every expected global probed **by name**. `Object.keys(window)` cannot see top-level `const`/`let`, and `S`, `esc`, `$`, `qs`, `qsa`, `cap`, `escAttr` are all in that blind spot — see below. |
| 3 | **Rendered DOM** | part of `compare.js` | Normalized `document.body.innerHTML` identical on all 47 captured pages. |
| 4 | **Behaviour** | `node scripts/refactor-verify/flows.js` | The 7 core flows still work end-to-end. |

### Why check 2b exists (a real blind spot, demonstrated)

In a classic `<script>`, `function f(){}` and `var x` become `window` properties,
but `const x = ...` creates a binding in the global *declarative* record — visible
to every script and to inline handlers, but **absent from `Object.keys(window)`**.
Verified on the real baseline: `S`, `esc`, `escAttr`, `qs`, `qsa`, `cap` are all
invisible to the key list, and they are the most-used symbols in the codebase
(`$` 122 call sites, `esc` 103, `S` read by 151 functions).

Demonstrated by renaming a `const` and re-running every check:

```
[1] Object.keys(window)  before=900  after=900   -> IDENTICAL (empty diff)   <- blind
[2] typeof window[k]                             -> IDENTICAL (empty diff)   <- blind
[3] DOM, all 47 pages                            -> identical               <- blind
[2b] *** LOST GLOBALS (1): PRIORITY_ICONS                                   <- caught it
```

Only 2b caught it. Without it, losing `esc` or `$` in a split could have passed
every other check.

**RAW byte-identity is mandatory for check 1.** There is no line-ending fallback
that can produce a PASS. CRLF→LF normalization is used *only* as a failure
diagnostic: when RAW fails, the output says whether the content was identical and
only line endings differed, so a line-ending problem is instantly distinguishable
from lost or edited content.

Plus the existing `node scripts/test-hotjar.js` (138 assertions).

## Usage — per phase, NOT against a pinned baseline

The behavioural baseline is **recaptured immediately before every phase**, on
unchanged code. It is deliberately *not* pinned to one snapshot taken once:

- `flows.js` mutates data (it cleans up after itself, but relying on that being
  perfect is fragile)
- the server runs background mutators — `startSprintAutoCompleter` every 60s and
  `startRetentionSweeper` every 6h — which can change data with no one touching
  the app
- a human may use the app between phases

Any of those makes a pinned DOM baseline drift, producing non-empty diffs for
reasons unrelated to the refactor. Capturing both sides at the same DB state
leaves **code as the only variable**.

```bash
# 1. BEFORE the phase, on unchanged code
node scripts/refactor-verify/capture.js before-phaseN
node scripts/refactor-verify/dbfingerprint.js before-phaseN

# 2. ... do the phase ...

# 3. AFTER the phase
node scripts/refactor-verify/catdiff.js                          # move purity
node scripts/refactor-verify/capture.js after-phaseN
node scripts/refactor-verify/compare.js before-phaseN after-phaseN
node scripts/refactor-verify/dbfingerprint.js after-phaseN
node scripts/refactor-verify/dbfingerprint.js --compare before-phaseN after-phaseN
node scripts/test-hotjar.js

# 4. flows LAST, so a mutating flow can never contaminate a compared capture
node scripts/refactor-verify/flows.js
```

Every command exits non-zero on failure, so they chain with `&&`.

`baselineRef` in `manifest.json` is a **source** baseline (a git ref) and stays
pinned at the pre-refactor commit forever — that is what proves the
concatenation still reproduces the *original*. It is a different thing from the
behavioural baseline above, which must not be pinned.

## Files

- `capture.js` — snapshots window surface + per-page DOM into `.refactor-verify/<label>.json`
- `compare.js` — diffs two snapshots; prints the first differing hunks
- `catdiff.js` — the move-purity proof (checks A–D above), driven by `manifest.json`
- `flows.js` — the 7 core flows (login, open space, board, drawer, create issue, log work, report)
- `dbfingerprint.js` — per-table row count + PK hash + max timestamp; tells a
  refactor-caused DOM diff apart from a data-drift-caused one
- `manifest.json` — `baselineRef` + `targets: [{ original, orderFrom, parts: [{ file, from, to }] }]`
- `lib/session.js` — stable reusable test session; also ranks spaces by sprint count
- `lib/normalize.js` — the volatility masks (see the register below)
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

## Normalizer register — every mask, its anchor, and what it hides

Every normalization rule is a place a real regression could hide, so the full set
is enumerated here. **Adding a rule requires explicit sign-off.** If a diff comes
back empty on a page whose renderer was just moved, check this table first — an
over-broad rule, not a clean move, may be the reason.

| # | Anchor (regex) | Masks | Why it is volatile | Could it hide a regression? |
|---|---|---|---|---|
| 1 | `(\?t=)[a-f0-9]{16,}` | session token in `?t=` | `fileApiUrl()` embeds the live token into every `<img src>` | Only a change to a token value. Path, filename and all other attrs still compared. |
| 2 | ISO 8601 timestamp | `2026-08-22T00:37:00Z` | rendered into `title`/`datetime` attrs from row timestamps | Only a timestamp value. A changed *attribute name or position* still diffs. |
| 3 | `temp-\d{10,}` | optimistic-UI ids | `'temp-' + Date.now()` | Only the epoch suffix; the `temp-` prefix and surrounding markup still compared. |
| 4 | `\d+[mhd] ago` | `49m ago` | `relativeTime()` (app.js:541) elapsed output | Only elapsed text. Its container markup still compared. |
| 5 | `just now` | `just now` | same function, sub-minute branch | as above |
| 6 | `\d+\s+(second\|minute\|…)s?\s+ago` | long-form elapsed | defensive: no current call site emits this | none in practice |
| 7 | `\b17\d{11}\b` | bare epoch-ms | generated ids/keys | **Widest rule.** Would also mask a genuine literal 13-digit number starting `17`. No such value is rendered today; revisit if one appears. |
| 8 | `(Last Updated: )\d{2} \w{3} \d{4} \d{2}:\d{2}` | Sprint Summary wall clock | literal `new Date()` at app.js:6512 | Anchored on the label, so it cannot touch any stored date. |

Rules 1–6 and 8 are label- or format-anchored and cannot mask structure. Rule 7
is the only one with real breadth and is flagged as such.

**Nothing structural is ever masked** — no tag, class, id, attribute name, or
text content. Widening a rule weakens the harness; if a new volatile value
appears, add a new anchored rule rather than loosening an existing one.

**Captures are read-only; only `flows.js` mutates**, and it is always run *after*
any capture used in a comparison.

**Line endings.** `core.autocrlf=true` in this repo: files are CRLF on disk, LF in
git blobs (`app.js` is 891,641 bytes on disk vs 874,347 in the blob — exactly one
extra byte per line). `catdiff` normalizes both sides to LF. This is git's
checkout behaviour, not a source change, and line counts plus all non-EOL bytes
are still compared exactly. `.refactor-verify/pristine/` holds untransformed disk
snapshots taken before Phase 1 and is preferred over the git blob as the
reference.

## Harness self-test (performed at build time)

A harness that only ever passes is worthless. Each detector was verified to
**pass when nothing changed** and **fail when something did**:

| Detector | No-change case | Injected fault | Detected? |
|---|---|---|---|
| DOM | 47/47 identical | `data-harness-canary="1"` on a static element | ✅ all 47 pages, exact hunks |
| window | 901 keys, diff empty | `window.__harnessCanary = 1` | ✅ `ADDED (1): __harnessCanary` |
| catdiff [A] range | PASS | 2 spaces inserted mid-part | ✅ FAIL, pinpointed original line ~658 |
| catdiff [B] tiling | PASS | 6-line gap between ranges | ✅ FAIL, named the exact boundary |
| catdiff [C] concat | PASS | either of the above | ✅ FAIL, byte offset reported |
| catdiff [D] order | PASS | two `<script>` tags swapped | ✅ FAIL, printed both orders |
| DB fingerprint | identical | — | ✅ 674 rows, PK hashes and timestamps stable across a flows run |

The [A]/[B] pair is deliberately independent: in the gap test, [A] *passed*
(each part did match its declared range) while [B] caught the gap. Either alone
would have missed it.

**Across-a-phase-boundary determinism** was also proven, since that is the case
that actually matters: `capture → flows (mutating) → capture → compare` came back
with all 47 pages identical and exit 0.
