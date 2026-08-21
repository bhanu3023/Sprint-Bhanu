/**
 * MOVE-PURITY PROOF.
 *
 *   node scripts/refactor-verify/catdiff.js
 *
 * Four independent assertions per split file, all of which must hold:
 *
 *   A. RANGE FIDELITY  — each part's bytes equal the pristine original's bytes
 *                        for the line range that part claims. Proves no edit,
 *                        no reformat, no reorder WITHIN a part.
 *   B. EXACT TILING    — the parts' line ranges tile 1..N with no gap and no
 *                        overlap. Proves nothing was lost or duplicated.
 *   C. CONCATENATION   — concatenating the parts in load order is byte-identical
 *                        to the whole pristine original.
 *   D. DECLARED ORDER  — for client files, the <script src> sequence parsed out
 *                        of the REAL index.html must equal the parts' ascending
 *                        line order. The manifest is not trusted for order; if
 *                        index.html and the manifest disagree, that disagreement
 *                        is itself reported as the bug.
 *
 * LINE ENDINGS: this repo has core.autocrlf=true, so files are CRLF on disk and
 * LF in git blobs (app.js: 891641 bytes on disk vs 874347 in the blob -- exactly
 * one extra byte per line). Comparison therefore normalizes both sides to LF.
 * That is git's checkout behaviour, not a source change; line COUNT and all
 * non-EOL bytes are still compared exactly, so a real edit still fails.
 * The pristine reference is preferred from .refactor-verify/pristine/<file>
 * (an untransformed disk snapshot taken before Phase 1) and falls back to
 * `git show <baselineRef>:<file>`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const PRISTINE_DIR = path.join(ROOT, '.refactor-verify', 'pristine');

const toLF = buf => Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');
const rd = p => fs.readFileSync(p);

function pristineOf(original, baselineRef) {
  const snap = path.join(PRISTINE_DIR, original.replace(/[\\/]/g, '__'));
  if (fs.existsSync(snap)) return { buf: rd(snap), src: 'disk snapshot ' + path.relative(ROOT, snap) };
  const flat = path.join(PRISTINE_DIR, path.basename(original));
  if (fs.existsSync(flat)) return { buf: rd(flat), src: 'disk snapshot ' + path.relative(ROOT, flat) };
  return {
    buf: execFileSync('git', ['show', baselineRef + ':' + original], { cwd: ROOT, maxBuffer: 1 << 28 }),
    src: 'git ' + baselineRef + ':' + original
  };
}

/** Ordered list of script srcs in an HTML file, in document order. */
function scriptSrcOrder(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[2]);
  return out;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const targets = manifest.targets || [];
let failed = false;

console.log('=== cat-diff move-purity proof ===');
console.log('baselineRef: ' + manifest.baselineRef + '\n');

if (!targets.length) {
  console.log('manifest.targets is empty -- nothing split yet. Nothing to prove.');
  process.exit(0);
}

for (const t of targets) {
  const parts = t.parts || [];
  console.log('--- ' + t.original + '  (' + parts.length + ' part' + (parts.length === 1 ? '' : 's') + ') ---');
  if (!parts.length) { console.log('   no parts declared, skipped\n'); continue; }

  const { buf: rawPristine, src } = pristineOf(t.original, manifest.baselineRef);
  const pristine = toLF(rawPristine);
  const pLines = pristine.toString('utf8').split('\n');
  const totalLines = pLines.length;
  console.log('   pristine source : ' + src);
  console.log('   pristine bytes  : ' + pristine.length + ' (LF-normalized), lines: ' + totalLines);

  // ── A. range fidelity ────────────────────────────────────────────────
  let aOk = true;
  const missing = parts.filter(p => !fs.existsSync(path.join(ROOT, p.file)));
  if (missing.length) {
    aOk = false; failed = true;
    missing.forEach(p => console.log('   [A] MISSING FILE: ' + p.file));
  }
  for (const p of parts) {
    if (!fs.existsSync(path.join(ROOT, p.file))) continue;
    const actual = toLF(rd(path.join(ROOT, p.file))).toString('utf8');
    const isLast = p.to >= totalLines;
    const expected = pLines.slice(p.from - 1, p.to).join('\n') + (isLast ? '' : '\n');
    if (actual !== expected) {
      aOk = false; failed = true;
      console.log('   [A] *** ' + p.file + ' does NOT match original lines ' + p.from + '-' + p.to);
      const min = Math.min(actual.length, expected.length);
      let i = 0; while (i < min && actual[i] === expected[i]) i++;
      const lineNo = p.from + expected.slice(0, i).split('\n').length - 1;
      console.log('        first difference at original line ~' + lineNo);
      console.log('        expected: ' + JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60)));
      console.log('        actual  : ' + JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60)));
    }
  }
  console.log('   [A] range fidelity  : ' + (aOk ? 'PASS — every part matches its original line range' : 'FAIL'));

  // ── B. exact tiling ─────────────────────────────────────────────────
  const sorted = parts.slice().sort((x, y) => x.from - y.from);
  let bOk = true, cursor = 1;
  for (const p of sorted) {
    if (p.from !== cursor) {
      bOk = false;
      console.log('   [B] ' + (p.from > cursor ? 'GAP' : 'OVERLAP') + ' before ' + p.file +
                  ': expected to start at line ' + cursor + ', starts at ' + p.from);
    }
    cursor = p.to + 1;
  }
  if (cursor - 1 !== totalLines) {
    bOk = false;
    console.log('   [B] coverage ends at line ' + (cursor - 1) + ' but original has ' + totalLines);
  }
  if (!bOk) failed = true;
  console.log('   [B] exact tiling    : ' + (bOk ? 'PASS — lines 1-' + totalLines + ' covered exactly once' : 'FAIL'));

  // ── C. concatenation ────────────────────────────────────────────────
  let cOk = false;
  if (parts.every(p => fs.existsSync(path.join(ROOT, p.file)))) {
    const order = t.loadOrder && t.loadOrder.length ? t.loadOrder : sorted.map(p => p.file);
    const joined = Buffer.concat(order.map(f => toLF(rd(path.join(ROOT, f)))));
    cOk = Buffer.compare(pristine, joined) === 0;
    if (!cOk) {
      failed = true;
      const min = Math.min(pristine.length, joined.length);
      let i = 0; while (i < min && pristine[i] === joined[i]) i++;
      console.log('   [C] concatenated bytes: ' + joined.length + ' vs pristine ' + pristine.length);
      console.log('   [C] first difference at byte ' + i +
                  ' (original line ~' + pristine.slice(0, i).toString('utf8').split('\n').length + ')');
    }
  } else failed = true;
  console.log('   [C] concatenation   : ' + (cOk ? 'PASS — cat-diff EMPTY' : 'FAIL'));

  // ── D. declared order vs real index.html ────────────────────────────
  if (t.orderFrom) {
    const htmlPath = path.join(ROOT, t.orderFrom);
    if (!fs.existsSync(htmlPath)) {
      failed = true;
      console.log('   [D] order source    : FAIL — ' + t.orderFrom + ' not found');
    } else {
      const declared = sorted.map(p => p.file.replace(/\\/g, '/'));
      const declaredSet = new Set(declared);
      const inHtml = scriptSrcOrder(htmlPath)
        .map(s => s.replace(/^\.?\//, ''))
        .filter(s => declaredSet.has(s));
      const same = inHtml.length === declared.length && inHtml.every((s, i) => s === declared[i]);
      if (!same) {
        failed = true;
        console.log('   [D] order source    : FAIL — index.html <script> order != original line order');
        console.log('        index.html order : ' + JSON.stringify(inHtml, null, 0));
        console.log('        line order       : ' + JSON.stringify(declared, null, 0));
        const miss = declared.filter(d => !inHtml.includes(d));
        if (miss.length) console.log('        declared parts NOT referenced by any <script src>: ' + miss.join(', '));
      } else {
        console.log('   [D] order source    : PASS — ' + t.orderFrom + ' <script> order == original line order (' + inHtml.length + ' tags)');
      }
    }
  } else {
    console.log('   [D] order source    : n/a (no orderFrom declared for this target)');
  }
  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — move purity NOT proven' : 'PASS — all checks empty') + ' ===');
process.exit(failed ? 1 : 0);
