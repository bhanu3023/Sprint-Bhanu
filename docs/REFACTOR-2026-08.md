# Refactor and hardening, August 2026 — handoff

64 commits on `manmadha`. **`main` has been deployed through `7551307`** — one
commit, `078f447` (response compression), is on `manmadha` only and has not been
merged or pushed. This document exists so the work is legible to whoever touches
it next, and so the running total of blind spots lives here instead of in
conversation history no one can re-read.

**Read this first, then [`AUDIT-FINDINGS.md`](../AUDIT-FINDINGS.md) and
[`DEAD-CODE-INVENTORY.md`](DEAD-CODE-INVENTORY.md).** Those two record decisions
that should not be re-litigated.

## The one-paragraph version

`app.js` (17,295 lines) and `server.js` (3,204 lines) were split into `src/client/`
(42 files) and `src/server/` (37 files) by a **move-only** refactor, proven
byte-identical. That was followed by two rounds of deliberate behaviour changes
(11 fixes total), a full multi-org correctness pass, a production incident and its
fix, five measured indexes, a memory-safety cap on the largest endpoint, a
credential leak closed, and response compression — each verified individually,
each against real measurement rather than assumption. A verification harness was
built alongside and extended twice more, and is the reason any of this is
trustworthy. **Production has been deployed** through the duplicate-key fix
(`7551307`); compression has not.

---

## 1. What changed

### 1.1 The refactor — no logic or UI change, mechanically proven

| Commits | What |
|---|---|
| `2035e18` `d00fb73` `19b5cef` `4871b48` `19e5386` | build the verification harness |
| `8f0d643` `2784cfb` `39226b0` `3f25c0f` `f017f02` `60ba64c` | client phases C1–C7: `app.js` → 42 files, `app.js` deleted |
| `a016b2e` `c6f9f89` `1627ea3` | server phases S1–S2b: `server.js` body → 37 files; root `server.js` becomes a 31-line ordered require list |
| `08b316f` | harness correction |

There is no C3 commit — it was folded into `39226b0`.

`server.js` is now **31 `require` lines whose order IS the route registration
order**. Do not reorder it casually: `/api/issues/deleted` must be required before
`/api/issues/:id`.

### 1.2 The first six behaviour changes

| Commit | Change |
|---|---|
| `ef8f155` | **Login rate limiting.** Two in-memory fixed-window buckets: per-IP 20, per-email 8, 15-minute window. Only failures count; success clears both. Also split `routes/auth.js` out of `routes/oauth.js` (password login is not an OAuth route). |
| `1a451cc` | **Upload ceilings** replacing `fileSize: Infinity`. Per file 1,073,741,823 (the Postgres `bytea` maximum); per request 1,100,000,000, checked on `Content-Length` before multer parses. |
| `4edea2c` | **Email HTML escaping.** `notify.js` put issue titles and comment text straight into an `<h2>`/`<p>`. Subjects deliberately stay unescaped — a subject is plain text. |
| `ee28352` `7ff43ad` | **Static allowlist.** `express.static(__dirname)` served the whole repository; `lib/permissions.js`, `db/schema.sql`, `Dockerfile`, `package.json` and CI config were all publicly readable. Now an allowlist, with prefixes restricted by file type. |
| `bc2160b` | **Issue-key retry.** Concurrent creates read the same `MAX(key)` and the loser got a bare 500. Reproduced at 12 concurrent: 5×201, 7×500. Now bounded retry on `23505/issues_key_key`. |
| `bb382c2` | **`GET /api/data` scoped in SQL** for non-admins instead of loading every user and membership and filtering in JS. Responses proven byte-identical for three roles. |
| `48e8e08` | **`/api/debug/spaces` gated to org admin.** It returned every space to any authenticated user. |

### 1.3 Deletions and infrastructure (first pass)

`ea58f70` `25dcc38` `621c0d1` `3d055ec` `8f6c9a6` removed 17 orphaned files.
`c3eb0c8` `590b024` fixed the deploy syntax gate (it checked the deleted `app.js`).
`c2a71c5` added minimum-count and repo-integrity guards. `b2ced8d` added
`.dockerignore`. `2db5329` removed the unused `cors` dependency. `bfe05fe` removed
one unused require. `b84eb5d` relocated `goBackFromIssue`. `33639a3` corrected an
archive floor set wrong (blind spot 10, below).

### 1.4 Five more behaviour fixes (A1–A5)

A second round, same discipline: named, individually verified, no bundling.

| Commit | Change |
|---|---|
| `f484c7b` | **A1 — honour `err.status`.** The global error handler reported every thrown error as 500. `express.json` parse failures (status 400) and Postgres SQLSTATE class 22 (data exception — client-input errors) now surface their real status. Class 23 (constraint violation) deliberately left unmapped — those routes already handle their own 409/400. |
| `be31cc4` | **A2 — guard the attachments route against a non-multipart body.** A POST with the wrong `Content-Type` reached multer and threw uncaught. |
| `ef42fc9` | **A3 — comment edit ownership.** Any authenticated space member could edit any other member's comment. Now author-only, or org admin. |
| `68d6e04` | **A4 — close both doors on sprint status.** `PUT /api/sprints/:id` could set `status`/`velocity` directly, bypassing the side-effect logic in `/start` and `/complete` entirely (no backlog move, no notification, no velocity calc). Both fields removed from `UPDATE_WHITELIST.sprints`; `/start` also gained a one-active-sprint-per-space guard (transactional, row-locked — see the concurrency test in `tests/suites/03-concurrency.js`). |
| `1b6292d` | **A5 — gate sprint deletion to `planning` only.** An `active` or `completed` sprint could be deleted outright, silently dropping its issue history and (for a completed sprint) its frozen velocity out of every report that reads it. |

Also in this window: `62ffe01` added the backend test suite (79 tests at the time,
now 94 — see §4); `2fa5579` bounded the connection pool's wait (blind spot 11,
below); `420530c` brought `lib/` under byte coverage and added `[P6]`, the
control-byte scan (closing blind spot 13, below); `fb7fbf9` repaired 8 NUL bytes
introduced while doing that; `4904889` and `a989344` were two small query-count
performance fixes (batching 14 built-in-field lookups into one query; no longer
running `ALTER TABLE` on every custom-fields read).

### 1.5 Rules documentation rewrite

`6317fcf` (Part B) and `c4c3471` (Part C). The four docs in `.claude/rules/` —
issue state machine, notification triggers, permission matrix, sprint lifecycle —
had drifted from the code: they specified a transition table that was never
implemented, four permission tiers where the code has three, and notification
title/body strings that matched nothing in `notify.js`. Each was rewritten to
describe **what the code does**, verified against the actual behaviour rather than
assumed, and Part C added a notification-triggers test suite so the rewritten
claims stay true rather than drifting again.

### 1.6 Multi-org correctness, and the production incident it led to

`7de9cb3` fixed the `spaces.org_id` write path (`POST /api/spaces` omitted the
column entirely, so every space created through it got `NULL`) and added
migration 017 to backfill existing NULLs — with a hard abort if more than one
organization exists, because guessing which org an orphaned space belongs to is
worse than leaving it NULL. `bf8fdc2` re-pinned server digests, restoring
coverage to 32/32 after drift.

Then the systemic version of the same bug, worked in four measured passes:

- **`3d5596c` (P0)** — migration 018 adds `issues_key_key UNIQUE(key)`, the
  constraint the issue-key retry fix (`bc2160b`) had depended on the whole time
  without it existing anywhere in a migration. It aborts (not auto-dedupes) if
  duplicates already exist — never silently rewrite production data.
- **`1764e12` (P1)** — 5 indexes, each justified by production-scale (150k-issue)
  measurement, not convention: `idx_issues_space_id`, `idx_issues_reporter_id`,
  `idx_comments_issue_id`, `idx_worklogs_issue_id`, and a **partial**
  `idx_issues_deleted_at` (only the rare `deleted_at IS NOT NULL` rows — 8KB
  instead of the 3.4MB a full index costs for a column that's NULL almost
  everywhere). A sixth candidate, `idx_issues_updated_at`, was **declined**: the
  planner would pick it, but measured timing showed no real improvement over
  sorting the already-filtered result.
- **`c7d09f0` (P2)** — 12 sites read `organizations LIMIT 1` as "the" org, a
  guess that is only correct by accident with more than one organization. Fixed
  10 via `req.user.org_id` or (where no authenticated user exists yet, e.g.
  accept-invite) the invitation's own recorded `org_id`. **Reported, not forced,
  the other 2**: `email.js`'s `sendEmail` takes a raw address, not a user or org
  — fixing it is a product decision (per-recipient-org / per-sender-org / one
  shared relay?) that touches five call sites at once; and Microsoft OAuth
  auto-provisioning, which IS the account-creation moment for someone the app
  has never seen, so there is no user and no invitation to fall back on — a
  correct fix needs a new mechanism (e.g. email-domain-to-org mapping) that
  doesn't exist in the schema. Both remain open decisions — see §7.
- **`4f09b25` (P3)** — N+1 audit at 150k-issue scale: none found that scale with
  table size (every loop is bounded by user-selected count or space count, never
  issue volume). **The `/api/data` finding that mattered**: unscoped, 94.6MB at
  150k issues / 2s server time, vs 3.9MB / 148ms scoped — not "a large response,"
  a different class of problem, on a call every org admin's first page load can
  trigger. Reported here, fixed two commits later. Also: two zero-risk dead-code
  removals (an unused `crypto` import, three unused auth imports in `oauth.js`).

**Then it broke a production deploy.** An archived space had reused a key
(`AI`) that a later, active space also claimed — allowed at the time because
nothing checked archived spaces for key conflicts — and their issues collided on
`AI-1`, `AI-2`, etc. once real traffic hit both. Migration 018 correctly refused
to add the UNIQUE constraint against 20 pre-existing duplicates and aborted the
deploy cleanly (schema rolled back, no partial change, no traffic served) rather
than guess how to resolve them.

- **`c78322a`** — two new migrations, run automatically at boot: `017b` resolves
  the duplicate the same way every time — whichever row belongs to the
  currently **active** space keeps its key, the archived space's row is renamed
  to the next free key in its own counter (ties/no-active-row groups fall back
  to earliest `created_at`) — then `018` finds zero duplicates and succeeds.
  `020` soft-deletes any issue with `space_id` NULL or pointing at a space that
  no longer exists (restorable from the Deleted Items bin, never a hard
  `DELETE`).
- **`7551307`** — closed the deeper gap that made the incident possible at all:
  migration 014 (`spaces.key` uniqueness) silently **skips** creating its own
  unique index if a duplicate key already exists at boot, and still marks
  itself applied forever — meaning the DB-level constraint can stay missing
  permanently even after the duplicate is fixed by hand, because 014 never
  runs again. Reproduced independently on the local dev database (`DEM`,
  same shape: one archived space, one active, both claiming the key). Migration
  021 resolves any existing duplicate the same way as `017b` and creates the
  missing index itself. The app-layer check (`findSpaceKeyConflict` in
  `spaces.js`) already blocked new duplicates, but it's a SELECT-then-INSERT
  check, not atomic — the DB constraint is what actually makes a repeat
  structurally impossible under a race, not just unlikely.

**This is the commit production is currently running.** 22 migrations total,
all idempotent, verified to apply cleanly on a brand-new database and to no-op on
re-run.

### 1.7 The memory-safety cap, a credential leak, and an OAuth hang

`48706a5`, one commit, three independent fixes reported and shipped together
because the user's mandate covered all three:

- **`/api/data` unscoped is now capped at 8,000 issues.** Every real client
  caller was audited first: two call sites (`init.js` on every login,
  `admin-settings.js`'s assignee-picker fallback) are unconditionally unscoped
  and load-bearing, so `space_id` could not be made required. The unscoped
  branch gets `LIMIT 8001` — deliberately **no `ORDER BY`**, because adding one
  would resort the array on every unscoped call, not just the ones the cap
  actually truncates, which is a response change for every org currently under
  the cap (i.e. every real org today). Measured at 150k issues:
  **94,591,976 bytes → 5,142,050 bytes** (94.6MB → 4.9MB). A visible
  `console.warn` fires when the cap actually truncates something.
- **`smtp_pass` was leaking in plaintext** from `GET`/`PUT /api/org` and
  `GET /api/data`, while the dedicated `/api/admin/email-settings` endpoint
  already masked it. Fixed inside `sanitizeOrgRow` (one place, covers all three
  paths) using the exact existing `••••••••` masking, not a new scheme.
  Confirmed via grep that no client code reads `smtp_pass` from either leaking
  endpoint before shipping the change.
- **Microsoft OAuth's two outbound `https.request` calls had no timeout.** A
  hung Microsoft endpoint hung the login callback forever. Added a 10s timeout
  to both (token exchange, Graph `/me`). Failure-path only — proven via the
  63-pair equivalence check that no successful response changed.

### 1.8 Response compression

`078f447` — **on `manmadha` only, not yet merged to `main` or deployed.** Added
the `compression` npm package (measured: 10 packages, 574KB, 0 new
vulnerabilities — hand-rolling was rejected because correctly interacting with
`express.static`'s conditional-GET/HEAD/range handling is a well-known
don't-roll-your-own risk). Registered as the very first `app.use()`, before
`express.static` and every route.

Every config value measured, not defaulted: **threshold 1024 bytes** (real
payloads at 41–63 bytes gzip to something *bigger*; real payloads at 488+ bytes
already save 179+ bytes; 1024 sits with 2× margin above the observed crossover).
**gzip level 6** (level 9 bought ~5% smaller for ~25% more CPU; level 1 was
meaningfully worse for barely less CPU). **brotli quality 4, set explicitly**
(this package prefers brotli whenever the client advertises it — most real
traffic — and quality 4 already beat gzip level 6 on both size *and* CPU for
`/api/data`; quality 9 cost ~6× the CPU, quality 11 cost 461ms on the 301KB
payload). **Filter**: only `text/*`, `application/json`, `application/javascript`,
`application/xml` — verified `/api/files/:id` correctly skips images regardless
of size, and both a small and a 274KB real text upload download byte-identical
to what was uploaded.

Proven: 63 (role, endpoint) pairs sha256-identical on the **decoded** body;
`[1][2][2b][3][4]` all empty; static allowlist must-200/must-404 unchanged;
94/94 tests, flows 8/8, hotjar 138/138, email 33/33 (the test harness never
advertises `Accept-Encoding`, so it exercises the untouched identity path by
construction).

**The measured trade-off** — see blind spot 15 for why this required a second
measurement pass. Unthrottled localhost: transfer bytes drop ~76% but raw load
time is neutral-to-slightly-worse (no real transfer time to save on a loopback
socket, and the CPU cost of compressing is a larger fraction of nothing). Under
CDP-simulated realistic network conditions, it's a large, clear win: home view
`loadEvent` 2586ms → 937ms on simulated 4G (**63.8% faster**), 609ms → 411ms on
25Mbps broadband (**32.5% faster**). The honest cost: TTFB on the 301KB endpoint
is ~11ms slower (median 21ms vs 10ms), and under a synthetic 30-concurrent
hammer on that single endpoint, CPU/request rose ~37% (35.8ms vs 26.2ms) and
median latency ~36% (620ms vs 456ms) — most likely Node's default 4-thread
libuv pool serializing concurrent brotli/gzip work. **Recorded as a known
characteristic, not acted on**: absolute costs stay in the tens-of-milliseconds
range under a deliberately adversarial single-endpoint hammer, not a realistic
mixed-traffic pattern. If `/api/data` is ever paginated (see §7), the endpoint
this cost is measured against shrinks by an order of magnitude and the concern
mostly disappears on its own.

**Verdict: worth it for real users on real networks.** Not yet pushed — see the
header.

---

## 2. The frontend performance investigation

Measured, twice, before any change was proposed — and the answer both times was
**decline**.

**First pass** (all 13 named views, 15 actually measured — the space subnav has
8 tabs in code, not 6): seeded a database sized like a busy real team (420
issues / 4 spaces), measured time-to-first-paint, API call patterns, JS/CSS
coverage (V8 precise coverage, self-time computed the same way Chrome's own
Coverage panel does — a naive range-sum double-counts nested function ranges),
and JS execution time via CDP `Performance.getMetrics`. Result: **all four
suspected culprits killed by measurement.** Redundant API calls — none found in
either a fresh-load test or a realistic click-through session; the one apparent
double `/api/data` fetch (All Work) turned out to fetch genuinely different data
the unscoped call deliberately omits. CSS — 184KB parses and arrives in 7.2ms
total, ~0.5% of page settle time. JS — all 42 files load in parallel (browser
preload scanner) in 41ms total; execution time 14–52ms across 15 views. What
*was* real: a 400–700ms gap that didn't cleanly attribute to anything.

**Second pass**, on the same 420-issue database plus a stress test: CDP
`Tracing` (not Playwright's `networkidle` heuristic) broke the gap down into
scripting/rendering/painting/other/idle with proper self-time computation
(stack-based, so a `Layout` nested inside a `FunctionCall` isn't double-counted).
Verdict: **mostly measurement artifact.** ~500ms of every "idle" number was
Playwright's own 500ms silence-detection tail, not real user-facing wait. What's
left underneath (~150–360ms of genuine Scripting+Rendering+Painting+Other per
view, Rendering consistently larger than Scripting) is real but modest, and
isn't the mystery it looked like. Separately, seeded one space with 2,605 real
issues (309 in an active sprint) and measured pure render time (network-free,
direct re-invocation of the actual render functions, warmed up, median of 3
trials, log-log power-law fit) for board/backlog/all-work/my-work/reports/
roadmap: **all scale linearly (b≈0.93–1.04) or better** (all-work is flat —
already effectively paginated) up to 2,605 rows, refuting the specific
`.innerHTML`-string-concat-degrades-non-linearly hypothesis. An uncontrolled
first pass without a warm-up call had looked super-linear; that was JIT-warmup
noise on the first timed call, not a real trend.

**Conclusion: nothing justified.** No redundant-call removal, no CSS split, no
JS deferral, no render-path rewrite. Coverage stayed 42/42 throughout — this
investigation touched zero files.

---

## 3. The harness

Everything lives in `scripts/refactor-verify/`. Snapshots go to `.refactor-verify/`
(gitignored, ~30 MB, contains real user names and emails).

```
node scripts/refactor-verify/preflight.js        # ALWAYS first
node scripts/refactor-verify/catdiff.js          # client move purity
node scripts/refactor-verify/serverdiff.js       # server move purity
node scripts/refactor-verify/libdiff.js          # lib/ byte coverage
node scripts/refactor-verify/capture.js  <label> # snapshot 47 pages
node scripts/refactor-verify/compare.js  <a> <b> # checks [1][2][2b][3][4]
node scripts/refactor-verify/scriptblock.js      # check [5]
node scripts/refactor-verify/flows.js            # 8 core flows
node scripts/refactor-verify/dbfingerprint.js <label>
node tests/run.js                                # 94 backend tests, one process
node scripts/test-hotjar.js                      # 138 assertions
node scripts/test-email-escaping.js              #  33 assertions
```

`SB_BASE` points the browser checks at another port. `ALLOW_DEV_LOGIN=1` is needed
in `.env` for `dev-login.html`.

### What each check proves — and what it does not

| Check | Proves | Does NOT prove |
|---|---|---|
| `catdiff [A][B][C][D]` | all 42 client files are byte-identical to the original `app.js`; ranges tile 1..17295 once; un-applying declared moves reproduces pristine line-for-line | nothing about behaviour |
| `serverdiff [SA][SB][SC][SD][SE]` | declared glue matches byte-for-byte, bodies are RAW-identical, lines tile 1..3204 once, require order preserved, and `[SE]` now proves every one of the 32 parts — pinned digest, byte-for-byte, restored on the next intentional change | `[SA]`/`[SB]` (raw tiling) skip parts flagged `modified` — **currently 21 of 32.** `[SE]` is the check that keeps this from decaying into a decoration: it re-verifies content, not just presence |
| `libdiff` | all 7 `lib/` files byte-verified by pinned digest | nothing about behaviour; a pin is a claim about *this* content, re-pinned deliberately on every intentional change |
| `[1] [2]` | `Object.keys(window)` and their typeofs unchanged | misses top-level `const`/`let` — that is what `[2b]` is for |
| `[2b]` | 690 named globals still resolve | the list is self-declared. Never edit it to make a red check green |
| `[3]` | `document.body.innerHTML` identical across 47 pages | scripts and comments are stripped (that is `[5]`); sensitive to data drift, see blind spots 9 and 12 |
| `[4]` | no new console errors or failed requests | **ignores warnings entirely** |
| `[5]` | the `<script>` block in `index.html` is intact, ordered, no dupes or drops | nothing about file contents |
| `[P1]–[P6]` | exactly one listener, started this run, all tracked files present, no deletions, no control bytes in ANY tracked text file (not just `lib/`) | nothing if you skip it |
| `flows.js` | 8 core user journeys work end to end | narrow coverage; known flaky on step 4 (drag-and-drop) against a genuinely populated board — timing, not correctness |
| `tests/run.js` | 94 backend tests: auth (17), security (9), concurrency (5), CRUD (9), sprint completion (9), reports (17), input validation (15), notifications (13) | **no frontend/browser test suite beyond `flows.js` and the DOM-diff harness** — there is no Jest/Playwright component-test layer, and none of this session's frontend measurement work added one |

**Protocol that matters:** restart the server, run `preflight`, capture, *then* run
`flows`. `flows` creates notifications, which changes `[3]` on every page — see
blind spot 9.

---

## 4. All fifteen blind spots

Checks that passed while verifying nothing, or measurements that would have
supported the wrong conclusion. **Thirteen were found in existing work or
existing methodology. Two were introduced by hardening itself** — the
distinction matters, because hardening that introduces its own defects is a
different failure mode from inheriting one.

| # | Blind spot | Origin |
|---|---|---|
| 1 | `[3]` could not pass at all: `document.body.innerHTML` contained the `<script>` block the refactor rewrites. Split into `[3]` + new `[5]`. | **found** |
| 2 | `[3]` indentation residue: removing `<script>` elements left whitespace-only text nodes, 15 chars/page. | **found** |
| 3 | CRLF blob-vs-blob: cat-diff compared CRLF disk files against LF git blobs, so it could never match. Fixed with untransformed pristine snapshots. | **found** |
| 4 | Tamper tests that perturbed nothing — replace-strings that did not exist, `\n` used against a CRLF file. Recurred three times. Every fault injection now asserts the perturbation landed. | **found** |
| 5 | `const`/`let` blindness: `Object.keys(window)` cannot see `S`, `esc`, `$`, `qs`, `qsa`, `cap`. Added `[2b]`, the only check that catches a renamed `const`. | **found** |
| 6 | Deploy syntax gate ran `node --check app.js` after `app.js` was deleted. Latent, not live — `main` still had the file. | **found** |
| 7 | `serverdiff`'s meaning changed silently as `modified: true` spread. It now prints the excluded list and qualifies its own PASS. | **found** |
| 8 | A symbol scanner reported `$` with **0** references. It has **1,145** — `\b` does not match `$`. Acting on it would have deleted the most-used helper in the codebase. | **found** |
| 9 | `[3]` is sensitive to the unread-notification badge in the shared header. `flows.js` creates notifications, so running it before a capture makes **all 47 pages** report DIFFERS. Isolate with two back-to-back captures. | **found** |
| 10 | **`MIN_ARCHIVE_ENTRIES` was set to 193 against a real 194.** `git archive` emits directory entries (34 at the time), so a file in a *new* directory raises the count by two. At 193 the check would have passed an archive that had silently lost a file — the exact failure it exists to catch. | **INTRODUCED** — while hardening, on the very hazard that prompted the guard |
| 11 | **pg's connection pool defaults `connectionTimeoutMillis` to 0 — wait forever.** Once all `max` clients are checked out, a further request queues with no deadline; a slow query holding a client hangs later requests indefinitely, and the socket never answers at all. No existing check ever exercised pool exhaustion. Demonstrated directly: 10 clients held by `pg_sleep(25)`, an 11th attempted — STILL WAITING at 20002ms with the default. Fixed: `connectionTimeoutMillis=10000`, chosen from measured acquisition latency (worst observed 181ms cold-connect) — ~55× headroom, and comfortably under the usual 60s reverse-proxy read timeout so the pool fails first with a clean 500. | **found** |
| 12 | `[3]` is sensitive to the delete-bin retention countdown. `admin-deleted` and `PTM:settings-deleted` render `days_left` computed from `NOW()`; "in 30 days" becoming "in 29 days" as real time passes makes both pages differ with zero code change. Same class as blind spot 9, different mechanism (wall-clock drift, not user action). | **found** |
| 13 | **`lib/` sat entirely outside `catdiff` and `serverdiff`.** Changes to `lib/builtin-issue-fields.js` had no manifest part at all, so no byte-level check covered them — the reported server coverage number never moved to reflect the gap, which meant it *understated* how much was actually unverified. Fixed: `libdiff.js` plus pinned digests, and `[P6]` extended to scan for control bytes across every tracked tree, not just `lib/`. | **found** |
| 14 | **The test harness leaks fixture data when killed.** A `npm test` run SIGKILL'd mid-execution left an org with 3 spaces and 6 users behind; that stray data shifted the sidebar space list and failed a later DOM compare that had nothing to do with the actual code change under test. The `finally` teardown covered clean failures but not signals. Fixed: `sweepOrphans()` now runs *before* the baseline capture, not only after the test — so a poisoned prior run can't contaminate the next one. | **found** |
| 15 | **Unthrottled localhost cannot measure a transfer-size change.** Response compression's raw before/after load time on localhost was neutral-to-slightly-worse — a defensible "not worth it, revert" verdict, reached from real numbers, not carelessness. The *same code*, measured under CDP-simulated realistic network conditions, was 63.8% faster on simulated 4G and 32.5% faster on 25Mbps broadband. Same code, opposite conclusions, and the wrong one was the default measurement environment because localhost has no real transfer time to save and disproportionately exposes the CPU cost of compressing instead. **Lesson, stated plainly: transfer-size changes cannot be measured on localhost — network conditions must be simulated before concluding anything.** | **found** |

A related one, also introduced: the runtime probe used for dead-code analysis
reported two known-live controls (`barChart`, `renderAllWork`) as never invoked,
because wrappers installed after page load and every render fires during load.
**Always include known-live controls in a probe: if a control reads zero, the probe
is broken, not the code.**

**The habit that produced all of these:** prove the check FAILS on the fault it is
supposed to catch. A green check that has never been shown to go red is decoration.
Where that habit was skipped even once — an unthrottled load-time comparison, a
teardown that only ran on the happy path — it cost a wrong conclusion, not just a
near miss.

---

## 5. Audit claims that were wrong

The original audit was right more often than not, but not always. Verify before
acting.

- **`_updateDateBadge` is not a bug.** Reported as a missing definition causing a
  ReferenceError. The call site never executes: none of the 8 element ids it binds
  to exist, so `if (!el) return;` returns for all of them and the listener is never
  attached. Date filtering already works through `_awSetDate`. Full evidence in
  `AUDIT-FINDINGS.md`. **Do not "fix" this.**
- **`users` was never `SELECT *`.** The `/api/data` finding said "SELECT * FROM
  users and space_members unscoped". `space_members` was; `users` was an explicit
  column list that correctly omits `password_hash`. Both were unscoped, which was
  the real issue.
- **Seven "dead" routes are unprovable, not dead.** A route is reachable by
  anything holding a token. `POST /api/auth/login` looked caller-less only because
  the scan excluded `dev-login.html`.

---

## 6. What is NOT verified

Be honest about these when planning further work.

- **The container layer.** Docker is not installed on the development machine, so
  no local `docker build` was ever run against this exact tree. The real build
  happens on the server during deploy — which has now happened successfully
  through `7551307`, so this is no longer purely theoretical, but compression
  (`078f447`) has not been through a real container build yet.
- **The rate limiter's 15-minute release.** Only restart-release was demonstrated.
  Note that once blocked, a correct password also gets 429 until the window expires
  — that is by design, but it means a legitimate user is locked out for 15 minutes.
- **Multi-instance behaviour.** The limiter is per-process, so limits multiply by
  instance count. Single container today.
- **Frontend/browser test coverage beyond `flows.js`.** There is no
  component-level frontend test suite. Every frontend claim in this document rests
  on the DOM-diff harness (`[3]`) plus 8 end-to-end flows — real, but narrow.
- **Compression under a real container build, and on real production traffic
  patterns.** The CPU/concurrency numbers in §1.8 are from a synthetic
  30-concurrent single-endpoint hammer against a local test database, not
  production load.
- **Item 6 from the original six changes**' equivalence rests on three constructed
  roles (admin, member with all spaces, member with one). A role shape not
  constructed could differ.

---

## 7. Deploying

The workflow triggers on **push to `main`** and on manual dispatch. Merging
`manmadha` into `main` locally does nothing; production changes only on push.

Sequence: syntax gate → build and assert the release archive → SSH → `pg_dump`
(aborts if under 1 KB) → extract → `docker build` → tag old image `:previous` →
swap → health check → roll back the container on any failure.

**Rollback:** automatic container rollback to `:previous` if any step fails, and it
only acts if the container was actually swapped. DB restore from
`/opt/backups/<newest>.sql`.

**Current state, and this is the part that changed since the doc was first
written: production HAS been deployed**, through `7551307` — the duplicate-key
incident and its fix are live. `main` and `origin/main` both sit at `7551307`.
**`manmadha` is one commit ahead, at `078f447` (response compression), which has
not been merged to `main` and has not been deployed.** That is the only thing
between this branch and full parity with `manmadha`.

Migrations: **22 total**, run automatically at server boot, all idempotent,
verified to apply cleanly on a brand-new database and to no-op on re-run. The six
added since the original refactor (`017`, `017b`, `018`, `019`, `020`, `021`) are
covered in §1.6 — all have already run successfully in production as part of the
`7551307` deploy.

**Things to know before pushing `078f447`:**

1. **Stale files persist on the server.** The deploy extracts the archive *over*
   `/opt/Sprint-Board` without wiping, so a file deleted from git stays on disk and
   gets baked into the next image. Harmless functionally (unreachable through the
   static allowlist) but worth a one-time `rm` or `--delete` handling eventually.
2. **`package-lock.json` changed.** Compression adds a real dependency (10
   packages including `compression` itself). `npm install` in the Dockerfile will
   pick it up correctly — verified via a full clean-archive dry run and an
   old-tree-overlaid-without-wipe dry run, both booting and serving compressed
   responses correctly, plus a rollback dry run (old code, same already-migrated
   database, works normally with no compression artifacts left behind).
3. **No new migrations** in this specific commit. Compression is server
   middleware only; the riskiest deploy failure (a partly-applied migration) is
   not in play for this push.

---

## 8. Open decisions and follow-ups

Decisions that need a person, not a measurement, plus the smaller open items.
Full detail on the client-side items in `AUDIT-FINDINGS.md`.

**Decisions not made, on purpose (each needs a product call before any code
changes):**

- **`/api/data` pagination.** The 8,000-row cap (§1.7) closes the memory-safety
  risk but is a ceiling, not a real solution for an org that actually grows past
  it. Deliberately not built — pagination is a response-shape change and its own
  project, not something to fold into a safety fix.
- **SMTP configuration scope.** Per-recipient-org, per-sender-org, or one shared
  relay for the whole deployment? `email.js`'s `sendEmail` takes a raw address
  today; answering this touches five call sites at once (see §1.6, P2).
- **Microsoft OAuth auto-provisioning.** First-login account creation has no
  user and no invitation to derive an org from. A correct fix needs a new
  mechanism (e.g. email-domain-to-org mapping) that doesn't exist in the schema
  yet — this is a schema decision, not a one-line fix.
- **Per-process rate limiting.** Correct today (single container), wrong the
  day a second instance is added. Needs a shared store (Redis or the database
  itself) if that day comes.

**Smaller open items:**

- `lib/schema-check.js:50,106` name two SQL files that have never existed.
- **No auth audit logging.** Failed logins are recorded nowhere and there is no
  request logging at all. Prevention exists; detection does not.
- Stale files on the server (§7).
- `[3]` is data-thin on PTM (no sprints, so those pages render "No sprints found."
  identically before and after any change) and sensitive to the notification
  badge (blind spot 9) and the delete-bin countdown (blind spot 12).
- `dev-login.html` — **KEEP.** Untracked, excluded from `git archive`, served only
  with `ALLOW_DEV_LOGIN=1`. `login.html` is Microsoft-OAuth only, so this is the
  only local password login.
- Everything in `DEAD-CODE-INVENTORY.md`: 18 proven-dead client symbols kept
  deliberately, 7 unprovable routes, 3 partial-destructure requires.
- No frontend/browser component test suite (§6) — the frontend investigation
  in §2 found nothing worth fixing, but the *coverage gap itself* (nothing
  beyond `flows.js` and DOM-diff) is still open if frontend logic changes are
  ever made.

## 9. The rule that made this work

`catdiff` proves the frontend is byte-identical to what it was before any of this
started — **42 of 42 files**, and `catdiff` has **zero** occurrences of `modified`.
Deleting one line inside a client file would require adding that flag, and the
server tree shows the price: 32/32 byte-verified at the start of this document's
history, **11/32 raw-byte-verified now** — but **32 of 32 pinned-digest-verified**
(`[SE]`, added specifically because raw coverage alone was becoming a decaying,
uninformative number). `lib/` sits at **7 of 7**, added after blind spot 13 showed
it had no coverage at all.

That guarantee was deliberately protected over removing ~300 lines of code that
nothing calls, over multiple rounds of behavioural fixes, over a production
incident and its remediation, and over a full frontend performance investigation
that touched zero files. If you are considering spending it, read
`DEAD-CODE-INVENTORY.md` first.
