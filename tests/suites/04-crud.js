/**
 * Category 4 — CRUD happy paths.
 *
 * Each test writes, reads back over HTTP, and asserts the value actually
 * persisted. Asserting only the create response would pass even if nothing was
 * committed, so every one of these does a second, independent GET.
 */
const { A } = require('../lib/harness');

module.exports = {
  name: 'CRUD happy paths',
  tests: [

    { name: 'issue: create -> read -> update -> soft delete -> restore', fn: async (c, x, own) => {
      const create = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'lifecycle ' + x.tag, type: 'story',
                priority: 'high', description: 'initial', story_points: 3 } });
      A.statusIn(create, [200, 201], 'create issue');
      const id = create.body.id;
      own.issue(id);
      A.includes(create.body.key, x.spaceKey, 'issue key must be prefixed with the space key');

      const read = await c.get('/api/issues/' + id, { token: x.users.manager.token });
      A.status(read, 200, 'read issue');
      A.eq(read.body.title, 'lifecycle ' + x.tag, 'title persisted');
      A.eq(read.body.priority, 'high', 'priority persisted');
      A.eq(Number(read.body.story_points), 3, 'story_points persisted');

      const upd = await c.put('/api/issues/' + id, { token: x.users.manager.token,
        body: { title: 'lifecycle updated ' + x.tag, status: 'In Progress', story_points: 8 } });
      A.statusIn(upd, [200, 201], 'update issue');
      const read2 = await c.get('/api/issues/' + id, { token: x.users.manager.token });
      A.eq(read2.body.title, 'lifecycle updated ' + x.tag, 'updated title persisted');
      A.eq(read2.body.status, 'In Progress', 'updated status persisted');
      A.eq(Number(read2.body.story_points), 8, 'updated story_points persisted');

      const del = await c.del('/api/issues/' + id, { token: x.users.manager.token });
      A.statusIn(del, [200, 204], 'soft delete issue');
      // Soft delete means excluded from lists, not gone.
      const list = await c.get('/api/issues?space_id=' + x.spaceId, { token: x.users.manager.token });
      const arr = Array.isArray(list.body) ? list.body : (list.body && list.body.issues) || [];
      A.eq(arr.filter(i => i.id === id).length, 0, 'a soft-deleted issue must not appear in the issue list');

      // Restore is org-admin-only in the implementation ('Only an org admin can
      // restore deleted issues'), which is stricter than the documented matrix.
      const restore = await c.post('/api/issues/' + id + '/restore', { token: x.users.admin.token });
      A.statusIn(restore, [200, 201], 'restore issue');
      const list2 = await c.get('/api/issues?space_id=' + x.spaceId, { token: x.users.manager.token });
      const arr2 = Array.isArray(list2.body) ? list2.body : (list2.body && list2.body.issues) || [];
      A.eq(arr2.filter(i => i.id === id).length, 1, 'a restored issue must reappear in the list');
    }},

    { name: 'issue history records a status change', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'history ' + x.tag, type: 'task', status: 'To Do' } });
      A.statusIn(iss, [200, 201], 'create issue for history');
      own.issue(iss.body.id);
      await c.put('/api/issues/' + iss.body.id, { token: x.users.manager.token, body: { status: 'In Progress' } });
      const got = await c.get('/api/issues/' + iss.body.id, { token: x.users.manager.token });
      A.status(got, 200, 'read issue with history');
      const hist = got.body.history || got.body.issue_history || [];
      const statusRows = hist.filter(h => h.field_name === 'status');
      A.ok(statusRows.length >= 1, 'a status change must write an issue_history row, found ' + statusRows.length);
      const row = statusRows[statusRows.length - 1];
      A.eq(row.new_value, 'In Progress', 'history new_value');
      A.eq(row.old_value, 'To Do', 'history old_value');
    }},

    { name: 'comment: create -> update -> delete', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'comments ' + x.tag, type: 'task' } });
      own.issue(iss.body.id);
      const add = await c.post('/api/comments', { token: x.users.member.token,
        body: { issue_id: iss.body.id, body: 'first comment ' + x.tag } });
      A.statusIn(add, [200, 201], 'create comment');
      const cid = add.body.id;
      A.eq(add.body.user_id, x.users.member.id, 'comment author is the session user');

      const upd = await c.put('/api/comments/' + cid, { token: x.users.member.token,
        body: { body: 'edited comment ' + x.tag } });
      A.statusIn(upd, [200, 201], 'edit own comment');

      const got = await c.get('/api/issues/' + iss.body.id, { token: x.users.member.token });
      const comments = got.body.comments || [];
      const mine = comments.find(cm => cm.id === cid);
      A.ok(mine, 'the comment must be readable on the issue');
      A.eq(mine.body, 'edited comment ' + x.tag, 'edited comment body persisted');

      // Deleting a comment requires a space admin in the implementation, so the
      // author alone cannot remove their own comment. See the divergence noted
      // in the run report against .claude/rules/permission-matrix.md.
      const delByAuthor = await c.del('/api/comments/' + cid, { token: x.users.member.token });
      A.status(delByAuthor, 403, 'the author alone cannot delete their comment');
      const del = await c.del('/api/comments/' + cid, { token: x.users.admin.token });
      A.statusIn(del, [200, 204], 'a space admin can delete the comment');
    }},

    { name: 'a member cannot edit or delete someone else\'s comment',
      knownBug: "lib/permissions.js:30 comment.update requires only space role member and NO ownership check exists anywhere, so any space member can rewrite another user's comment. The message at permissions.js:64 reads: You can only edit your own comments -- promising a check that is not implemented.",
      fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'comment perms ' + x.tag, type: 'task' } });
      own.issue(iss.body.id);
      const add = await c.post('/api/comments', { token: x.users.manager.token,
        body: { issue_id: iss.body.id, body: 'managers comment ' + x.tag } });
      A.statusIn(add, [200, 201], 'manager creates a comment');
      const cid = add.body.id;
      A.denied(await c.put('/api/comments/' + cid, { token: x.users.member.token, body: { body: 'hijack' } }),
        'member editing another user\'s comment');
      A.denied(await c.del('/api/comments/' + cid, { token: x.users.member.token }),
        'member deleting another user\'s comment');
      // cleaned up by its author so teardown has nothing to chase
      await c.del('/api/comments/' + cid, { token: x.users.manager.token });
    }},

    { name: 'worklog: create -> read -> update -> delete', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'worklog crud ' + x.tag, type: 'task' } });
      own.issue(iss.body.id);
      const add = await c.post('/api/worklogs', { token: x.users.member.token,
        body: { issue_id: iss.body.id, time_spent: 90, work_date: x.soon, description: 'wl ' + x.tag } });
      A.statusIn(add, [200, 201], 'create worklog');
      const wid = add.body.id;
      own.worklog(wid);
      A.eq(Number(add.body.time_spent), 90, 'time_spent is stored in minutes as sent');

      const upd = await c.put('/api/worklogs/' + wid, { token: x.users.member.token,
        body: { time_spent: 120, work_date: x.soon, description: 'wl updated ' + x.tag } });
      A.statusIn(upd, [200, 201], 'update own worklog');

      const list = await c.get('/api/worklogs?issue_id=' + iss.body.id, { token: x.users.member.token });
      A.status(list, 200, 'list worklogs');
      const rows = Array.isArray(list.body) ? list.body : [];
      const mine = rows.find(w => w.id === wid);
      A.ok(mine, 'the worklog must be listed');
      A.eq(Number(mine.time_spent), 120, 'updated time_spent persisted');

      A.statusIn(await c.del('/api/worklogs/' + wid, { token: x.users.member.token }), [200, 204], 'delete own worklog');
    }},

    { name: 'a member cannot edit another user\'s worklog', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'worklog perms ' + x.tag, type: 'task' } });
      own.issue(iss.body.id);
      const add = await c.post('/api/worklogs', { token: x.users.manager.token,
        body: { issue_id: iss.body.id, time_spent: 30, work_date: x.soon, description: 'mgr wl ' + x.tag } });
      A.statusIn(add, [200, 201], 'manager creates a worklog');
      own.worklog(add.body.id);
      A.denied(await c.put('/api/worklogs/' + add.body.id,
        { token: x.users.member.token, body: { time_spent: 999, work_date: x.soon } }),
        'member editing another user\'s worklog');
    }},

    { name: 'custom field: create -> update -> delete', fn: async (c, x) => {
      const create = await c.post('/api/custom-fields', { token: x.users.admin.token,
        body: { space_id: x.spaceId, name: 'Test Field ' + x.tag, field_type: 'select',
                options: ['alpha', 'beta'], is_required: false } });
      A.statusIn(create, [200, 201], 'create custom field');
      const fid = create.body.id;

      const list = await c.get('/api/custom-fields?space_id=' + x.spaceId, { token: x.users.admin.token });
      A.status(list, 200, 'list custom fields');
      const rows = Array.isArray(list.body) ? list.body : [];
      A.ok(rows.some(f => f.id === fid), 'the new field must be listed');

      const upd = await c.put('/api/custom-fields/' + fid, { token: x.users.admin.token,
        body: { name: 'Test Field ' + x.tag, options: ['alpha', 'beta', 'gamma'] } });
      A.statusIn(upd, [200, 201], 'update custom field options');

      const list2 = await c.get('/api/custom-fields?space_id=' + x.spaceId, { token: x.users.admin.token });
      const updated = (Array.isArray(list2.body) ? list2.body : []).find(f => f.id === fid);
      A.ok(updated, 'field still present after update');
      const opts = Array.isArray(updated.options) ? updated.options : JSON.parse(updated.options || '[]');
      A.eq(opts.length, 3, 'the added option must persist');

      A.statusIn(await c.del('/api/custom-fields/' + fid, { token: x.users.admin.token }), [200, 204], 'delete custom field');
    }},

    { name: 'space: update settings and read them back', fn: async (c, x, own) => {
      const key = 'TU' + x.tag.slice(0, 4);
      const sp = await c.post('/api/spaces', { token: x.users.admin.token,
        body: { name: 'Update Space ' + x.tag, key, space_type: 'scrum', visibility: 'team', owner_id: x.users.admin.id } });
      A.statusIn(sp, [200, 201], 'create space');
      own.space(sp.body.id);
      const upd = await c.put('/api/spaces/' + sp.body.id, { token: x.users.admin.token,
        body: { name: 'Renamed Space ' + x.tag, description: 'changed ' + x.tag } });
      A.statusIn(upd, [200, 201], 'update space');
      const list = await c.get('/api/spaces', { token: x.users.admin.token });
      A.status(list, 200, 'list spaces');
      const found = (Array.isArray(list.body) ? list.body : []).find(s => s.id === sp.body.id);
      A.ok(found, 'the space must still be listed');
      A.eq(found.name, 'Renamed Space ' + x.tag, 'renamed space name persisted');
    }}
  ]
};
