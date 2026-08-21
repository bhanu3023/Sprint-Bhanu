/**
 * Snapshots the pristine, UNTRANSFORMED on-disk bytes of the files about to be
 * split, into .refactor-verify/pristine/.
 *
 *   node scripts/refactor-verify/pristine.js            # create (refuses to overwrite)
 *   node scripts/refactor-verify/pristine.js --verify    # re-check hashes only
 *
 * Why a disk snapshot rather than `git show`: this repo has core.autocrlf=true,
 * so the working file is CRLF and the git blob is LF (app.js: 891641 vs 874347
 * bytes -- one extra byte per line). catdiff requires RAW byte-identity with no
 * transformation, which is only achievable against the disk bytes.
 *
 * Refuses to overwrite an existing snapshot: once a phase has moved code, the
 * on-disk original is no longer pristine, and silently re-snapshotting it would
 * destroy the reference the whole proof rests on.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, '.refactor-verify', 'pristine');
const MANIFEST = path.join(__dirname, 'manifest.json');
const FILES = ['app.js', 'server.js', 'index.html'];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const crlfCount = b => { let n = 0; for (let i = 1; i < b.length; i++) if (b[i] === 10 && b[i - 1] === 13) n++; return n; };
const lfCount = b => { let n = 0; for (let i = 0; i < b.length; i++) if (b[i] === 10) n++; return n; };

const verifyOnly = process.argv.includes('--verify');
fs.mkdirSync(DIR, { recursive: true });

const meta = {};
let failed = false;

for (const f of FILES) {
  const dest = path.join(DIR, f);
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.log(f.padEnd(12) + ' SOURCE MISSING — skipped'); continue; }
  const cur = fs.readFileSync(src);

  if (fs.existsSync(dest)) {
    const snap = fs.readFileSync(dest);
    const same = Buffer.compare(cur, snap) === 0;
    meta[f] = { bytes: snap.length, sha256: sha(snap), crlf: crlfCount(snap), lf: lfCount(snap) };
    console.log(f.padEnd(12) + ' snapshot EXISTS  ' + snap.length + ' bytes  sha=' + sha(snap).slice(0, 16) +
                '  (working copy ' + (same ? 'still identical' : 'has since changed — expected once a phase has run') + ')');
    if (!verifyOnly && !same) {
      console.log('             -> refusing to overwrite; the snapshot is the pristine reference.');
    }
    continue;
  }
  if (verifyOnly) { console.log(f.padEnd(12) + ' NO SNAPSHOT — run without --verify first'); failed = true; continue; }

  fs.writeFileSync(dest, cur);
  meta[f] = { bytes: cur.length, sha256: sha(cur), crlf: crlfCount(cur), lf: lfCount(cur) };
  console.log(f.padEnd(12) + ' snapshot CREATED ' + cur.length + ' bytes  sha=' + sha(cur).slice(0, 16) +
              '  CRLF=' + crlfCount(cur) + ' LF=' + lfCount(cur));
}

// record the hashes in the manifest so a corrupted/replaced snapshot is detectable
if (!verifyOnly) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  m.pristine = meta;
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n');
  console.log('\npristine hashes recorded in manifest.json');
} else {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const [f, rec] of Object.entries(m.pristine || {})) {
    const got = meta[f];
    if (!got) { console.log('!! ' + f + ' missing from snapshot dir'); failed = true; continue; }
    if (got.sha256 !== rec.sha256) {
      console.log('!! ' + f + ' snapshot hash CHANGED — reference is no longer trustworthy');
      console.log('     manifest: ' + rec.sha256);
      console.log('     on disk : ' + got.sha256);
      failed = true;
    }
  }
  console.log(failed ? '\nVERIFY: FAIL' : '\nVERIFY: PASS — all pristine snapshots match their recorded hashes');
}

process.exit(failed ? 1 : 0);
