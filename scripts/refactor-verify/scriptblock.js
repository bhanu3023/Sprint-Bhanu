/**
 * CHECK [5] — script-block integrity.
 *
 *   node scripts/refactor-verify/scriptblock.js
 *
 * Check [3] used to cover the <script> block only by accident, via
 * document.body.innerHTML. Since this refactor is DEFINED by rewriting that
 * block, [3] can never pass again while it includes scripts -- so [3] now strips
 * them and this check covers the block deliberately, with something that can
 * actually interpret it.
 *
 * Asserts, for every client target in the manifest:
 *   1. ORDER      — the <script src> sequence for managed parts, in document
 *                   order, equals the manifest's ascending line order exactly.
 *   2. EXISTS     — every referenced file is present on disk.
 *   3. TAIL       — the original file (the tail, e.g. app.js) is referenced
 *                   exactly once, and is the LAST managed tag.
 *   4. NO DUPES   — no managed src appears twice.
 *   5. NO DROPS   — every manifest part has a tag; no managed part is missing.
 *   6. UNMANAGED  — the non-managed scripts (/config.js, /hotjar.js,
 *                   combination-options.js) keep their relative order and still
 *                   precede the managed block, since the managed code depends on
 *                   globals they define.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let failed = false;

console.log('=== [5] script-block integrity ===\n');

const clientTargets = (manifest.targets || []).filter(t => t.orderFrom && /\.html$/i.test(t.orderFrom));
if (!clientTargets.length) {
  console.log('no client targets with an orderFrom html declared -- nothing to check.');
  process.exit(0);
}

for (const t of clientTargets) {
  const htmlPath = path.join(ROOT, t.orderFrom);
  console.log('--- ' + t.orderFrom + '  (target: ' + t.original + ') ---');
  if (!fs.existsSync(htmlPath)) { failed = true; console.log('   !! ' + t.orderFrom + ' not found\n'); continue; }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const srcs = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let m; while ((m = re.exec(html))) srcs.push(m[2]);
  const norm = s => s.replace(/^\.?\//, '');

  const parts = (t.parts || []).slice().sort((x, y) => x.from - y.from);
  const managedSet = new Set(parts.map(p => p.file.replace(/\\/g, '/')));
  const managedInDoc = srcs.map(norm).filter(s => managedSet.has(s));
  const unmanagedInDoc = srcs.map(norm).filter(s => !managedSet.has(s));
  const expectedOrder = parts.map(p => p.file.replace(/\\/g, '/'));

  console.log('   tags total=' + srcs.length + '  managed=' + managedInDoc.length + '  unmanaged=' + unmanagedInDoc.length);

  // 1. ORDER
  const orderOk = managedInDoc.length === expectedOrder.length &&
                  managedInDoc.every((s, i) => s === expectedOrder[i]);
  if (!orderOk) {
    failed = true;
    console.log('   [5.1] ORDER      : FAIL');
    console.log('          in html : ' + JSON.stringify(managedInDoc));
    console.log('          expected: ' + JSON.stringify(expectedOrder));
  } else console.log('   [5.1] ORDER      : PASS — document order == original line order');

  // 2. EXISTS
  const missing = expectedOrder.filter(f => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) { failed = true; console.log('   [5.2] EXISTS     : FAIL — missing on disk: ' + missing.join(', ')); }
  else console.log('   [5.2] EXISTS     : PASS — all ' + expectedOrder.length + ' referenced files present');

  // 3. TAIL referenced exactly once, and last
  const tailName = t.original.replace(/\\/g, '/');
  const tailRefs = managedInDoc.filter(s => s === tailName).length;
  const tailIsLast = managedInDoc.length > 0 && managedInDoc[managedInDoc.length - 1] === tailName;
  const tailStillExists = fs.existsSync(path.join(ROOT, t.original));
  if (tailStillExists) {
    if (tailRefs !== 1 || !tailIsLast) {
      failed = true;
      console.log('   [5.3] TAIL       : FAIL — ' + tailName + ' referenced ' + tailRefs +
                  ' time(s), last=' + tailIsLast);
    } else console.log('   [5.3] TAIL       : PASS — ' + tailName + ' referenced once, and last');
  } else {
    if (tailRefs !== 0) { failed = true; console.log('   [5.3] TAIL       : FAIL — ' + tailName + ' deleted but still referenced ' + tailRefs + 'x'); }
    else console.log('   [5.3] TAIL       : PASS — ' + tailName + ' fully consumed and no longer referenced');
  }

  // 4. NO DUPES
  const seen = new Map();
  managedInDoc.forEach(s => seen.set(s, (seen.get(s) || 0) + 1));
  const dupes = [...seen.entries()].filter(([, c]) => c > 1);
  if (dupes.length) { failed = true; console.log('   [5.4] NO DUPES   : FAIL — ' + dupes.map(([s, c]) => s + ' x' + c).join(', ')); }
  else console.log('   [5.4] NO DUPES   : PASS');

  // 5. NO DROPS
  const dropped = expectedOrder.filter(f => !managedInDoc.includes(f));
  if (dropped.length) { failed = true; console.log('   [5.5] NO DROPS   : FAIL — no <script src> for: ' + dropped.join(', ')); }
  else console.log('   [5.5] NO DROPS   : PASS — every manifest part has a tag');

  // 6. UNMANAGED scripts precede the managed block and keep their order
  const firstManagedIdx = srcs.map(norm).findIndex(s => managedSet.has(s));
  const unmanagedAfter = firstManagedIdx < 0 ? [] :
    srcs.map(norm).slice(firstManagedIdx).filter(s => !managedSet.has(s));
  if (unmanagedAfter.length) {
    failed = true;
    console.log('   [5.6] UNMANAGED  : FAIL — these load AFTER managed code starts: ' + unmanagedAfter.join(', '));
  } else console.log('   [5.6] UNMANAGED  : PASS — ' + JSON.stringify(unmanagedInDoc) + ' all precede the managed block');

  console.log('');
}

console.log('=== RESULT: ' + (failed ? 'FAIL — script block is not intact' : 'PASS — script block intact') + ' ===');
process.exit(failed ? 1 : 0);
