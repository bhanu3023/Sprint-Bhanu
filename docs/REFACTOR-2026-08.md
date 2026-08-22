# Refactor and hardening, August 2026 — handoff

40 commits on `manmadha`, none pushed. This document exists so the work is legible
to whoever touches it next.

**Read this first, then [`AUDIT-FINDINGS.md`](../AUDIT-FINDINGS.md) and
[`DEAD-CODE-INVENTORY.md`](DEAD-CODE-INVENTORY.md).** Those two record decisions
that should not be re-litigated.

## The one-paragraph version

`app.js` (17,295 lines) and `server.js` (3,204 lines) were split into `src/client/`
(42 files) and `src/server/` (37 files) by a **move-only** refactor, proven
byte-identical. Six deliberate behaviour changes were then made, each verified
individually. A verification harness was built alongside and is the reason any of
this is trustworthy. Nothing has been deployed: **production still runs
pre-refactor code.**

---

## 1. What changed

### The refactor — no logic or UI change, mechanically proven

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

### The six intended behaviour changes

| Commit | Change |
|---|---|
| `ef8f155` | **Login rate limiting.** Two in-memory fixed-window buckets: per-IP 20, per-email 8, 15-minute window. Only failures count; success clears both. Also split `routes/auth.js` out of `routes/oauth.js` (password login is not an OAuth route). |
| `1a451cc` | **Upload ceilings** replacing `fileSize: Infinity`. Per file 1,073,741,823 (the Postgres `bytea` maximum); per request 1,100,000,000, checked on `Content-Length` before multer parses. |
| `4edea2c` | **Email HTML escaping.** `notify.js` put issue titles and comment text straight into an `<h2>`/`<p>`. Subjects deliberately stay unescaped — a subject is plain text. |
| `ee28352` `7ff43ad` | **Static allowlist.** `express.static(__dirname)` served the whole repository; `lib/permissions.js`, `db/schema.sql`, `Dockerfile`, `package.json` and CI config were all publicly readable. Now an allowlist, with prefixes restricted by file type. |
| `bc2160b` | **Issue-key retry.** Concurrent creates read the same `MAX(key)` and the loser got a bare 500. Reproduced at 12 concurrent: 5×201, 7×500. Now bounded retry on `23505/issues_key_key`. |
| `bb382c2` | **`GET /api/data` scoped in SQL** for non-admins instead of loading every user and membership and filtering in JS. Responses proven byte-identical for three roles. |
| `48e8e08` | **`/api/debug/spaces` gated to org admin.** It returned every space to any authenticated user. |

### Deletions and infrastructure

`ea58f70` `25dcc38` `621c0d1` `3d055ec` `8f6c9a6` removed 17 orphaned files.
`c3eb0c8` `590b024` fixed the deploy syntax gate (it checked the deleted `app.js`).
`c2a71c5` added minimum-count and repo-integrity guards. `b2ced8d` added
`.dockerignore`. `2db5329` removed the unused `cors` dependency. `bfe05fe` removed
one unused require. `b84eb5d` relocated `goBackFromIssue`. `33639a3` corrected an
archive floor I had set wrong.

---

## 2. The harness

Everything lives in `scripts/refactor-verify/`. Snapshots go to `.refactor-verify/`
(gitignored, ~30 MB, contains real user names and emails).

```
node scripts/refactor-verify/preflight.js        # ALWAYS first
node scripts/refactor-verify/catdiff.js          # client move purity
node scripts/refactor-verify/serverdiff.js       # server move purity
node scripts/refactor-verify/capture.js  <label> # snapshot 47 pages
node scripts/refactor-verify/compare.js  <a> <b> # checks [1][2][2b][3][4]
node scripts/refactor-verify/scriptblock.js      # check [5]
node scripts/refactor-verify/flows.js            # 7 core flows
node scripts/refactor-verify/dbfingerprint.js <label>
node scripts/test-hotjar.js                      # 138 assertions
node scripts/test-email-escaping.js              #  33 assertions
```

`SB_BASE` points the browser checks at another port. `ALLOW_DEV_LOGIN=1` is needed
in `.env` for `dev-login.html`.

### What each check proves — and what it does not

| Check | Proves | Does NOT prove |
|---|---|---|
| `catdiff [A][B][C][D]` | all 42 client files are byte-identical to the original `app.js`; ranges tile 1..17295 once; un-applying declared moves reproduces pristine line-for-line | nothing about behaviour |
| `serverdiff [SA][SB][SC][SD]` | declared glue matches byte-for-byte, bodies are RAW-identical, lines tile 1..3204 once, require order preserved | **only for parts NOT flagged `modified`. Currently 20 of 32.** The check prints the excluded list every run |
| `[1] [2]` | `Object.keys(window)` and their typeofs unchanged | misses top-level `const`/`let` — that is what `[2b]` is for |
| `[2b]` | 690 named globals still resolve | the list is self-declared. Never edit it to make a red check green |
| `[3]` | `document.body.innerHTML` identical across 47 pages | scripts and comments are stripped (that is `[5]`); sensitive to data drift, see blind spot 9 |
| `[4]` | no new console errors or failed requests | **ignores warnings entirely** |
| `[5]` | the `<script>` block in `index.html` is intact, ordered, no dupes or drops | nothing about file contents |
| `preflight [P1]–[P5]` | exactly one listener, started this run, all tracked files present, no deletions | nothing if you skip it |
| `flows.js` | 7 core user journeys work end to end | narrow coverage; 8 assertions |

**Protocol that matters:** restart the server, run `preflight`, capture, *then* run
`flows`. `flows` creates notifications, which changes `[3]` on every page — see
blind spot 9.

---

## 3. All ten blind spots

Checks that passed while verifying nothing. **Eight were found in existing work.
Two were introduced by this work** — the distinction matters, because hardening
that introduces its own defects is a different failure mode from inheriting one.

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
| 10 | **`MIN_ARCHIVE_ENTRIES` was set to 193 against a real 194.** `git archive` emits directory entries (34 today), so a file in a *new* directory raises the count by two. At 193 the check would have passed an archive that had silently lost a file — the exact failure it exists to catch. | **INTRODUCED** — while hardening, on the very hazard that prompted the guard |

A related one, also introduced: the runtime probe used for dead-code analysis
reported two known-live controls (`barChart`, `renderAllWork`) as never invoked,
because wrappers installed after page load and every render fires during load.
**Always include known-live controls in a probe: if a control reads zero, the probe
is broken, not the code.**

**The habit that produced all of these:** prove the check FAILS on the fault it is
supposed to catch. A green check that has never been shown to go red is decoration.

---

## 4. Audit claims that were wrong

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

## 5. What is NOT verified

Be honest about these when planning the deploy.

- **The container layer.** Docker is not installed on the development machine, so
  no `docker build` was ever run. `.dockerignore` was written but never validated
  by a build. The first real build happens on the server during deploy. Mitigations:
  the app source was scanned for post-Node-18 APIs (`Object.groupBy`, `toSorted`,
  `Promise.withResolvers`, …) with **zero hits**, and nothing branches on
  `NODE_ENV`. Container networking is unchanged by this work.
- **The rate limiter's 15-minute release.** Only restart-release was demonstrated.
  Note that once blocked, a correct password also gets 429 until the window expires
  — that is by design, but it means a legitimate user is locked out for 15 minutes.
- **Multi-instance behaviour.** The limiter is per-process, so limits multiply by
  instance count. Single container today.
- **Production.** It still serves pre-refactor code.
- **Item 6's equivalence** rests on three constructed roles (admin, member with all
  spaces, member with one). A role shape not constructed could differ.

---

## 6. Deploying

The workflow triggers on **push to `main`** and on manual dispatch. Merging
`manmadha` into `main` locally does nothing; production changes only on push.

Sequence: syntax gate → build and assert the release archive → SSH → `pg_dump`
(aborts if under 1 KB) → extract → `docker build` → tag old image `:previous` →
swap → health check → roll back the container on any failure.

**Rollback:** automatic container rollback to `:previous` if any step fails, and it
only acts if the container was actually swapped. DB restore from
`/opt/backups/<newest>.sql`. Git-level, `main` currently sits at `c22c688`.

**Two things to know before the first deploy:**

1. **Stale files persist on the server.** The deploy extracts the archive *over*
   `/opt/Sprint-Board` without wiping, so every file deleted from git stays on disk
   and gets baked into the next image — `app.js`, `check.js`,
   `assets/placeholder.txt` and 14 others. Harmless functionally, and unreachable
   over HTTP thanks to the static allowlist, but it needs a one-time `rm` or
   `--delete` handling.
2. **No new migrations.** `lib/migrations/index.js` is identical between `main` and
   `manmadha` — 16 migrations both sides. The riskiest deploy failure (a partly
   applied migration, which the workflow explicitly cannot roll back) is not in
   play.

---

## 7. Open follow-ups

Full list with detail in `AUDIT-FINDINGS.md`. Summary:

- `lib/schema-check.js:50,106` name two SQL files that have never existed.
- **No auth audit logging.** Failed logins are recorded nowhere and there is no
  request logging at all. Prevention exists; detection does not.
- Stale files on the server (above).
- Rate limiter is per-process.
- `[3]` is data-thin on PTM (no sprints, so those pages render "No sprints found."
  identically before and after any change) and sensitive to the notification badge.
- `dev-login.html` — **KEEP.** Untracked, excluded from `git archive`, served only
  with `ALLOW_DEV_LOGIN=1`. `login.html` is Microsoft-OAuth only, so this is the
  only local password login.
- Everything in `DEAD-CODE-INVENTORY.md`: 18 proven-dead client symbols kept
  deliberately, 7 unprovable routes, 3 partial-destructure requires.

## 8. The rule that made this work

`catdiff` proves the frontend is byte-identical to what it was before any of this
started — **42 of 42 files**, and `catdiff` has **zero** occurrences of `modified`.
Deleting one line inside a client file would require adding that flag, and the
server tree shows the price: 32/32 byte-verified at the start, **20/32 now**, and
the erosion cannot be reversed.

That guarantee was deliberately protected over removing ~300 lines of code that
nothing calls. If you are considering spending it, read
`DEAD-CODE-INVENTORY.md` first.
