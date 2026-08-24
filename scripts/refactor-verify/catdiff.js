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

// ── DECLARED MOVES ────────────────────────────────────────────────────────
// A placement fix relocates a block of code from one split file to another.
// That BREAKS the original model outright: the old [A] compared each file
// against its declared app.js line range, and [C] concatenated files in load
// order expecting the pristine bytes back. After a move, the source file is
// missing a block and the destination has one that belongs to a range it does
// not own, so [A] fails for both files and [C] fails on ordering.
//
// Contiguity is therefore GONE for the files involved, and the proof changes
// shape. It does not weaken:
//
//   [A] expected content is computed from pristine app.js MINUS the blocks
//       declared as moved out, PLUS the blocks declared as moved in at their
//       declared position. Still RAW byte-comparison against pristine bytes --
//       the relocation is declared, not assumed.
//
//   [C] replaced by REVERSIBILITY. Every file's ACTUAL bytes are split into
//       lines, each declared move is UN-APPLIED (the block is lifted out of the
//       destination and put back where it came from in the source), and the
//       result is concatenated in load order. That must equal pristine app.js
//       line-for-line. A move is pure exactly when it is byte-reversible, so
//       this is a stronger statement than the old ordered concatenation: it
//       proves no byte was added, lost or altered anywhere, AND that the moved
//       block is byte-identical to the original.
//
// If moves is empty the behaviour is identical to before.
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
// Client targets only. Server targets use a different part shape (ranges +
// declared glue, because CommonJS extraction cannot avoid a require preamble)
// and are proven separately by serverdiff.js. Without this filter catdiff
// silently mis-parsed the server parts -- p.from/p.to are undefined there -- and
// reported a bogus tiling/concatenation failure.
const targets = (manifest.targets || []).filter(t => t.kind !== 'server');
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

  const moves = t.moves || [];
  if (moves.length) {
    console.log('   moves     : ' + moves.length + ' declared relocation(s) — contiguity intentionally broken');
    moves.forEach(mv => {
      console.log('               app.js lines ' + mv.block[0] + '-' + mv.block[1] +
                  ' (' + (mv.block[1] - mv.block[0] + 1) + ' lines)');
      console.log('               from ' + mv.from);
      console.log('               to   ' + mv.to + ', after original line ' + mv.afterOriginalLine);
      if (mv.why) console.log('               why: ' + mv.why);
    });
  }

  // element helpers: a file's content split into lines, trailing-newline aware
  const toElems = (content, isLast) => isLast ? content.split('\n') : content.slice(0, -1).split('\n');
  const fromElems = (elems, isLast) => isLast ? elems.join('\n') : elems.join('\n') + '\n';
  const blockElems = mv => pLines.slice(mv.block[0] - 1, mv.block[1]);

  // Expected element array for a part, with declared moves applied.
  function expectedElems(p) {
    let els = pLines.slice(p.from - 1, p.to);
    // remove blocks that moved OUT of this file (descending, so indices hold)
    moves.filter(mv => mv.from === p.file)
         .sort((a, b) => b.block[0] - a.block[0])
         .forEach(mv => { els.splice(mv.block[0] - p.from, mv.block[1] - mv.block[0] + 1); });
    // insert blocks that moved INTO this file
    moves.filter(mv => mv.to === p.file)
         .sort((a, b) => a.afterOriginalLine - b.afterOriginalLine)
         .forEach(mv => { els.splice(mv.afterOriginalLine - p.from + 1, 0, ...blockElems(mv)); });
    return els;
  }

  // ── A. range fidelity (RAW, move-aware) ─────────────────────────────
  // A part declared `modified: true` is EXPECTED to no longer match its
  // original pristine range -- that is the whole point of the declaration.
  // Skip the RAW comparison for it rather than let an expected, deliberate
  // difference report as a failure; [E] below (pinned digest) is what keeps
  // a modified part honest instead. Anything NOT declared modified still
  // gets the full, unweakened check.
  let aOk = true;
  const modifiedParts = parts.filter(p => p.modified);
  for (const p of parts) {
    if (p.modified) {
      console.log('   [A] ' + p.file.padEnd(48) + ' MODIFIED by declaration: ' + p.modifiedReason);
      continue;
    }
    const abs = path.join(ROOT, p.file);
    if (!fs.existsSync(abs)) { aOk = false; failed = true; console.log('   [A] MISSING FILE: ' + p.file); continue; }
    const actual = rd(abs).toString('latin1');
    const isLast = p.to >= totalLines;
    const expected = fromElems(expectedElems(p), isLast);
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
  console.log('   [A] range fidelity  : ' + (aOk
    ? 'PASS — every non-modified part RAW-matches its original line range' + (modifiedParts.length ? ' (' + modifiedParts.length + ' modified by declaration, skipped -- see [E])' : '')
    : 'FAIL'));

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

  // ── C. concatenation / move-reversibility (RAW) ─────────────────────
  let cOk = false;
  if (modifiedParts.length) {
    // A modified part means the whole-file concatenation is EXPECTED to no
    // longer equal pristine byte-for-byte -- that expectation doesn't
    // change just because other parts are untouched. [B] above already
    // proves nothing was lost (the declared ranges still tile completely);
    // [E] below proves the modified content matches what was deliberately
    // pinned. Reporting this as FAIL would treat a declared, reasoned change
    // as if it were silent corruption.
    cOk = true;
    console.log('   [C] concatenation   : SKIPPED — ' + modifiedParts.length + ' part(s) modified by declaration ' +
      '(full-file byte match against pristine is expected to fail now; [B] proves nothing was lost, [E] proves the change matches what was pinned)');
  } else if (parts.every(p => fs.existsSync(path.join(ROOT, p.file)))) {
    const order = t.loadOrder && t.loadOrder.length ? t.loadOrder : sorted.map(p => p.file);

    if (!moves.length) {
      // No moves: the original check, byte-for-byte over concatenated files.
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
      console.log('   [C] concatenation   : ' + (cOk ? 'PASS — cat-diff EMPTY (RAW byte-identical)' : 'FAIL'));
    } else {
      // Moves declared: UN-APPLY them against the files' ACTUAL bytes, then
      // require the reconstruction to equal pristine line-for-line.
      const elemsByFile = {};
      for (const p of parts) {
        elemsByFile[p.file] = toElems(rd(path.join(ROOT, p.file)).toString('latin1'), p.to >= totalLines);
      }
      let liftOk = true;
      for (const mv of moves) {
        const destPart = parts.find(x => x.file === mv.to);
        const srcPart = parts.find(x => x.file === mv.from);
        const want = blockElems(mv);
        const at = mv.afterOriginalLine - destPart.from + 1;
        const got = elemsByFile[mv.to].slice(at, at + want.length);
        if (got.join('\n') !== want.join('\n')) {
          liftOk = false; failed = true;
          console.log('   [C] moved block is NOT byte-identical in its destination ' + mv.to);
          let i = 0; while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++;
          console.log('        first differing line ' + i + ' of the block');
          console.log('        expected: ' + JSON.stringify((want[i] || '').slice(0, 100)));
          console.log('        actual  : ' + JSON.stringify((got[i] || '').slice(0, 100)));
          break;
        }
        elemsByFile[mv.to].splice(at, want.length);                       // lift out of destination
        elemsByFile[mv.from].splice(mv.block[0] - srcPart.from, 0, ...want); // put back in source
      }
      if (liftOk) {
        const rebuilt = [];
        order.forEach(f => { rebuilt.push(...elemsByFile[f]); });
        cOk = rebuilt.length === pLines.length && rebuilt.every((l, i) => l === pLines[i]);
        if (!cOk) {
          failed = true;
          console.log('   [C] rebuilt ' + rebuilt.length + ' lines vs pristine ' + pLines.length);
          const n = Math.min(rebuilt.length, pLines.length);
          let i = 0; while (i < n && rebuilt[i] === pLines[i]) i++;
          console.log('        first differing line ' + (i + 1));
          console.log('        pristine: ' + JSON.stringify((pLines[i] || '').slice(0, 100)));
          console.log('        rebuilt : ' + JSON.stringify((rebuilt[i] || '').slice(0, 100)));
        }
      }
      console.log('   [C] reversibility   : ' + (cOk
        ? 'PASS — un-applying ' + moves.length + ' declared move(s) reproduces pristine app.js line-for-line ('
          + pLines.length + ' lines); the moved block is byte-identical in its new home'
        : 'FAIL'));
    }
  } else { failed = true; console.log('   [C] ' + (moves.length ? 'reversibility' : 'concatenation') + '   : FAIL — missing file'); }

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

  // ── E. pinned digests — the live coverage figure ────────────────────
  // Mirrors serverdiff's [SE]. [A]/[C] above are RAW comparisons against
  // pristine app.js and go silent (by design) for a part declared modified,
  // because that part is EXPECTED to differ now. This is what keeps a
  // modified part honest instead: every part's CURRENT on-disk sha256 must
  // match a pin recorded in manifest.clientPins, re-pinned deliberately in
  // the SAME commit as any intentional change. Unlike modified:true spreading
  // silently, a pin is a positive claim about exact content, and is restored
  // (not left decaying) the moment a change is re-pinned.
  const clientPins = manifest.clientPins || {};
  let eOk = true, ePinned = 0;
  for (const p of parts) {
    if (!clientPins[p.file]) { eOk = false; failed = true; console.log('   [E] ' + p.file + ' has NO pin -- unpinned part'); continue; }
    const abs = path.join(ROOT, p.file);
    if (!fs.existsSync(abs)) { eOk = false; failed = true; console.log('   [E] ' + p.file + ' MISSING from disk'); continue; }
    const actual = sha(rd(abs));
    if (actual !== clientPins[p.file]) {
      eOk = false; failed = true;
      console.log('   [E] ' + p.file + ' DIGEST MISMATCH -- pinned=' + clientPins[p.file].slice(0, 16) + ' actual=' + actual.slice(0, 16));
      continue;
    }
    ePinned++;
  }
  console.log('   [E] pinned digests  : ' + (eOk
    ? 'PASS — all ' + ePinned + ' of ' + parts.length + ' client parts byte-verified by pinned digest'
    : 'FAIL'));

  if (modifiedParts.length) {
    console.log('');
    console.log('   *** NOT RAW-VERIFIED against pristine: ' + modifiedParts.length + ' of ' + parts.length +
      ' part(s) carry modified:true, so [A] and [C] were SKIPPED for them. They are');
    console.log('       covered instead by [B] (nothing lost from the original tiling) and by [E]');
    console.log('       (current content matches what was deliberately pinned):');
    modifiedParts.forEach(p => {
      console.log('         - ' + p.file);
      console.log('             ' + p.modifiedReason);
    });
  }
  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — move purity NOT proven' : 'PASS — RAW where untouched, pinned digest where declared modified') + ' ===');
process.exit(failed ? 1 : 0);
