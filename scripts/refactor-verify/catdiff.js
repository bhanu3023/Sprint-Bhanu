/**
 * MOVE-PURITY PROOF.
 *
 *   node scripts/refactor-verify/catdiff.js
 *
 * For each original file listed in manifest.json, concatenates its replacement
 * files IN LOAD ORDER and byte-compares the result against the pristine original
 * taken from git (manifest.baselineRef). An empty diff proves the refactor moved
 * lines only -- no edit, no reorder, no reformat, nothing added or lost.
 *
 * This is the hard requirement for every client phase: if this is not empty,
 * the phase is wrong.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');

function gitShow(ref, relPath) {
  return execFileSync('git', ['show', ref + ':' + relPath], { cwd: ROOT, maxBuffer: 1 << 28 });
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const ref = manifest.baselineRef;
let failed = false;

console.log('=== cat-diff move-purity proof (baselineRef=' + ref + ') ===\n');

const entries = Object.entries(manifest.originals || {});
if (!entries.length) {
  console.log('manifest.originals is empty -- nothing split yet. Nothing to prove.');
  process.exit(0);
}

for (const [original, parts] of entries) {
  if (!parts || !parts.length) { console.log(original + ': no parts listed, skipped'); continue; }

  let pristine;
  try { pristine = gitShow(ref, original); }
  catch (e) { console.log('!! cannot read ' + ref + ':' + original + ' -- ' + e.message); failed = true; continue; }

  const missing = parts.filter(p => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) {
    console.log('!! ' + original + ': missing part file(s): ' + missing.join(', '));
    failed = true; continue;
  }

  const joined = Buffer.concat(parts.map(p => fs.readFileSync(path.join(ROOT, p))));

  const same = Buffer.compare(pristine, joined) === 0;
  console.log(original + '  (' + parts.length + ' part' + (parts.length > 1 ? 's' : '') + ')');
  console.log('   pristine bytes : ' + pristine.length);
  console.log('   concatenated   : ' + joined.length);
  if (same) {
    console.log('   -> IDENTICAL — cat-diff EMPTY ✓');
  } else {
    failed = true;
    console.log('   -> *** DIFFERS ***');
    // locate first differing byte and show surrounding context as text
    const min = Math.min(pristine.length, joined.length);
    let i = 0; while (i < min && pristine[i] === joined[i]) i++;
    const pl = pristine.slice(0, i).toString('utf8').split('\n').length;
    console.log('   first difference at byte ' + i + ' (original line ~' + pl + ')');
    const ctxA = pristine.slice(Math.max(0, i - 160), i + 160).toString('utf8');
    const ctxB = joined.slice(Math.max(0, i - 160), i + 160).toString('utf8');
    console.log('   --- pristine ---\n' + ctxA.split('\n').map(l => '   | ' + l).join('\n'));
    console.log('   --- concatenated ---\n' + ctxB.split('\n').map(l => '   | ' + l).join('\n'));
  }
  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — cat-diff NOT empty' : 'PASS — all cat-diffs empty') + ' ===');
process.exit(failed ? 1 : 0);
