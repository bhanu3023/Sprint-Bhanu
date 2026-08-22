/**
 * The test world.
 *
 * Every run builds its OWN organization, users, space, sprint and issues, with
 * randomised keys, and destroys all of it afterwards. Nothing here reads or
 * writes a pre-existing row, so the suite cannot be affected by -- or damage --
 * ENG, PTM, or any real data. That is also what makes the db fingerprint
 * identical before and after a full run.
 *
 * Setup writes directly to postgres rather than through the API on purpose:
 *   - users and sessions must exist BEFORE any authenticated call can be made,
 *   - and setup failures should look like setup failures, not test failures.
 * Everything a test actually asserts on goes through HTTP.
 */
const crypto = require('crypto');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { pool, q } = require(path.join(ROOT, 'src', 'server', 'db'));
const { hashPassword } = require(path.join(ROOT, 'src', 'server', 'auth'));

const uid = () => crypto.randomUUID();
const tag = crypto.randomBytes(3).toString('hex').toUpperCase();   // e.g. "A9F31C"
const PASSWORD = 'Test-' + crypto.randomBytes(8).toString('hex');

// Space keys are short and must be unique org-wide; findSpaceKeyConflict is
// global, so the random tag also keeps parallel/repeat runs from colliding.
const SPACE_KEY = 'TQ' + tag.slice(0, 4);
const SPACE_KEY_2 = 'TR' + tag.slice(0, 4);

async function mkUser(orgId, name, email, role) {
  const id = 'usr-' + uid();
  await q(`INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active)
           VALUES($1,$2,$3,$4,'#6366f1',$5,$6,true)`,
    [id, orgId, name, email, role, hashPassword(PASSWORD)]);
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,NOW()+interval '2 hours')`,
    ['ses-' + uid(), id, token]);
  return { id, name, email, role, token, password: PASSWORD };
}

async function up() {
  const orgId = 'org-' + uid();
  await q(`INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)`,
    [orgId, 'Test Org ' + tag, 'test-org-' + tag.toLowerCase()]);

  // Org roles: owner and admin can do org-level things; member cannot.
  const owner = await mkUser(orgId, 'T Owner ' + tag, 't-owner-' + tag + '@test.invalid', 'owner');
  const admin = await mkUser(orgId, 'T Admin ' + tag, 't-admin-' + tag + '@test.invalid', 'admin');
  const manager = await mkUser(orgId, 'T Manager ' + tag, 't-manager-' + tag + '@test.invalid', 'member');
  const member = await mkUser(orgId, 'T Member ' + tag, 't-member-' + tag + '@test.invalid', 'member');
  const viewer = await mkUser(orgId, 'T Viewer ' + tag, 't-viewer-' + tag + '@test.invalid', 'member');
  // Belongs to the org but to NO space -- proves space scoping, not just auth.
  const outsider = await mkUser(orgId, 'T Outsider ' + tag, 't-outsider-' + tag + '@test.invalid', 'member');

  const spaceId = uid(), space2Id = uid();
  await q(`INSERT INTO spaces(id,org_id,name,key,description,space_type,visibility,owner_id)
           VALUES($1,$2,$3,$4,'suite fixture','scrum','team',$5)`,
    [spaceId, orgId, 'Test Space ' + tag, SPACE_KEY, owner.id]);
  await q(`INSERT INTO spaces(id,org_id,name,key,description,space_type,visibility,owner_id)
           VALUES($1,$2,$3,$4,'suite fixture 2','scrum','team',$5)`,
    [space2Id, orgId, 'Test Space 2 ' + tag, SPACE_KEY_2, owner.id]);

  const sm = (sid, uid_, role) => q(`INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,$4)`, [uid(), sid, uid_, role]);
  await sm(spaceId, owner.id, 'site_admin');
  await sm(spaceId, admin.id, 'site_admin');
  await sm(spaceId, manager.id, 'manager');
  await sm(spaceId, member.id, 'member');
  await sm(spaceId, viewer.id, 'viewer');
  await sm(space2Id, owner.id, 'site_admin');
  // the key-sequence concurrency test creates issues in space 2
  await sm(space2Id, admin.id, 'site_admin');
  await sm(space2Id, manager.id, 'manager');

  // end_date is deliberately in the FUTURE: startup.js runs a sprint
  // auto-completer, and a past end_date would let it mutate this sprint
  // mid-run, which would both break tests and drift the fingerprint.
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 1 * 864e5).toISOString().slice(0, 10);
  const sprintId = uid();
  await q(`INSERT INTO sprints(id,space_id,name,goal,start_date,end_date,status)
           VALUES($1,$2,$3,'fixture sprint',$4,$5,'planning')`,
    [sprintId, spaceId, 'Fixture Sprint ' + tag, soon, future]);

  return {
    tag, password: PASSWORD, orgId, spaceId, space2Id, sprintId,
    spaceKey: SPACE_KEY, spaceKey2: SPACE_KEY_2,
    users: { owner, admin, manager, member, viewer, outsider },
    future, soon
  };
}

/**
 * Teardown deletes by traversing FROM the test org, so anything a test created
 * inside this world is removed even if the test never told us about it. Order
 * is FK-safe, child-first. A leftover row would show up as fingerprint drift,
 * which run.js treats as a hard failure -- so this is verified, not hoped for.
 */
async function down(ctx, owned = {}) {
  if (!ctx || !ctx.orgId) return { deleted: 0, errors: [] };
  const org = ctx.orgId;
  const userIds = (await q('SELECT id FROM users WHERE org_id=$1', [org])).rows.map(r => r.id);

  // Spaces are found three ways, because org traversal ALONE is not enough:
  // POST /api/spaces does not populate org_id, so every space a test created
  // through the API has org_id NULL and is invisible to the org query. Missing
  // them made teardown delete nothing at all (the FK from spaces.owner_id back
  // to users then blocked the user and org deletes too).
  const found = new Set((await q('SELECT id FROM spaces WHERE org_id=$1', [org])).rows.map(r => r.id));
  if (userIds.length) {
    for (const r of (await q('SELECT id FROM spaces WHERE owner_id = ANY($1::varchar[])', [userIds])).rows) found.add(r.id);
  }
  for (const id of (owned.spaces || [])) found.add(id);
  const spaceIds = [...found];

  const issueIds = new Set();
  if (spaceIds.length) {
    for (const r of (await q('SELECT id FROM issues WHERE space_id = ANY($1::varchar[])', [spaceIds])).rows) issueIds.add(r.id);
  }
  for (const id of (owned.issues || [])) issueIds.add(id);

  // Errors are COLLECTED, never swallowed. A silent catch here once made
  // teardown look like it worked while it deleted nothing at all; the only
  // symptom was fingerprint drift, which is far too late to be useful.
  const errors = [];
  const del = async (sql, params) => {
    try { return (await q(sql, params)).rowCount || 0; }
    catch (e) { errors.push(sql.split(/\s+/).slice(0, 4).join(' ') + ' -> ' + e.message); return 0; }
  };
  let n = 0;

  const issueIdList = [...issueIds];
  if (issueIdList.length) {
    n += await del('DELETE FROM issue_field_values WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM issue_attachments WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM issue_history   WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM issue_links     WHERE source_id = ANY($1::varchar[]) OR target_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM issue_favorites WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM comments        WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    n += await del('DELETE FROM worklogs        WHERE issue_id = ANY($1::varchar[])', [issueIdList]);
    // subtasks reference parent_id within the same set, so clear the link first
    n += await del('UPDATE issues SET parent_id=NULL WHERE id = ANY($1::varchar[])', [issueIdList]);
  }
  if (spaceIds.length) {
    n += await del('DELETE FROM issues          WHERE space_id = ANY($1::varchar[])', [spaceIds]);
  }
  if (issueIdList.length) {
    n += await del('DELETE FROM issues          WHERE id = ANY($1::varchar[])', [issueIdList]);
  }
  if (spaceIds.length) {
    n += await del('DELETE FROM custom_fields   WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM saved_filters   WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM roadmap_items   WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM notifications   WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM audit_logs      WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM space_favorites WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM space_members   WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    n += await del('DELETE FROM sprints         WHERE space_id = ANY($1::varchar[])', [spaceIds]);
    if ((owned.sprints || []).length) n += await del('DELETE FROM sprints WHERE id = ANY($1::varchar[])', [owned.sprints]);
    n += await del('DELETE FROM spaces          WHERE id = ANY($1::varchar[])', [spaceIds]);
  }
  if (userIds.length) {
    // file_storage rows are owned by uploader, which is always a test user here.
    n += await del('DELETE FROM file_storage    WHERE uploaded_by = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM roadmap_colors  WHERE created_by = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM sessions        WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM notifications   WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM space_members   WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM worklogs        WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM comments        WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM audit_logs      WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM issue_favorites WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM space_favorites WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM saved_filters   WHERE user_id = ANY($1::varchar[])', [userIds]);
    n += await del('DELETE FROM users           WHERE id = ANY($1::varchar[])', [userIds]);
  }
  n += await del('DELETE FROM invitations WHERE org_id=$1', [org]);
  n += await del('DELETE FROM organizations WHERE id=$1', [org]);
  return { deleted: n, errors };
}

module.exports = { up, down, pool, q, PASSWORD };
