/**
 * Category 1 — authentication and the permission matrix.
 *
 * Authentication (is this a valid session?) and authorization (may this session
 * do this?) fail differently and are tested separately. Every denial is checked
 * with A.denied, which rejects BOTH a silent 2xx and a 500 -- a permission bug
 * that crashes is still a permission bug.
 */
const { A } = require('../lib/harness');

module.exports = {
  name: 'auth & permissions',
  tests: [

    // ---- authentication ------------------------------------------------
    { name: 'no token on a protected route -> 401', fn: async (c, x) => {
      const r = await c.get('/api/issues');
      A.status(r, 401, 'GET /api/issues without a token');
      A.noLeak(r);
    }},

    { name: 'malformed token -> 401', fn: async (c) => {
      const r = await c.get('/api/issues', { token: 'not-a-real-token' });
      A.status(r, 401, 'GET with a garbage bearer token');
    }},

    { name: 'well-formed but unknown token -> 401', fn: async (c) => {
      const r = await c.get('/api/issues', { token: 'a'.repeat(64) });
      A.status(r, 401, 'GET with a 64-hex token that was never issued');
    }},

    { name: 'valid login returns a token and never the password hash', fn: async (c, x) => {
      const r = await c.post('/api/auth/login', { body: { email: x.users.member.email, password: x.password } });
      A.status(r, 200, 'login with correct credentials');
      A.ok(r.body && r.body.token, 'login response carries a token');
      A.ok(r.body.user && r.body.user.id === x.users.member.id, 'login returns the right user');
      A.noLeak(r, 'login response');
      A.excludes(r.raw, 'password_hash', 'login response body');
      // the freshly issued token must actually work
      const me = await c.get('/api/auth/me', { token: r.body.token });
      A.status(me, 200, 'GET /api/auth/me with the new token');
      A.eq(me.body.id, x.users.member.id, '/api/auth/me identity');
    }},

    { name: 'wrong password -> 401 and no session issued', fn: async (c, x) => {
      const r = await c.post('/api/auth/login', { body: { email: x.users.outsider.email, password: 'definitely-wrong' } });
      A.status(r, 401, 'login with a wrong password');
      A.ok(!r.body || !r.body.token, 'a failed login must not return a token');
    }},

    { name: 'unknown email and wrong password are indistinguishable', fn: async (c, x) => {
      // User enumeration: the two failures must look the same to the caller.
      const a = await c.post('/api/auth/login', { body: { email: 'nobody-' + x.tag + '@test.invalid', password: 'x' } });
      const b = await c.post('/api/auth/login', { body: { email: x.users.viewer.email, password: 'wrong-' + x.tag } });
      A.eq(a.status, b.status, 'status for unknown-email vs wrong-password');
      A.eq(JSON.stringify(a.body), JSON.stringify(b.body), 'body for unknown-email vs wrong-password');
    }},

    { name: 'logout invalidates the session', fn: async (c, x) => {
      const login = await c.post('/api/auth/login', { body: { email: x.users.viewer.email, password: x.password } });
      A.status(login, 200, 'login before logout');
      const t = login.body.token;
      A.status(await c.get('/api/auth/me', { token: t }), 200, 'me before logout');
      const out = await c.post('/api/auth/logout', { token: t });
      A.statusIn(out, [200, 204], 'logout');
      const after = await c.get('/api/auth/me', { token: t });
      A.status(after, 401, 'me AFTER logout -- the session must be dead');
    }},

    // ---- authorization: issues -----------------------------------------
    { name: 'a space role of viewer normalises to member (3-tier model)', fn: async (c, x, own) => {
      // lib/permissions.js deliberately collapsed to three tiers -- Org Admin,
      // Space Admin, Member -- and normalizeSpaceRole maps the legacy values
      // viewer -> member and manager -> site_admin. So a row with role='viewer'
      // has MEMBER rights, and creating an issue is allowed.
      //
      // .claude/rules/permission-matrix.md still documents four space roles with
      // viewer read-only. The implementation is the deliberate one; the doc is
      // stale. This test pins the IMPLEMENTED behaviour so the divergence is
      // visible rather than assumed either way.
      const r = await c.post('/api/issues', { token: x.users.viewer.token,
        body: { space_id: x.spaceId, title: 'viewer-as-member ' + x.tag, type: 'task' } });
      A.statusIn(r, [200, 201], 'a legacy viewer normalises to member and may create');
      own.issue(r.body.id);
      // What IS still enforced for a non-site_admin: sprint management.
      A.denied(await c.post('/api/sprints', { token: x.users.viewer.token,
        body: { space_id: x.spaceId, name: 'viewer sprint ' + x.tag } }),
        'a member-tier user managing sprints');
    }},

    { name: 'member CAN create an issue', fn: async (c, x, own) => {
      const r = await c.post('/api/issues', { token: x.users.member.token,
        body: { space_id: x.spaceId, title: 'member create ' + x.tag, type: 'task' } });
      A.statusIn(r, [200, 201], 'member POST /api/issues');
      A.ok(r.body && r.body.id, 'created issue has an id');
      own.issue(r.body.id);
    }},

    { name: 'a user in the org but not in the space cannot read its issues', fn: async (c, x) => {
      const r = await c.get('/api/issues?space_id=' + x.spaceId, { token: x.users.outsider.token });
      // Either an explicit denial, or an empty result -- what must NOT happen is
      // this space's issues coming back to a non-member.
      if (r.status >= 200 && r.status < 300) {
        const list = Array.isArray(r.body) ? r.body : (r.body && r.body.issues) || [];
        const leaked = list.filter(i => i.space_id === x.spaceId);
        A.eq(leaked.length, 0, 'issues from a space the caller is not a member of');
      } else {
        A.denied(r, 'outsider GET issues of a space they do not belong to');
      }
    }},

    // ---- authorization: sprints ----------------------------------------
    { name: 'member cannot create a sprint', fn: async (c, x) => {
      const r = await c.post('/api/sprints', { token: x.users.member.token,
        body: { space_id: x.spaceId, name: 'member sprint ' + x.tag } });
      A.denied(r, 'member POST /api/sprints');
    }},

    { name: 'manager CAN create a sprint', fn: async (c, x, own) => {
      const r = await c.post('/api/sprints', { token: x.users.manager.token,
        body: { space_id: x.spaceId, name: 'manager sprint ' + x.tag, start_date: x.soon, end_date: x.future } });
      A.statusIn(r, [200, 201], 'manager POST /api/sprints');
      own.sprint(r.body.id);
    }},

    // ---- authorization: spaces -----------------------------------------
    { name: 'non-admin cannot create a space', fn: async (c, x) => {
      const r = await c.post('/api/spaces', { token: x.users.member.token,
        body: { name: 'nope ' + x.tag, key: 'NOPE' + x.tag.slice(0, 2), owner_id: x.users.member.id } });
      A.denied(r, 'member POST /api/spaces');
    }},

    { name: 'org admin CAN create a space', fn: async (c, x, own) => {
      const key = 'TZ' + x.tag.slice(0, 4);
      const r = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'Admin Space ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
      A.statusIn(r, [200, 201], 'admin POST /api/spaces');
      A.eq(r.body.key, key, 'created space key');
      own.space(r.body.id);
    }},

    { name: 'duplicate space key is rejected with 409, not a raw pg error', fn: async (c, x) => {
      const r = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'Clash ' + x.tag, key: x.spaceKey, owner_id: x.users.admin.id } });
      A.status(r, 409, 'POST /api/spaces with an existing key');
      A.noLeak(r, 'space key clash response');
    }},

    // ---- the debug route that was gated --------------------------------
    { name: '/api/debug/spaces is gated to org admins', fn: async (c, x) => {
      const denied = await c.get('/api/debug/spaces', { token: x.users.member.token });
      A.denied(denied, 'member GET /api/debug/spaces');
      const allowed = await c.get('/api/debug/spaces', { token: x.users.admin.token });
      A.status(allowed, 200, 'admin GET /api/debug/spaces');
    }},

    // ---- worklog identity ----------------------------------------------
    { name: 'worklog ignores user_id in the body and uses the session user', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'worklog identity ' + x.tag, type: 'task' } });
      A.statusIn(iss, [200, 201], 'issue for worklog test');
      own.issue(iss.body.id);
      const r = await c.post('/api/worklogs', { token: x.users.member.token,
        body: { issue_id: iss.body.id, time_spent: 30, work_date: x.soon,
                description: 'identity ' + x.tag, user_id: x.users.admin.id } });
      A.statusIn(r, [200, 201], 'POST /api/worklogs');
      own.worklog(r.body.id);
      A.eq(r.body.user_id, x.users.member.id,
        'worklog owner must be the SESSION user, not the user_id sent in the body');
    }}
  ]
};
