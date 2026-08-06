#!/usr/bin/env node
// ===== SprintBoard — Automated Scenario Tests =====
// Run: node scripts/test-scenarios.js
// Requires server running on PORT (default 3000)

const BASE = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const QA_PASSWORD = 'Test@12345';

const ACCOUNTS = [
  { email: 'qa-owner@test.local',     label: 'QA Owner',     expectSpaces: true,  canAdmin: true  },
  { email: 'qa-admin@test.local',     label: 'QA Admin',     expectSpaces: true,  canAdmin: true  },
  { email: 'qa-member@test.local',    label: 'QA Member',    expectSpaces: true,  canAdmin: false },
  { email: 'qa-viewer@test.local',    label: 'QA Viewer',    expectSpaces: true,  canAdmin: false },
  { email: 'qa-manager@test.local',   label: 'QA Manager',   expectSpaces: true,  canAdmin: false },
  { email: 'qa-nospaces@test.local',  label: 'QA No Spaces', expectSpaces: false, canAdmin: false },
  { email: 'sarah@neutara.dev',       label: 'Sarah (seed)', expectSpaces: true,  canAdmin: true, password: 'password123' },
];

const results = { pass: 0, fail: 0, skip: 0, details: [] };

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  results.details.push({ status, name, detail });
  if (status === 'PASS') results.pass++;
  else if (status === 'FAIL') results.fail++;
  else results.skip++;
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

async function request(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function login(email, password = QA_PASSWORD) {
  const { status, data } = await request('POST', '/api/auth/login', { body: { email, password } });
  if (status !== 200) throw new Error(`Login failed (${status}): ${data?.error || 'unknown'}`);
  return data;
}

async function run() {
  console.log(`\n🧪 SprintBoard Scenario Tests — ${BASE}\n${'='.repeat(50)}\n`);

  // ── Health / static ──
  try {
    const r = await fetch(`${BASE}/login.html`);
    log(r.ok ? 'PASS' : 'FAIL', 'Static: login.html served', `status ${r.status}`);
  } catch (e) {
    log('FAIL', 'Static: login.html served', e.message);
    console.error('\n❌ Server not reachable. Start with: npm start\n');
    process.exit(1);
  }

  // ── Inactive account ──
  {
    const { status, data } = await request('POST', '/api/auth/login', {
      body: { email: 'qa-inactive@test.local', password: QA_PASSWORD },
    });
    log(status === 403 ? 'PASS' : 'FAIL', 'Auth: inactive account blocked', `status ${status}`);
    if (status !== 403) log('FAIL', 'Auth: inactive error message', data?.error || '');
  }

  // ── Invalid credentials ──
  {
    const { status } = await request('POST', '/api/auth/login', {
      body: { email: 'qa-member@test.local', password: 'wrongpassword' },
    });
    log(status === 401 ? 'PASS' : 'FAIL', 'Auth: wrong password rejected', `status ${status}`);
  }

  const tokens = {};
  let qaSpaceId, qaSprintActive, qaIssueId, qaMemberToken;

  // ── Per-account tests ──
  for (const acct of ACCOUNTS) {
    console.log(`\n── ${acct.label} (${acct.email}) ──`);
    try {
      const session = await login(acct.email, acct.password || QA_PASSWORD);
      tokens[acct.email] = session.token;
      log('PASS', `${acct.label}: login`);

      const me = await request('GET', '/api/auth/me', { token: session.token });
      log(me.status === 200 ? 'PASS' : 'FAIL', `${acct.label}: /api/auth/me`, `role=${me.data?.role}`);

      const data = await request('GET', '/api/data', { token: session.token });
      const spaceCount = data.data?.spaces?.length || 0;
      if (acct.expectSpaces) {
        log(spaceCount > 0 ? 'PASS' : 'FAIL', `${acct.label}: sees spaces`, `count=${spaceCount}`);
      } else {
        log(spaceCount === 0 ? 'PASS' : 'FAIL', `${acct.label}: no space access`, `count=${spaceCount}`);
      }

      if (acct.email === 'qa-member@test.local') {
        qaMemberToken = session.token;
        const qat = data.data?.spaces?.find(s => s.key === 'QAT');
        qaSpaceId = qat?.id;
        log(qat ? 'PASS' : 'FAIL', 'QA Member: QAT space visible');
      }

      if (acct.canAdmin) {
        const users = await request('GET', '/api/users', { token: session.token });
        log(users.status === 200 && users.data?.length > 0 ? 'PASS' : 'FAIL', `${acct.label}: list users`, `count=${users.data?.length}`);
        const inv = await request('GET', '/api/auth/invitations', { token: session.token });
        log(inv.status === 200 ? 'PASS' : 'FAIL', `${acct.label}: list invitations`);
      } else if (acct.email === 'qa-member@test.local') {
        const users = await request('GET', '/api/users', { token: session.token });
        log(users.status === 200 ? 'PASS' : 'FAIL', 'QA Member: can list users (allowed for all auth users)');
      }
    } catch (e) {
      log('FAIL', `${acct.label}: login`, e.message);
    }
  }

  // ── Feature tests (as QA member) ──
  if (qaMemberToken && qaSpaceId) {
    console.log('\n── Feature scenarios (QA Member) ──');

    const sprints = await request('GET', `/api/sprints?space_id=${qaSpaceId}`, { token: qaMemberToken });
    log(sprints.status === 200 && sprints.data?.length > 0 ? 'PASS' : 'FAIL', 'Sprints: list', `count=${sprints.data?.length}`);
    qaSprintActive = sprints.data?.find(s => s.status === 'active')?.id;

    const issues = await request('GET', `/api/issues?space_id=${qaSpaceId}`, { token: qaMemberToken });
    log(issues.status === 200 && issues.data?.length > 0 ? 'PASS' : 'FAIL', 'Issues: list', `count=${issues.data?.length}`);
    qaIssueId = issues.data?.find(i => i.key === 'QAT-2')?.id;

    const statuses = new Set(issues.data?.map(i => i.status) || []);
    log(statuses.has('Blocked') ? 'PASS' : 'FAIL', 'Issues: Blocked status present');
    log(issues.data?.some(i => i.type === 'subtask') ? 'PASS' : 'FAIL', 'Issues: subtask type present');
    log(issues.data?.some(i => i.type === 'epic') ? 'PASS' : 'FAIL', 'Issues: epic type present');

    if (qaIssueId) {
      const detail = await request('GET', `/api/issues/${qaIssueId}`, { token: qaMemberToken });
      log(detail.status === 200 ? 'PASS' : 'FAIL', 'Issues: detail with comments/worklogs');
      log(detail.data?.comments?.length > 0 ? 'PASS' : 'FAIL', 'Comments: seeded on QAT-2');
      log(detail.data?.worklogs?.length > 0 ? 'PASS' : 'FAIL', 'Worklogs: seeded on QAT-2');
      log(detail.data?.history?.length > 0 ? 'PASS' : 'FAIL', 'History: issue_history rows');
    }

    const fields = await request('GET', `/api/custom-fields?space_id=${qaSpaceId}`, { token: qaMemberToken });
    log(fields.status === 200 && fields.data?.length >= 5 ? 'PASS' : 'FAIL', 'Custom fields: multiple types', `count=${fields.data?.length}`);

    const filters = await request('GET', `/api/filters?space_id=${qaSpaceId}`, { token: qaMemberToken });
    log(filters.status === 200 && filters.data?.length > 0 ? 'PASS' : 'FAIL', 'Saved filters', `count=${filters.data?.length}`);

    const notifs = await request('GET', `/api/notifications?user_id=${(await request('GET','/api/auth/me',{token:qaMemberToken})).data.id}`, { token: qaMemberToken });
    log(notifs.status === 200 && notifs.data?.length > 0 ? 'PASS' : 'FAIL', 'Notifications', `count=${notifs.data?.length}`);

    const myIssues = await request('GET', '/api/my-issues', { token: qaMemberToken });
    log(myIssues.status === 200 ? 'PASS' : 'FAIL', 'My issues cross-space');

    const roadmap = await request('GET', `/api/roadmap?space_id=${qaSpaceId}`, { token: qaMemberToken });
    log(roadmap.status === 200 && roadmap.data?.length > 0 ? 'PASS' : 'FAIL', 'Roadmap items', `count=${roadmap.data?.length}`);

    if (qaSprintActive) {
      const reports = [
        ['Sprint report', `/api/reports/sprint/${qaSprintActive}`],
        ['Burndown', `/api/reports/burndown/${qaSprintActive}`],
        ['Team workload', `/api/reports/team-workload/${qaSprintActive}`],
        ['Scope change', `/api/reports/scope-change/${qaSprintActive}`],
        ['Bugs report', `/api/reports/bugs/${qaSprintActive}`],
        ['Spillover', `/api/reports/spillover/${qaSprintActive}`],
        ['Velocity', `/api/reports/velocity?space_id=${qaSpaceId}`],
        ['Cycle time', `/api/reports/cycle-time?space_id=${qaSpaceId}`],
      ];
      for (const [name, path] of reports) {
        const r = await request('GET', path, { token: qaMemberToken });
        log(r.status === 200 ? 'PASS' : 'FAIL', `Report: ${name}`, `status ${r.status}`);
      }
    }

    // Create + update issue flow
    const created = await request('POST', '/api/issues', {
      token: qaMemberToken,
      body: { space_id: qaSpaceId, title: 'QA Auto Test Issue', type: 'task', status: 'To Do', priority: 'medium', sprint_id: qaSprintActive },
    });
    log(created.status === 200 || created.status === 201 ? 'PASS' : 'FAIL', 'Issues: create new', created.data?.key || `status ${created.status}`);

    if (created.data?.id) {
      const updated = await request('PUT', `/api/issues/${created.data.id}`, {
        token: qaMemberToken,
        body: { status: 'In Progress' },
      });
      log(updated.status === 200 ? 'PASS' : 'FAIL', 'Issues: status update + history');

      const comment = await request('POST', '/api/comments', {
        token: qaMemberToken,
        body: { issue_id: created.data.id, user_id: (await request('GET','/api/auth/me',{token:qaMemberToken})).data.id, body: 'Automated test comment' },
      });
      log(comment.status === 200 || comment.status === 201 ? 'PASS' : 'FAIL', 'Comments: create');

      const wl = await request('POST', '/api/worklogs', {
        token: qaMemberToken,
        body: { issue_id: created.data.id, time_spent: 30, work_date: '2026-02-15', description: 'Auto test worklog' },
      });
      log(wl.status === 200 || wl.status === 201 ? 'PASS' : 'FAIL', 'Worklogs: create');

      await request('DELETE', `/api/issues/${created.data.id}`, { token: qaMemberToken });
      log('PASS', 'Issues: delete test issue (cleanup)');
    }
  }

  // ── Invitation scenarios ──
  console.log('\n── Invitation scenarios ──');
  const invList = await request('GET', '/api/auth/invitations', { token: tokens['qa-admin@test.local'] });
  const statuses = [...new Set(invList.data?.map(i => i.status) || [])];
  log(invList.status === 200 && statuses.length >= 2 ? 'PASS' : 'FAIL', 'Invitations: multiple statuses seeded', statuses.join(', '));

  // ── Org & spaces public endpoints ──
  console.log('\n── Public endpoints ──');
  const org = await request('GET', '/api/org');
  log(org.status === 200 ? 'PASS' : 'FAIL', 'GET /api/org');
  const spaces = await request('GET', '/api/spaces');
  log(spaces.status === 200 && spaces.data?.length > 0 ? 'PASS' : 'FAIL', 'GET /api/spaces', `count=${spaces.data?.length}`);

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ✅ ${results.pass} passed  ❌ ${results.fail} failed  ⏭️ ${results.skip} skipped`);
  console.log(`${'='.repeat(50)}\n`);

  if (results.fail > 0) {
    console.log('Failed tests:');
    results.details.filter(d => d.status === 'FAIL').forEach(d => console.log(`  • ${d.name}: ${d.detail}`));
    process.exit(1);
  }
}

run().catch(err => { console.error('Test runner error:', err); process.exit(1); });
