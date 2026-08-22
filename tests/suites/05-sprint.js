/**
 * Category 5 — sprint completion, the highest-consequence write in the app.
 *
 * Completion does four things in order (velocity, status, move incomplete
 * issues to backlog, notify) and `velocity` is afterwards the single source of
 * truth for reporting -- it is never recalculated. So each step is asserted
 * separately: a completion that sets status but skips velocity would otherwise
 * look like a pass.
 *
 * Every test builds its OWN space and sprint, because completion is
 * destructive to sprint contents and must not depend on ordering.
 */
const { A } = require('../lib/harness');

// Builds an isolated space + sprint + issues, and returns the ids.
async function world(c, x, own, label, issues) {
  const key = label + x.tag.slice(0, 4);
  const sp = await c.post('/api/spaces', { token: x.users.admin.token,
    body: { name: 'Sprint World ' + label + ' ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
  A.statusIn(sp, [200, 201], 'create space for ' + label);
  own.space(sp.body.id);

  const spr = await c.post('/api/sprints', { token: x.users.admin.token,
    body: { space_id: sp.body.id, name: 'Sprint ' + label + ' ' + x.tag, start_date: x.soon, end_date: x.future } });
  A.statusIn(spr, [200, 201], 'create sprint for ' + label);
  own.sprint(spr.body.id);

  const made = [];
  for (const spec of issues) {
    const r = await c.post('/api/issues', { token: x.users.admin.token,
      body: { space_id: sp.body.id, sprint_id: spr.body.id, title: spec.title + ' ' + x.tag,
              type: 'story', story_points: spec.points, status: 'To Do' } });
    A.statusIn(r, [200, 201], 'create issue ' + spec.title);
    own.issue(r.body.id);
    // Status is set by a follow-up update so the state machine is exercised
    // rather than bypassed at insert time.
    if (spec.status && spec.status !== 'To Do') {
      const u = await c.put('/api/issues/' + r.body.id, { token: x.users.admin.token, body: { status: spec.status } });
      A.statusIn(u, [200, 201], 'set status ' + spec.status);
    }
    made.push({ id: r.body.id, ...spec });
  }
  return { spaceId: sp.body.id, sprintId: spr.body.id, issues: made };
}

module.exports = {
  name: 'sprint completion',
  tests: [

    { name: 'planning -> active -> completed', fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SA', [{ title: 'a', points: 2, status: 'To Do' }]);
      const start = await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token });
      A.statusIn(start, [200, 201], 'start sprint');
      const afterStart = await c.get('/api/sprints?space_id=' + w.spaceId, { token: x.users.admin.token });
      A.eq((afterStart.body || []).find(s => s.id === w.sprintId).status, 'active', 'status after start');

      const done = await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token });
      A.statusIn(done, [200, 201], 'complete sprint');
      const afterDone = await c.get('/api/sprints?space_id=' + w.spaceId, { token: x.users.admin.token });
      A.eq((afterDone.body || []).find(s => s.id === w.sprintId).status, 'completed', 'status after complete');
    }},

    { name: 'a second sprint cannot start while one is active',
      fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SB', []);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start first sprint');
      const second = await c.post('/api/sprints', { token: x.users.admin.token,
        body: { space_id: w.spaceId, name: 'Second ' + x.tag, start_date: x.soon, end_date: x.future } });
      A.statusIn(second, [200, 201], 'create second sprint');
      own.sprint(second.body.id);
      const r = await c.post('/api/sprints/' + second.body.id + '/start', { token: x.users.admin.token });
      A.status(r, 400, 'starting a second sprint while one is active must be a 400');
      A.noLeak(r, 'second-start response');
    }},

    { name: 'completion writes velocity as the sum of Done story points', fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SC', [
        { title: 'done-3', points: 3, status: 'Done' },
        { title: 'done-5', points: 5, status: 'Done' },
        { title: 'open-8', points: 8, status: 'In Progress' },
        { title: 'todo-13', points: 13, status: 'To Do' }
      ]);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start');
      const done = await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token });
      A.statusIn(done, [200, 201], 'complete');
      // 3 + 5 = 8; the 8 and 13 were not Done and must not count.
      A.eq(Number(done.body.velocity), 8, 'velocity must be the sum of Done story points only');
    }},

    { name: 'completion moves incomplete issues to the backlog and keeps Done ones', fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SD', [
        { title: 'keep-done', points: 2, status: 'Done' },
        { title: 'move-prog', points: 3, status: 'In Progress' },
        { title: 'move-todo', points: 5, status: 'To Do' }
      ]);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start');
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token }), [200, 201], 'complete');

      const byTitle = {};
      for (const i of w.issues) {
        const got = await c.get('/api/issues/' + i.id, { token: x.users.admin.token });
        A.status(got, 200, 'read ' + i.title);
        byTitle[i.title] = got.body;
      }
      A.eq(byTitle['keep-done'].sprint_id, w.sprintId, 'a Done issue keeps its sprint_id for historical reporting');
      A.eq(byTitle['move-prog'].sprint_id, null, 'an In Progress issue moves to the backlog');
      A.eq(byTitle['move-todo'].sprint_id, null, 'a To Do issue moves to the backlog');
      // Moved issues keep their status; they are NOT reset to To Do.
      A.eq(byTitle['move-prog'].status, 'In Progress', 'a backlogged issue keeps its status');
    }},

    { name: 'a completed sprint cannot be restarted',
      fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SE', []);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start');
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token }), [200, 201], 'complete');
      const again = await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token });
      A.denied(again, 'restarting a completed sprint');
    }},

    { name: 'velocity is not recalculated after completion', fn: async (c, x, own) => {
      // sprints.velocity is the single source of truth once written. Changing an
      // issue afterwards must not move the historical number.
      const w = await world(c, x, own, 'SF', [{ title: 'v-done', points: 5, status: 'Done' }]);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start');
      const done = await c.post('/api/sprints/' + w.sprintId + '/complete', { token: x.users.admin.token });
      A.eq(Number(done.body.velocity), 5, 'velocity at completion');

      await c.put('/api/issues/' + w.issues[0].id, { token: x.users.admin.token, body: { story_points: 99 } });
      const list = await c.get('/api/sprints?space_id=' + w.spaceId, { token: x.users.admin.token });
      const after = (list.body || []).find(s => s.id === w.sprintId);
      A.eq(Number(after.velocity), 5, 'velocity must stay at its completion-time value');
    }},

    { name: 'sprint status and velocity cannot be set through the generic PUT', fn: async (c, x, own) => {
      // The second door. Guarding /start alone closed nothing while status was
      // writable here, with none of the completion side effects running.
      const w = await world(c, x, own, 'SP', [{ title: 'p', points: 3, status: 'Done' }]);

      const setActive = await c.put('/api/sprints/' + w.sprintId,
        { token: x.users.admin.token, body: { status: 'active' } });
      A.status(setActive, 400, 'PUT {status} alone must be rejected as nothing-to-update');

      const setVelocity = await c.put('/api/sprints/' + w.sprintId,
        { token: x.users.admin.token, body: { velocity: 999 } });
      A.status(setVelocity, 400, 'PUT {velocity} alone must be rejected');

      // A legitimate PUT alongside them must still work, and must NOT smuggle
      // status through.
      const mixed = await c.put('/api/sprints/' + w.sprintId,
        { token: x.users.admin.token, body: { name: 'Renamed ' + x.tag, status: 'completed', velocity: 42 } });
      A.statusIn(mixed, [200, 201], 'a PUT with a legitimate field must still succeed');
      A.eq(mixed.body.name, 'Renamed ' + x.tag, 'the legitimate field was applied');
      A.eq(mixed.body.status, 'planning', 'status must be ignored, not applied');
      A.eq(Number(mixed.body.velocity), 0, 'velocity must be ignored, not applied');
    }},

    { name: 'a sprint can only be deleted while in planning',
      knownBug: "src/server/routes/sprints.js:35 DELETE /api/sprints/:id has no status gate, so an ACTIVE sprint can be binned and its issues detached to the backlog mid-sprint. sprint-lifecycle.md says it is only allowed while status=planning.",
      fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SG', []);
      A.statusIn(await c.post('/api/sprints/' + w.sprintId + '/start', { token: x.users.admin.token }), [200, 201], 'start');
      A.denied(await c.del('/api/sprints/' + w.sprintId, { token: x.users.admin.token }), 'deleting an ACTIVE sprint');

      const planning = await c.post('/api/sprints', { token: x.users.admin.token,
        body: { space_id: w.spaceId, name: 'Deletable ' + x.tag, start_date: x.soon, end_date: x.future } });
      A.statusIn(planning, [200, 201], 'create a planning sprint');
      const del = await c.del('/api/sprints/' + planning.body.id, { token: x.users.admin.token });
      A.statusIn(del, [200, 204], 'deleting a PLANNING sprint must be allowed');
    }},

    { name: 'deleting a planning sprint returns its issues to the backlog', fn: async (c, x, own) => {
      const w = await world(c, x, own, 'SH', [{ title: 'orphan', points: 1, status: 'To Do' }]);
      const del = await c.del('/api/sprints/' + w.sprintId, { token: x.users.admin.token });
      A.statusIn(del, [200, 204], 'delete planning sprint');
      const got = await c.get('/api/issues/' + w.issues[0].id, { token: x.users.admin.token });
      A.status(got, 200, 'the issue must survive its sprint being deleted');
      A.eq(got.body.sprint_id, null, 'the issue must be back in the backlog, not orphaned to a dead sprint');
    }}
  ]
};
