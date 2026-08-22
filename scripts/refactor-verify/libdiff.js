/**
 * lib/ INTEGRITY PROOF — pinned digests.
 *
 *   node scripts/refactor-verify/libdiff.js
 *
 * WHY THIS EXISTS
 * lib/ sat outside catdiff and serverdiff entirely. Two performance changes
 * landed in lib/builtin-issue-fields.js with no byte-level check covering them,
 * and the "20 of 32" server figure understated what was unverified because
 * these 7 files were not counted at all.
 *
 * WHY A DIGEST AND NOT RANGE TILING
 * catdiff and serverdiff both prove "these bytes equal that range of a pristine
 * original". lib/ has no pristine original -- it was never split from anything,
 * it is hand-written code that predates the refactor. There is no range to tile,
 * so that model cannot apply.
 *
 * What matters for lib/ is different: no byte may change without someone saying
 * so. A pinned sha256 per file gives exactly that, and it has one property the
 * server model lacks -- it does NOT erode. `modified: true` in serverdiff
 * permanently disables [SA]/[SB] for a part, so coverage only ever decreases.
 * A pin is re-pinned when a change is intentional, so the file returns to fully
 * verified after every deliberate edit. Coverage is restored, not spent.
 *
 *   [L1] PINNED       every pinned file's sha256 matches its manifest pin
 *   [L2] COMPLETE     every lib/*.js on disk is pinned -- a new unpinned file
 *                     is a failure, so code cannot enter lib/ unnoticed
 *   [L3] PRESENT      every pinned file still exists on disk
 *   [L4] CLEAN BYTES  no NUL or stray control bytes. Added because exactly this
 *                     corruption reached src/server/routes/issues.js and no
 *                     check caught it: the file still parsed, every test passed,
 *                     and git silently reclassified it as binary.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const pins = manifest.libPins || {};

const walk = (d, o = []) => {
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (/\.js$/.test(e.name)) o.push(p);
  }
  return o;
};
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const ctrlBytes = b => {
  const hits = [];
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (x === 0 || x < 9 || (x > 13 && x < 32) || x === 127) hits.push({ at: i, byte: x });
  }
  return hits;
};

let failed = false;
console.log('=== lib/ integrity proof — PINNED DIGESTS ===\n');

const onDisk = walk(path.join(ROOT, 'lib')).map(rel).sort();
const pinned = Object.keys(pins).sort();
console.log('   files on disk : ' + onDisk.length);
console.log('   files pinned  : ' + pinned.length + '\n');

// ── [L1] pinned digests match ────────────────────────────────────────────
let l1 = true, verified = 0;
for (const f of pinned) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;                 // [L3] reports this
  const actual = sha(fs.readFileSync(abs));
  const want = typeof pins[f] === 'string' ? pins[f] : pins[f].sha256;
  const note = typeof pins[f] === 'string' ? null : pins[f].note;
  if (actual === want) {
    verified++;
    console.log('   [ok] ' + f.padEnd(34) + actual.slice(0, 16) + (note ? '   note: ' + note : ''));
  } else {
    l1 = false; failed = true;
    console.log('   [L1] *** ' + f + ' DIGEST MISMATCH');
    console.log('        pinned : ' + want);
    console.log('        actual : ' + actual);
    console.log('        If this change was intentional, re-pin it in the SAME commit and say why.');
  }
}
console.log('\n   [L1] pinned digests : ' + (l1 ? 'PASS — all ' + verified + ' match' : 'FAIL'));

// ── [L2] no unpinned file in lib/ ────────────────────────────────────────
const unpinned = onDisk.filter(f => !pins[f]);
if (unpinned.length) {
  failed = true;
  console.log('   [L2] unpinned files : FAIL — ' + unpinned.length + ' file(s) in lib/ have no pin');
  unpinned.forEach(f => console.log('        *** ' + f + '  sha ' + sha(fs.readFileSync(path.join(ROOT, f)))));
} else {
  console.log('   [L2] unpinned files : PASS — every lib/*.js is pinned');
}

// ── [L3] pinned files still exist ────────────────────────────────────────
const missing = pinned.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
  failed = true;
  console.log('   [L3] pinned present : FAIL — ' + missing.length + ' pinned file(s) missing from disk');
  missing.forEach(f => console.log('        *** ' + f));
} else {
  console.log('   [L3] pinned present : PASS — all ' + pinned.length + ' present');
}

// ── [L4] control bytes ───────────────────────────────────────────────────
let l4 = true;
for (const f of onDisk) {
  const hits = ctrlBytes(fs.readFileSync(path.join(ROOT, f)));
  if (hits.length) {
    l4 = false; failed = true;
    console.log('   [L4] *** ' + f + ' contains ' + hits.length + ' control byte(s), first 0x' +
                hits[0].byte.toString(16) + ' at offset ' + hits[0].at);
  }
}
console.log('   [L4] clean bytes    : ' + (l4 ? 'PASS — no NUL or stray control bytes in any lib/ file' : 'FAIL'));

console.log('');
console.log('   coverage: ' + verified + ' of ' + onDisk.length + ' lib/ files byte-verified by pinned digest.');
console.log('   Unlike serverdiff\'s modified:true, a pin is RESTORED on the next intentional');
console.log('   change, so this number does not decay.');
console.log('');
console.log('=== RESULT: ' + (failed ? 'FAIL — lib/ integrity NOT proven' : 'PASS — lib/ integrity proven') + ' ===');
process.exit(failed ? 1 : 0);
