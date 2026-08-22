/**
 * Captures a verification snapshot: global surface + per-page rendered DOM.
 *
 *   node scripts/refactor-verify/capture.js <label>
 *
 * Writes .refactor-verify/<label>.json (git-ignored working dir, outside the
 * committed tree is not possible for diff convenience, so it lives here and is
 * listed in .gitignore by the harness README).
 *
 * What is captured per page:
 *   - sorted Object.keys(window)                -> catches a lost global
 *   - typeof for each own window key            -> catches fn becoming undefined
 *   - normalized document.body.innerHTML        -> catches any DOM change
 *   - console errors + failed network requests  -> catches 404 on a moved file
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getSession, rankedSpaceKeys, pool } = require('./lib/session');
const { normalizeHtml } = require('./lib/normalize');
const { globalPages, spacePages } = require('./lib/pages');
const { collect } = require('./lib/globals');

const BASE = process.env.SB_BASE || 'http://localhost:3000';
// Refuse to snapshot a server that is not this run's code -- see preflight.js.
require('./preflight').assertFreshServer(BASE);
const OUTDIR = path.join(__dirname, '..', '..', '.refactor-verify');
const SETTLE_MS = Number(process.env.SB_SETTLE_MS || 1800);

async function pickIssueKey(spaceKey) {
  const p = pool();
  try {
    const r = await p.query(
      `SELECT i.key FROM issues i JOIN spaces s ON s.id=i.space_id
       WHERE s.key=$1 AND i.deleted_at IS NULL ORDER BY i.key LIMIT 1`, [spaceKey]);
    return r.rows[0] ? r.rows[0].key : null;
  } finally { await p.end(); }
}

(async () => {
  const label = process.argv[2];
  if (!label) { console.error('usage: capture.js <label>'); process.exit(2); }

  const { token } = await getSession();
  const spaces = await rankedSpaceKeys(Number(process.env.SB_SPACES || 2));
  if (!spaces.length) { console.error('No non-archived space found.'); process.exit(2); }

  const list = globalPages();
  for (const s of spaces) list.push(...spacePages(s.key));

  // one drawer capture per space, so drawer rendering is exercised against
  // both a sprint-rich space and a differently-configured one
  const issueKeys = {};
  for (const s of spaces) {
    const k = await pickIssueKey(s.key);
    if (k) {
      issueKeys[s.key] = k;
      list.push({ name: s.key + ':issue-drawer', url: '/?issue=' + encodeURIComponent(k) });
    }
  }

  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', e => consoleErrors.push({ kind: 'pageerror', text: String(e.message) }));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ kind: 'console', text: m.text() }); });
  page.on('requestfailed', r => failedRequests.push({ url: r.url(), err: r.failure() && r.failure().errorText }));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() }); });

  // seed auth
  await page.goto(BASE + '/');
  await page.evaluate(t => localStorage.setItem('sb-token', t), token);

  const snapshot = { label, base: BASE, spaces, issueKeys, capturedPages: [], pages: {}, windowKeys: null, windowTypes: null };

  for (const p of list) {
    const before = consoleErrors.length, beforeReq = failedRequests.length;
    await page.goto(BASE + p.url, { waitUntil: 'load' });
    await page.waitForTimeout(SETTLE_MS);
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) { /* some pages poll */ }

    // document.body.innerHTML contains the <script> block, and this refactor is
    // DEFINED by rewriting that block -- so a raw body diff can never pass again
    // at any phase. The script elements and HTML comments are therefore removed
    // from a CLONE before serializing, and their counts are captured separately:
    // a change in those counts is itself a signal, and the script block proper
    // is covered deliberately by check [5] (scriptblock.js), which can actually
    // interpret it. Nothing else is stripped.
    const shot = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      let scriptsRemoved = 0, commentsRemoved = 0, wsRemoved = 0;
      // Removing an element leaves its indentation behind as a whitespace-only
      // text node, so N extra <script> tags would still show up as N extra
      // indentation runs. Take the immediately-preceding whitespace-only text
      // node with each removal. Whitespace-only, adjacent-only: no content-
      // bearing node can be caught by this.
      const dropWithIndent = (node) => {
        const prev = node.previousSibling;
        if (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) { prev.parentNode.removeChild(prev); wsRemoved++; }
        node.parentNode.removeChild(node);
      };
      clone.querySelectorAll('script').forEach(s => { dropWithIndent(s); scriptsRemoved++; });
      const w = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
      const cs = []; let n;
      while ((n = w.nextNode())) cs.push(n);
      cs.forEach(c => { if (c.parentNode) { dropWithIndent(c); commentsRemoved++; } });
      return { html: clone.innerHTML, scriptsRemoved, commentsRemoved, wsRemoved };
    });
    const html = shot.html;
    snapshot.pages[p.name] = {
      url: p.url,
      html: normalizeHtml(html),
      htmlLength: html.length,
      scriptsRemoved: shot.scriptsRemoved,
      commentsRemoved: shot.commentsRemoved,
      newConsoleErrors: consoleErrors.slice(before),
      newFailedRequests: failedRequests.slice(beforeReq)
    };
    snapshot.capturedPages.push(p.name);
    process.stdout.write('.');
  }

  // global surface, captured on the last loaded page (all scripts evaluated)
  const win = await page.evaluate(() => {
    const keys = Object.keys(window).sort();
    const types = {};
    for (const k of keys) { try { types[k] = typeof window[k]; } catch (_) { types[k] = '<throws>'; } }
    return { keys, types };
  });
  snapshot.windowKeys = win.keys;
  snapshot.windowTypes = win.types;

  // Object.keys(window) does NOT see top-level const/let bindings (S, esc, $,
  // qs, qsa, cap, escAttr ... are all declarative globals, verified absent from
  // the key list). Those are the most-used symbols in the codebase, so each
  // expected global is additionally probed BY NAME in page scope.
  const expected = collect(path.join(OUTDIR, 'pristine')).all;
  const probed = await page.evaluate((names) => {
    const out = {};
    for (const n of names) {
      try { out[n] = eval('typeof ' + n); } catch (e) { out[n] = '<throws>'; }
    }
    return out;
  }, expected);
  snapshot.globalProbe = probed;
  const undef = Object.entries(probed).filter(([, v]) => v === 'undefined' || v === '<throws>').map(([k]) => k);
  snapshot.globalProbeMissing = undef;

  snapshot.totals = {
    pages: snapshot.capturedPages.length,
    windowKeys: win.keys.length,
    globalsProbed: expected.length,
    globalsMissing: undef.length,
    consoleErrors: consoleErrors.length,
    failedRequests: failedRequests.length
  };

  await browser.close();
  const out = path.join(OUTDIR, label + '.json');
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
  console.log('\nsnapshot written: ' + out);
  console.log(JSON.stringify(snapshot.totals, null, 1));
  if (consoleErrors.length) {
    console.log('\nconsole errors observed:');
    consoleErrors.slice(0, 20).forEach(e => console.log('  [' + e.kind + '] ' + e.text.slice(0, 200)));
  }
  if (failedRequests.length) {
    console.log('\nfailed/4xx+ requests observed:');
    failedRequests.slice(0, 20).forEach(r => console.log('  ' + (r.status || r.err) + '  ' + r.url));
  }
})().catch(e => { console.error('CAPTURE FAILED:', e); process.exit(1); });
