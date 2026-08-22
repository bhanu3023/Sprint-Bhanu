/**
 * Category 7 — input validation and the hard rules.
 *
 * The theme: malformed input must produce a 4xx with a generic message, never a
 * 500, never a raw postgres error, and never a stack trace. A 500 here is a
 * finding, not a stylistic complaint -- it means untrusted input reached the
 * driver unguarded.
 */
const { A } = require('../lib/harness');

module.exports = {
  name: 'input validation',
  tests: [

    { name: 'creating an issue without space_id -> 400', fn: async (c, x) => {
      const r = await c.post('/api/issues', { token: x.users.manager.token, body: { title: 'no space ' + x.tag } });
      A.status(r, 400, 'POST /api/issues with no space_id');
      A.noLeak(r);
    }},

    { name: 'creating an issue with a nonexistent space_id -> 4xx, not 500', fn: async (c, x) => {
      const r = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: 'sp-does-not-exist-' + x.tag, title: 'ghost ' + x.tag } });
      A.statusIn(r, [400, 403, 404], 'POST /api/issues with a bogus space_id');
      A.noLeak(r);
    }},

    { name: 'creating a sprint without space_id -> 400', fn: async (c, x) => {
      const r = await c.post('/api/sprints', { token: x.users.admin.token, body: { name: 'no space ' + x.tag } });
      A.status(r, 400, 'POST /api/sprints with no space_id');
      A.noLeak(r);
    }},

    { name: 'login with a missing field -> 400', fn: async (c) => {
      A.status(await c.post('/api/auth/login', { body: { email: 'a@b.invalid' } }), 400, 'login with no password');
      A.status(await c.post('/api/auth/login', { body: { password: 'x' } }), 400, 'login with no email');
      A.status(await c.post('/api/auth/login', { body: {} }), 400, 'login with an empty body');
    }},

    { name: 'a space with no key -> 400', fn: async (c, x) => {
      const r = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'keyless ' + x.tag, owner_id: x.users.admin.id } });
      A.status(r, 400, 'POST /api/spaces with no key');
      A.noLeak(r);
    }},

    { name: 'an unconfigured issue type or priority is rejected', fn: async (c, x) => {
      const bad = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'bad type ' + x.tag, type: 'not-a-real-type' } });
      A.status(bad, 400, 'POST /api/issues with an unconfigured type');
      const badP = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'bad prio ' + x.tag, type: 'task', priority: 'not-a-real-priority' } });
      A.status(badP, 400, 'POST /api/issues with an unconfigured priority');
    }},

    { name: 'SQL metacharacters in a query string do not reach the driver',
      fn: async (c, x) => {
      // Every one of these would break a string-interpolated query. All queries
      // are parameterized, so each must come back as a normal answer or a 4xx.
      const payloads = ["' OR 1=1 --", "'; DROP TABLE issues; --", "1' UNION SELECT NULL--",
                        "%27", "\\", " ", "'::int",
                        // an explicit NUL: postgres cannot store one, so this probes the guard
                        String.fromCharCode(0)];
      for (const p of payloads) {
        const r = await c.get('/api/issues?space_id=' + encodeURIComponent(p), { token: x.users.manager.token });
        A.ok(r.status < 500, 'GET /api/issues with payload ' + JSON.stringify(p) +
          ' returned ' + r.status + ' -- must not be a server error. body=' + r.raw.slice(0, 160));
        A.noLeak(r, 'injection payload ' + JSON.stringify(p));
      }
      // and the table is still there
      const after = await c.get('/api/issues?space_id=' + x.spaceId, { token: x.users.manager.token });
      A.status(after, 200, 'issues still readable after the injection attempts');
    }},

    { name: 'SQL metacharacters in a JSON body do not reach the driver', fn: async (c, x, own) => {
      const evil = "'); DROP TABLE issues; --";
      const r = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: evil, type: 'task', description: evil } });
      A.statusIn(r, [200, 201], 'an issue whose title is a SQL payload must simply be stored');
      own.issue(r.body.id);
      A.eq(r.body.title, evil, 'the payload must be stored verbatim, not executed or mangled');
      const after = await c.get('/api/issues?space_id=' + x.spaceId, { token: x.users.manager.token });
      A.status(after, 200, 'issues table intact');
    }},

    { name: 'a very long string is either stored or refused, never a 500', fn: async (c, x, own) => {
      const long = 'L'.repeat(200000);
      const r = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'long ' + x.tag, type: 'task', description: long } });
      A.ok(r.status < 500, 'a 200KB description returned ' + r.status + ' -- must not be a server error');
      A.noLeak(r, 'long-string response');
      if (r.body && r.body.id) own.issue(r.body.id);
    }},

    { name: 'malformed JSON -> 400, not a crash',
      fn: async (c, x) => {
      const r = await c.post('/api/issues', { token: x.users.manager.token,
        raw: '{"space_id": "' + x.spaceId + '", "title": ', headers: { 'Content-Type': 'application/json' } });
      A.ok(r.status >= 400 && r.status < 500, 'truncated JSON returned ' + r.status + ', expected 4xx');
      A.noLeak(r, 'malformed JSON response');
    }},

    { name: 'wrong types in numeric fields -> 4xx, not 500',
      fn: async (c, x, own) => {
      const r = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'bad number ' + x.tag, type: 'task', story_points: 'not-a-number' } });
      A.ok(r.status < 500, 'story_points="not-a-number" returned ' + r.status + ' -- must not be a server error');
      A.noLeak(r, 'bad numeric response');
      if (r.body && r.body.id) own.issue(r.body.id);
    }},

    { name: 'a worklog with no issue_id -> 400', fn: async (c, x) => {
      const r = await c.post('/api/worklogs', { token: x.users.member.token,
        body: { time_spent: 30, work_date: x.soon } });
      A.statusIn(r, [400, 404], 'POST /api/worklogs with no issue_id');
      A.noLeak(r);
    }},

    { name: 'a comment with no body -> 400', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'empty comment ' + x.tag, type: 'task' } });
      own.issue(iss.body.id);
      const r = await c.post('/api/comments', { token: x.users.member.token, body: { issue_id: iss.body.id } });
      A.statusIn(r, [400, 422], 'POST /api/comments with no body');
      A.noLeak(r);
    }},

    { name: 'a bogus uuid in a path parameter -> 4xx, not 500', fn: async (c, x) => {
      for (const p of ['/api/issues/not-a-uuid', '/api/comments/not-a-uuid', '/api/worklogs/not-a-uuid']) {
        const r = p.includes('issues')
          ? await c.get(p, { token: x.users.manager.token })
          : await c.del(p, { token: x.users.manager.token });
        A.ok(r.status < 500, 'GET/DELETE ' + p + ' returned ' + r.status + ' -- a bad id must not be a server error. body=' + r.raw.slice(0, 140));
        A.noLeak(r, p);
      }
    }},

    {
      // multer only fills req.files for a multipart body, so a JSON POST left it
      // undefined and `for (const f of req.files)` threw a TypeError -- a 500 on
      // a plainly bad request. Guarded to match the sibling at comments.js:71.
      name: 'attachments route survives a non-multipart POST',
      fn: async (c, x, own) => {
        const iss = await c.post('/api/issues', { token: x.users.manager.token,
          body: { space_id: x.spaceId, title: 'nonmultipart ' + x.tag, type: 'task' } });
        own.issue(iss.body.id);
        const r = await c.post('/api/issues/' + iss.body.id + '/attachments',
          { token: x.users.manager.token, body: { not: 'a file' } });
          A.status(r, 400, 'a non-multipart POST to the attachments route');
      }
    }
  ]
};
