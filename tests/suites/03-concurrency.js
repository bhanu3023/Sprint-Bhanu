/**
 * Category 3 — concurrency.
 *
 * These are the tests that would have caught the duplicate-key race: issue keys
 * are allocated with a read-then-insert (MAX(number)+1 with no lock), so two
 * creates that overlap read the same MAX. The fix retries on conflict; this
 * suite drives real parallel requests against the real server to prove it.
 *
 * A concurrency test that passes because the requests did not actually overlap
 * is worthless, so each one fires with Promise.all and asserts on the whole
 * result set rather than one response.
 */
const { A } = require('../lib/harness');

module.exports = {
  name: 'concurrency',
  tests: [

    { name: '25 parallel issue creates all succeed with unique keys', fn: async (c, x, own) => {
      const N = 25;
      const results = await Promise.all(Array.from({ length: N }, (_, i) =>
        c.post('/api/issues', { token: x.users.manager.token,
          body: { space_id: x.spaceId, title: 'race ' + x.tag + ' #' + i, type: 'task' } })));

      const failed = results.filter(r => r.status < 200 || r.status >= 300);
      results.forEach(r => { if (r.body && r.body.id) own.issue(r.body.id); });

      A.eq(failed.length, 0, N + ' parallel creates: failures=' + failed.length +
        ' first=' + JSON.stringify(failed[0] && { s: failed[0].status, b: failed[0].body }));
      failed.forEach(f => A.noLeak(f, 'failed parallel create'));

      const keys = results.map(r => r.body && r.body.key).filter(Boolean);
      A.eq(keys.length, N, 'every create returned a key');
      A.eq(new Set(keys).size, N, 'keys must be unique -- got ' + new Set(keys).size + ' distinct of ' + N +
        '  duplicates: ' + keys.filter((k, i) => keys.indexOf(k) !== i).join(','));
    }},

    { name: 'parallel creates produce a contiguous key sequence with no gaps', fn: async (c, x, own) => {
      // Uniqueness alone can be satisfied by skipping numbers. The counter is
      // meant to be dense, so check the numeric run too.
      const N = 10;
      const results = await Promise.all(Array.from({ length: N }, (_, i) =>
        c.post('/api/issues', { token: x.users.manager.token,
          body: { space_id: x.space2Id, title: 'seq ' + x.tag + ' #' + i, type: 'task' } })));
      results.forEach(r => { if (r.body && r.body.id) own.issue(r.body.id); });
      results.forEach((r, i) => A.statusIn(r, [200, 201], 'sequence create #' + i));
      const nums = results.map(r => Number(String(r.body.key).split('-')[1])).sort((a, b) => a - b);
      A.eq(nums.length, N, 'all creates returned a parseable key');
      for (let i = 1; i < nums.length; i++) {
        A.eq(nums[i], nums[i - 1] + 1, 'key sequence must be contiguous; got ' + nums.join(','));
      }
    }},

    { name: 'only one sprint can become active despite parallel starts',
      knownBug: "src/server/routes/sprints.js:49 POST /api/sprints/:id/start has NO guard: it runs UPDATE sprints SET status=active unconditionally. There is no one-active-sprint-per-space check and no source-status check, so a second sprint can go active alongside the first, and a COMPLETED sprint can be moved back to active. .claude/rules/sprint-lifecycle.md specifies a SELECT-then-400 check which is absent.",
      fn: async (c, x, own) => {
      // Create three planning sprints in a fresh space, then start all three at
      // once. The lifecycle rule allows exactly one active sprint per space.
      const key = 'TC' + x.tag.slice(0, 4);
      const sp = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'Race Space ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
      A.statusIn(sp, [200, 201], 'space for sprint race');
      own.space(sp.body.id);

      const sprints = await Promise.all([1, 2, 3].map(i =>
        c.post('/api/sprints', { token: x.users.admin.token,
          body: { space_id: sp.body.id, name: 'Race Sprint ' + i + ' ' + x.tag, start_date: x.soon, end_date: x.future } })));
      sprints.forEach(r => A.statusIn(r, [200, 201], 'sprint create'));
      sprints.forEach(r => own.sprint(r.body.id));

      const starts = await Promise.all(sprints.map(s =>
        c.post('/api/sprints/' + s.body.id + '/start', { token: x.users.admin.token })));
      const ok = starts.filter(r => r.status >= 200 && r.status < 300);
      starts.forEach(r => A.noLeak(r, 'parallel sprint start'));
      A.eq(ok.length, 1, 'exactly one parallel start may succeed, got ' + ok.length +
        '  statuses=' + starts.map(r => r.status).join(','));

      // and the database must agree, not just the HTTP responses
      const list = await c.get('/api/sprints?space_id=' + sp.body.id, { token: x.users.admin.token });
      A.status(list, 200, 'list sprints');
      const active = (Array.isArray(list.body) ? list.body : []).filter(s => s.status === 'active');
      A.eq(active.length, 1, 'exactly one sprint may be active in the space, found ' + active.length);
    }},

    { name: 'parallel updates to one issue all record history', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'history race ' + x.tag, type: 'task', status: 'To Do' } });
      A.statusIn(iss, [200, 201], 'issue for history race');
      own.issue(iss.body.id);

      // Distinct fields so the updates do not simply overwrite each other.
      const ups = await Promise.all([
        c.put('/api/issues/' + iss.body.id, { token: x.users.manager.token, body: { story_points: 5 } }),
        c.put('/api/issues/' + iss.body.id, { token: x.users.manager.token, body: { priority: 'high' } }),
        c.put('/api/issues/' + iss.body.id, { token: x.users.manager.token, body: { status: 'In Progress' } })
      ]);
      ups.forEach(r => A.statusIn(r, [200, 201], 'parallel issue update'));
      ups.forEach(r => A.noLeak(r, 'parallel issue update'));

      const got = await c.get('/api/issues/' + iss.body.id, { token: x.users.manager.token });
      A.status(got, 200, 'read back after parallel updates');
      // Every field written must have stuck -- a lost update would show here.
      A.eq(Number(got.body.story_points), 5, 'story_points survived');
      A.eq(got.body.priority, 'high', 'priority survived');
      A.eq(got.body.status, 'In Progress', 'status survived');
    }},

    { name: 'parallel worklogs on one issue all persist', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'worklog race ' + x.tag, type: 'task' } });
      A.statusIn(iss, [200, 201], 'issue for worklog race');
      own.issue(iss.body.id);

      const N = 8;
      const logs = await Promise.all(Array.from({ length: N }, (_, i) =>
        c.post('/api/worklogs', { token: x.users.member.token,
          body: { issue_id: iss.body.id, time_spent: 15, work_date: x.soon, description: 'wl ' + x.tag + ' ' + i } })));
      logs.forEach(r => A.statusIn(r, [200, 201], 'parallel worklog create'));
      logs.forEach(r => { if (r.body && r.body.id) own.worklog(r.body.id); });
      const ids = logs.map(r => r.body.id).filter(Boolean);
      A.eq(new Set(ids).size, N, 'each parallel worklog must be its own row');
    }}
  ]
};
