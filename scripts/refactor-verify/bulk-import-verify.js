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
    // Enable Team / Product Type (a fresh space via POST /api/spaces does not
    // configure these) so the casing-preservation checks below have a
    // realistic capitalized option set to validate against, same as a real
    // space like DEM.
    await p.query(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in, is_builtin, field_key)
       VALUES ($1,$2,'Team','select',$3,false,90,ARRAY['create','drawer'],true,'team')`,
      ['cf-' + crypto.randomUUID(), created.spaceId, JSON.stringify(['Dev', 'QA', 'Infra', 'Manage', 'Product_Team'])]
    );
    await p.query(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in, is_builtin, field_key)
       VALUES ($1,$2,'Product Type','select',$3,false,91,ARRAY['create','drawer'],true,'product_type')`,
      ['cf-' + crypto.randomUUID(), created.spaceId, JSON.stringify(['Message', 'Email', 'Content', 'Manage', 'Infra'])]
    );
    // A genuine per-space custom field (is_builtin=false), like "Customer" on
    // the real dmeo space -- and the builtin Combination field, whose valid
    // values are grouped by Product Type -- to cover the "sample CSV must
    // include every field this space shows on Create" report.
    const customerFieldId = 'cf-' + crypto.randomUUID();
    await p.query(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in, is_builtin, field_key)
       VALUES ($1,$2,'Customer','text','[]',false,92,ARRAY['create','drawer'],false,NULL)`,
      [customerFieldId, created.spaceId]
    );
    const combinationFieldId = 'cf-' + crypto.randomUUID();
    await p.query(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in, is_builtin, field_key)
       VALUES ($1,$2,'Combination','multi_select',$3::jsonb,false,93,ARRAY['create','drawer'],true,'combination')`,
      [combinationFieldId, created.spaceId, JSON.stringify({
        v: 2,
        flat: ['Box - SharePoint', 'Slack - Teams', 'Egnyte - Azure'],
        groups: { Content: ['Box - SharePoint', 'Egnyte - Azure'], Message: ['Slack - Teams'] }
      })]
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
      await page.waitForTimeout(500); // let the async custom-fields fetch triggered by opening the modal land
      sampleCsv = await page.evaluate(() => {
        var sid = (document.getElementById('issueSpaceId') && document.getElementById('issueSpaceId').value) || S.currentSpace;
        return (typeof buildBulkSampleCsv === 'function') ? buildBulkSampleCsv(sid) : null;
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

    // ── 8. Day-first dates (fixed DD-MM-YYYY rule) and Team/Product Type casing ──
    // Regression coverage for a real report: a user typed 09-12-2003 into
    // Excel, which saved it back into the CSV verbatim (not reformatted to
    // ISO), and the strict YYYY-MM-DD-only check rejected it. The user
    // explicitly wants DD-MM-YYYY read as day-first ALWAYS, not guessed by
    // magnitude -- so "05-06-2026" must mean 5 June 2026, not be rejected as
    // ambiguous. Also caught in the same pass: the resolved payload was
    // sending the RAW date string instead of the normalized one, the server
    // was lowercasing Product Type before insert while Team was not
    // (corrupting its case against the space's configured capitalized
    // options), and Date.parse silently rolls an out-of-range date like
    // Feb 30 forward instead of rejecting it.
    {
      await page.goto(BASE + '/space/' + spaceKey + '/board');
      await page.waitForTimeout(1000);
      await page.evaluate(() => { if (typeof openCreateIssueModal === 'function') openCreateIssueModal(); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { if (typeof openBulkIssueModal === 'function') openBulkIssueModal(); });
      await page.waitForTimeout(300);

      const header = sampleCsv.replace(/^﻿/, '').split('\n')[0].replace(/\r$/, '');
      const cols = header.split(',').map(c => c.replace(/^"|"$/g, ''));
      const idx = name => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());
      const mkRow = obj => {
        const row = new Array(cols.length).fill('');
        Object.keys(obj).forEach(k => { const i = idx(k); if (i >= 0) row[i] = obj[k]; });
        return row.map(v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',');
      };

      const csvLines = [
        header,
        mkRow({ Title: 'Day-first date task', Type: 'task', 'Product Type': 'Message', Team: 'Dev', 'Start Date': '09-12-2003', 'Due Date': '2026-12-25' }),
        mkRow({ Title: 'Both-under-13 day-first task', Type: 'task', 'Start Date': '05-06-2026' }),
        mkRow({ Title: 'Reversed range task', Type: 'task', 'Start Date': '2026-12-25', 'Due Date': '09-12-2003' }),
        mkRow({ Title: 'Impossible calendar date task', Type: 'task', 'Start Date': '30-02-2026' })
      ];
      const csvText2 = csvLines.join('\r\n');
      const buf2 = Buffer.from(csvText2, 'utf8');
      await page.setInputFiles('#bulkIssueFile', { name: 'edge-dates.csv', mimeType: 'text/csv', buffer: buf2 });
      await page.waitForTimeout(800);

      const rowErrors = await page.evaluate(() => Array.from(document.querySelectorAll('.bulk-issue-row-item')).map(i => i.textContent.trim()));
      record('8a. day-first date "09-12-2003" is accepted and read as 9 December',
             /Day-first date task/.test(rowErrors[0] || '') && /Ready/.test(rowErrors[0] || ''),
             rowErrors[0]);
      record('8b. "05-06-2026" (both components <= 12) is accepted as day-first, not rejected as ambiguous',
             /Both-under-13 day-first task/.test(rowErrors[1] || '') && /Ready/.test(rowErrors[1] || ''),
             rowErrors[1]);
      record('8c. reversed range with a day-first date still catches Due < Start',
             /before Start Date/.test(rowErrors[2] || ''), rowErrors[2]);
      record('8g. an impossible calendar date (30 Feb) is rejected, not silently rolled to March',
             /not a valid date/i.test(rowErrors[3] || ''), rowErrors[3]);

      // Confirm creation of the one valid row and check what actually landed in the DB
      await page.evaluate(() => confirmBulkIssueCreate());
      await page.waitForTimeout(800);
      const dbRow = (await p.query(
        "SELECT id, title, to_char(start_date, 'YYYY-MM-DD') AS start_iso, to_char(due_date, 'YYYY-MM-DD') AS due_iso, team, product_type FROM issues WHERE space_id=$1 AND title='Day-first date task'",
        [created.spaceId]
      )).rows[0];
      if (dbRow) created.issueIds.push(dbRow.id);
      record('8d. day-first date "09-12-2003" stored as the correct calendar date (2003-12-09)', dbRow && dbRow.start_iso === '2003-12-09', 'start_date=' + (dbRow && dbRow.start_iso));
      record('8e. Team casing preserved exactly ("Dev", not "dev")', dbRow && dbRow.team === 'Dev', 'team=' + (dbRow && dbRow.team));
      record('8f. Product Type casing preserved exactly ("Message", not "message")', dbRow && dbRow.product_type === 'Message', 'product_type=' + (dbRow && dbRow.product_type));

      await page.evaluate(() => { if (typeof finishBulkIssueImport === 'function') finishBulkIssueImport(); });
      await page.waitForTimeout(300);
    }

    // ── 9. Dynamic per-space fields: a genuine custom field (Customer) and
    // the builtin Combination field. Regression coverage for a real report:
    // a production space had a Combination field on Create Issue that the
    // sample CSV never mentioned, so there was no way to set it via import.
    {
      await page.goto(BASE + '/space/' + spaceKey + '/board');
      await page.waitForTimeout(1000);
      await page.evaluate(() => { if (typeof openCreateIssueModal === 'function') openCreateIssueModal(); });
      await page.waitForTimeout(500);
      const dynamicCsv = await page.evaluate(() => buildBulkSampleCsv(document.getElementById('issueSpaceId').value));
      const dynHeaderLine = dynamicCsv.replace(/^﻿/, '').split('\n')[0].replace(/\r$/, '');
      record('9a. sample CSV includes a Customer column (genuine custom field)', /(^|,)Customer(,|$)/.test(dynHeaderLine), dynHeaderLine);
      record('9b. sample CSV includes a Combination column (builtin, non-issues-row field)', /(^|,)Combination(,|$)/.test(dynHeaderLine), dynHeaderLine);

      await page.evaluate(() => { if (typeof openBulkIssueModal === 'function') openBulkIssueModal(); });
      await page.waitForTimeout(300);

      const dynCols = dynHeaderLine.split(',').map(c => c.replace(/^"|"$/g, ''));
      const dynIdx = name => dynCols.findIndex(c => c.toLowerCase() === name.toLowerCase());
      const mkDynRow = obj => {
        const row = new Array(dynCols.length).fill('');
        Object.keys(obj).forEach(k => { const i = dynIdx(k); if (i >= 0) row[i] = obj[k]; });
        return row.map(v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',');
      };
      const dynCsvLines = [
        dynHeaderLine,
        mkDynRow({ Title: 'Dynamic fields valid task', Type: 'task', 'Product Type': 'Content', Customer: 'Acme Corp', Combination: 'box - sharepoint' }),
        mkDynRow({ Title: 'Combination wrong group task', Type: 'task', 'Product Type': 'Message', Combination: 'Box - SharePoint' }),
        mkDynRow({ Title: 'Combination unknown value task', Type: 'task', Combination: 'Not - ARealOption' })
      ];
      await page.setInputFiles('#bulkIssueFile', { name: 'dynamic-fields.csv', mimeType: 'text/csv', buffer: Buffer.from(dynCsvLines.join('\r\n'), 'utf8') });
      await page.waitForTimeout(800);

      const dynRowErrors = await page.evaluate(() => Array.from(document.querySelectorAll('.bulk-issue-row-item')).map(i => i.textContent.trim()));
      record('9c. Customer (free text) and Combination (case-insensitive match) both accepted',
             /Dynamic fields valid task/.test(dynRowErrors[0] || '') && /Ready/.test(dynRowErrors[0] || ''), dynRowErrors[0]);
      record('9d. a combination valid for a DIFFERENT Product Type\'s group is rejected',
             /not available for Product Type/i.test(dynRowErrors[1] || ''), dynRowErrors[1]);
      record('9e. a combination not in the configured list at all is rejected',
             /not one of this space.s configured combinations/i.test(dynRowErrors[2] || ''), dynRowErrors[2]);

      await page.evaluate(() => confirmBulkIssueCreate());
      await page.waitForTimeout(800);
      const dynDbRow = (await p.query(
        "SELECT i.id, i.title FROM issues i WHERE i.space_id=$1 AND i.title='Dynamic fields valid task'", [created.spaceId]
      )).rows[0];
      if (dynDbRow) created.issueIds.push(dynDbRow.id);
      const fieldValues = dynDbRow ? (await p.query(
        "SELECT cf.name, ifv.value FROM issue_field_values ifv JOIN custom_fields cf ON cf.id=ifv.field_id WHERE ifv.issue_id=$1",
        [dynDbRow.id]
      )).rows : [];
      const customerVal = fieldValues.find(r => r.name === 'Customer');
      const comboVal = fieldValues.find(r => r.name === 'Combination');
      record('9f. Customer value stored via issue_field_values', customerVal && customerVal.value === 'Acme Corp', JSON.stringify(customerVal));
      record('9g. Combination stored with its CANONICAL configured casing ("Box - SharePoint"), not the lowercase typed in the CSV',
             comboVal && comboVal.value === 'Box - SharePoint', JSON.stringify(comboVal));

      await page.evaluate(() => { if (typeof finishBulkIssueImport === 'function') finishBulkIssueImport(); });
      await page.waitForTimeout(300);
    }

    record('no uncaught page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  } catch (e) {
    record('SCRIPT ERROR', false, e.stack || String(e));
  } finally {
    // ── cleanup ──────────────────────────────────────────────────────────
    try {
      // Delete by space_id, not just the tracked issueIds -- some assertions
      // above create rows without recording their id, and a leftover row
      // would otherwise block the DELETE FROM spaces below on the FK.
      if (created.spaceId) await p.query('DELETE FROM issue_history WHERE issue_id IN (SELECT id FROM issues WHERE space_id=$1)', [created.spaceId]);
      if (created.spaceId) await p.query('DELETE FROM issue_field_values WHERE issue_id IN (SELECT id FROM issues WHERE space_id=$1)', [created.spaceId]);
      if (created.spaceId) await p.query('DELETE FROM issues WHERE space_id=$1', [created.spaceId]);
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
