# Refactor and hardening, August 2026 — handoff

**`main` and `origin/manmadha` are both deployed and current through
`63147c3`.** Since then, **14 commits sit on `manmadha` only** and have not been
merged or pushed: one notification-routing fix, twelve making up the toast
overhaul (§5a), and one closeout that reshapes server sentences into clauses,
deletes an unreachable branch, and re-baselines the client (§10). This document
exists so the work is legible to whoever touches it next, and so the running
total of blind spots lives here instead of in conversation history no one can
re-read.

**Read this first, then [`AUDIT-FINDINGS.md`](../AUDIT-FINDINGS.md) and
[`DEAD-CODE-INVENTORY.md`](DEAD-CODE-INVENTORY.md).** Those two record decisions
that should not be re-litigated.

## The one-paragraph version

`app.js` (17,295 lines) and `server.js` (3,204 lines) were split into `src/client/`
(42 files) and `src/server/` (37 files) by a **move-only** refactor, proven
byte-identical. That was followed by two rounds of deliberate behaviour changes
(11 fixes total), a full multi-org correctness pass, a production incident and
its fix (§2 — read that one, it's the case study), five measured indexes, a
memory-safety cap on the largest endpoint, a credential leak closed, and
response compression — each verified individually, each against real
measurement rather than assumption. A verification harness was built alongside
and extended twice more, and is the reason any of this is trustworthy. After all
of that came the **first deliberate UI change** — a full rewrite of every toast
message in the app (§5a), which is also where six new blind spots came from,
including two error paths that would have thrown a `ReferenceError` the moment
they fired. **Production is deployed and current** through `63147c3`; the toast
overhaul and its closeout are the 14 commits on `manmadha` not yet pushed.

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
  doesn't exist in the schema. Both remain open decisions — see §9.
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
mixed-traffic pattern. If `/api/data` is ever paginated (see §9), the endpoint
this cost is measured against shrinks by an order of magnitude and the concern
mostly disappears on its own.

**Verdict: worth it for real users on real networks.** Not yet pushed — see the
header.

---

## 2. The AI-key incident — a case study

This is the best evidence in this project that the verification discipline
worked, not decoration around it. Recorded properly rather than as a log
line, because the lesson at the end applies to any future feature, not just
to migration 018.

### What happened

A production deploy failed. The GitHub Actions log read:

```
DEPLOY ABORTED — a database migration failed.
Migration 018-issues-key-unique-constraint failed: 20 duplicate issue key(s)
exist -- cannot add the UNIQUE constraint. Resolve manually (rename or merge
the duplicates), then re-run. Affected: AI-1 x2 (...), AI-2 x2 (...), ...
AI-27 x2 (...)
```

**Root cause:** archiving a space in this app is a soft-delete — `is_archived`
flips to `true`, but the row and every one of its issues stay exactly where
they were, with their keys intact. At some point a space with key `AI` was
archived. Later, a *new* space was created and also given the key `AI` —
allowed at the time, because nothing checked archived spaces for a key
conflict, only active ones. The new space's `issue_counter` started fresh at
1, so its first 27 issues became `AI-1` through `AI-27` — and collided
directly with the archived space's own `AI-1` through `AI-27`, which had
been sitting there, live, the whole time.

### Why migration 018 caught it instead of corrupting anything

Migration 018 exists to add `UNIQUE(key)` to `issues`. It was written, from
the start, to check for existing duplicates first and **abort loudly rather
than guess** how to resolve them — the same principle behind migration 017's
multi-org abort (§1.6): a migration that silently "fixes" ambiguous data by
picking a side is worse than one that refuses to run. Here, that design paid
for itself exactly as intended: the migration found 20 duplicate keys,
refused to add the constraint, and rolled back cleanly. No partial schema
change. No row was renamed, merged, or dropped without a human decision. The
old, working container image kept serving traffic while the deploy pipeline
reported the failure and stopped.

This is not a story about a bug slipping through. It is a story about a
migration doing exactly what it was designed to do the one time it mattered
in production, and the app staying up because of it.

### The fix

Three migrations, all idempotent, all run automatically at the next boot —
no manual SQL, no one-off script run by hand against production:

- **`017b-dedupe-issue-keys-active-space-priority`** — for each duplicate
  key, the row belonging to the **currently active** space keeps it; the row
  belonging to the **archived** space is renamed to the next free key in its
  own space's counter (ties, or a group with no active-space row at all, fall
  back to earliest `created_at`). Verified against a simulation matching the
  real shape — archived space's issues created weeks before the active
  space's — confirming the active space's keys survive untouched. Runs
  immediately before 018 in the migration order, so 018 then finds zero
  duplicates and succeeds.
- **`020-soft-delete-spaceless-issues`** — while investigating, checked for
  the adjacent failure mode too: an issue with `space_id` NULL, or pointing
  at a space that no longer exists at all. Bins any it finds (`deleted_at`
  set, restorable from the Deleted Items bin — never a hard `DELETE`).
- **`021-dedupe-and-enforce-space-key-uniqueness`** — closes the deeper gap
  that let the `AI`/`AI` collision happen in the first place. See blind spot
  16 in §5: migration 014 (which is supposed to make `spaces.key` globally
  unique) silently skips creating its own index if a duplicate already
  exists at boot, and marks itself permanently applied regardless — so the
  constraint can stay missing forever even after the duplicate is fixed by
  hand. 021 resolves any existing `spaces.key` duplicate the same way 017b
  resolves issue keys, then creates the index itself if 014 never could.
  Reproduced independently on the local dev database first (space key
  `DEM`, same shape: one archived, one active, both claiming it) — this
  was not a one-off, it is a systemic gap that will recur for any key-reuse
  path unless the DB-level constraint actually exists. The app-layer check
  (`findSpaceKeyConflict` in `spaces.js`) already blocked *new* duplicates,
  but it is a SELECT-then-INSERT check, not atomic — the DB constraint is
  what makes a repeat structurally impossible under a race, not just
  unlikely.

### The lesson

**Soft-delete means a key is not free to reuse.** Archiving, not deleting,
is why this project's data survives — deliberately, everywhere (spaces,
sprints, issues all soft-delete). But it has a consequence that is easy to
miss: a soft-deleted row's identifying fields (a space's `key`, and anything
like it added later) are still live data, not freed-up namespace, for as
long as that row and its children exist — which with soft-delete is
forever, unless something purges it. Any future feature that reuses a key,
a slug, a short code, or any other human-assigned identifier **must** check
against archived/soft-deleted rows too, not just active ones, and ideally
enforce that at the database level, not only in application code. This
incident is what happens when that rule is missed once. Read this section
before adding one.

---

## 3. The frontend performance investigation

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

## 4. The harness

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
| `catdiff [A][B][C][D][E]` | all 42 client files are byte-identical to the declared pristine reference; ranges tile 1..17794 once; the concatenation reproduces it byte-for-byte. Since the re-baseline (§10) that reference is the code as reviewed at that commit, **not** the original pre-split `app.js` | nothing about behaviour |
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

## 5. All twenty-two blind spots

Checks that passed while verifying nothing, or measurements that would have
supported the wrong conclusion. **Nineteen were found in existing work or
existing methodology. Three were introduced by hardening itself** — the
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
| 16 | **A migration that silently skips its precondition, and never retries.** Migration 014 adds a unique index on `spaces.key` — but if a duplicate already exists at boot, it just logs a warning, skips creating the index, and still records itself as applied. `schema_migrations` never forgets that, so the index can stay missing *forever*, even after the duplicate is fixed by hand, because 014 has no path back to running again. This is the exact same class of defect as every other row in this table: a check that returns green (a clean boot, no thrown error) while verifying nothing durable. Found while investigating the AI-key incident (§2), not by inspection — reproduced independently on the local dev database first (space key `DEM`, same shape: one archived space, one active, both claiming it), proving the gap was systemic rather than a one-off. Fixed as migration 021, which resolves the duplicate and creates the index itself if 014 never could. | **found** |

| 17 | **Toast text was rendered as HTML, and silently ate anything that looked like a tag.** All three notification renderers built their output by concatenating the caller's message into `innerHTML`. Real call sites interpolate values a user controls — an uploaded file's name, a custom field's name, a space name or key, a user's display name, an invitee's email — so a file named `<img src=x onerror=…>.png` executed on upload. But the *more instructive* half is the display bug hiding underneath: because the message was parsed as markup, ordinary text containing angle brackets was **thrown away**. A custom field genuinely named `Team & Product <Type>` rendered as `Team & Product ` — characters missing, no error, nothing to report. That is the better argument for `textContent` than the security one: the security hole needed an attacker, the truncation needed only a user with a normal name for something. Fixed at the sink rather than by escaping at ~170 call sites, so a future caller cannot forget. | **found** |
| 18 | **One failure, two toasts — the useless one on top.** `api()` toasts every non-`silent` failure itself, and call sites with their own `catch` toast again, so a single failed action raised two error toasts: the wrapper's raw text (`Internal server error`, or a bare HTTP `statusText`) stacked above the specific message. This had been true for a long time and was *invisible* while the second message was `Save failed` — two useless toasts read as one clumsy toast. It only became obvious once the second message was worth reading. Fixed by passing `{silent:true}` wherever a call site renders its own message, and by mapping the raw text inside `api()` so the paths that *don't* have their own message still read properly. **The lesson: improving one message exposed a defect in a different layer. Quality work surfaces adjacent defects, and the count of things wrong can go up as a direct result of fixing something.** | **found** |
| 19 | **`.catch(function () { … })` — the error discarded before anything could show it.** Five sites (both comment handlers, all three All Work inline menus) caught with **no parameter**, so the API's own explanation was fetched, thrown, and dropped in favour of a fixed string. `You can only edit your own comments.` — the exact sentence the permission model exists to produce — was computed by the server, sent over the wire, and then deliberately ignored. Not a missing feature: an actively discarded one, and invisible because a toast still appeared. | **found** |
| 20 | **Two error paths that would have thrown the moment they fired.** The space "User added" alert referenced `userName` and the org role-change alert referenced `name`; neither identifier existed in its scope. Both would have raised a `ReferenceError` instead of showing anything. They were reachable, ordinary success paths — not obscure branches — and nothing had ever exercised them, so nothing had ever noticed. Found only by reading every message in the app rather than every message that looked suspicious. **A message nobody has watched render is not tested, even when the code around it is.** | **found** |
| 21 | **A live `FileList` emptied before an async handler read it.** *Introduced by this work.* The attachment-upload confirmation reported `0 attachments uploaded`: it read `files.length` in the response handler, but `files` is the input element's live `FileList` and the handler resets `e.target.value = ''` at the end, which empties it before the response lands. Caught by triggering the message rather than reading the code — the code looks correct, and would pass any review. Fixed by capturing the names synchronously at submit. | **introduced** |
| 22 | **The suite's DB-drift check cannot tell "tests left rows behind" from "a human edited concurrently."** `RESULT: FAIL / db drift: DETECTED` fired twice in one afternoon with all 94 tests passing, both times because someone was editing real issues in a browser while the suite ran. The check compares a fingerprint before and after and attributes any difference to the suite. It is still worth having — it caught blind spot 14 — but its failure message asserts a cause it has not established, which is the same defect the rest of this table is about, pointed the other way. The discipline that saved it each time: capture twice with identical code to establish a zero noise floor **before** attributing a diff to your own change. That habit caught three separate false alarms across this work (`PTM-19`'s status changing mid-run, leftover scratch sprints in a dropdown, and this). | **found** |

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

## 5a. The toast overhaul

The first deliberate UI change in this work. Everything before it was
behaviour-preserving by construction; this one changes what the user reads, on
purpose, and so needed a different kind of proof.

**Why `[3]` could not prove it.** A toast lives 3.6 seconds. `[3]` captures 47
idle pages, so it cannot see one. Rigging a held-open toast would have changed
timing and tested a state that never occurs. So the proof is
**trigger-and-verify**: for every message changed, perform the real user action
and read what actually rendered. `[3]` stayed in use as a regression check on
everything *other* than toast text — and because it cannot see a toast, any
non-empty `[3]` during this work was by definition **not** the message change,
which is what made it useful.

That inversion paid for itself. `[3]` came back non-empty three times: twice from
concurrent edits to real issues, once from leftover scratch sprints in a
dropdown. None were the code. It also caught the one case where a message *is*
visible to `[3]`: the invite modal's `onclick="…toast('Copied!')"` is toast text
authored in an HTML attribute, so it lives in the static DOM. That commit changed
all 47 pages by exactly 11 bytes, one line each — `'Copied!'` → `'Invite link
copied'`, a length delta of exactly 11.

**What changed.** 12 commits, one per area, ~170 call sites reviewed:

- Failures say what failed **and why**. `Save failed` → `ENG-12 update failed —
  you do not have permission`. Server text written for a machine (a bare 500
  body, a raw HTTP `statusText`) is mapped to plain language on the client; text
  the API already writes for a user passes through with its detail intact.
- Successes say **what changed**, not that something did. `Saved` → `ENG-12 moved
  to In Review`, `ENG-12 assigned to Alex Kumar`, `Sprint 4 completed — 21 story
  points`, `1h 30m logged on ENG-12`, `qa-report.pdf uploaded`.
- **Nothing new was computed.** Every identifier used was already at the call
  site: the field and value passed to the save function, the key on a POST
  response, the velocity `/complete` already returns and the client was throwing
  away, the name in the form the user just typed. No server response changed —
  the entire overhaul is client-only, which `serverdiff` and `libdiff` confirm.
- A batch reports a count (`ENG-12 updated — 3 fields`) rather than listing
  fields, so the line cannot grow without bound.
- The same event reads the same way everywhere. All Work's inline status menu and
  the drawer's inline status field now produce identical text, from one shared
  `issueChangeSummary()`.

**Mechanism rule**, for choosing between the two renderers:

> `toast()` for an action that completed in place, on the page the user is
> already looking at. `popupAlert()` for a message that must outlive a
> navigation, or that tells the user how to undo or continue.

Under that rule, adding a member (a `popupAlert`) was wrong and is now a toast,
matching removing one. Deleting a sprint (toast, stays on the backlog) and
deleting a space (`popupAlert`, navigates to Home and has to say it is
recoverable) are **not** inconsistent and were left alone.

**Vocabulary: "issue", never "ticket".** Nine toasts and five dialog strings said
"ticket". The UI, the routes, the schema and `CLAUDE.md` all say *issue*, so this
was a consistency fix, not a preference — the app was contradicting itself, and
in one flow contradicting itself twice on the same screen (a permission toast
saying "issues" above a confirm dialog saying "ticket"). Banned words were swept
app-wide rather than at the sites the inventory happened to list: `successfully`
was gone from 3 toasts *and* 7 `popupAlert`s, and every `!` from both.

**Two messages could not be triggered, and both are findings rather than gaps:**

- `crud/issue.js`'s modal-edit branch. Its message could not fire because the
  branch is **unreachable**: it reads the hidden `#issueId` input, and nothing in
  the codebase writes to that input except `resetIssueForm()`, which sets it to
  `''`. Three references total, one modal title path, all of them "Create".
  Improving a string in dead code is the wrong move, so **the branch was
  deleted.**
- `backlog.js`'s "that sprint is completed" guard. Completed lanes render without
  drop handlers by design, so there is no drop target to reach it. It is
  belt-and-braces for a path that does not exist, exactly as its own comment
  says, and was left in place.

Two more needed setup before they were reachable at all and are otherwise
verified: `moved to <sprint>` (every Engineering sprint was `completed`, and the
picker only offers planning/active) and the board's status drop (no active
sprint → no columns rendered).

**Grafted sentences.** Reasons render after a dash, so a server sentence arrives
with a sentence-initial capital and a full stop and reads bolted on.
`toReasonClause()` lowers the first letter and strips one trailing period — but
never touches a domain noun the app capitalises itself (`Sprint`, `Space`,
`Issue`), an identifier (`space_id`, `ENG-12`), an acronym (`SMTP`), or a
multi-sentence string, and strips only `.`, never `!`, `?`, `)` or an ellipsis.
Tested against **all 88** distinct `error:` strings the server can return: 68
reshaped, 20 left alone, 7 of those because they are multi-sentence. The one
place a reason is shown standalone rather than after a dash wraps it back with
`capitaliseFirst()`.

---

## 6. Audit claims that were wrong

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

## 7. What is NOT verified

Be honest about these when planning further work.

- **The container layer.** Docker is not installed on the development machine, so
  no local `docker build` was ever run against this exact tree. The real build
  happens on the server during deploy — which has now happened successfully
  through `63147c3`, so this is no longer purely theoretical. The 14 unpushed
  commits touch no server file and add no dependency, so a container build is the
  least of their risks.
- **The rate limiter's 15-minute release.** Only restart-release was demonstrated.
  Note that once blocked, a correct password also gets 429 until the window expires
  — that is by design, but it means a legitimate user is locked out for 15 minutes.
- **Multi-instance behaviour.** The limiter is per-process, so limits multiply by
  instance count. Single container today.
- **Frontend/browser test coverage beyond `flows.js`.** There is no
  component-level frontend test suite. Every frontend claim in this document rests
  on the DOM-diff harness (`[3]`) plus 8 end-to-end flows — real, but narrow. The
  toast overhaul (§5a) is the sharpest example: `[3]` structurally cannot see a
  3.6-second toast, so every message claim rests on having triggered it by hand
  once. Nothing stops a future edit from silently regressing one.

- **`confirm()` vs `confirmDialog()` — two destructive-action dialogs out of
  line.** Out of scope for the toast work and deliberately left alone, recorded
  here so it is not lost. `_deleteComment` (`drawer-panels.js`) and `_prmDelete`
  (`roadmap.js`) use the browser's native `confirm()`. Every other destructive
  action in the app uses either `confirmDialog()` (app-styled, `#confirmYes`) or
  `typedConfirmDialog()` (type-the-name-to-confirm, used for issues, sprints and
  spaces). Three consequences: the two native ones look nothing like the rest of
  the UI, they cannot be styled or themed, and they are the only destructive
  actions with no typed-confirmation gate — deleting a comment is one
  mis-click, whereas deleting an issue requires typing its key. It is the same
  inconsistency class as the toast/popupAlert mismatch that *was* fixed (§5a);
  it just belongs to the dialog layer. Cheap to fix (`confirmDialog()` is a
  drop-in returning a promise), but it changes a confirmation flow, so it wants
  its own commit and its own verification rather than being folded in.

- **The 800ms debounce vs per-field messages — a product question, not a bug.**
  The drawer coalesces edits made within 800ms into one PUT, so changing three
  fields quickly yields `ENG-12 updated — 3 fields` rather than three specific
  messages. That is correct under the stated rule (say the count, don't list
  fields), but a user who just changed Status expecting `moved to In Review` sees
  a count instead. What the alternative costs, if it is ever wanted: naming the
  *last* field plus a count (`ENG-12 moved to In Review, +2 more`) needs no new
  data — `autoSave` already receives each `(field, value)` pair and could record
  the most recent one alongside the pending set, so it is a small change inside
  one function with no server involvement. The real cost is deciding which field
  "wins" when the batch is heterogeneous, and that is a judgement about what the
  user was most likely watching, not something the code can derive. Left open
  deliberately.
- **Compression under a real container build, and on real production traffic
  patterns.** The CPU/concurrency numbers in §1.8 are from a synthetic
  30-concurrent single-endpoint hammer against a local test database, not
  production load.
- **Item 6 from the original six changes**' equivalence rests on three constructed
  roles (admin, member with all spaces, member with one). A role shape not
  constructed could differ.

---

## 8. Deploying

The workflow triggers on **push to `main`** and on manual dispatch. Merging
`manmadha` into `main` locally does nothing; production changes only on push.

Sequence: syntax gate → build and assert the release archive → SSH → `pg_dump`
(aborts if under 1 KB) → extract → `docker build` → tag old image `:previous` →
swap → health check → roll back the container on any failure.

**Rollback:** automatic container rollback to `:previous` if any step fails, and it
only acts if the container was actually swapped. DB restore from
`/opt/backups/<newest>.sql`.

**Current state: production IS deployed and current.** `main` and `origin/main`
both sit at `63147c3` — the AI-key incident and its fix (§2), response
compression, and every security and data-integrity fix in this document are live.
**`manmadha` is 14 commits ahead**, all of them user-facing message work: the
sprint-notification routing fix (`06ee907`), the twelve-commit toast overhaul
(`ac09119`..`d9b9e8b`, §5a), and the closeout (`3f4f1be`) that reshapes server
sentences into clauses, deletes an unreachable branch, and re-baselines the
client (§10). None has been merged to `main` or pushed.

Unlike compression, these 14 are **client-only** — `serverdiff` and `libdiff`
confirm zero server and zero `lib/` bytes changed, and no server response
changed — so their deploy risk profile is different: no migration, no API
contract change, nothing that can fail differently under a container build than
it does locally. What they *do* change is what every user reads on almost every
action, which is exactly the class of change `[3]` cannot see (§5a). Their
evidence is trigger-and-verify, not DOM equality.

Migrations: **22 total**, run automatically at server boot, all idempotent,
verified to apply cleanly on a brand-new database and to no-op on re-run. The six
added since the original refactor (`017`, `017b`, `018`, `019`, `020`, `021`) are
covered in §1.6 — all have already run successfully in production. **The 14
unpushed commits add no migration.**

**Things to know before pushing:**

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

## 9. Open decisions and follow-ups

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

**Planned work, decided and deferred (not open questions — the call was made):**

- **Ban `style` in stored HTML, once the content is migrated.** The comment/
  description sanitiser (§5b) allows `style` on `img`, `div`, `span` and `p`.
  That was a knowing trade, not an oversight: 8 stored bodies carry the inline
  sizing for their images in a `style` attribute, so banning it outright would
  have made every inline screenshot render at full size. What `style` still
  permits is CSS redressing — a stored `position:fixed;z-index:9999` overlay
  covering the app — which is real but far below script execution, and which
  DOMPurify does not filter by default. The path out, in order: migrate the
  bodies that use `style` onto classes, confirm no stored body needs it, then
  drop `style` from `SANITISE_ALLOWED_ATTRS` in `src/client/utils/index.js` and
  re-run the render-fidelity comparison. Recorded here so a future reader does
  not mistake the allowance for carelessness, and does not silently ban the
  attribute and break the existing content.
- **The other two classes found in the same audit.** The sanitiser commit closed
  the five sinks where stored HTML reaches `innerHTML`. Two separate classes
  came out of the same audit and are their own work: a **session token embedded
  in a stored comment body** (readable by every member of the space, so a
  credential leak, and `stripFileAuthTokensFromHtml` did not catch the row that
  has it), and **185 quote-sensitive `esc()` interpolations** inside HTML
  attributes — the same bug class as the `title=` filename hole fixed in
  `7d0c4c4`, since `esc()` does not escape quotes.

**Smaller open items:**

- `lib/schema-check.js:50,106` name two SQL files that have never existed.
- **No auth audit logging.** Failed logins are recorded nowhere and there is no
  request logging at all. Prevention exists; detection does not.
- Stale files on the server (§8).
- `[3]` is data-thin on PTM (no sprints, so those pages render "No sprints found."
  identically before and after any change) and sensitive to the notification
  badge (blind spot 9) and the delete-bin countdown (blind spot 12).
- `dev-login.html` — **KEEP.** Untracked, excluded from `git archive`, served only
  with `ALLOW_DEV_LOGIN=1`. `login.html` is Microsoft-OAuth only, so this is the
  only local password login.
- Everything in `DEAD-CODE-INVENTORY.md`: 18 proven-dead client symbols kept
  deliberately, 7 unprovable routes, 3 partial-destructure requires.
- No frontend/browser component test suite (§7) — the frontend investigation
  in §3 found nothing worth fixing, but the *coverage gap itself* (nothing
  beyond `flows.js` and DOM-diff) is still open if frontend logic changes are
  ever made.

## 10. The rule that made this work

`catdiff` proves the frontend is byte-identical to a declared reference —
**42 of 42 files**, with **zero** occurrences of `modified`.

That number was true against the *original* pre-split `app.js` for most of this
document's history. The toast overhaul (§5a) changed 26 client files on purpose,
and `modified:true` climbed to **28 of 42** — two-thirds of the client verified
only by its own pins, no longer against anything external. That is precisely the
erosion the server tree had already demonstrated, and it is what `modified:true`
does by design: it buys a deliberate change at the cost of permanent raw
coverage, so the number only ever falls.

So the client was **re-baselined**: the current parts became the new pristine,
every `modified` flag was cleared, and `[A]`/`[B]`/`[C]`/`[D]` cover all 42 again.
This is a real trade, stated plainly — the client is now byte-verified against
**the code as reviewed at the re-baseline commit**, not against the original
`app.js`. What that still buys is the thing that matters day to day: no byte can
change from here without someone declaring it. What it gives up is the link back
to the pre-refactor original, which is why the outgoing baseline was verified
byte-identical to `git show c22c688:app.js` (LF→CRLF) *before* being replaced, and
kept.

The re-baseline was falsified five ways before being trusted — a changed byte, a
changed `<script>` order, a corrupted snapshot, a deleted part, an appended line —
each of which must make `catdiff` go red, and each of which did. The corrupted
snapshot is caught by a stronger guard than expected: the snapshot's own sha256 is
pinned in the manifest, so the reference cannot be quietly re-pointed by editing
it. Re-baselining is now a guarded tool
(`scripts/refactor-verify/rebaseline-client.js`, refuses to run without
`--confirm`) rather than something done by hand.

Current coverage:

| Tree | Raw byte-verified | Pinned-digest-verified |
|---|---|---|
| client (42 parts) | **42 of 42** — against the re-baseline, not the original `app.js` | 42 of 42 |
| server (32 parts) | 11 of 32 (`modified:true` on 21) | 32 of 32 (`[SE]`) |
| `lib/` (7 files) | n/a — never split from anything | 7 of 7 |

The server tree is the untreated control: it shows what the client looked like
before this, and what it will look like again if `modified:true` is allowed to
accumulate instead of being periodically reset.

That guarantee was deliberately protected over removing ~300 lines of code that
nothing calls, over multiple rounds of behavioural fixes, over a production
incident and its remediation, and over a full frontend performance investigation
that touched zero files. If you are considering spending it, read
`DEAD-CODE-INVENTORY.md` first.
