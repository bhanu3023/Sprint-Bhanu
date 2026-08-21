const { requireAuth } = require('../auth');
const { uid, wrap } = require('../core');
const { q } = require('../db');
const { UPDATE_WHITELIST, buildDynamicUpdate, canRemoveSpaceMember, denyUnlessCanAct, getSpaceMemberRecord, isOrgAdmin, pickAllowed, requireOrgAdmin, seedBuiltinIssueFields, validateSpaceRoleAssignment } = require('../deps');
const { app } = require('../express-app');
// ── Spaces ────────────────────────────────────────────────
app.get('/api/spaces', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id || req.user.id;
  const admin = isOrgAdmin(req.user.role);
  const params = [];
  let memberJoin = '';
  if (!admin) {
    params.push(userId);
    memberJoin = ' JOIN space_members vis ON vis.space_id=s.id AND vis.user_id=$1';
  }
  const r = await q(`SELECT s.*, COUNT(sm.id)::int AS member_count
    FROM spaces s${memberJoin}
    LEFT JOIN space_members sm ON sm.space_id=s.id
    WHERE s.is_archived=false
    GROUP BY s.id ORDER BY s.name`, params);
  res.json(r.rows);
}));

// A space key is the /space/:key route segment and what getSpaceByKey() looks
// up, so two spaces sharing one key means every link to either resolves to
// whichever the lookup hits first. Checked case-insensitively and against
// ARCHIVED spaces too: archiving keeps the row and its key, so handing that key
// to a new space only defers the collision to whenever the old one comes back.
async function findSpaceKeyConflict(key, excludeSpaceId) {
  const params = [String(key || '').trim()];
  let sql = 'SELECT id, name, is_archived FROM spaces WHERE UPPER(key) = UPPER($1)';
  if (excludeSpaceId) { params.push(excludeSpaceId); sql += ' AND id <> $2'; }
  return (await q(sql + ' LIMIT 1', params)).rows[0] || null;
}

function spaceKeyTakenMessage(clash) {
  return 'That key is already used by the space "' + clash.name + '"' +
    (clash.is_archived ? ' (archived)' : '') + '. Pick a different key.';
}

app.post('/api/spaces', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can create a space.')) return;
  const { name, description, icon, color, space_type, visibility, owner_id } = req.body;
  const key = String(req.body.key || '').trim().toUpperCase();
  if (!key) return res.status(400).json({ error: 'A space key is required.' });
  const clash = await findSpaceKeyConflict(key, null);
  if (clash) return res.status(409).json({ error: spaceKeyTakenMessage(clash) });
  const id = uid();
  const r = await q(`INSERT INTO spaces(id,name,key,description,icon,color,space_type,visibility,owner_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, name, key, description, icon, color, space_type, visibility, owner_id]);
  await q(`INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,'site_admin')`, [uid(), id, owner_id]);
  try {
    await seedBuiltinIssueFields(q, uid, id, r.rows[0]);
  } catch (e) {
    console.error('[spaces] Built-in field seed failed:', e.message);
  }
  res.status(201).json(r.rows[0]);
}));

// Debug: raw spaces count
app.get('/api/debug/spaces', requireAuth, wrap(async (req, res) => {
  const all = await q(`SELECT id, name, key, is_archived FROM spaces ORDER BY name`);
  res.json({ count: all.rows.length, spaces: all.rows });
}));

// Recover orphaned space (insert with specific ID) — admin only
app.post('/api/spaces/recover', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admin only' });
  const { id, name, icon, color } = req.body;
  const key = String(req.body.key || '').trim().toUpperCase();
  if (!id || !name || !key) return res.status(400).json({ error: 'id, name, key required' });
  // Recovery re-inserts by id, so it can hand an existing key to a different
  // space and re-create the collision the unique index exists to prevent.
  const clash = await findSpaceKeyConflict(key, id);
  if (clash) return res.status(409).json({ error: spaceKeyTakenMessage(clash) });
  // Get org_id to satisfy FK if needed
  const orgR = await q(`SELECT id FROM organizations LIMIT 1`);
  const orgId = orgR.rows[0] ? orgR.rows[0].id : null;
  // Insert with original ID — also force is_archived=false on conflict
  const r = await q(`INSERT INTO spaces(id,org_id,name,key,description,icon,color,space_type,visibility,owner_id,is_archived)
    VALUES($1,$2,$3,$4,'Recovered space',$5,$6,'scrum','team',$7,false)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, key=EXCLUDED.key, is_archived=false RETURNING *`,
    [id, orgId, name, key, icon||'📁', color||'#6366f1', req.user.user_id]);
  if (!r.rows[0]) return res.status(500).json({ error: 'Insert returned no rows' });
  // Add current user as site_admin member
  await q(`INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,'site_admin') ON CONFLICT DO NOTHING`,
    [uid(), id, req.user.user_id]);
  console.log(`  Recovered space: ${name} (${key}) id=${id}`);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/spaces/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = req.params.id;
  let body = req.body;
  // Renaming a key into an existing one breaks routing exactly like creating a
  // duplicate does. Only org admins can reach `key` at all — it is absent from
  // UPDATE_WHITELIST.spaces_space_admin — so this guard sits on that branch.
  if (isOrgAdmin(req.user.role) && Object.prototype.hasOwnProperty.call(body, 'key')) {
    const key = String(body.key || '').trim().toUpperCase();
    if (!key) return res.status(400).json({ error: 'A space key is required.' });
    const clash = await findSpaceKeyConflict(key, spaceId);
    if (clash) return res.status(409).json({ error: spaceKeyTakenMessage(clash) });
    body = Object.assign({}, body, { key: key });
  }
  if (isOrgAdmin(req.user.role)) {
    const upd = buildDynamicUpdate('spaces', body, 2);
    if (!upd) return res.status(400).json({ error: 'Nothing to update' });
    const r = await q(`UPDATE spaces SET ${upd.set},updated_at=NOW() WHERE id=$1 RETURNING *`, [spaceId, ...upd.vals]);
    return res.json(r.rows[0]);
  }
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'space.settings'))) return;
  body = pickAllowed(body, UPDATE_WHITELIST.spaces_space_admin);
  const upd = buildDynamicUpdate('spaces_space_admin', body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE spaces SET ${upd.set},updated_at=NOW() WHERE id=$1 RETURNING *`, [spaceId, ...upd.vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/spaces/:id', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can delete a space.')) return;
  await q('UPDATE spaces SET is_archived=true,updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/spaces/:id/favorite', requireAuth, wrap(async (req, res) => {
  const user_id = req.user.user_id;
  const spid = req.params.id;
  const ex = await q('SELECT 1 FROM space_favorites WHERE space_id=$1 AND user_id=$2', [spid, user_id]);
  if (ex.rows.length) {
    await q('DELETE FROM space_favorites WHERE space_id=$1 AND user_id=$2', [spid, user_id]);
    res.json({ favorited: false });
  } else {
    await q('INSERT INTO space_favorites(user_id,space_id) VALUES($1,$2)', [user_id, spid]);
    res.json({ favorited: true });
  }
}));

app.post('/api/issues/:id/favorite', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id;
  const issueId = req.params.id;
  const issue = (await q('SELECT id FROM issues WHERE id=$1 AND deleted_at IS NULL', [issueId])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  const ex = await q('SELECT 1 FROM issue_favorites WHERE issue_id=$1 AND user_id=$2', [issueId, userId]);
  if (ex.rows.length) {
    await q('DELETE FROM issue_favorites WHERE issue_id=$1 AND user_id=$2', [issueId, userId]);
    res.json({ favorited: false });
  } else {
    await q('INSERT INTO issue_favorites(user_id,issue_id) VALUES($1,$2)', [userId, issueId]);
    res.json({ favorited: true });
  }
}));

app.get('/api/spaces/:id/members', requireAuth, wrap(async (req, res) => {
  if (!(await denyUnlessCanAct(q, req.user, res, req.params.id, 'space_member.read'))) return;
  const r = await q(`SELECT sm.*, u.name, u.email, u.avatar_url, u.color
    FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=$1`, [req.params.id]);
  res.json(r.rows);
}));

// ── Space Members ─────────────────────────────────────────
app.post('/api/space-members', requireAuth, wrap(async (req, res) => {
  const { space_id, user_id, role } = req.body;
  if (!space_id || !user_id) return res.status(400).json({ error: 'space_id and user_id are required' });
  if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'space_member.manage'))) return;
  const validated = await validateSpaceRoleAssignment(q, req.user, space_id, role || 'member');
  if (!validated.ok) return res.status(403).json({ error: validated.error });
  const r = await q('INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), space_id, user_id, validated.role]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/space-members/:id', requireAuth, wrap(async (req, res) => {
  const rec = await getSpaceMemberRecord(q, req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, rec.space_id, 'space_member.manage'))) return;
  // rec.role = the target's CURRENT role, so a space admin can't demote a peer.
  const validated = await validateSpaceRoleAssignment(q, req.user, rec.space_id, req.body.role, rec.role);
  if (!validated.ok) return res.status(403).json({ error: validated.error });
  const r = await q('UPDATE space_members SET role=$1 WHERE id=$2 RETURNING *', [validated.role, req.params.id]);
  res.json(r.rows[0]);
}));

app.delete('/api/space-members/:id', requireAuth, wrap(async (req, res) => {
  const rec = await getSpaceMemberRecord(q, req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, rec.space_id, 'space_member.manage'))) return;
  // A space admin may not remove a peer space admin (may remove themselves).
  const allowed = await canRemoveSpaceMember(q, req.user, rec);
  if (!allowed.ok) return res.status(403).json({ error: allowed.error });
  await q('DELETE FROM space_members WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

