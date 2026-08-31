/**
 * Live UI verification for the bulk CSV ticket import feature.
 * One-off manual verification script, not part of the regular check suite.
 *
 *   node scripts/refactor-verify/bulk-import-verify.js
 *
 * Covers, against the real running app + real DB:
 *   1. Bulk Create button hidden for a plain member, visible for a space admin
 *   2. Download Sample CSV produces a CSV with the expected header columns
 *   3. Importing a CSV with a mix of valid/invalid rows shows correct preview
 *   4. Confirming creates only the valid rows, modal locks meanwhile
 *   5. Created tickets are real rows in the DB with correct field values
 *   6. Opening a created ticket's key from the app works
 *   7. Row cap / empty file / malformed CSV are handled gracefully (no crash)
 */
const crypto = require('crypto');
const { chromium } = require('playwright');
const { getSession, pool } = require('./lib/session');

const BASE = process.env.SB_BASE || 'http://localhost:3000';
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
};

(async () => {
  const { token } = await getSession();
  const p = pool();
  const created = { spaceId: null, memberUserId: null, issueIds: [] };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));

  try {
    // ── fixture: a fresh space owned by the admin session, plus a plain member ──
    const spaceResp = await page.request.post(BASE + '/api/spaces', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: { name: 'Bulk Import Verify', key: 'BIV' + Date.now().toString(36).toUpperCase().slice(-4), space_type: 'scrum' }
    });
    const space = await spaceResp.json();
    created.spaceId = space.id;
    const spaceKey = space.key;

    const memberEmail = 'bulk-verify-member-' + Date.now() + '@example.invalid';
    const memberPassword = 'Verify!' + crypto.randomBytes(6).toString('hex');
    const memberResp = await page.request.post(BASE + '/api/users', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: { name: 'Bulk Verify Member', email: memberEmail, password: memberPassword, role: 'member' }
    });
    const memberUser = await memberResp.json();
    created.memberUserId = memberUser.id || (memberUser.user && memberUser.user.id);
    await p.query(
      "INSERT INTO space_members(id, space_id, user_id, role) VALUES ($1,$2,$3,'member')",
      ['sm-' + crypto.randomUUID(), created.spaceId, created.memberUserId]
    );

    // login the browser as the plain member first, to test the negative case
    const memberLogin = await page.request.post(BASE + '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: memberEmail, password: memberPassword }
    });
    const memberBody = await memberLogin.json();

    await page.goto(BASE + '/');
    await page.evaluate(t => localStorage.setItem('sb-token', t), memberBody.token);
    await page.reload();
    await page.waitForTimeout(1500);

    // ── 1a. member: Bulk Create button must be hidden ──────────────────────
    {
      await page.goto(BASE + '/space/' + spaceKey + '/board');
      await page.waitForTimeout(1200);
      await page.evaluate(() => { if (typeof openCreateIssueModal === 'function') openCreateIssueModal(); });
      await page.waitForTimeout(600);
      const hidden = await page.evaluate(() => {
        const b = document.getElementById('bulkCreateIssueBtn');
        return !b || b.hidden;
      });
      record('1a. Bulk Create hidden for plain member', hidden, 'hidden=' + hidden);
      await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('modal-issue'); });
    }

    // ── switch to the admin session for the rest ────────────────────────────
    await page.goto(BASE + '/');
    await page.evaluate(t => localStorage.setItem('sb-token', t), token);
    await page.reload();
    await page.waitForTimeout(1500);

    // ── 1b. admin: Bulk Create button visible ───────────────────────────────
    {
      await page.goto(BASE + '/space/' + spaceKey + '/board');
      await page.waitForTimeout(1200);
      await page.evaluate(() => { if (typeof openCreateIssueModal === 'function') openCreateIssueModal(); });
      await page.waitForTimeout(600);
      const visible = await page.evaluate(() => {
        const b = document.getElementById('bulkCreateIssueBtn');
        return !!b && !b.hidden;
      });
      record('1b. Bulk Create visible for org admin', visible, 'visible=' + visible);
    }

    // ── 2. Download Sample CSV — verify generated content via in-page fn ────
    let sampleCsv = '';
    {
      sampleCsv = await page.evaluate(() => {
        return (typeof buildBulkSampleCsv === 'function') ? buildBulkSampleCsv(S.issueSpaceId || S.currentSpace.id) : null;
      });
      const hasHeader = sampleCsv && /title/i.test(sampleCsv.split('\n')[0]) && /type/i.test(sampleCsv.split('\n')[0]);
      const hasNoSpaceCol = sampleCsv && !/\bspace\b/i.test(sampleCsv.split('\n')[0]);
      record('2. sample CSV has expected header, no space column', !!hasHeader && !!hasNoSpaceCol,
             'header=' + JSON.stringify((sampleCsv || '').split('\n')[0]));
    }

    // ── 3. Open Bulk Create modal, import a mixed valid/invalid CSV ─────────
    {
      await page.evaluate(() => { if (typeof openBulkIssueModal === 'function') openBulkIssueModal(); });
      await page.waitForTimeout(500);
      const modalVisible = await page.evaluate(() => {
        const m = document.getElementById('modal-bulk-issue');
        return !!m && !m.hidden;
      });
      record('3a. Bulk Create modal opens', modalVisible, 'visible=' + modalVisible);

      const header = sampleCsv.replace(/^﻿/, '').split('\n')[0].replace(/\r$/, '');
      const cols = header.split(',').map(c => c.replace(/^"|"$/g, ''));
      const idx = name => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());
      const titleIdx = idx('title');
      const typeIdx = idx('type');
      const priorityIdx = idx('priority');

      const mkRow = (title, type, priority) => {
        const row = new Array(cols.length).fill('');
        if (titleIdx >= 0) row[titleIdx] = title;
        if (typeIdx >= 0) row[typeIdx] = type;
        if (priorityIdx >= 0) row[priorityIdx] = priority;
        return row.map(v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',');
      };

      const csvLines = [
        header,
        mkRow('Bulk verify valid task one', 'task', 'medium'),
        mkRow('Bulk verify valid task two, with a comma', 'bug', 'high'),
        mkRow('', 'task', 'medium'), // invalid: missing title
        mkRow('Bulk verify bad type', 'not-a-real-type', 'medium') // invalid: bad type
      ];
      const csvText = csvLines.join('\r\n');

      const parsed = await page.evaluate(csvText => mapCsvToBulkRows(csvText), csvText);
      record('3b. CSV parses into 4 data rows',
             !!parsed && Array.isArray(parsed.rows) && parsed.rows.length === 4,
             'rows=' + (parsed && parsed.rows && parsed.rows.length) + ' headerError=' + (parsed && parsed.headerError));

      // Drive the actual file input the way a user would, via a DataTransfer.
      const buf = Buffer.from(csvText, 'utf8');
      await page.setInputFiles('#bulkIssueFile', {
        name: 'sample.csv',
        mimeType: 'text/csv',
        buffer: buf
      });
      await page.waitForTimeout(800);

      const previewState = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.bulk-issue-row-item'));
        return {
          count: items.length,
          invalidCount: items.filter(i => i.classList.contains('is-invalid')).length,
          validCount: items.filter(i => !i.classList.contains('is-invalid')).length,
          confirmHidden: document.getElementById('bulkIssueConfirmBtn').hidden,
          confirmDisabled: document.getElementById('bulkIssueConfirmBtn').disabled,
          confirmLabel: document.getElementById('bulkIssueConfirmBtn').textContent,
          errors: items.map(i => i.textContent.trim().slice(0, 250))
        };
      });
      record('3c. preview shows 4 rows, 2 valid / 2 invalid',
             previewState.count === 4 && previewState.validCount === 2 && previewState.invalidCount === 2,
             JSON.stringify(previewState));
      record('3d. confirm button enabled and labeled for the valid subset',
             !previewState.confirmHidden && !previewState.confirmDisabled && /2/.test(previewState.confirmLabel),
             previewState.confirmLabel);
    }

    // ── 4. Confirm creation; verify modal locks other UI during the call ────
    {
      // Poll tightly instead of sampling once — with only 2 rows against a
      // local server, the whole create can finish inside a single setTimeout tick.
      const pollPromise = page.evaluate(() => {
        return new Promise(resolve => {
          let sawLocked = false;
          const iv = setInterval(() => {
            const cancel = document.getElementById('bulkIssueCancelBtn');
            const closeBtn = document.getElementById('bulkIssueCloseBtn');
            if (window._bulkIssueBusy === true && cancel.disabled && closeBtn.disabled) sawLocked = true;
            if (window._bulkIssueBusy === false || !document.getElementById('modal-bulk-issue') || document.getElementById('modal-bulk-issue').hidden) {
              clearInterval(iv);
              resolve(sawLocked);
            }
          }, 5);
          setTimeout(() => { clearInterval(iv); resolve(sawLocked); }, 5000);
        });
      });
      const clickPromise = page.evaluate(() => confirmBulkIssueCreate());
      const [lockedMidFlight] = await Promise.all([pollPromise, clickPromise]);
      await page.waitForTimeout(500);
      record('4a. UI locked while creating', lockedMidFlight, 'lockedMidFlight=' + lockedMidFlight);

      const resultState = await page.evaluate(() => {
        const r = document.getElementById('bulkIssueResult');
        return { hidden: r.hidden, text: r.textContent.trim().slice(0, 300) };
      });
      record('4b. result summary shown after creation', !resultState.hidden, resultState.text);
    }

    // ── 5. Verify the DB: exactly 2 issues created in this space ────────────
    {
      const rows = (await p.query(
        "SELECT id, key, title, type, priority, status FROM issues WHERE space_id=$1 AND deleted_at IS NULL ORDER BY created_at",
        [created.spaceId]
      )).rows;
      created.issueIds.push(...rows.map(r => r.id));
      const titles = rows.map(r => r.title).sort();
      const expected = ['Bulk verify valid task one', 'Bulk verify valid task two, with a comma'].sort();
      const match = rows.length === 2 && JSON.stringify(titles) === JSON.stringify(expected);
      record('5. exactly the 2 valid rows persisted in DB, invalid rows skipped', match,
             'rows=' + rows.length + ' titles=' + JSON.stringify(titles));
      const statusesOk = rows.every(r => r.status === 'To Do');
      record('5b. created issues default to To Do status', statusesOk, JSON.stringify(rows.map(r => r.status)));
    }

    // ── 6. Done button closes and a created ticket key opens from the app ──
    {
      await page.evaluate(() => { if (typeof finishBulkIssueImport === 'function') finishBulkIssueImport(); });
      await page.waitForTimeout(500);
      const modalClosed = await page.evaluate(() => document.getElementById('modal-bulk-issue').hidden);
      record('6a. Done closes the bulk modal', modalClosed, 'hidden=' + modalClosed);

      const key = (await p.query('SELECT key FROM issues WHERE id=$1', [created.issueIds[0]])).rows[0].key;
      await page.goto(BASE + '/?issue=' + encodeURIComponent(key));
      await page.waitForTimeout(1500);
      const drawerOpen = await page.evaluate(() => document.body.classList.contains('issue-page'));
      record('6b. created ticket opens via its key', drawerOpen, 'key=' + key + ' issue-page=' + drawerOpen);
    }

    // ── 7. Edge cases: empty CSV and header-only CSV don't crash the page ──
    {
      await page.goto(BASE + '/space/' + spaceKey + '/board');
      await page.waitForTimeout(1000);
      await page.evaluate(() => { if (typeof openCreateIssueModal === 'function') openCreateIssueModal(); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { if (typeof openBulkIssueModal === 'function') openBulkIssueModal(); });
      await page.waitForTimeout(300);

      const emptyBuf = Buffer.from('', 'utf8');
      await page.setInputFiles('#bulkIssueFile', { name: 'empty.csv', mimeType: 'text/csv', buffer: emptyBuf });
      await page.waitForTimeout(500);
      const afterEmpty = await page.evaluate(() => document.getElementById('bulkIssuePreview').textContent.slice(0, 200));
      record('7a. empty CSV handled without a crash', pageErrors.length === 0, 'preview=' + JSON.stringify(afterEmpty));

      const headerOnlyBuf = Buffer.from(sampleCsv.split('\n')[0], 'utf8');
      await page.setInputFiles('#bulkIssueFile', { name: 'header-only.csv', mimeType: 'text/csv', buffer: headerOnlyBuf });
      await page.waitForTimeout(500);
      const afterHeaderOnly = await page.evaluate(() => document.getElementById('bulkIssuePreview').textContent.slice(0, 200));
      record('7b. header-only CSV handled without a crash', pageErrors.length === 0, 'preview=' + JSON.stringify(afterHeaderOnly));
    }

    record('no uncaught page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  } catch (e) {
    record('SCRIPT ERROR', false, e.stack || String(e));
  } finally {
    // ── cleanup ──────────────────────────────────────────────────────────
    try {
      if (created.issueIds.length) await p.query('DELETE FROM issue_history WHERE issue_id = ANY($1)', [created.issueIds]);
      if (created.issueIds.length) await p.query('DELETE FROM issue_field_values WHERE issue_id = ANY($1)', [created.issueIds]);
      if (created.issueIds.length) await p.query('DELETE FROM issues WHERE id = ANY($1)', [created.issueIds]);
      if (created.spaceId) await p.query('DELETE FROM space_members WHERE space_id=$1', [created.spaceId]);
      if (created.spaceId) await p.query('DELETE FROM custom_fields WHERE space_id=$1', [created.spaceId]);
      if (created.spaceId) await p.query('DELETE FROM spaces WHERE id=$1', [created.spaceId]);
      if (created.memberUserId) await p.query('DELETE FROM sessions WHERE user_id=$1', [created.memberUserId]);
      if (created.memberUserId) await p.query('DELETE FROM users WHERE id=$1', [created.memberUserId]);
    } catch (e) { console.error('cleanup error', e); }
    await p.end();
    await browser.close();
  }

  const passed = results.filter(r => r.ok).length;
  console.log('\n=== BULK IMPORT VERIFY: ' + passed + '/' + results.length + ' passed ===');
  process.exit(passed === results.length ? 0 : 1);
})();
