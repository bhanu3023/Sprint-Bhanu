/**
 * Category 8 — the notification rules that notification-triggers.md calls
 * load-bearing, and which nothing verified until now.
 *
 * These are the rules most likely to rot silently: a notification that fires
 * to the wrong person, or twice, or to the actor themself, breaks nothing
 * visible in a test that only checks status codes. So every assertion here
 * reads the RECIPIENT's own notification list and counts.
 *
 * createNotif is fire-and-forget by design -- the request returns before the
 * INSERT necessarily lands -- so each check settles first. That is a property
 * of the thing under test, not a flaky test: if the wait were removed these
 * would fail intermittently rather than wrongly.
 */
const { A } = require('../lib/harness');

const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

// A user's notifications, newest first, optionally filtered by type.
async function notifs(c, token, type) {
  const r = await c.get('/api/notifications', { token });
  A.status(r, 200, 'GET /api/notifications');
  const rows = Array.isArray(r.body) ? r.body : [];
  return type ? rows.filter(n => n.type === type) : rows;
}
// Only the ones referring to this issue key, so parallel tests cannot bleed in.
const forKey = (rows, key) => rows.filter(n =>
  (n.title || '').includes(key) || (n.link || '').includes(key));

async function mkIssue(c, x, own, title, extra = {}) {
  const r = await c.post('/api/issues', { token: x.users.manager.token,
    body: { space_id: x.spaceId, title: title + ' ' + x.tag, type: 'task', ...extra } });
  A.statusIn(r, [200, 201], 'create issue: ' + title);
  own.issue(r.body.id);
  return r.body;
}

module.exports = {
  name: 'notification rules',
  tests: [

    { name: 'issue_assigned goes to the new assignee with the shipped title', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif assign');
      const before = forKey(await notifs(c, x.users.member.token, 'issue_assigned'), iss.key).length;
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { assignee_id: x.users.member.id } });
      A.statusIn(upd, [200, 201], 'assign to member');
      await settle();
      const after = forKey(await notifs(c, x.users.member.token, 'issue_assigned'), iss.key);
      A.eq(after.length, before + 1, 'the new assignee must get exactly one issue_assigned');
      // the exact shipped string, per notification-triggers.md
      A.eq(after[0].title, 'You were assigned to ' + iss.key, 'issue_assigned title');
      A.eq(after[0].body, iss.title, 'issue_assigned body is the issue title');
      A.includes(after[0].link, '/?issue=', 'link format is /?issue=<key>, not /issues/<key>');
      A.eq(after[0].is_read, false, 'a new notification is unread');
    }},

    { name: 'self-assignment notifies nobody', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif selfassign');
      const before = forKey(await notifs(c, x.users.manager.token, 'issue_assigned'), iss.key).length;
      // the manager assigns the issue to the manager
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { assignee_id: x.users.manager.id } });
      A.statusIn(upd, [200, 201], 'self-assign');
      await settle();
      const after = forKey(await notifs(c, x.users.manager.token, 'issue_assigned'), iss.key).length;
      A.eq(after, before, 'the actor must never be notified about their own action');
    }},

    { name: 'status_changed goes to the assignee, not to the actor', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif status', { assignee_id: x.users.member.id });
      const beforeMember = forKey(await notifs(c, x.users.member.token, 'status_changed'), iss.key).length;
      const beforeActor = forKey(await notifs(c, x.users.manager.token, 'status_changed'), iss.key).length;
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { status: 'In Progress' } });
      A.statusIn(upd, [200, 201], 'status change by a non-assignee');
      await settle();
      const afterMember = forKey(await notifs(c, x.users.member.token, 'status_changed'), iss.key);
      A.eq(afterMember.length, beforeMember + 1, 'the assignee must be notified of a status change');
      A.eq(afterMember[0].title, iss.key + ' status changed to In Progress', 'status_changed title');
      const afterActor = forKey(await notifs(c, x.users.manager.token, 'status_changed'), iss.key).length;
      A.eq(afterActor, beforeActor, 'the actor must not be notified');
    }},

    { name: 'the assignee changing their own status notifies nobody', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif ownstatus', { assignee_id: x.users.member.id });
      const before = forKey(await notifs(c, x.users.member.token, 'status_changed'), iss.key).length;
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.member.token,
        body: { status: 'In Review' } });
      A.statusIn(upd, [200, 201], 'assignee changes their own status');
      await settle();
      const after = forKey(await notifs(c, x.users.member.token, 'status_changed'), iss.key).length;
      A.eq(after, before, 'assignee === actor must suppress status_changed');
    }},

    { name: 'an unassigned issue produces no status_changed at all', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif noassignee');
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { status: 'In Progress' } });
      A.statusIn(upd, [200, 201], 'status change with no assignee');
      await settle();
      // nobody in the fixture may have received one for this issue
      for (const who of ['owner', 'admin', 'manager', 'member', 'viewer']) {
        const got = forKey(await notifs(c, x.users[who].token, 'status_changed'), iss.key);
        A.eq(got.length, 0, 'no status_changed may exist for an unassigned issue (' + who + ')');
      }
    }},

    { name: 'priority_changed follows the same assignee and actor rules', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif priority', { assignee_id: x.users.member.id, priority: 'low' });
      const before = forKey(await notifs(c, x.users.member.token, 'priority_changed'), iss.key).length;
      const upd = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { priority: 'high' } });
      A.statusIn(upd, [200, 201], 'priority change');
      await settle();
      const after = forKey(await notifs(c, x.users.member.token, 'priority_changed'), iss.key);
      A.eq(after.length, before + 1, 'the assignee must be notified of a priority change');
      A.eq(after[0].title, iss.key + ' priority changed to high', 'priority_changed title');
    }},

    { name: 'comment_added is deduplicated when assignee and reporter are the same person', fn: async (c, x, own) => {
      // This is the rule the Set in comments.js exists for. With assignee and
      // reporter both pointing at one user, a naive implementation sends twice.
      const iss = await mkIssue(c, x, own, 'notif dedupe',
        { assignee_id: x.users.member.id, reporter_id: x.users.member.id });
      A.eq(iss.assignee_id, x.users.member.id, 'fixture: assignee set');
      A.eq(iss.reporter_id, x.users.member.id, 'fixture: reporter set to the SAME user');
      const before = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key).length;
      const add = await c.post('/api/comments', { token: x.users.manager.token,
        body: { issue_id: iss.id, body: 'dedupe probe ' + x.tag } });
      A.statusIn(add, [200, 201], 'comment by a third party');
      await settle();
      const after = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key);
      A.eq(after.length, before + 1, 'assignee === reporter must yield exactly ONE comment_added, not two');
      A.eq(after[0].title, 'New comment on ' + iss.key, 'comment_added title');
      await c.del('/api/comments/' + add.body.id, { token: x.users.admin.token });
    }},

    { name: 'comment_added reaches assignee and reporter separately when they differ', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif two recipients',
        { assignee_id: x.users.member.id, reporter_id: x.users.viewer.id });
      const beforeA = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key).length;
      const beforeR = forKey(await notifs(c, x.users.viewer.token, 'comment_added'), iss.key).length;
      const add = await c.post('/api/comments', { token: x.users.manager.token,
        body: { issue_id: iss.id, body: 'two recipients ' + x.tag } });
      A.statusIn(add, [200, 201], 'comment by a third party');
      await settle();
      A.eq(forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key).length, beforeA + 1, 'assignee notified');
      A.eq(forKey(await notifs(c, x.users.viewer.token, 'comment_added'), iss.key).length, beforeR + 1, 'reporter notified');
      await c.del('/api/comments/' + add.body.id, { token: x.users.admin.token });
    }},

    { name: 'the commenter is never notified of their own comment', fn: async (c, x, own) => {
      // member is BOTH the assignee and the author, so the only thing stopping a
      // notification is the commenter guard.
      const iss = await mkIssue(c, x, own, 'notif owncomment', { assignee_id: x.users.member.id });
      const before = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key).length;
      const add = await c.post('/api/comments', { token: x.users.member.token,
        body: { issue_id: iss.id, body: 'my own comment ' + x.tag } });
      A.statusIn(add, [200, 201], 'comment by the assignee');
      await settle();
      const after = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key).length;
      A.eq(after, before, 'the commenter must not be notified even when they are the assignee');
      await c.del('/api/comments/' + add.body.id, { token: x.users.member.token });
    }},

    { name: 'a comment truncates the notification body at 80 characters', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif truncate', { assignee_id: x.users.member.id });
      const long = 'T'.repeat(200);
      const add = await c.post('/api/comments', { token: x.users.manager.token,
        body: { issue_id: iss.id, body: long } });
      A.statusIn(add, [200, 201], 'long comment');
      await settle();
      const rows = forKey(await notifs(c, x.users.member.token, 'comment_added'), iss.key);
      A.ok(rows.length >= 1, 'the assignee got the notification');
      // 80 characters plus one ellipsis character
      A.eq(rows[0].body.length, 81, 'body is 80 chars + the ellipsis, got ' + rows[0].body.length);
      A.ok(rows[0].body.endsWith('…'), 'body ends with a single ellipsis character');
      await c.del('/api/comments/' + add.body.id, { token: x.users.admin.token });
    }},

    { name: 'mention notifies each named user and skips the commenter', fn: async (c, x, own) => {
      const iss = await mkIssue(c, x, own, 'notif mention');
      const before = forKey(await notifs(c, x.users.viewer.token, 'mention'), iss.key).length;
      const beforeSelf = forKey(await notifs(c, x.users.manager.token, 'mention'), iss.key).length;
      const add = await c.post('/api/comments', { token: x.users.manager.token,
        body: { issue_id: iss.id, body: 'hey there ' + x.tag,
                mentioned_user_ids: [x.users.viewer.id, x.users.manager.id] } });
      A.statusIn(add, [200, 201], 'comment with mentions');
      await settle();
      const after = forKey(await notifs(c, x.users.viewer.token, 'mention'), iss.key);
      A.eq(after.length, before + 1, 'the mentioned user must get exactly one mention');
      A.includes(after[0].title, 'mentioned you on ' + iss.key, 'mention title');
      A.eq(forKey(await notifs(c, x.users.manager.token, 'mention'), iss.key).length, beforeSelf,
        'a commenter who mentions themself must not be notified');
      await c.del('/api/comments/' + add.body.id, { token: x.users.admin.token });
    }},

    { name: 'sprint_started reaches every space member, the actor included', fn: async (c, x, own) => {
      // The documented exception to the never-notify-the-actor rule: a sprint
      // transition is an announcement, so the person who clicked gets one too.
      const key = 'TN' + x.tag.slice(0, 4);
      const sp = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'Notif Space ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
      A.statusIn(sp, [200, 201], 'create space');
      own.space(sp.body.id);
      for (const who of ['manager', 'member']) {
        const add = await c.post('/api/space-members', { token: x.users.admin.token,
          body: { space_id: sp.body.id, user_id: x.users[who].id, role: 'member' } });
        A.statusIn(add, [200, 201], 'add ' + who + ' to the space');
      }
      const spr = await c.post('/api/sprints', { token: x.users.admin.token,
        body: { space_id: sp.body.id, name: 'Notif Sprint ' + x.tag, start_date: x.soon, end_date: x.future } });
      A.statusIn(spr, [200, 201], 'create sprint');
      own.sprint(spr.body.id);

      const name = 'Notif Sprint ' + x.tag;
      const seen = {};
      for (const who of ['admin', 'manager', 'member']) {
        seen[who] = (await notifs(c, x.users[who].token, 'sprint_started')).filter(n => n.title === name + ' has started').length;
      }
      A.statusIn(await c.post('/api/sprints/' + spr.body.id + '/start', { token: x.users.admin.token }),
        [200, 201], 'start the sprint');
      await settle(700);
      for (const who of ['admin', 'manager', 'member']) {
        const now = (await notifs(c, x.users[who].token, 'sprint_started')).filter(n => n.title === name + ' has started');
        A.eq(now.length, seen[who] + 1, 'sprint_started must reach ' + who + ' (actor included)');
        A.includes(now[0].link, '/space/' + key, 'sprint_started link is keyed by space KEY');
      }
    }},

    { name: 'createNotif never blocks the response it belongs to', fn: async (c, x, own) => {
      // Fire-and-forget is a hard rule: a notification failure must never fail
      // or slow a request. An assignment triggers both an INSERT and an email
      // lookup, so if it were awaited it would show up here.
      const iss = await mkIssue(c, x, own, 'notif nonblocking');
      const r = await c.put('/api/issues/' + iss.id, { token: x.users.manager.token,
        body: { assignee_id: x.users.member.id, status: 'In Progress', priority: 'high' } });
      A.statusIn(r, [200, 201], 'update firing three notifications at once');
      A.ok(r.ms < 3000, 'a triple-notification update answered in ' + r.ms.toFixed(0) +
        'ms; anything slow suggests createNotif is being awaited');
    }}
  ]
};
