/**
 * MOVE-PURITY PROOF.  RAW byte-identity is MANDATORY.
 *
 *   node scripts/refactor-verify/catdiff.js
 *
 * Four independent assertions per split file, all compared on RAW, UNTRANSFORMED
 * bytes. There is no line-ending fallback that can produce a PASS: a green check
 * means exactly one thing -- the bytes are identical.
 *
 *   A. RANGE FIDELITY  — each part's raw bytes equal the pristine original's raw
 *                        bytes for the line range that part claims.
 *   B. EXACT TILING    — the parts' line ranges tile 1..N with no gap, no overlap.
 *   C. CONCATENATION   — concatenating the parts in load order is raw
 *                        byte-identical to the whole pristine original.
 *   D. DECLARED ORDER  — for client targets, the <script src> sequence parsed out
 *                        of the REAL index.html equals the parts' ascending line
 *                        order. The manifest is never trusted for order; a
 *                        disagreement between the two is reported as the bug.
 *
 * LINE ENDINGS: core.autocrlf=true here, so working files are CRLF and git blobs
 * are LF. The reference is therefore .refactor-verify/pristine/<file> -- an
 * untransformed disk snapshot (see pristine.js). CRLF->LF normalization is used
 * ONLY as a failure diagnostic: when RAW fails, we report whether the content
 * would have matched under normalization, so a line-ending problem is instantly
 * distinguishable from lost/edited content. That path can never yield a PASS.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const PRISTINE_DIR = path.join(ROOT, '.refactor-verify', 'pristine');

const rd = p => fs.readFileSync(p);
const toLF = s => s.replace(/\r\n/g, '\n');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const targets = manifest.targets || [];
let failed = false;

console.log('=== cat-diff move-purity proof — RAW byte-identity MANDATORY ===');
console.log('baselineRef: ' + manifest.baselineRef + '\n');

if (!targets.length) {
  console.log('manifest.targets is empty -- nothing split yet. Nothing to prove.');
  process.exit(0);
}

for (const t of targets) {
  const parts = t.parts || [];
  console.log('--- ' + t.original + '  (' + parts.length + ' part' + (parts.length === 1 ? '' : 's') + ') ---');
  if (!parts.length) { console.log('   no parts declared, skipped\n'); continue; }

  // ── reference: the pristine untransformed disk snapshot, required ────
  const refPath = path.join(PRISTINE_DIR, path.basename(t.original));
  if (!fs.existsSync(refPath)) {
    failed = true;
    console.log('   !! NO PRISTINE SNAPSHOT at ' + path.relative(ROOT, refPath));
    console.log('      RAW byte-identity cannot be proven against a git blob in a');
    console.log('      core.autocrlf=true repo. Run: node scripts/refactor-verify/pristine.js');
    console.log('');
    continue;
  }
  const pristine = rd(refPath);
  const recorded = (manifest.pristine || {})[path.basename(t.original)];
  if (recorded && recorded.sha256 !== sha(pristine)) {
    failed = true;
    console.log('   !! PRISTINE SNAPSHOT HASH MISMATCH — the reference has been altered');
    console.log('      manifest: ' + recorded.sha256);
    console.log('      on disk : ' + sha(pristine));
    console.log('');
    continue;
  }

  // byte-preserving line split ('latin1' maps each byte 1:1, so \r is retained)
  const pStr = pristine.toString('latin1');
  const pLines = pStr.split('\n');
  const totalLines = pLines.length;
  console.log('   reference : ' + path.relative(ROOT, refPath) + '  (untransformed disk snapshot)');
  console.log('   bytes     : ' + pristine.length + '   lines: ' + totalLines);

  // ── A. range fidelity (RAW) ─────────────────────────────────────────
  let aOk = true;
  for (const p of parts) {
    const abs = path.join(ROOT, p.file);
    if (!fs.existsSync(abs)) { aOk = false; failed = true; console.log('   [A] MISSING FILE: ' + p.file); continue; }
    const actual = rd(abs).toString('latin1');
    const isLast = p.to >= totalLines;
    const expected = pLines.slice(p.from - 1, p.to).join('\n') + (isLast ? '' : '\n');
    if (actual === expected) continue;

    aOk = false; failed = true;
    console.log('   [A] *** ' + p.file + ' does NOT match original lines ' + p.from + '-' + p.to);
    // diagnostic: is this only line endings, or is content actually different?
    if (toLF(actual) === toLF(expected)) {
      console.log('        DIAGNOSTIC: content is identical; only LINE ENDINGS differ.');
      console.log('        (' + actual.length + ' vs ' + expected.length + ' bytes) Rewrite the part preserving CRLF.');
    } else {
      const min = Math.min(actual.length, expected.length);
      let i = 0; while (i < min && actual[i] === expected[i]) i++;
      const lineNo = p.from + expected.slice(0, i).split('\n').length - 1;
      console.log('        DIAGNOSTIC: CONTENT differs (not just line endings) at original line ~' + lineNo);
      console.log('        expected: ' + JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60)));
      console.log('        actual  : ' + JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60)));
    }
  }
  console.log('   [A] range fidelity  : ' + (aOk ? 'PASS — every part RAW-matches its original line range' : 'FAIL'));

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

  // ── C. concatenation (RAW) ──────────────────────────────────────────
  let cOk = false;
  if (parts.every(p => fs.existsSync(path.join(ROOT, p.file)))) {
    const order = t.loadOrder && t.loadOrder.length ? t.loadOrder : sorted.map(p => p.file);
    const joined = Buffer.concat(order.map(f => rd(path.join(ROOT, f))));
    cOk = Buffer.compare(pristine, joined) === 0;
    if (!cOk) {
      failed = true;
      console.log('   [C] concatenated ' + joined.length + ' bytes vs pristine ' + pristine.length);
      if (toLF(joined.toString('latin1')) === toLF(pStr)) {
        console.log('   [C] DIAGNOSTIC: content complete and in order; only LINE ENDINGS differ.');
      } else {
        const min = Math.min(pristine.length, joined.length);
        let i = 0; while (i < min && pristine[i] === joined[i]) i++;
        console.log('   [C] DIAGNOSTIC: CONTENT differs at byte ' + i +
                    ' (original line ~' + pStr.slice(0, i).split('\n').length + ')');
      }
    }
  } else failed = true;
  console.log('   [C] concatenation   : ' + (cOk ? 'PASS — cat-diff EMPTY (RAW byte-identical)' : 'FAIL'));

  // ── D. declared order vs the real HTML ──────────────────────────────
  if (t.orderFrom) {
    const htmlPath = path.join(ROOT, t.orderFrom);
    if (!fs.existsSync(htmlPath)) {
      failed = true;
      console.log('   [D] order source    : FAIL — ' + t.orderFrom + ' not found');
    } else {
      const html = fs.readFileSync(htmlPath, 'utf8');
      const srcs = [];
      const re = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
      let m; while ((m = re.exec(html))) srcs.push(m[2].replace(/^\.?\//, ''));
      const declared = sorted.map(p => p.file.replace(/\\/g, '/'));
      const declaredSet = new Set(declared);
      const inHtml = srcs.filter(s => declaredSet.has(s));
      const same = inHtml.length === declared.length && inHtml.every((s, i) => s === declared[i]);
      if (!same) {
        failed = true;
        console.log('   [D] order source    : FAIL — <script> order != original line order');
        console.log('        index.html order : ' + JSON.stringify(inHtml));
        console.log('        line order       : ' + JSON.stringify(declared));
        const miss = declared.filter(d => !inHtml.includes(d));
        if (miss.length) console.log('        parts with NO <script src>: ' + miss.join(', '));
      } else {
        console.log('   [D] order source    : PASS — ' + t.orderFrom + ' <script> order == line order (' + inHtml.length + ' tags)');
      }
    }
  } else {
    console.log('   [D] order source    : n/a (no orderFrom declared)');
  }
  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — move purity NOT proven' : 'PASS — all checks empty (RAW)') + ' ===');
process.exit(failed ? 1 : 0);
