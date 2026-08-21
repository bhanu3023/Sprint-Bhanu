/**
 * SERVER MOVE-PURITY PROOF — glue-stripped exact.
 *
 *   node scripts/refactor-verify/serverdiff.js
 *
 * server.js is CommonJS, so extraction unavoidably adds a require preamble
 * (and sometimes a module.exports footer). Contiguity is therefore dropped for
 * the server and the check becomes:
 *
 *   [SA] GLUE EXACT   — the file's declared gluePrefix / glueSuffix must match
 *                       the manifest string BYTE FOR BYTE. Any deviation FAILS.
 *   [SB] BODY RAW     — with the glue removed by exact byte-slice, the remainder
 *                       must be RAW byte-identical to the original lines the part
 *                       declares (multiple ranges allowed, concatenated in the
 *                       order listed).
 *   [SC] EXACT TILING — the union of every part's ranges tiles 1..N of the
 *                       pristine server.js with no gap and no overlap.
 *   [SD] REQUIRE ORDER— the require() sequence parsed out of the REAL entry file
 *                       equals the declared registration order, so the 117
 *                       routes still register in their original order.
 *
 * This is exact-match removal of a declared constant, not normalization: the
 * glue text is fixed in the manifest, compared byte-for-byte, and then removed
 * by length. Nothing content-bearing can hide inside it, because any byte that
 * differs from the declared string is a FAIL before the removal happens.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const PRISTINE = path.join(ROOT, '.refactor-verify', 'pristine', 'server.js');

const rd = p => fs.readFileSync(p);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const targets = (manifest.targets || []).filter(t => t.kind === 'server');
let failed = false;

console.log('=== server move-purity proof — GLUE-STRIPPED EXACT ===\n');
if (!targets.length) { console.log('no server targets declared -- nothing to prove.'); process.exit(0); }

for (const t of targets) {
  console.log('--- ' + t.original + ' ---');
  if (!fs.existsSync(PRISTINE)) { failed = true; console.log('   !! no pristine snapshot for server.js\n'); continue; }
  const pristine = rd(PRISTINE);
  const pStr = pristine.toString('latin1');
  const pLines = pStr.split('\n');
  const totalLines = pLines.length;
  console.log('   reference : .refactor-verify/pristine/server.js  (' + pristine.length + ' bytes, ' + totalLines + ' lines)');

  const parts = t.parts || [];
  let glueLinesTotal = 0, bodyLinesTotal = 0;

  // ── [SA] + [SB] per part ──────────────────────────────────────────────
  let saOk = true, sbOk = true;
  for (const p of parts) {
    const abs = path.join(ROOT, p.file);
    if (!fs.existsSync(abs)) { saOk = sbOk = false; failed = true; console.log('   MISSING FILE: ' + p.file); continue; }
    let content = rd(abs).toString('latin1');
    const pre = p.gluePrefix || '';
    const suf = p.glueSuffix || '';

    if (pre && !content.startsWith(pre)) {
      saOk = false; failed = true;
      console.log('   [SA] ' + p.file + ': gluePrefix MISMATCH');
      let i = 0; while (i < Math.min(pre.length, content.length) && pre[i] === content[i]) i++;
      console.log('        first differing byte ' + i + '  declared=' + JSON.stringify(pre.slice(i, i + 50)) +
                  '  actual=' + JSON.stringify(content.slice(i, i + 50)));
      continue;
    }
    if (suf && !content.endsWith(suf)) {
      saOk = false; failed = true;
      console.log('   [SA] ' + p.file + ': glueSuffix MISMATCH');
      console.log('        declared tail=' + JSON.stringify(suf.slice(-60)) + '  actual tail=' + JSON.stringify(content.slice(-60)));
      continue;
    }
    // exact byte-slice removal
    const body = content.slice(pre.length, suf.length ? content.length - suf.length : content.length);
    glueLinesTotal += (pre ? pre.split('\n').length - 1 : 0) + (suf ? suf.split('\n').length - 1 : 0);

    const ranges = p.ranges || [];
    const expected = ranges.map(([a, b], idx) => {
      const isFileEnd = b >= totalLines;
      const lastRange = idx === ranges.length - 1;
      return pLines.slice(a - 1, b).join('\n') + ((isFileEnd && lastRange) ? '' : '\n');
    }).join('');
    ranges.forEach(([a, b]) => { bodyLinesTotal += (b - a + 1); });

    if (body !== expected) {
      sbOk = false; failed = true;
      console.log('   [SB] ' + p.file + ': BODY does not match original ranges ' + JSON.stringify(ranges));
      const min = Math.min(body.length, expected.length);
      let i = 0; while (i < min && body[i] === expected[i]) i++;
      console.log('        body bytes=' + body.length + ' expected=' + expected.length + ', first diff at ' + i);
      console.log('        expected: ' + JSON.stringify(expected.slice(Math.max(0, i - 50), i + 50)));
      console.log('        actual  : ' + JSON.stringify(body.slice(Math.max(0, i - 50), i + 50)));
    }
  }
  console.log('   [SA] glue exact     : ' + (saOk ? 'PASS — every declared glue string matches byte-for-byte' : 'FAIL'));
  console.log('   [SB] body RAW       : ' + (sbOk ? 'PASS — every body RAW-matches its original ranges' : 'FAIL'));

  // ── [SC] tiling over the union of all ranges ─────────────────────────
  const all = [];
  parts.forEach(p => (p.ranges || []).forEach(r => all.push({ from: r[0], to: r[1], file: p.file })));
  all.sort((a, b) => a.from - b.from);
  let scOk = true, cursor = 1;
  for (const r of all) {
    if (r.from !== cursor) {
      scOk = false;
      console.log('   [SC] ' + (r.from > cursor ? 'GAP' : 'OVERLAP') + ' before ' + r.file +
                  ': expected line ' + cursor + ', got ' + r.from);
    }
    cursor = r.to + 1;
  }
  if (cursor - 1 !== totalLines) {
    scOk = false;
    console.log('   [SC] coverage ends at ' + (cursor - 1) + ' but server.js has ' + totalLines + ' lines');
  }
  if (!scOk) failed = true;
  console.log('   [SC] exact tiling   : ' + (scOk ? 'PASS — lines 1-' + totalLines + ' covered exactly once' : 'FAIL'));

  // ── [SD] require order from the real entry file ──────────────────────
  if (t.requireOrderFrom) {
    const entry = path.join(ROOT, t.requireOrderFrom);
    if (!fs.existsSync(entry)) { failed = true; console.log('   [SD] require order  : FAIL — ' + t.requireOrderFrom + ' not found'); }
    else {
      const txt = fs.readFileSync(entry, 'utf8');
      const seq = [];
      const re = /require\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
      let m; while ((m = re.exec(txt))) seq.push(m[2]);
      const declared = (t.registrationOrder || []).slice();
      const seqNorm = seq.map(s => s.replace(/^\.\//, '').replace(/\.js$/, ''));
      const decNorm = declared.map(s => s.replace(/^\.\//, '').replace(/\.js$/, ''));
      const filtered = seqNorm.filter(s => decNorm.includes(s));
      const ok = filtered.length === decNorm.length && filtered.every((s, i) => s === decNorm[i]);
      if (!ok) {
        failed = true;
        console.log('   [SD] require order  : FAIL — entry require() order != declared registration order');
        console.log('        in entry : ' + JSON.stringify(filtered));
        console.log('        declared : ' + JSON.stringify(decNorm));
      } else console.log('   [SD] require order  : PASS — ' + t.requireOrderFrom + ' requires ' + filtered.length + ' modules in declared order');
    }
  } else console.log('   [SD] require order  : n/a (no requireOrderFrom declared)');

  console.log('   arithmetic          : original ' + bodyLinesTotal + ' lines + ' + glueLinesTotal +
              ' glue lines  (server.js original = ' + totalLines + ')');
  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — server move purity NOT proven' : 'PASS — all server checks empty') + ' ===');
process.exit(failed ? 1 : 0);
