/**
 * Diffs two capture snapshots.
 *
 *   node scripts/refactor-verify/compare.js <before-label> <after-label>
 *
 * Exit code 0 only when EVERY check is empty:
 *   - window key set identical (added/removed listed)
 *   - typeof identical for every shared key
 *   - normalized body.innerHTML identical for every page
 *   - no new console errors / failed requests
 * Anything non-empty exits 1 and prints the first differing hunks.
 */
const fs = require('fs');
const path = require('path');
const { toDiffableLines } = require('./lib/normalize');

const OUTDIR = path.join(__dirname, '..', '..', '.refactor-verify');
const load = l => JSON.parse(fs.readFileSync(path.join(OUTDIR, l + '.json'), 'utf8'));

function firstDiffHunks(aHtml, bHtml, ctx = 2, maxHunks = 3) {
  const A = toDiffableLines(aHtml), B = toDiffableLines(bHtml);
  const hunks = [];
  const max = Math.max(A.length, B.length);
  let i = 0;
  while (i < max && hunks.length < maxHunks) {
    if ((A[i] || '') !== (B[i] || '')) {
      const from = Math.max(0, i - ctx);
      const to = Math.min(max, i + ctx + 1);
      const lines = [];
      for (let j = from; j < to; j++) {
        const a = A[j] === undefined ? '<none>' : A[j];
        const b = B[j] === undefined ? '<none>' : B[j];
        lines.push((a === b ? '  ' : (a !== b ? '- ' : '  ')) + a.slice(0, 220));
        if (a !== b) lines.push('+ ' + b.slice(0, 220));
      }
      hunks.push({ atLine: i + 1, lines });
      // skip past this hunk
      while (i < max && (A[i] || '') !== (B[i] || '')) i++;
    }
    i++;
  }
  return hunks;
}

const [beforeLabel, afterLabel] = process.argv.slice(2);
if (!beforeLabel || !afterLabel) { console.error('usage: compare.js <before> <after>'); process.exit(2); }

const a = load(beforeLabel), b = load(afterLabel);
let failed = false;
const say = s => console.log(s);

say('=== comparing "' + beforeLabel + '" -> "' + afterLabel + '" ===\n');

// ── window key set ───────────────────────────────────────────────────────
const A = new Set(a.windowKeys), B = new Set(b.windowKeys);
const removed = a.windowKeys.filter(k => !B.has(k));
const added   = b.windowKeys.filter(k => !A.has(k));
say('[1] Object.keys(window)  before=' + a.windowKeys.length + '  after=' + b.windowKeys.length);
if (removed.length || added.length) {
  failed = true;
  if (removed.length) say('    REMOVED (' + removed.length + '): ' + removed.join(', '));
  if (added.length)   say('    ADDED   (' + added.length + '): ' + added.join(', '));
} else say('    -> IDENTICAL (empty diff)');

// ── typeof per shared key ────────────────────────────────────────────────
const typeChanges = [];
for (const k of a.windowKeys) {
  if (!B.has(k)) continue;
  if (a.windowTypes[k] !== b.windowTypes[k]) typeChanges.push(k + ': ' + a.windowTypes[k] + ' -> ' + b.windowTypes[k]);
}
say('\n[2] typeof window[k] for shared keys');
if (typeChanges.length) { failed = true; typeChanges.forEach(t => say('    CHANGED: ' + t)); }
else say('    -> IDENTICAL (empty diff)');

// ── declarative globals probed by name ───────────────────────────────────
// Object.keys(window) misses top-level const/let (S, esc, $, qs, qsa, cap,
// escAttr ...), which are the most-used symbols in the codebase. These are
// probed by name instead, so losing one cannot slip past checks [1]/[2].
say('\n[2b] global identifiers probed by name (catches lost const/let bindings)');
{
  const pa = a.globalProbe || {}, pb = b.globalProbe || {};
  const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  if (!names.length) {
    say('    -> SKIPPED: snapshots predate the probe (recapture "' + beforeLabel + '" to enable)');
  } else {
    const changed = names.filter(n => pa[n] !== pb[n]);
    const lost = names.filter(n => pa[n] && pa[n] !== 'undefined' && pa[n] !== '<throws>' &&
                                   (pb[n] === 'undefined' || pb[n] === '<throws>' || pb[n] === undefined));
    say('    probed=' + names.length +
        '  before-missing=' + (a.globalProbeMissing || []).length +
        '  after-missing=' + (b.globalProbeMissing || []).length);
    if (lost.length) {
      failed = true;
      say('    *** LOST GLOBALS (' + lost.length + '): ' + lost.join(', '));
    }
    const otherChanges = changed.filter(n => !lost.includes(n));
    if (otherChanges.length) {
      failed = true;
      otherChanges.forEach(n => say('    CHANGED: ' + n + ': ' + pa[n] + ' -> ' + pb[n]));
    }
    if (!lost.length && !otherChanges.length) say('    -> IDENTICAL (empty diff)');
  }
}

// ── per-page DOM ─────────────────────────────────────────────────────────
say('\n[3] document.body.innerHTML per page (normalized)');
const names = [...new Set([...a.capturedPages, ...b.capturedPages])];
let domDiffs = 0;
for (const n of names) {
  const pa = a.pages[n], pb = b.pages[n];
  if (!pa || !pb) { failed = true; domDiffs++; say('    ' + n.padEnd(26) + ' MISSING in ' + (pa ? afterLabel : beforeLabel)); continue; }
  if (pa.html === pb.html) { say('    ' + n.padEnd(26) + ' identical  (' + pa.htmlLength + ' chars)'); continue; }
  failed = true; domDiffs++;
  say('    ' + n.padEnd(26) + ' *** DIFFERS *** (' + pa.htmlLength + ' -> ' + pb.htmlLength + ' chars)');
  firstDiffHunks(pa.html, pb.html).forEach(h => {
    say('        @ diff-line ' + h.atLine);
    h.lines.forEach(l => say('        ' + l));
  });
}
say('    -> ' + (domDiffs === 0 ? 'ALL PAGES IDENTICAL (empty diff)' : domDiffs + ' page(s) differ'));

// ── console errors / failed requests ─────────────────────────────────────
say('\n[4] console errors & failed requests');
let newIssues = 0;
for (const n of names) {
  const pa = a.pages[n] || { newConsoleErrors: [], newFailedRequests: [] };
  const pb = b.pages[n] || { newConsoleErrors: [], newFailedRequests: [] };
  const ce = pb.newConsoleErrors.length - pa.newConsoleErrors.length;
  const fr = pb.newFailedRequests.length - pa.newFailedRequests.length;
  if (ce > 0 || fr > 0) {
    failed = true; newIssues++;
    say('    ' + n + ': +' + ce + ' console errors, +' + fr + ' failed requests');
    pb.newConsoleErrors.slice(-3).forEach(e => say('        [' + e.kind + '] ' + String(e.text).slice(0, 200)));
    pb.newFailedRequests.slice(-3).forEach(r => say('        req ' + (r.status || r.err) + ' ' + r.url));
  }
}
if (!newIssues) say('    -> NO NEW console errors or failed requests');

say('\n=== RESULT: ' + (failed ? 'FAIL — differences found above' : 'PASS — every diff empty') + ' ===');
process.exit(failed ? 1 : 0);
