/**
 * The 7 core flows, assertion-based (not DOM-byte-based, because these mutate
 * data and a byte-diff of mutated state is meaningless).
 *
 *   node scripts/refactor-verify/flows.js
 *
 *   1. login            — real email+password POST /api/auth/login
 *   2. open a space     — sidebar space click expands its submenu
 *   3. open the board   — Active Sprint tab renders
 *   4. open a drawer    — issue drawer opens from All Work
 *   5. create an issue  — via the Create Issue modal, then verified in the DB
 *   6. log work         — worklog modal, then verified in the DB
 *   7. view a report    — space Reports tab renders a report body
 *
 * Every row this creates is deleted again at the end, so the DOM snapshots
 * used by capture.js stay comparable across runs.
 */
const crypto = require('crypto');
const { chromium } = require('playwright');
const { getSession, rankedSpaceKeys, pool } = require('./lib/session');

const BASE = process.env.SB_BASE || 'http://localhost:3000';
// Refuse to run against a server that is not this run's code. See preflight.js:
// stale processes once made several 'restart, then verify' steps measure old code.
require('./preflight').assertFreshServer(BASE);
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
};

(async () => {
  const { token, userId } = await getSession();
  const ranked = await rankedSpaceKeys(4);
  // primary space for the generic UI flows; sprint-rich space for the report flow
  const spaceKey = ranked[0] ? ranked[0].key : null;
  const withSprints = ranked.find(s => s.sprints > 0);
  const reportSpaceKey = withSprints ? withSprints.key : null;
  const p = pool();

  const spaceRow = (await p.query('SELECT id, org_id FROM spaces WHERE key=$1', [spaceKey])).rows[0];
  const spaceId = spaceRow.id;

  // fixtures we must clean up
  const created = { userId: null, issueIds: [], worklogIds: [], sprintId: null };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  try {
    // ── 1. LOGIN (real credentials) ───────────────────────────────────────
    {
      const email = 'refactor-verify-' + Date.now() + '@example.invalid';
      const password = 'Verify!' + crypto.randomBytes(6).toString('hex');
      // create via the app's own endpoint so hashing matches production exactly
      const adminResp = await page.request.post(BASE + '/api/users', {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        data: { name: 'Refactor Verify', email, password, role: 'member' }
      });
      if (!adminResp.ok()) {
        record('1. login', false, 'could not create temp user: HTTP ' + adminResp.status());
      } else {
        const u = await adminResp.json();
        created.userId = u.id || (u.user && u.user.id);
        const login = await page.request.post(BASE + '/api/auth/login', {
          headers: { 'Content-Type': 'application/json' },
          data: { email, password }
        });
        const body = login.ok() ? await login.json() : null;
        record('1. login', login.status() === 200 && !!(body && body.token) && !('password_hash' in (body.user || {})),
               'HTTP ' + login.status() + (body && body.token ? ', token returned, no password_hash leaked' : ''));
      }
    }

    // authenticate the browser for the UI flows
    await page.goto(BASE + '/');
    await page.evaluate(t => localStorage.setItem('sb-token', t), token);
    await page.reload();
    await page.waitForTimeout(1500);

    // ── 2. OPEN A SPACE (sidebar submenu expands, no navigation) ──────────
    {
      await page.goto(BASE + '/');
      await page.waitForTimeout(1200);
      const item = await page.$('.space-item[data-space-id]');
      const urlBefore = page.url();
      await item.click();
      await page.waitForTimeout(600);
      const hasSubnav = !!(await page.$('.space-subnav'));
      record('2. open a space', hasSubnav && page.url() === urlBefore,
             'subnav=' + hasSubnav + ', url unchanged=' + (page.url() === urlBefore));
    }

    // ── 3. OPEN THE BOARD ────────────────────────────────────────────────
    {
      await page.goto(BASE + '/space/' + spaceKey + '/sprint');
      await page.waitForTimeout(1800);
      const visible = await page.evaluate(() => {
        const v = document.getElementById('view-sprint');
        return !!v && !v.hidden;
      });
      const cols = await page.$$eval('#sprintBoard *', els => els.length).catch(() => 0);
      record('3. open the board', visible, 'view-sprint visible=' + visible + ', board nodes=' + cols);
    }

    // ── 4. OPEN AN ISSUE DRAWER (from All Work) ──────────────────────────
    {
      await page.goto(BASE + '/space/' + spaceKey + '/all-work');
      await page.waitForTimeout(2000);
      let opened = false;
      for (let i = 0; i < 5 && !opened; i++) {
        await page.evaluate(() => { const el = document.querySelector('[onclick*="openIssuePage"]'); if (el) el.click(); });
        await page.waitForTimeout(700);
        opened = page.url().includes('issue=');
      }
      const drawerOpen = await page.evaluate(() => document.body.classList.contains('issue-page'));
      record('4. open an issue drawer', opened && drawerOpen, 'url=' + (opened ? 'has ?issue=' : 'no') + ', issue-page class=' + drawerOpen);
    }

    // ── 5. CREATE AN ISSUE (through the real POST the modal uses) ────────
    {
      const title = 'refactor-verify issue ' + Date.now();
      const resp = await page.request.post(BASE + '/api/issues', {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        data: { space_id: spaceId, title, type: 'task', priority: 'medium' }
      });
      const body = resp.ok() ? await resp.json() : null;
      if (body && body.id) created.issueIds.push(body.id);
      const inDb = body && body.id
        ? (await p.query('SELECT 1 FROM issues WHERE id=$1 AND title=$2', [body.id, title])).rowCount === 1
        : false;
      record('5. create an issue', resp.status() === 201 && inDb,
             'HTTP ' + resp.status() + (body && body.key ? ', key=' + body.key : '') + ', persisted=' + inDb);
    }

    // ── 6. LOG WORK ──────────────────────────────────────────────────────
    {
      const issueId = created.issueIds[0];
      if (!issueId) record('6. log work', false, 'skipped: no issue created in step 5');
      else {
        const resp = await page.request.post(BASE + '/api/worklogs', {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          data: { issue_id: issueId, time_spent: 30, work_date: new Date().toISOString().slice(0, 10), description: 'refactor-verify' }
        });
        const body = resp.ok() ? await resp.json() : null;
        if (body && body.id) created.worklogIds.push(body.id);
        const row = body && body.id
          ? (await p.query('SELECT time_spent, user_id FROM worklogs WHERE id=$1', [body.id])).rows[0]
          : null;
        record('6. log work', !!row && row.time_spent === 30 && row.user_id === userId,
               'HTTP ' + resp.status() + (row ? ', time_spent=' + row.time_spent + ', user_id from session=' + (row.user_id === userId) : ''));
      }
    }

    // ── 7. VIEW A REPORT ─────────────────────────────────────────────────
    // Uses the most sprint-rich space on purpose: a space with no sprints
    // legitimately renders "No sprints found.", which would assert nothing
    // about the actual report renderers.
    {
      const reportKey = reportSpaceKey || spaceKey;
      await page.goto(BASE + '/space/' + reportKey + '/reports');
      await page.waitForTimeout(3000);
      const info = await page.evaluate(() => {
        const c = document.getElementById('reportContent');
        return {
          present: !!c,
          len: c ? c.innerHTML.length : 0,
          txt: c ? c.textContent.trim().slice(0, 80) : '',
          hasSvg: !!(c && c.querySelector('svg, canvas, table, .chart-card'))
        };
      });
      record('7. view a report', info.present && info.len > 200 && info.hasSvg,
             'space=' + reportKey + ', reportContent chars=' + info.len +
             ', chart/table rendered=' + info.hasSvg + ' "' + info.txt + '"');
    }

    record('no uncaught page errors', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'none');

  } finally {
    // ── cleanup: leave the DB exactly as we found it ─────────────────────
    for (const id of created.worklogIds) await p.query('DELETE FROM worklogs WHERE id=$1', [id]).catch(() => {});
    for (const id of created.issueIds) {
      await p.query('DELETE FROM issue_history WHERE issue_id=$1', [id]).catch(() => {});
      await p.query('DELETE FROM issues WHERE id=$1', [id]).catch(() => {});
    }
    if (created.userId) {
      await p.query('DELETE FROM sessions WHERE user_id=$1', [created.userId]).catch(() => {});
      await p.query('DELETE FROM space_members WHERE user_id=$1', [created.userId]).catch(() => {});
      await p.query('DELETE FROM users WHERE id=$1', [created.userId]).catch(() => {});
    }
    await p.end();
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n=== FLOWS: ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  if (failed.length) { console.log('failed: ' + failed.map(f => f.name).join(', ')); process.exit(1); }
})().catch(e => { console.error('FLOWS CRASHED:', e); process.exit(1); });
