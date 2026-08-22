/**
 * Category 6 — all 13 report endpoints.
 *
 * Reports are read-only, which makes them easy to under-test: a 200 with an
 * empty body would pass a naive check. So each report is driven against a space
 * that has KNOWN contents (a completed sprint with known points and statuses),
 * and the two reports whose numbers are fully determined by that data --
 * velocity and status -- are asserted on their values, not just their shape.
 */
const { A } = require('../lib/harness');

// The 13 routes from src/server/routes/reports.js. `param` says which id the
// path needs, so a missing report here is a visible gap rather than a silent one.
const REPORTS = [
  { name: 'velocity',      path: (w) => '/api/reports/velocity?space_id=' + w.spaceId },
  { name: 'status',        path: (w) => '/api/reports/status?space_id=' + w.spaceId },
  { name: 'priority',      path: (w) => '/api/reports/priority?space_id=' + w.spaceId },
  { name: 'workload',      path: (w) => '/api/reports/workload?space_id=' + w.spaceId },
  { name: 'cycle-time',    path: (w) => '/api/reports/cycle-time?space_id=' + w.spaceId },
  { name: 'sprint',        path: (w) => '/api/reports/sprint/' + w.sprintId },
  { name: 'burndown',      path: (w) => '/api/reports/burndown/' + w.sprintId },
  { name: 'control-chart', path: (w) => '/api/reports/control-chart/' + w.sprintId },
  { name: 'team-workload', path: (w) => '/api/reports/team-workload/' + w.sprintId },
  { name: 'scope-change',  path: (w) => '/api/reports/scope-change/' + w.sprintId },
  { name: 'bugs',          path: (w) => '/api/reports/bugs/' + w.sprintId },
  { name: 'spillover',     path: (w) => '/api/reports/spillover/' + w.sprintId },
  { name: 'mbr',           path: (w) => '/api/reports/mbr/' + w.spaceId }
];

// Built once and cached for the suite: creating a completed sprint per report
// would be 13x the work for identical data.
let cached = null;
async function reportWorld(c, x, own) {
  if (cached) return cached;
  const key = 'TR' + x.tag.slice(0, 2) + 'P';
  const sp = await c.post('/api/spaces', { token: x.users.admin.token,
    body: { name: 'Report Space ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
  A.statusIn(sp, [200, 201], 'create report space');
  own.space(sp.body.id);
  // every fixture user joins so team/workload reports have people to group by
  // The route is POST /api/space-members with space_id in the body. This
  // previously posted to a URL that does not exist and swallowed the failure
  // with .catch(), so the team/workload reports were being exercised against a
  // space with only one member.
  for (const u of ['manager', 'member', 'viewer']) {
    const add = await c.post('/api/space-members', { token: x.users.admin.token,
      body: { space_id: sp.body.id, user_id: x.users[u].id, role: 'member' } });
    A.statusIn(add, [200, 201], 'add ' + u + ' to the report space');
  }

  const spr = await c.post('/api/sprints', { token: x.users.admin.token,
    body: { space_id: sp.body.id, name: 'Report Sprint ' + x.tag, start_date: x.soon, end_date: x.future } });
  A.statusIn(spr, [200, 201], 'create report sprint');
  own.sprint(spr.body.id);

  // Known contents: 3 Done (2+3+5=10 points), 1 In Progress, 1 To Do, 1 bug.
  const spec = [
    { t: 'r-done-2', p: 2, s: 'Done', type: 'story' },
    { t: 'r-done-3', p: 3, s: 'Done', type: 'story' },
    { t: 'r-done-5', p: 5, s: 'Done', type: 'story' },
    { t: 'r-prog',   p: 8, s: 'In Progress', type: 'story' },
    { t: 'r-todo',   p: 1, s: 'To Do', type: 'story' },
    { t: 'r-bug',    p: 2, s: 'To Do', type: 'bug' }
  ];
  for (const s of spec) {
    const r = await c.post('/api/issues', { token: x.users.admin.token,
      body: { space_id: sp.body.id, sprint_id: spr.body.id, title: s.t + ' ' + x.tag,
              type: s.type, story_points: s.p, status: 'To Do', assignee_id: x.users.member.id } });
    A.statusIn(r, [200, 201], 'create ' + s.t);
    own.issue(r.body.id);
    if (s.s !== 'To Do') {
      await c.put('/api/issues/' + r.body.id, { token: x.users.admin.token, body: { status: s.s } });
    }
  }
  A.statusIn(await c.post('/api/sprints/' + spr.body.id + '/start', { token: x.users.admin.token }), [200, 201], 'start report sprint');

  cached = { spaceId: sp.body.id, sprintId: spr.body.id, doneCount: 3, donePoints: 10, total: spec.length };
  return cached;
}

const tests = [];

// One test per report: must be 200, must be JSON, must not leak, must answer
// in a sane time. Shape-level but applied to every single one of the 13.
for (const rep of REPORTS) {
  tests.push({ name: 'report ' + rep.name + ' responds 200 with valid JSON', fn: async (c, x, own) => {
    const w = await reportWorld(c, x, own);
    const r = await c.get(rep.path(w), { token: x.users.admin.token });
    A.status(r, 200, 'GET report ' + rep.name);
    A.ok(r.body !== null, 'report ' + rep.name + ' must return parseable JSON, got: ' + r.raw.slice(0, 160));
    A.noLeak(r, 'report ' + rep.name);
    A.ok(r.ms < 10000, 'report ' + rep.name + ' took ' + r.ms.toFixed(0) + 'ms');
  }});
}

// Value-level assertions where the fixture fully determines the answer.
tests.push({ name: 'velocity report reflects the completed sprint\'s velocity', fn: async (c, x, own) => {
  const w = await reportWorld(c, x, own);
  const done = await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token });
  A.statusIn(done, [200, 201], 'complete the report sprint');
  A.eq(Number(done.body.velocity), w.donePoints, 'sprint velocity at completion');

  const r = await c.get('/api/reports/velocity?space_id=' + w.spaceId, { token: x.users.admin.token });
  A.status(r, 200, 'velocity report');
  const rows = Array.isArray(r.body) ? r.body : (r.body.sprints || r.body.data || []);
  const mine = rows.find(s => s.id === w.sprintId || s.sprint_id === w.sprintId ||
                              (s.name || '').includes(x.tag));
  A.ok(mine, 'the completed sprint must appear in the velocity report');
  A.eq(Number(mine.velocity != null ? mine.velocity : mine.completed),
    w.donePoints, 'velocity in the report must equal the stored velocity, not a recalculation');
}});

tests.push({ name: 'status report counts match the known fixture contents', fn: async (c, x, own) => {
  const w = await reportWorld(c, x, own);
  const r = await c.get('/api/reports/status?space_id=' + w.spaceId, { token: x.users.admin.token });
  A.status(r, 200, 'status report');
  // Normalise whatever shape it uses into {status: count}.
  const rows = Array.isArray(r.body) ? r.body : (r.body.data || r.body.statuses || []);
  const counts = {};
  for (const row of rows) {
    const k = row.status || row.name || row.label;
    const v = Number(row.count != null ? row.count : row.value);
    if (k) counts[k] = v;
  }
  A.ok(Object.keys(counts).length > 0, 'status report must break down by status, got ' + r.raw.slice(0, 200));
  A.eq(counts['Done'], w.doneCount, 'Done count in the status report');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  A.eq(total, w.total, 'total issues across all statuses');
}});

// Authorization: reports are space-admin only.
tests.push({ name: 'reports are denied to a non-admin space member', fn: async (c, x, own) => {
  const w = await reportWorld(c, x, own);
  for (const rep of REPORTS) {
    const r = await c.get(rep.path(w), { token: x.users.viewer.token });
    A.denied(r, 'viewer GET report ' + rep.name);
  }
}});

tests.push({ name: 'reports require authentication', fn: async (c, x, own) => {
  const w = await reportWorld(c, x, own);
  for (const rep of REPORTS) {
    const r = await c.get(rep.path(w));
    A.status(r, 401, 'unauthenticated GET report ' + rep.name);
  }
}});

module.exports = { name: 'reports (13)', tests, reset: () => { cached = null; } };
