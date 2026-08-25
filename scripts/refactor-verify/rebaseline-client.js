// scripts/refactor-verify/rebaseline-client.js
//
//   node scripts/refactor-verify/rebaseline-client.js --confirm
//
// CLIENT RE-BASELINE
//
// modified:true had reached 28 of 42 client parts, so two-thirds of the client
// was no longer byte-verified against the original app.js -- only against its
// own pins. Same erosion the server went through. The fix is the same: make the
// CURRENT parts the new pristine, drop every modified flag, and restore 42/42
// raw verification by [A]/[B]/[C]/[D].
//
// This changes NO shipped file. .refactor-verify/pristine/app.js is read only by
// catdiff; the app loads the 42 parts individually via index.html and there is
// no app.js at the repo root at all. The re-baseline is metadata only.
//
// The original baseline is not lost: it is exactly reproducible as
//   git show c22c688:app.js  |  LF -> CRLF
// which was verified byte-for-byte before this ran.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const MPATH = path.join(__dirname, 'manifest.json');
const PRISTINE = path.join(ROOT, '.refactor-verify', 'pristine', 'app.js');
if (!process.argv.includes('--confirm')) {
  console.error('Refusing to run without --confirm.');
  console.error('');
  console.error('This REPLACES .refactor-verify/pristine/app.js with the concatenation of');
  console.error('the current 42 client parts and clears every modified:true flag, so');
  console.error('[A]/[B]/[C]/[D] verify against the code as it is TODAY rather than against');
  console.error('the original pre-split app.js. Only do this deliberately, when');
  console.error('modified:true has eroded coverage far enough to be worth resetting, and');
  console.error('only with a clean tree so the new baseline is a reviewed commit.');
  console.error('');
  console.error('The outgoing baseline stays recoverable from git (see manifest');
  console.error('targets[].rebaselined.originalBaselineRecoverableBy).');
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(MPATH, 'utf8'));
const t = m.targets.find(x => x.original === 'app.js');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const nlCount = b => { let n = 0; for (let i = 0; i < b.length; i++) if (b[i] === 10) n++; return n; };
const crlfCount = b => { let n = 0; for (let i = 1; i < b.length; i++) if (b[i] === 10 && b[i - 1] === 13) n++; return n; };

// order = manifest part order, which check [D] proves equals index.html's
// <script> order. Concatenate exactly as [C] would.
const bufs = t.parts.map(p => fs.readFileSync(path.join(ROOT, p.file)));
const joined = Buffer.concat(bufs);
const totalLines = joined.toString('latin1').split('\n').length;

// Recompute contiguous ranges. Every part but the last ends in a newline, so its
// line count is its newline count; the last part carries the file's final line.
let cursor = 1;
const newParts = t.parts.map((p, i) => {
  const isLast = i === t.parts.length - 1;
  const n = nlCount(bufs[i]);
  const from = cursor;
  const to = isLast ? totalLines : cursor + n - 1;
  cursor = to + 1;
  const out = { file: p.file, from: from, to: to };   // modified/modifiedReason dropped
  return out;
});

if (cursor - 1 !== totalLines) {
  console.error('ARITHMETIC MISMATCH: ranges end at ' + (cursor - 1) + ', file has ' + totalLines + ' lines');
  process.exit(1);
}

const oldPristine = fs.readFileSync(PRISTINE);
// Keep the OUTGOING baseline, but never overwrite a kept copy: running this
// twice would replace the real previous baseline with the one written by the
// first run, which is exactly how the reference gets quietly lost.
const keep = path.join(ROOT, '.refactor-verify', 'app.js.baseline-c22c688');
if (!fs.existsSync(keep)) fs.writeFileSync(keep, oldPristine);
else console.log('kept copy already exists, left untouched: ' + path.basename(keep));
fs.writeFileSync(PRISTINE, joined);

t.parts = newParts;
// The one declared relocation is baked into the new baseline: relative to THIS
// pristine the parts are contiguous, so there is nothing left to un-apply.
const oldMoves = t.moves || [];
t.moves = [];

m.pristine['app.js'] = {
  bytes: joined.length,
  sha256: sha(joined),
  crlf: crlfCount(joined),
  lf: nlCount(joined)
};

t.rebaselined = {
  from: 'c22c688',
  why: 'modified:true had reached 28 of 42 client parts, so two-thirds of the client was verified only by its own pins and no longer against the original app.js. The current parts become the new pristine so [A]/[B]/[C]/[D] cover all 42 again.',
  originalBaselineRecoverableBy: 'git show c22c688:app.js, then LF -> CRLF (verified byte-identical to the previous snapshot before it was replaced)',
  previousSnapshotKeptAt: '.refactor-verify/app.js.baseline-c22c688',
  movesFoldedIn: oldMoves.length,
  changedNoShippedFile: true
};

// clientPins are unchanged in value (the files did not change) but re-derive
// them so the pin set and the new baseline are written by the same pass.
t.parts.forEach(p => { m.clientPins[p.file] = sha(fs.readFileSync(path.join(ROOT, p.file))); });

fs.writeFileSync(MPATH, JSON.stringify(m, null, 2) + '\n');

console.log('new pristine app.js : ' + joined.length + ' bytes, ' + totalLines + ' lines, sha ' + sha(joined).slice(0, 16));
console.log('old pristine        : ' + oldPristine.length + ' bytes, sha ' + sha(oldPristine).slice(0, 16));
console.log('parts re-ranged     : ' + newParts.length + ' (contiguous 1..' + totalLines + ')');
console.log('modified flags left : ' + newParts.filter(p => p.modified).length);
console.log('moves folded in     : ' + oldMoves.length);
