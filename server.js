require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const uid = () => crypto.randomUUID();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Custom fields live in a separate issue_field_values table — a custom field
// named e.g. "Story Points" would render right next to the real built-in
// story_points field in the drawer, but editing it writes to a completely
// different column that reports never read, silently diverging from what
// the user thinks they're updating. Block creating/renaming a custom field
// to reuse a built-in field's name (case/spacing-insensitive).
const RESERVED_FIELD_NAMES = new Set([
  'title', 'status', 'priority', 'assignee', 'assigneeid', 'reporter', 'reporterid',
  'sprint', 'sprintid', 'labels', 'storypoints', 'points', 'sp', 'startdate', 'duedate',
  'description', 'fixdescription', 'type', 'key', 'team', 'producttype'
]);
function normalizeFieldName(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isReservedFieldName(name) { return RESERVED_FIELD_NAMES.has(normalizeFieldName(name)); }

// Issue-link types come in inverse pairs: storing A "blocks" B is the same
// relationship as storing B "is blocked by" A. POST /api/links uses this to
// treat a pair's whole family as one link, so contradictory duplicates can't
// be created. Mirrors LINK_TYPES in app.js — keep the two in sync.
// `is_child_of`/`is_parent_of` are still accepted so pre-existing rows can be
// edited/removed, but app.js no longer offers them for new links (issue
// hierarchy belongs to issues.parent_id).
const LINK_TYPE_INVERSE = {
  blocks: 'is_blocked_by',
  is_blocked_by: 'blocks',
  clones: 'is_cloned_by',
  is_cloned_by: 'clones',
  duplicates: 'is_duplicated_by',
  is_duplicated_by: 'duplicates',
  relates_to: 'relates_to',
  is_child_of: 'is_parent_of',
  is_parent_of: 'is_child_of'
};

/** Reserved names are OK when updating an existing built-in registry row (not renaming). */
function reservedNameBlockedForUpdate(name, existing) {
  if (!isReservedFieldName(name)) return false;
  if (!existing) return true;
  if (existing.is_builtin) return false;
  return normalizeFieldName(existing.name) !== normalizeFieldName(name);
}

// Install nodemailer if not present
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch(e) {
  try {
    console.log('Installing nodemailer...');
    execSync('npm install nodemailer', { cwd: __dirname, stdio: 'inherit' });
    nodemailer = require('nodemailer');
  } catch(err) { console.error('Could not install nodemailer:', err.message); }
}

// Install multer if not present
let multer;
try {
  multer = require('multer');
} catch(e) {
  try {
    console.log('Installing multer...');
    execSync('npm install multer', { cwd: __dirname, stdio: 'inherit' });
    multer = require('multer');
    console.log('multer installed');
  } catch(err) { console.error('Could not install multer:', err.message); }
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname, {
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Serve uploaded files (auth + space membership required)
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function getFileLinkedSpaceIds(fileId) {
  const spaces = new Set();
  const attach = await q(
    `SELECT DISTINCT i.space_id FROM issue_attachments a
     JOIN issues i ON i.id = a.issue_id AND i.deleted_at IS NULL
     WHERE a.filename = $1`, [fileId]
  );
  attach.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  const pattern = '%/api/files/' + fileId + '%';
  const fromIssues = await q(
    `SELECT DISTINCT space_id FROM issues
     WHERE deleted_at IS NULL AND (description LIKE $1 OR fix_description LIKE $1)`, [pattern]
  );
  fromIssues.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  const fromComments = await q(
    `SELECT DISTINCT i.space_id FROM comments c
     JOIN issues i ON i.id = c.issue_id AND i.deleted_at IS NULL
     WHERE c.body LIKE $1`, [pattern]
  );
  fromComments.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  return Array.from(spaces);
}

async function denyUnlessCanAccessFile(user, res, fileId) {
  const spaceIds = await getFileLinkedSpaceIds(fileId);
  if (spaceIds.length) {
    for (let i = 0; i < spaceIds.length; i++) {
      if (await canActInSpace(q, user, spaceIds[i], 'attachment.read')) return true;
    }
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  const fr = await q('SELECT uploaded_by FROM file_storage WHERE id=$1', [fileId]);
  if (!fr.rows.length) {
    res.status(404).json({ error: 'File not found' });
    return false;
  }
  const userId = user.id || user.user_id;
  if (fr.rows[0].uploaded_by === userId || isOrgAdmin(user.role)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function sanitizeOrgRow(orgRow, admin) {
  if (!orgRow) return null;
  if (admin) return orgRow;
  const safe = Object.assign({}, orgRow);
  delete safe.email_settings;
  return safe;
}

app.use('/uploads', requireAuthFile, wrap(async (req, res, next) => {
  const filename = path.basename(decodeURIComponent(req.path || ''));
  if (!filename || filename === '/') return res.status(404).end();
  const attach = await q(
    `SELECT i.space_id FROM issue_attachments a
     JOIN issues i ON i.id = a.issue_id AND i.deleted_at IS NULL
     WHERE a.filename = $1 LIMIT 1`, [filename]
  );
  if (attach.rows[0]) {
    if (!(await denyUnlessCanAct(q, req.user, res, attach.rows[0].space_id, 'attachment.read'))) return;
    return next();
  }
  if (!isOrgAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}), express.static(uploadsDir));

// Multer storage config. No artificial size cap here — the practical ceiling is
// the upload routes below, which buffer the file in memory and store the bytes in
// file_storage.data (bytea, hard-capped at 1GB per value by Postgres).
const storage = multer ? multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uid() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
}) : null;
const upload = multer ? multer({ storage, limits: { fileSize: Infinity, files: Infinity } }) : null;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : new Pool({ host: 'sprint-postgres', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres' });
pool.on('error', (err) => { console.error('[pg pool error] Client lost connection:', err.message); });
const q = (text, params) => pool.query(text, params);
const {
  validateSchemaReadOnly, logProductTeamCombinationStatus, logDuplicateKeyWarning
} = require('./lib/schema-check');
const { runMigrations } = require('./lib/migrate');
const {
  buildDynamicUpdate, canActInSpace, denyUnlessCanAct, requireOrgAdmin, isOrgAdmin,
  UPDATE_WHITELIST, validateSpaceRoleAssignment, canRemoveSpaceMember, getSpaceMemberRole,
  getIssueSpaceId, getSprintSpaceId, getCommentIssueSpaceId,
  getCustomFieldSpaceId, getFilterSpaceId, getSpaceMemberRecord, getMemberSpaceIds, getVisibleSpaceIds, pickAllowed
} = require('./lib/permissions');
const { seedBuiltinIssueFields } = require('./lib/builtin-issue-fields');
const { startRetentionSweeper, retentionDays, purgeIssueRows: purgeIssueCascade } = require('./lib/retention');
// One shared cascade for every issue purge — manual, bulk, and the retention sweep.
const purgeIssueRows = (id) => purgeIssueCascade(q, id);
const https = require('https');

// ── Microsoft OAuth2 state store (CSRF) ───────────────────
const oauthStates = new Map(); // state → { createdAt }
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
}, 10 * 60 * 1000);

// ── Bulk Load ─────────────────────────────────────────────
app.get('/api/data', requireAuth, wrap(async (req, res) => {
  const sid = req.query.space_id;
  const userId = req.user.user_id;
  const userRole = req.user.role;
  const isAdmin = userRole === 'admin' || userRole === 'owner';

  const [org, users, allSpaces, allSm, sf, issueFavs] = await Promise.all([
    q('SELECT * FROM organizations LIMIT 1'),
    q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users'),
    q('SELECT * FROM spaces WHERE is_archived=false'),
    q('SELECT * FROM space_members'),
    q('SELECT * FROM space_favorites'),
    q('SELECT issue_id, created_at FROM issue_favorites WHERE user_id=$1 ORDER BY created_at DESC', [userId])
  ]);

  // Members only see spaces they are assigned to
  const myMemberships = allSm.rows.filter(function(m) { return m.user_id === userId; });
  const mySpaceIds = myMemberships.map(function(m) { return m.space_id; });
  const spaces = isAdmin ? allSpaces.rows : allSpaces.rows.filter(function(s) { return mySpaceIds.includes(s.id); });
  // Admins see all space_members; members only see memberships for their spaces
  const space_members = isAdmin ? allSm.rows : allSm.rows.filter(function(m) { return mySpaceIds.includes(m.space_id); });

  // Members only see users in their visible spaces (admins unchanged)
  let scopedUsers = users.rows;
  if (!isAdmin) {
    const visibleUserIds = new Set([userId]);
    space_members.forEach(function (m) { visibleUserIds.add(m.user_id); });
    scopedUsers = users.rows.filter(function (u) { return visibleUserIds.has(u.id); });
  }

  // Determine which space IDs to load issues/sprints for
  const visibleSpaceIds = spaces.map(function(s) { return s.id; });

  const sf1 = sid ? ' WHERE space_id=$1' : '';
  const p = sid ? [sid] : [];
  const queries = [
    q('SELECT * FROM sprints' + (sf1 ? sf1 + ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'), p),
    q('SELECT id,space_id,sprint_id,parent_id,key,title,type,status,priority,assignee_id,reporter_id,story_points,labels,position,start_date,due_date,original_estimate,time_spent,team,product_type,created_at,updated_at FROM issues' + (sf1 ? sf1 + ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'), p),
    q('SELECT * FROM custom_fields' + sf1, p),
    q('SELECT * FROM saved_filters' + sf1, p),
    q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]),
  ];
  // Only load issue_field_values when scoped to a space (avoids full-table scan on initial load)
  if (sid) queries.push(q('SELECT * FROM issue_field_values WHERE issue_id IN (SELECT id FROM issues WHERE space_id=$1 AND deleted_at IS NULL)', p));

  const [sprints, issues, cf, filters, notifs, ifv] = await Promise.all(queries);

  // Filter issues/sprints to only non-archived visible spaces (everyone, including admins)
  let filteredIssues = issues.rows.filter(function(i) { return visibleSpaceIds.includes(i.space_id); });
  const filteredSprints = sprints.rows.filter(function(s) { return visibleSpaceIds.includes(s.space_id); });

  // Always include the user's starred issues in the cache (even when scoped to one space)
  const favIds = issueFavs.rows.map(function (f) { return f.issue_id; });
  if (favIds.length) {
    const loadedIds = new Set(filteredIssues.map(function (i) { return i.id; }));
    const missingFavIds = favIds.filter(function (id) { return !loadedIds.has(id); });
    if (missingFavIds.length) {
      const extraIssues = await q(
        `SELECT id,space_id,sprint_id,parent_id,key,title,type,status,priority,assignee_id,reporter_id,story_points,labels,position,start_date,due_date,original_estimate,time_spent,team,product_type,created_at,updated_at
         FROM issues WHERE deleted_at IS NULL AND id = ANY($1::varchar[])`,
        [missingFavIds]
      );
      extraIssues.rows.forEach(function (i) {
        if (visibleSpaceIds.includes(i.space_id) && !loadedIds.has(i.id)) {
          filteredIssues.push(i);
          loadedIds.add(i.id);
        }
      });
    }
  }

  res.json({
    org: sanitizeOrgRow(org.rows[0] || null, isAdmin), users: scopedUsers, spaces: spaces,
    space_members: space_members, space_favorites: sf.rows,
    issue_favorites: issueFavs.rows,
    sprints: filteredSprints,
    issues: filteredIssues, worklogs: [], comments: [],
    custom_fields: cf.rows, saved_filters: filters.rows, notifications: notifs.rows,
    issue_field_values: ifv ? ifv.rows : [],
    // So delete dialogs can state the real retention window instead of hardcoding "30 days".
    bin_retention_days: retentionDays()
  });
}));

// ── My Issues (fast, cross-space) ────────────────────────
app.get('/api/my-issues', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id;
  const admin = isOrgAdmin(req.user.role);
  const spaceIds = admin ? null : await getVisibleSpaceIds(q, req.user);
  if (!admin && (!spaceIds || !spaceIds.length)) {
    return res.json({ assigned: [], reported: [], recent: [] });
  }
  const scopeSql = admin ? '' : ' AND i.space_id = ANY($2)';
  const scopeParams = admin ? [userId] : [userId, spaceIds];
  const [assigned, reported, recent] = await Promise.all([
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.assignee_id = $1 AND i.deleted_at IS NULL${scopeSql}
       ORDER BY i.updated_at DESC`, scopeParams),
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.reporter_id = $1 AND i.deleted_at IS NULL${scopeSql}
       ORDER BY i.updated_at DESC`, scopeParams),
    q(`SELECT DISTINCT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       LEFT JOIN comments c ON c.issue_id = i.id AND c.user_id = $1
       WHERE i.deleted_at IS NULL
         AND (i.assignee_id = $1 OR i.reporter_id = $1 OR c.id IS NOT NULL)${scopeSql}
       ORDER BY i.updated_at DESC LIMIT 20`, scopeParams)
  ]);
  res.json({ assigned: assigned.rows, reported: reported.rows, recent: recent.rows });
}));

// Activity in spaces the current user belongs to (dashboard — last 24h, includes self)
app.get('/api/dashboard/activity', requireAuth, wrap(async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const spaceIds = await getMemberSpaceIds(q, req.user);
  if (!spaceIds.length) return res.json([]);

  const [created, history] = await Promise.all([
    q(`SELECT i.id AS issue_id, i.reporter_id AS user_id, i.created_at,
              u.name AS user_name, u.color AS user_color,
              i.key AS issue_key, i.title AS issue_title, i.space_id,
              s.key AS project_key, s.name AS space_name,
              'created' AS activity_type, NULL AS field_name, NULL AS old_value, NULL AS new_value
       FROM issues i
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = i.reporter_id
       WHERE i.deleted_at IS NULL
         AND i.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
         AND i.space_id = ANY($1)
       ORDER BY i.created_at DESC
       LIMIT $3`, [spaceIds, hours, limit]),
    q(`SELECT h.issue_id, h.user_id, h.field_name, h.old_value, h.new_value, h.created_at,
              u.name AS user_name, u.color AS user_color,
              i.key AS issue_key, i.title AS issue_title, i.space_id,
              s.key AS project_key, s.name AS space_name,
              'update' AS activity_type
       FROM issue_history h
       JOIN issues i ON i.id = h.issue_id AND i.deleted_at IS NULL
       JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
         AND i.space_id = ANY($1)
         AND h.field_name NOT IN ('restored', 'created')
       ORDER BY h.created_at DESC
       LIMIT $3`, [spaceIds, hours, limit])
  ]);

  const combined = created.rows.concat(history.rows)
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
    .slice(0, limit);
  res.json(combined);
}));

// ── Organization ─────────────────────────────────────────
app.get('/api/org', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT * FROM organizations LIMIT 1');
  res.json(sanitizeOrgRow(r.rows[0] || null, isOrgAdmin(req.user.role)));
}));

app.put('/api/org', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can update organization settings' });
  const { name, slug } = req.body;
  const r = await q('UPDATE organizations SET name=COALESCE($1,name), slug=COALESCE($2,slug) WHERE id=(SELECT id FROM organizations LIMIT 1) RETURNING *',
    [name || null, slug || null]);
  res.json(r.rows[0]);
}));

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

app.post('/api/spaces', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can create a space.')) return;
  const { name, key, description, icon, color, space_type, visibility, owner_id } = req.body;
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
  const { id, name, key, icon, color } = req.body;
  if (!id || !name || !key) return res.status(400).json({ error: 'id, name, key required' });
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

// ── Sprints ───────────────────────────────────────────────
app.get('/api/sprints', requireAuth, wrap(async (req, res) => {
  const spaceId = req.query.space_id;
  if (!spaceId) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.read'))) return;
  const r = await q('SELECT * FROM sprints WHERE space_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [spaceId]);
  res.json(r.rows);
}));

app.post('/api/sprints', requireAuth, wrap(async (req, res) => {
  const { space_id, name, goal, start_date, end_date, developer_ids, qa_ids, public_holidays, developer_leaves } = req.body;
  if (!space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'sprint.manage'))) return;
  const r = await q('INSERT INTO sprints(id,space_id,name,goal,start_date,end_date,developer_ids,qa_ids,public_holidays,developer_leaves) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *',
    [uid(), space_id, name, goal, start_date || null, end_date || null, developer_ids || [], qa_ids || [], public_holidays || [], JSON.stringify(developer_leaves || {})]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/sprints/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getSprintSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.manage'))) return;
  const upd = buildDynamicUpdate('sprints', req.body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE sprints SET ${upd.set} WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/sprints/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getSprintSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'sprint.manage'))) return;
  // Soft delete so the sprint lands in Deleted Items and an org admin can restore
  // it. Its issues are still detached to the backlog (unchanged behaviour) — a
  // binned sprint must not keep tickets out of the backlog — but former_sprint_id
  // remembers where they came from so a restore can put them back.
  await q('UPDATE issues SET sprint_id=NULL, former_sprint_id=$1 WHERE sprint_id=$1', [req.params.id]);
  await q('UPDATE sprints SET deleted_at=NOW(), deleted_by=$2 WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/sprints/:id/start', requireAuth, wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'sprint.manage'))) return;
  const r = await q("UPDATE sprints SET status='active' WHERE id=$1 RETURNING *", [req.params.id]);
  const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [sprint.space_id])).rows[0];
  const sprintLink = spaceRow ? '/space/' + encodeURIComponent(spaceRow.key) + '/board' : null;
  const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
  members.rows.forEach(function(m) {
    createNotif({ user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_started',
      title: sprint.name + ' has started',
      body: 'Sprint is now active. Time to get to work!',
      link: sprintLink });
  });
  res.json(r.rows[0]);
}));

app.post('/api/sprints/:id/complete', requireAuth, wrap(async (req, res) => {
  const sid = req.params.id;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1 AND deleted_at IS NULL', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'sprint.manage'))) return;
  const done = await q("SELECT COALESCE(SUM(story_points),0)::int AS pts FROM issues WHERE sprint_id=$1 AND status='Done'", [sid]);
  await q("UPDATE sprints SET status='completed',velocity=$2 WHERE id=$1", [sid, done.rows[0].pts]);
  // Capture spillover issues before moving them to backlog
  const spilloverIssues = (await q(
    "SELECT id FROM issues WHERE sprint_id=$1 AND status!='Done' AND deleted_at IS NULL", [sid]
  )).rows;
  await q("UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1 AND status!='Done'", [sid]);
  // Record this as a distinct 'spillover' history entry (not 'sprint_id') so
  // it can't be confused with a manual mid-sprint removal — PUT /api/issues/:id
  // already logs field_name='sprint_id' for ANY sprint change (drag to
  // backlog, editing the Sprint dropdown, etc.), and both the Spillover and
  // Scope Change reports read issue_history by field_name. Without a
  // separate marker, a sprint's genuine end-of-sprint spillover and any
  // manual backlog move made earlier in that same sprint were
  // indistinguishable, so manually-removed tickets were showing up as
  // "spillover" instead of under Scope Change's "Removed".
  for (const issue of spilloverIssues) {
    q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
       VALUES($1,$2,$3,'spillover',$4,NULL)`,
      [uid(), issue.id, req.user ? req.user.id : null, sid]).catch(() => {});
  }
  const r = await q('SELECT * FROM sprints WHERE id=$1', [sid]);
  // Notify all space members
  if (sprint) {
    const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [sprint.space_id])).rows[0];
    const sprintLink = spaceRow ? '/space/' + encodeURIComponent(spaceRow.key) + '/board' : null;
    const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
    members.rows.forEach(function(m) {
      createNotif({ user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_completed',
        title: sprint.name + ' has been completed',
        body: 'Sprint completed with ' + done.rows[0].pts + ' story points.',
        link: sprintLink });
    });
  }
  res.json(r.rows[0]);
}));

// ── Issues ────────────────────────────────────────────────
app.get('/api/issues', requireAuth, wrap(async (req, res) => {
  const { space_id, sprint_id, type, status, assignee_id, priority, search } = req.query;
  if (space_id) {
    if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'issue.read'))) return;
  } else if (!isOrgAdmin(req.user.role)) {
    return res.status(400).json({ error: 'space_id is required' });
  }
  // Binned (soft-deleted) issues must never appear in a normal list. Every other
  // read path already filters this; this one did not, so deleted tickets still
  // showed up in All Work and anything else backed by GET /api/issues.
  let where = ['i.deleted_at IS NULL'], params = [], n = 1;
  const add = (col, val) => { where.push(`${col}=$${n++}`); params.push(val); };
  if (space_id) add('i.space_id', space_id);
  else if (!isOrgAdmin(req.user.role)) {
    where.push(`i.space_id IN (SELECT space_id FROM space_members WHERE user_id=$${n++})`);
    params.push(req.user.id);
  }
  if (sprint_id) {
    if (sprint_id === 'null') where.push('i.sprint_id IS NULL');
    else add('i.sprint_id', sprint_id);
  }
  if (type) add('i.type', type);
  if (status) add('i.status', status);
  if (assignee_id) add('i.assignee_id', assignee_id);
  if (priority) add('i.priority', priority);
  if (search) { where.push(`(i.title ILIKE $${n} OR i.key ILIKE $${n})`); params.push(`%${search}%`); n++; }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q(`SELECT i.*,
      a.name AS assignee_name, a.color AS assignee_color,
      rep.name AS reporter_name, rep.color AS reporter_color,
      s.key AS project_key, p.key AS parent_key, p.title AS parent_title
    FROM issues i
    LEFT JOIN users a ON a.id=i.assignee_id
    LEFT JOIN users rep ON rep.id=i.reporter_id
    LEFT JOIN spaces s ON s.id=i.space_id
    LEFT JOIN issues p ON p.id=i.parent_id${w}
    ORDER BY i.key DESC`, params);
  res.json(r.rows);
}));

// Delete bin — org admin sees every space; a space admin sees only the spaces
// they administer (read-only: restore and permanent delete below are admin-only).
// `can_restore` tells the UI whether to render the action buttons at all, so the
// client never has to re-derive the rule.
app.get('/api/issues/deleted', requireAuth, wrap(async (req, res) => {
  const orgAdmin = isOrgAdmin(req.user.role);
  let scopeIds = null;
  if (!orgAdmin) {
    const userId = req.user.id || req.user.user_id;
    const rows = (await q(
      `SELECT space_id FROM space_members WHERE user_id=$1 AND role IN ('site_admin','manager','owner','admin')`,
      [userId]
    )).rows;
    scopeIds = rows.map(function (r) { return r.space_id; });
    if (!scopeIds.length) {
      return res.status(403).json({ error: 'Only a space admin can view the deleted items bin.' });
    }
  }
  // Typed bin: tickets, sprints, and archived spaces in one list. `entity_type`
  // tells the UI which restore/purge route to call, so adding a future type only
  // means adding a branch here and in the two handlers below.
  const params = orgAdmin ? [] : [scopeIds];
  const scope = orgAdmin ? '' : ' AND i.space_id = ANY($1::varchar[])';
  // The counts drive the "here is exactly what a permanent delete destroys" list in
  // the confirm dialog. Cheap correlated subqueries — this list is capped at 500.
  const tickets = await q(`SELECT i.id, i.key AS label, i.key, i.title, i.status, i.type,
      i.space_id, i.deleted_at, i.deleted_by,
      s.name AS space_name, u.name AS deleted_by_name,
      a.name AS assignee_name,
      (SELECT COUNT(*)::int FROM comments          c  WHERE c.issue_id  = i.id) AS comment_count,
      (SELECT COUNT(*)::int FROM worklogs          w  WHERE w.issue_id  = i.id) AS worklog_count,
      (SELECT COALESCE(SUM(w.time_spent),0)::int FROM worklogs w WHERE w.issue_id = i.id) AS logged_minutes,
      (SELECT COUNT(*)::int FROM issue_attachments at WHERE at.issue_id = i.id) AS attachment_count,
      (SELECT COUNT(*)::int FROM issues            ch WHERE ch.parent_id = i.id) AS subtask_count
    FROM issues i
    LEFT JOIN spaces s ON s.id = i.space_id
    LEFT JOIN users u ON u.id = i.deleted_by
    LEFT JOIN users a ON a.id = i.assignee_id
    WHERE i.deleted_at IS NOT NULL` + scope + `
    ORDER BY i.deleted_at DESC LIMIT 500`, params);

  // restorable_issues = tickets that would come back if this sprint were restored:
  // the ones still in the backlog carrying its breadcrumb. Shown in the bin so an
  // admin knows what a restore will do before clicking it.
  const sprints = await q(`SELECT sp.id, sp.name AS label, sp.goal AS title, sp.status, sp.space_id,
      sp.deleted_at, sp.deleted_by, s.name AS space_name, u.name AS deleted_by_name,
      (SELECT COUNT(*)::int FROM issues i2
        WHERE i2.former_sprint_id = sp.id AND i2.sprint_id IS NULL AND i2.deleted_at IS NULL
      ) AS restorable_issues
    FROM sprints sp
    LEFT JOIN spaces s ON s.id = sp.space_id
    LEFT JOIN users u ON u.id = sp.deleted_by
    WHERE sp.deleted_at IS NOT NULL` + (orgAdmin ? '' : ' AND sp.space_id = ANY($1::varchar[])') + `
    ORDER BY sp.deleted_at DESC LIMIT 500`, params);

  // Spaces are archived rather than tombstoned (no deleted_at column on spaces),
  // so is_archived IS the bin state for them. updated_at is the closest thing to
  // a deletion timestamp. Org admin only — a space admin has no business seeing
  // other spaces, and cannot delete a space anyway.
  const spaces = orgAdmin
    ? await q(`SELECT sp.id, sp.key AS label, sp.name AS title, 'archived' AS status, sp.id AS space_id,
        sp.updated_at AS deleted_at, NULL AS deleted_by, sp.name AS space_name, NULL AS deleted_by_name
      FROM spaces sp WHERE sp.is_archived = true ORDER BY sp.updated_at DESC LIMIT 200`)
    : { rows: [] };

  // days_left = how long before the retention sweeper purges it for good. Archived
  // spaces are never auto-purged, so they get null and the UI shows nothing.
  const days = retentionDays();
  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null;
    const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86400000;
    return Math.max(0, Math.ceil(days - elapsed));
  };
  const tag = (rows, type) => rows.map(function (r) {
    return Object.assign({
      entity_type: type,
      days_left: type === 'space' ? null : daysLeft(r.deleted_at)
    }, r);
  });
  const items = tag(tickets.rows, 'ticket')
    .concat(tag(sprints.rows, 'sprint'))
    .concat(tag(spaces.rows, 'space'))
    .sort(function (a, b) { return new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0); });

  res.json({ can_restore: orgAdmin, retention_days: days, items: items });
}));

app.post('/api/issues/:id/restore', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can restore deleted issues.')) return;
  const row = (await q('SELECT id, key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Deleted issue not found' });
  // Restores in place: space_id/status were never changed by the soft delete, so
  // clearing the tombstone returns the issue to its original space and state.
  await q('UPDATE issues SET deleted_at=NULL, deleted_by=NULL, updated_at=NOW() WHERE id=$1', [req.params.id]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'restored',NULL,$4)`,
    [uid(), req.params.id, req.user.id, row.key]).catch(() => {});
  res.json({ ok: true });
}));

// ── Generic bin restore / purge (org admin only) ─────────────
// One route per verb, typed by :type, so the UI calls the same pair for every
// kind of binned thing. The issue-specific routes above are kept for
// compatibility with anything already calling them.
app.post('/api/bin/:type/:id/restore', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can restore deleted items.')) return;
  const { type, id } = req.params;
  if (type === 'ticket') {
    const row = (await q('SELECT key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'That ticket is not in the bin.' });
    await q('UPDATE issues SET deleted_at=NULL, deleted_by=NULL, updated_at=NOW() WHERE id=$1', [id]);
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
      VALUES($1,$2,$3,'restored',NULL,$4)`, [uid(), id, req.user.id, row.key]).catch(() => {});
    return res.json({ ok: true, label: row.key });
  }
  if (type === 'sprint') {
    const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'That sprint is not in the bin.' });
    await q('UPDATE sprints SET deleted_at=NULL, deleted_by=NULL WHERE id=$1', [id]);
    // Refill it with the tickets the delete pushed to the backlog — but only the
    // ones still sitting there. `sprint_id IS NULL` is the whole safety rule: if
    // someone re-planned a ticket into another sprint meanwhile, that decision
    // wins and the restore leaves it alone.
    const refilled = await q(`UPDATE issues SET sprint_id=$1, former_sprint_id=NULL, updated_at=NOW()
      WHERE former_sprint_id=$1 AND sprint_id IS NULL
      RETURNING id, key, deleted_at`, [id]);
    const live = refilled.rows.filter(function (r) { return !r.deleted_at; });
    live.forEach(function (r) {
      q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
         VALUES($1,$2,$3,'sprint_id',NULL,$4)`, [uid(), r.id, req.user.id, String(id)]).catch(() => {});
    });
    // Anything left pointing at this sprint was moved elsewhere by hand; drop the
    // breadcrumb so a future delete/restore cycle starts clean.
    await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [id]);
    return res.json({ ok: true, label: row.name, restored_issues: live.length });
  }
  if (type === 'space') {
    const row = (await q('SELECT name FROM spaces WHERE id=$1 AND is_archived=true', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'That space is not archived.' });
    await q('UPDATE spaces SET is_archived=false, updated_at=NOW() WHERE id=$1', [id]);
    return res.json({ ok: true, label: row.name });
  }
  res.status(400).json({ error: 'Unknown item type: ' + type });
}));

// Bulk permanent delete — the UI's multi-select "Delete forever (N)" action.
// Body: { items: [{ type, id }, ...] }. Spaces are rejected up front (same reason
// as the single-item route) rather than silently skipped, so the count the admin
// confirmed is the count that actually happens.
app.post('/api/bin/purge', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete items.')) return;
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
  if (!items || !items.length) return res.status(400).json({ error: 'Nothing selected to delete.' });
  if (items.length > 500) return res.status(400).json({ error: 'Too many items in one request (max 500).' });
  if (items.some(function (it) { return it && it.type === 'space'; })) {
    return res.status(400).json({ error: 'Spaces cannot be permanently deleted. Deselect the archived space(s) and try again.' });
  }
  const bad = items.find(function (it) { return !it || !it.id || (it.type !== 'ticket' && it.type !== 'sprint'); });
  if (bad) return res.status(400).json({ error: 'Unsupported item in selection.' });

  const purged = [];
  const skipped = [];
  for (const it of items) {
    if (it.type === 'sprint') {
      const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [it.id])).rows[0];
      if (!row) { skipped.push(it.id); continue; }
      await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [it.id]);
      await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [it.id]);
      await q('DELETE FROM sprints WHERE id=$1', [it.id]);
      purged.push(row.name);
    } else {
      const row = (await q('SELECT key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [it.id])).rows[0];
      if (!row) { skipped.push(it.id); continue; }
      await purgeIssueRows(it.id);
      purged.push(row.key);
    }
  }
  res.json({ ok: true, purged: purged.length, skipped: skipped.length, labels: purged });
}));

app.delete('/api/bin/:type/:id', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete items.')) return;
  const { type, id } = req.params;
  if (type === 'ticket') {
    return purgeIssue(id, req, res);
  }
  if (type === 'sprint') {
    const row = (await q('SELECT name FROM sprints WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Sprint is not in the bin — delete it first.' });
    // Detach anything still pointing at it — including the former_sprint_id
    // breadcrumb, which would otherwise dangle at a sprint id that no longer exists.
    await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [id]);
    await q('UPDATE issues SET former_sprint_id=NULL WHERE former_sprint_id=$1', [id]);
    await q('DELETE FROM sprints WHERE id=$1', [id]);
    return res.json({ ok: true, label: row.name });
  }
  if (type === 'space') {
    // Deliberately not implemented: purging a space would cascade through every
    // issue, sprint, field and comment it owns. Archive is the terminal state.
    return res.status(400).json({
      error: 'Spaces cannot be permanently deleted from here. Restore it, or leave it archived.'
    });
  }
  res.status(400).json({ error: 'Unknown item type: ' + type });
}));

// Shared by DELETE /api/bin/ticket/:id and the legacy /api/issues/:id/permanent.
// Only ever purges something already in the bin, so one call can't destroy a live
// issue. Callers must have already checked org-admin.
async function purgeIssue(id, req, res) {
  const row = (await q('SELECT id, key FROM issues WHERE id=$1 AND deleted_at IS NOT NULL', [id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Issue is not in the bin — restore or delete it first.' });
  await purgeIssueRows(id);
  return res.json({ ok: true, key: row.key, label: row.key });
}

app.delete('/api/issues/:id/permanent', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can permanently delete issues.')) return;
  return purgeIssue(req.params.id, req, res);
}));

app.get('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const param = req.params.id;
  const issue = (await q(`SELECT i.*,
      a.name AS assignee_name, a.color AS assignee_color,
      rep.name AS reporter_name, rep.color AS reporter_color,
      s.key AS project_key, s.name AS space_name,
      p.key AS parent_key, p.title AS parent_title, p.type AS parent_type
    FROM issues i
    LEFT JOIN users a ON a.id=i.assignee_id
    LEFT JOIN users rep ON rep.id=i.reporter_id
    LEFT JOIN spaces s ON s.id=i.space_id
    LEFT JOIN issues p ON p.id=i.parent_id
    WHERE (i.id=$1 OR UPPER(i.key)=UPPER($1)) AND i.deleted_at IS NULL`, [param])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issue.space_id, 'issue.read'))) return;
  const issueId = issue.id;
  const [worklogs, comments, links, subtasks, cfv, history, attachments] = await Promise.all([
    q(`SELECT w.*, u.name AS user_name, u.color AS user_color FROM worklogs w
      LEFT JOIN users u ON u.id=w.user_id WHERE w.issue_id=$1 ORDER BY w.created_at DESC`, [issueId]),
    q(`SELECT c.*, u.name AS user_name, u.avatar_url, u.color AS user_color
      FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.issue_id=$1 ORDER BY c.created_at`, [issueId]),
    // Inner join, not LEFT: a link whose counterpart is soft-deleted (or gone)
    // used to still render as a row that 404s when clicked, because
    // GET /api/issues/:id filters deleted_at but this query didn't. Links are
    // intentionally left in the table so restoring the issue restores them.
    q(`SELECT l.*, t.key AS target_key, t.title AS target_title, t.status AS target_status, t.type AS target_type
      FROM issue_links l
      JOIN issues t ON t.id = CASE WHEN l.source_id=$1 THEN l.target_id ELSE l.source_id END
      WHERE (l.source_id=$1 OR l.target_id=$1) AND t.deleted_at IS NULL`, [issueId]),
    q(`SELECT id, key, title, status, type, priority, assignee_id, story_points
      FROM issues WHERE parent_id=$1 ORDER BY position, created_at`, [issueId]),
    q(`SELECT v.*, f.name AS field_name, f.field_type
      FROM issue_field_values v JOIN custom_fields f ON f.id=v.field_id WHERE v.issue_id=$1`, [issueId]),
    q(`SELECT h.*, u.name AS user_name, u.color AS user_color
      FROM issue_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.issue_id=$1 ORDER BY h.created_at DESC`, [issueId]),
    q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
      LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [issueId])
  ]);
  issue.worklogs = worklogs.rows;
  issue.comments = comments.rows;
  issue.links = links.rows;
  issue.subtasks = subtasks.rows;
  issue.custom_field_values = cfv.rows;
  issue.history = history.rows;
  issue.attachments = attachments.rows;
  res.json(issue);
}));

app.post('/api/issues', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, b.space_id, 'issue.create'))) return;
  const spaceKeyRow = (await q('SELECT key FROM spaces WHERE id=$1', [b.space_id])).rows[0];
  if (!spaceKeyRow) return res.status(400).json({ error: 'Invalid space_id' });
  const spaceKey = spaceKeyRow.key;
  const maxRow = (await q(
    "SELECT COALESCE(MAX(CAST(SPLIT_PART(key, '-', 2) AS INTEGER)), 0) AS mx FROM issues WHERE space_id=$1 AND key ~ ($2 || '-[0-9]+$')",
    [b.space_id, spaceKey]
  )).rows[0];
  const key = `${spaceKey}-${maxRow.mx + 1}`;
  const id = uid();
  const r = await q(`INSERT INTO issues(id,key,space_id,sprint_id,parent_id,title,description,type,priority,
      assignee_id,reporter_id,story_points,labels,start_date,due_date,original_estimate,team,product_type)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [id, key, b.space_id, b.sprint_id || null, b.parent_id || null, b.title, b.description || null,
     b.type || 'task', b.priority || 'medium', b.assignee_id || null, b.reporter_id || null,
     b.story_points || b.points || null, b.labels || null, b.start_date || null, b.due_date || null,
     b.original_estimate || null, b.team || null, b.product_type || null]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'created',NULL,$4)`, [uid(), id, req.user.id, key]).catch(function () {});
  res.status(201).json(r.rows[0]);
}));

app.put('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.update'))) return;
  const upd = buildDynamicUpdate('issues', req.body, 2);
  if (!upd) {
    return res.json((await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0]);
  }
  const keys = upd.keys;
  const oldRow = (await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0];
  const r = await q(`UPDATE issues SET ${upd.set},updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  const newRow = r.rows[0];
  // Same rule as PUT /:id/move — deciding this ticket's sprint by hand retires the
  // former_sprint_id breadcrumb, so restoring its old deleted sprint won't yank it back.
  if (keys.includes('sprint_id')) {
    await q('UPDATE issues SET former_sprint_id=NULL WHERE id=$1', [req.params.id]).catch(() => {});
  }
  const TRACKED = ['title','status','priority','assignee_id','reporter_id','sprint_id','labels','story_points','start_date','due_date','description','fix_description'];
  if (oldRow) {
    for (const key of keys) {
      if (!TRACKED.includes(key)) continue;
      const oldVal = oldRow[key] != null ? String(oldRow[key]) : null;
      const newVal = req.body[key] != null ? String(req.body[key]) : null;
      if (oldVal !== newVal) {
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
          [uid(), req.params.id, req.user.id, key, oldVal, newVal]).catch(()=>{});
      }
    }
    const actor = req.user.id;
    const issueKey = oldRow.key || req.params.id;
    const spaceId = oldRow.space_id;
    const link = '/?issue=' + encodeURIComponent(issueKey);
    // Notify new assignee when assignee_id changes
    if (keys.includes('assignee_id') && req.body.assignee_id && req.body.assignee_id !== oldRow.assignee_id) {
      const newAssignee = req.body.assignee_id;
      if (newAssignee !== actor) {
        createNotif({ user_id: newAssignee, space_id: spaceId, type: 'issue_assigned',
          title: 'You were assigned to ' + issueKey,
          body: oldRow.title, link });
      }
    }
    // Notify assignee when status changes
    if (keys.includes('status') && req.body.status !== oldRow.status) {
      const assignee = newRow.assignee_id;
      if (assignee && assignee !== actor) {
        createNotif({ user_id: assignee, space_id: spaceId, type: 'status_changed',
          title: issueKey + ' status changed to ' + req.body.status,
          body: oldRow.title, link });
      }
    }
    // Notify assignee when priority changes
    if (keys.includes('priority') && req.body.priority !== oldRow.priority) {
      const assignee = newRow.assignee_id;
      if (assignee && assignee !== actor) {
        createNotif({ user_id: assignee, space_id: spaceId, type: 'priority_changed',
          title: issueKey + ' priority changed to ' + req.body.priority,
          body: oldRow.title, link });
      }
    }
  }
  res.json(newRow);
}));

app.delete('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const issue = (await q('SELECT id, space_id, key FROM issues WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issue.space_id, 'issue.delete'))) return;
  const id = req.params.id;
  await q(`UPDATE issues SET deleted_at=NOW(), deleted_by=$2, updated_at=NOW()
    WHERE (id=$1 OR parent_id=$1) AND deleted_at IS NULL`, [id, req.user.id]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'deleted',NULL,$4)`,
    [uid(), id, req.user.id, issue.key]).catch(() => {});
  res.json({ ok: true });
}));

app.post('/api/issues/bulk', requireAuth, wrap(async (req, res) => {
  const { ids, updates } = req.body;
  if (!ids || !ids.length) return res.json({ ok: true, updated: 0 });
  const picked = pickAllowed(updates || {}, UPDATE_WHITELIST.issues);
  const keys = Object.keys(picked);
  if (!keys.length) return res.json({ ok: true, updated: 0 });
  const issueRows = (await q('SELECT id, space_id FROM issues WHERE id = ANY($1) AND deleted_at IS NULL', [ids])).rows;
  if (issueRows.length !== ids.length) return res.status(404).json({ error: 'Issue not found' });
  const bulkSpaceIds = Array.from(new Set(issueRows.map(function (row) { return row.space_id; })));
  for (let i = 0; i < bulkSpaceIds.length; i++) {
    if (!(await denyUnlessCanAct(q, req.user, res, bulkSpaceIds[i], 'issue.bulk'))) return;
  }
  const upd = buildDynamicUpdate('issues', picked, 2);
  const r = await q(`UPDATE issues SET ${upd.set},updated_at=NOW() WHERE id=ANY($1) RETURNING *`, [ids, ...upd.vals]);
  // A bulk sprint move is still a deliberate move — retire the breadcrumb (see PUT /api/issues/:id).
  if (keys.includes('sprint_id')) {
    await q('UPDATE issues SET former_sprint_id=NULL WHERE id=ANY($1)', [ids]).catch(() => {});
  }
  res.json({ ok: true, updated: r.rowCount, issues: r.rows });
}));

// ── Comments ──────────────────────────────────────────────
app.post('/api/comments', requireAuth, wrap(async (req, res) => {
  const { issue_id, body, mentioned_user_ids } = req.body;
  if (!issue_id || !body) return res.status(400).json({ error: 'issue_id and body are required' });
  const issueRow = (await q('SELECT space_id, key, title, assignee_id, reporter_id FROM issues WHERE id=$1', [issue_id])).rows[0];
  if (!issueRow) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issueRow.space_id, 'comment.create'))) return;
  const user_id = req.user.id;
  const r = await q('INSERT INTO comments(id,issue_id,user_id,body) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), issue_id, user_id, body]);
  const issue = (await q('SELECT * FROM issues WHERE id=$1', [issue_id])).rows[0];
  if (issue) {
    const commenter = user_id;
    const link = '/?issue=' + encodeURIComponent(issue.key || issue_id);
    const preview = body.length > 80 ? body.slice(0, 80) + '…' : body;
    const notifyUsers = new Set([issue.assignee_id, issue.reporter_id].filter(Boolean));
    notifyUsers.forEach(function(uid_) {
      if (uid_ !== commenter) {
        createNotif({ user_id: uid_, space_id: issue.space_id, type: 'comment_added',
          title: 'New comment on ' + (issue.key || issue_id),
          body: preview, link });
      }
    });
    // Notify @mentioned users (skip commenter; dedupe with comment recipients)
    const mentionIds = Array.isArray(mentioned_user_ids) ? mentioned_user_ids : [];
    if (mentionIds.length) {
      const commenterRow = (await q('SELECT name FROM users WHERE id=$1', [commenter])).rows[0];
      const commenterName = commenterRow?.name || 'Someone';
      const mentioned = new Set(mentionIds.filter(Boolean));
      mentioned.forEach(function(uid_) {
        if (uid_ === commenter) return;
        createNotif({ user_id: uid_, space_id: issue.space_id, type: 'mention',
          title: commenterName + ' mentioned you on ' + (issue.key || issue_id),
          body: preview, link });
      });
    }
  }
  res.status(201).json(r.rows[0]);
}));

app.put('/api/comments/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getCommentIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'comment.update'))) return;
  const r = await q('UPDATE comments SET body=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.body, req.params.id]);
  res.json(r.rows[0]);
}));

app.delete('/api/comments/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getCommentIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'comment.delete'))) return;
  await q('DELETE FROM comments WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/comments/upload', requireAuth, (req, res) => {
  if (!upload) return res.status(503).json({ error: 'File upload not available' });
  const memStorage = multer.memoryStorage();
  const memUpload = multer({ storage: memStorage, limits: { fileSize: Infinity, files: 20 } });
  memUpload.array('files', 20)(req, res, async (err) => {
    if (err) { console.error('[comments/upload]', err); return res.status(400).json({ error: 'Upload failed' }); }
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });
    const files = [];
    for (const f of req.files) {
      const fileId = uid();
      await pool.query(
        `INSERT INTO file_storage (id, original_name, mime_type, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [fileId, f.originalname, f.mimetype, f.size, f.buffer, req.user.user_id]
      );
      files.push({ name: f.originalname, url: '/api/files/' + fileId, type: f.mimetype });
    }
    res.json({ files });
  });
});

app.get('/api/files/:id', requireAuthFile, wrap(async (req, res) => {
  if (!(await denyUnlessCanAccessFile(req.user, res, req.params.id))) return;
  const r = await pool.query('SELECT original_name, mime_type, data FROM file_storage WHERE id=$1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'File not found' });
  const { original_name, mime_type, data } = r.rows[0];
  res.setHeader('Content-Type', mime_type);
  res.setHeader('Content-Disposition', 'inline; filename="' + original_name.replace(/"/g, '') + '"');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(data);
}));

// ── Worklogs ──────────────────────────────────────────────
app.get('/api/worklogs', requireAuth, wrap(async (req, res) => {
  const { space_id, user_id, from, to } = req.query;
  if (space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'worklog.read'))) return;
  let where = [], params = [], n = 1;
  if (space_id) {
    where.push(`i.space_id=$${n++}`);
    params.push(space_id);
  } else if (!isOrgAdmin(req.user.role)) {
    const visible = await getVisibleSpaceIds(q, req.user);
    if (!visible.length) return res.json([]);
    where.push(`i.space_id = ANY($${n++})`);
    params.push(visible);
  }
  if (user_id) { where.push(`w.user_id=$${n++}`); params.push(user_id); }
  if (from) { where.push(`w.work_date>=$${n++}`); params.push(from); }
  if (to) { where.push(`w.work_date<=$${n++}`); params.push(to); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q(`SELECT w.*, u.name AS user_name, i.key AS issue_key, i.title AS issue_title, i.space_id
    FROM worklogs w JOIN users u ON u.id=w.user_id JOIN issues i ON i.id=w.issue_id${w}
    ORDER BY w.work_date DESC`, params);
  res.json(r.rows);
}));

// Anyone authenticated can log time on any issue — attributed to the logged-in user (not assignee)
app.post('/api/worklogs', requireAuth, wrap(async (req, res) => {
  const { issue_id, time_spent, work_date, description, is_billable } = req.body;
  const issueSpace = issue_id ? await getIssueSpaceId(q, issue_id) : null;
  if (!issueSpace) return res.status(400).json({ error: 'Valid issue_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, issueSpace, 'worklog.create'))) return;
  const user_id = req.user.id;
  const r = await q(`INSERT INTO worklogs(id,issue_id,user_id,time_spent,work_date,description,is_billable)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [uid(), issue_id, user_id, time_spent, work_date || new Date(), description, is_billable || false]);
  await q('UPDATE issues SET time_spent=COALESCE(time_spent,0)+$2,updated_at=NOW() WHERE id=$1', [issue_id, time_spent]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/worklogs/:id', requireAuth, wrap(async (req, res) => {
  const wl = (await q('SELECT * FROM worklogs WHERE id=$1', [req.params.id])).rows[0];
  if (!wl) return res.status(404).json({ error: 'Not found' });
  if (wl.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Cannot edit another user\'s worklog' });
  const { time_spent, description, work_date, is_billable } = req.body;
  const newTime = time_spent !== undefined ? Number(time_spent) : wl.time_spent;
  const diff = newTime - wl.time_spent;
  if (diff !== 0) {
    await q('UPDATE issues SET time_spent=GREATEST(COALESCE(time_spent,0)+$2,0),updated_at=NOW() WHERE id=$1', [wl.issue_id, diff]);
  }
  const r = await q(
    `UPDATE worklogs SET time_spent=$2,description=$3,work_date=$4,is_billable=$5 WHERE id=$1
     RETURNING *, (SELECT u.name FROM users u WHERE u.id=worklogs.user_id) AS user_name,
                  (SELECT i.key FROM issues i WHERE i.id=worklogs.issue_id) AS issue_key`,
    [req.params.id, newTime,
     description !== undefined ? description : wl.description,
     work_date   !== undefined ? work_date   : wl.work_date,
     is_billable !== undefined ? is_billable : wl.is_billable]
  );
  res.json(r.rows[0]);
}));

app.delete('/api/worklogs/:id', requireAuth, wrap(async (req, res) => {
  const wl = (await q('SELECT * FROM worklogs WHERE id=$1', [req.params.id])).rows[0];
  if (!wl) return res.status(404).json({ error: 'Not found' });
  // Only the owner or admin/owner can delete a worklog
  if (wl.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Cannot delete another user\'s worklog' });
  }
  await q('UPDATE issues SET time_spent=GREATEST(COALESCE(time_spent,0)-$2,0),updated_at=NOW() WHERE id=$1', [wl.issue_id, wl.time_spent]);
  await q('DELETE FROM worklogs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Product Roadmap ───────────────────────────────────────
app.get('/api/roadmap', requireAuth, wrap(async (req, res) => {
  const { space_id, status } = req.query;
  let sql = `SELECT r.*, u.name AS assigned_name, i.key AS issue_key, i.title AS issue_title,
               s.name AS space_name, cb.name AS created_by_name
             FROM roadmap_items r
             LEFT JOIN users u  ON u.id  = r.assigned_to
             LEFT JOIN issues i ON i.id  = r.issue_id
             LEFT JOIN spaces s ON s.id  = r.space_id
             LEFT JOIN users cb ON cb.id = r.created_by
             WHERE 1=1`;
  const params = [];
  if (space_id) {
    if (!(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;
    params.push(space_id); sql += ` AND r.space_id=$${params.length}`;
  } else if (!isOrgAdmin(req.user.role)) {
    params.push(req.user.user_id || req.user.id);
    sql += ` AND r.space_id IN (SELECT space_id FROM space_members WHERE user_id=$${params.length})`;
  }
  if (status)   { params.push(status);   sql += ` AND r.status=$${params.length}`; }
  sql += ' ORDER BY r.start_date ASC NULLS LAST, r.created_at ASC';
  res.json((await q(sql, params)).rows);
}));

app.post('/api/roadmap', requireAuth, wrap(async (req, res) => {
  const { title, description, status, start_date, end_date, space_id, issue_id, color, priority, assigned_to, group_name, category, milestone } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;

  // Auto-create a backlog issue in the linked space (sprint_id=null = backlog)
  let linkedIssueId = issue_id || null;
  if (space_id && !linkedIssueId) {
    try {
      const spaceRow = (await q('SELECT key FROM spaces WHERE id=$1', [space_id])).rows[0];
      if (spaceRow) {
        const cnt = (await q('SELECT COUNT(*)::int AS c FROM issues WHERE space_id=$1', [space_id])).rows[0].c;
        const issueKey = `${spaceRow.key}-${cnt + 1}`;
        const issueId = uid();
        await q(
          `INSERT INTO issues(id,key,space_id,title,description,type,priority,assignee_id,reporter_id,start_date,due_date)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [issueId, issueKey, space_id, title, description||null,
           'task', priority||'medium', assigned_to||null, req.user.user_id,
           start_date||null, end_date||null]
        );
        linkedIssueId = issueId;
      }
    } catch(e) { console.error('Auto-create backlog issue failed:', e.message); }
  }

  const id = 'rm_' + Date.now() + Math.random().toString(36).slice(2, 7);
  const row = (await q(
    `INSERT INTO roadmap_items (id,title,description,status,start_date,end_date,space_id,issue_id,color,priority,assigned_to,created_by,group_name,category,milestone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [id, title, description||null, status||'planned', start_date||null, end_date||null,
     space_id||null, linkedIssueId, color||'#4d90e0', priority||'medium', assigned_to||null,
     req.user.user_id, group_name||'General', category||'Items', milestone||false]
  )).rows[0];
  res.json(row);
}));

app.put('/api/roadmap/:id', requireAuth, wrap(async (req, res) => {
  const { title, description, status, start_date, end_date, space_id, issue_id, color, priority, assigned_to, group_name, category, milestone } = req.body;
  const existing = (await q('SELECT space_id FROM roadmap_items WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.space_id && !(await denyUnlessCanAct(q, req.user, res, existing.space_id, 'roadmap.manage'))) return;
  if (space_id && space_id !== existing.space_id && !(await denyUnlessCanAct(q, req.user, res, space_id, 'roadmap.manage'))) return;
  const row = (await q(
    `UPDATE roadmap_items SET title=$2,description=$3,status=$4,start_date=$5,end_date=$6,
     space_id=$7,issue_id=$8,color=$9,priority=$10,assigned_to=$11,
     group_name=$12,category=$13,milestone=$14,updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [req.params.id, title, description||null, status||'planned', start_date||null, end_date||null,
     space_id||null, issue_id||null, color||'#4d90e0', priority||'medium', assigned_to||null,
     group_name||'General', category||'Items', milestone||false]
  )).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

app.delete('/api/roadmap/:id', requireAuth, wrap(async (req, res) => {
  const existing = (await q('SELECT space_id FROM roadmap_items WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.space_id && !(await denyUnlessCanAct(q, req.user, res, existing.space_id, 'roadmap.manage'))) return;
  await q('DELETE FROM roadmap_items WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Roadmap Colors ────────────────────────────────────────
app.get('/api/roadmap/colors', requireAuth, wrap(async (req, res) => {
  const rows = (await q('SELECT color_key, color FROM roadmap_colors WHERE created_by=$1', [req.user.user_id])).rows;
  const result = {};
  rows.forEach(function(r) { result[r.color_key] = r.color; });
  res.json(result);
}));

app.post('/api/roadmap/colors', requireAuth, wrap(async (req, res) => {
  const { color_key, color } = req.body;
  if (!color_key || !color) return res.status(400).json({ error: 'color_key and color required' });
  await q(
    `INSERT INTO roadmap_colors (color_key, color, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (color_key, created_by) DO UPDATE SET color=$2`,
    [color_key, color, req.user.user_id]
  );
  res.json({ ok: true });
}));

// ── Issue Links ───────────────────────────────────────────
app.post('/api/links', requireAuth, wrap(async (req, res) => {
  const { source_id, target_id, link_type } = req.body;
  if (!source_id || !target_id || !link_type) return res.status(400).json({ error: 'source_id, target_id and link_type are required' });
  if (source_id === target_id) return res.status(400).json({ error: 'An issue cannot be linked to itself' });
  if (!LINK_TYPE_INVERSE[link_type]) return res.status(400).json({ error: 'Unknown link type' });
  const sourceSpace = await getIssueSpaceId(q, source_id);
  const targetSpace = await getIssueSpaceId(q, target_id);
  if (!sourceSpace || !targetSpace || sourceSpace !== targetSpace) return res.status(400).json({ error: 'Invalid issue link' });
  if (!(await denyUnlessCanAct(q, req.user, res, sourceSpace, 'link.manage'))) return;
  // Reject one link family per pair. Checking only the exact (pair, link_type)
  // let contradictions through, because a family's two names are different
  // strings: A "blocks" B could coexist with A "is blocked by" B, and with
  // B "blocks" A. Comparing against the whole family (type + its inverse) in
  // both directions collapses all four of those into one check, while still
  // allowing genuinely different relationships on the same pair (e.g. both
  // "blocks" and "relates to"), which is how Jira behaves.
  const family = [link_type, LINK_TYPE_INVERSE[link_type]].filter(Boolean);
  const existing = await q(
    `SELECT id, source_id, link_type FROM issue_links
     WHERE ((source_id=$1 AND target_id=$2) OR (source_id=$2 AND target_id=$1))
       AND link_type = ANY($3::varchar[])`,
    [source_id, target_id, family]
  );
  if (existing.rows.length) {
    const clash = existing.rows[0];
    const same = clash.source_id === source_id && clash.link_type === link_type;
    return res.status(409).json({
      error: same
        ? 'These two issues are already linked that way'
        : 'These two issues already have a conflicting link (' + clash.link_type.replace(/_/g, ' ') + ') — remove it first'
    });
  }
  const r = await q('INSERT INTO issue_links(id,source_id,target_id,link_type) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), source_id, target_id, link_type]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/links/:id', requireAuth, wrap(async (req, res) => {
  const linkRow = (await q('SELECT source_id FROM issue_links WHERE id=$1', [req.params.id])).rows[0];
  if (!linkRow) return res.status(404).json({ error: 'Not found' });
  const spaceId = await getIssueSpaceId(q, linkRow.source_id);
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'link.manage'))) return;
  await q('DELETE FROM issue_links WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Attachments ───────────────────────────────────────────
app.get('/api/issues/:id/attachments', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'attachment.read'))) return;
  const r = await q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [req.params.id]);
  res.json(r.rows);
}));

app.post('/api/issues/:id/attachments', requireAuth, (req, res, next) => {
  if (!multer) return res.status(503).json({ error: 'File upload not available' });
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Infinity, files: 20 } });
  memUpload.array('files', 20)(req, res, async (err) => {
    if (err) { console.error('[attachments/upload]', err); return res.status(400).json({ error: 'Upload failed' }); }
    try {
      const spaceId = await getIssueSpaceId(q, req.params.id);
      if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
      if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'attachment.upload'))) return;
      const saved = [];
      for (const f of req.files) {
        const fileId = uid();
        await q(`INSERT INTO file_storage(id,original_name,mime_type,size,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)`,
          [fileId, f.originalname, f.mimetype, f.size, f.buffer, req.user.id]);
        const r = await q(`INSERT INTO issue_attachments(id,issue_id,filename,original_name,size,mime_type,uploaded_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [uid(), req.params.id, fileId, f.originalname, f.size, f.mimetype, req.user.id]);
        saved.push(r.rows[0]);
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
          VALUES($1,$2,$3,'attachment',NULL,$4)`,
          [uid(), req.params.id, req.user.id, f.originalname]);
      }
      res.status(201).json(saved);
    } catch(e) { next(e); }
  });
});

app.delete('/api/attachments/:id', requireAuth, wrap(async (req, res) => {
  const a = (await q('SELECT * FROM issue_attachments WHERE id=$1', [req.params.id])).rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.uploaded_by !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Cannot delete another user\'s attachment' });
  try { fs.unlinkSync(path.join(uploadsDir, a.filename)); } catch(_) {}
  try { await q('DELETE FROM file_storage WHERE id=$1', [a.filename]); } catch(_) {}
  await q('DELETE FROM issue_attachments WHERE id=$1', [req.params.id]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'attachment',$4,NULL)`,
    [uid(), a.issue_id, req.user.user_id, a.original_name]);
  res.json({ ok: true });
}));

// Rename attachment
app.patch('/api/attachments/:id', requireAuth, wrap(async (req, res) => {
  const { original_name } = req.body;
  if (!original_name) return res.status(400).json({ error: 'name required' });
  const a = (await q('SELECT * FROM issue_attachments WHERE id=$1', [req.params.id])).rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.uploaded_by !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Forbidden' });
  const r = await q('UPDATE issue_attachments SET original_name=$2 WHERE id=$1 RETURNING *', [req.params.id, original_name]);
  res.json(r.rows[0]);
}));

// ── Custom Fields ─────────────────────────────────────────
app.get('/api/custom-fields', requireAuth, wrap(async (req, res) => {
  const sid = req.query.space_id;
  if (sid && !(await denyUnlessCanAct(q, req.user, res, sid, 'custom_field.read'))) return;
  if (sid) {
    try {
      const sp = (await q('SELECT id, name, key FROM spaces WHERE id=$1', [sid])).rows[0];
      if (sp) await seedBuiltinIssueFields(q, uid, sid, sp);
    } catch (e) {
      console.warn('[custom-fields] Built-in seed skipped:', e.message);
    }
    const r = await q(
      'SELECT * FROM custom_fields WHERE space_id=$1 ORDER BY is_builtin DESC, position, name',
      [sid]
    );
    return res.json(r.rows);
  }
  const r = isOrgAdmin(req.user.role)
    ? await q('SELECT * FROM custom_fields ORDER BY position')
    : await q('SELECT cf.* FROM custom_fields cf JOIN space_members sm ON sm.space_id=cf.space_id WHERE sm.user_id=$1 ORDER BY cf.position', [req.user.id]);
  res.json(r.rows);
}));

app.post('/api/custom-fields', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, b.space_id, 'custom_field.manage'))) return;
  if (isReservedFieldName(b.name)) {
    return res.status(400).json({ error: `"${b.name}" is a built-in field name — choose a different name for this custom field` });
  }
  // options must be JSON-stringified for jsonb column (pg binds arrays as PG arrays otherwise)
  const opts = b.options != null ? JSON.stringify(Array.isArray(b.options) ? b.options : []) : '[]';
  // show_in was omitted here, so the column default ('{drawer}') always won and a
  // field created with "Create issue" ticked silently became drawer-only.
  const showIn = Array.isArray(b.show_in) && b.show_in.length ? b.show_in : ['drawer'];
  const reqTypes = Array.isArray(b.required_types) ? b.required_types : null;
  const r = await q(`INSERT INTO custom_fields(id,space_id,name,field_type,options,is_required,position,show_in,required_types)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *`,
    [uid(), b.space_id, b.name, b.field_type, opts, b.is_required || false, b.position || 0, showIn, reqTypes]);
  res.status(201).json(r.rows[0]);
}));

// Create a brand-new field definition on every non-archived space at once
// (for when the field doesn't exist anywhere yet — as opposed to
// apply-to-all below, which copies one that already exists on some board).
// Skips any space that already has a field with the same name.
app.post('/api/custom-fields/create-for-all', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can add a field to every space.')) return;
  const b = req.body;
  if (!b.name || !b.field_type) return res.status(400).json({ error: 'name and field_type are required' });
  if (isReservedFieldName(b.name)) {
    return res.status(400).json({ error: `"${b.name}" is a built-in field name — choose a different name for this custom field` });
  }
  const opts = b.options != null ? JSON.stringify(Array.isArray(b.options) ? b.options : []) : '[]';
  const showIn = b.show_in && b.show_in.length ? b.show_in : ['drawer'];
  const spaces = (await q(
    'SELECT id, name FROM spaces WHERE (is_archived = false OR is_archived IS NULL) ORDER BY name'
  )).rows;
  const addedTo = [];
  const skipped = [];
  for (const sp of spaces) {
    const exists = (await q(
      'SELECT id FROM custom_fields WHERE space_id=$1 AND LOWER(name)=LOWER($2)',
      [sp.id, b.name]
    )).rows[0];
    if (exists) { skipped.push(sp.name); continue; }
    await q(
      `INSERT INTO custom_fields(id,space_id,name,field_type,options,is_required,position,show_in)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [uid(), sp.id, b.name, b.field_type, opts, b.is_required || false, b.position || 0, showIn]
    );
    addedTo.push(sp.name);
  }
  res.json({ ok: true, added: addedTo.length, totalSpaces: spaces.length, addedTo, skipped });
}));

app.put('/api/custom-fields/:id', requireAuth, wrap(async (req, res) => {
  const existing = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, existing.space_id, 'custom_field.manage'))) return;

  const body = { ...req.body };
  delete body.space_id;

  if (existing.is_builtin) {
    // Built-in registry: config only (required, options, show_in, position)
    delete body.name;
    delete body.field_type;
    delete body.field_key;
    delete body.is_builtin;
  } else if (body.name !== undefined && reservedNameBlockedForUpdate(body.name, existing)) {
    return res.status(400).json({ error: `"${body.name}" is a built-in field name — choose a different name for this custom field` });
  }

  if (body.options != null && typeof body.options === 'object') {
    body.options = JSON.stringify(body.options);
  }

  const upd = buildDynamicUpdate('custom_fields', body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE custom_fields SET ${upd.set} WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  res.json(r.rows[0]);
}));

// Copy a custom field's definition (name/type/options/required/show_in) onto
// every other non-archived space that doesn't already have a field with that
// name. Returns which boards it was actually added to and which were
// skipped (and why) so the UI can show something more useful than a count.
app.post('/api/custom-fields/:id/apply-to-all', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res, 'Only an org admin can push a field to every space.')) return;
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  // is_archived defaults to false, but treat NULL the same way defensively
  // in case any space row predates that default being applied.
  const spaces = (await q(
    'SELECT id, name FROM spaces WHERE (is_archived = false OR is_archived IS NULL) AND id != $1 ORDER BY name',
    [field.space_id]
  )).rows;
  const addedTo = [];
  const skipped = [];
  for (const sp of spaces) {
    const exists = (await q(
      'SELECT id FROM custom_fields WHERE space_id=$1 AND LOWER(name)=LOWER($2)',
      [sp.id, field.name]
    )).rows[0];
    if (exists) { skipped.push(sp.name); continue; }
    await q(
      `INSERT INTO custom_fields(id,space_id,name,field_type,options,is_required,position,show_in)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [uid(), sp.id, field.name, field.field_type, JSON.stringify(field.options || []), field.is_required, field.position || 0, field.show_in || ['drawer']]
    );
    addedTo.push(sp.name);
  }
  res.json({ ok: true, added: addedTo.length, totalSpaces: spaces.length, addedTo, skipped });
}));

// Upsert a single custom field value for an issue
app.put('/api/issues/:id/field-values/:fieldId', requireAuth, wrap(async (req, res) => {
  const { id: issueId, fieldId } = req.params;
  const spaceId = await getIssueSpaceId(q, issueId);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.update'))) return;
  const { value } = req.body;
  // Check if record exists
  const existing = await q('SELECT id FROM issue_field_values WHERE issue_id=$1 AND field_id=$2', [issueId, fieldId]);
  if (existing.rows.length) {
    if (value === '' || value === null || value === undefined) {
      await q('DELETE FROM issue_field_values WHERE issue_id=$1 AND field_id=$2', [issueId, fieldId]);
    } else {
      await q('UPDATE issue_field_values SET value=$1 WHERE issue_id=$2 AND field_id=$3', [String(value), issueId, fieldId]);
    }
  } else if (value !== '' && value !== null && value !== undefined) {
    await q('INSERT INTO issue_field_values(id,issue_id,field_id,value) VALUES($1,$2,$3,$4)',
      [uid(), issueId, fieldId, String(value)]);
  }
  // Track in history
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,new_value,created_at)
    VALUES($1,$2,$3,$4,$5,NOW())`, [uid(), issueId, req.user.id, 'custom_field_' + fieldId, String(value || '')]);
  res.json({ ok: true });
}));

app.delete('/api/custom-fields/:id', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  if (field.is_builtin && field.field_key === 'title') {
    return res.status(400).json({ error: 'Title is a required built-in field and cannot be removed' });
  }
  await q('DELETE FROM issue_field_values WHERE field_id=$1', [req.params.id]);
  await q('DELETE FROM custom_fields WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Saved Filters ─────────────────────────────────────────
app.get('/api/filters', requireAuth, wrap(async (req, res) => {
  if (req.query.space_id && !(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'filter.read'))) return;
  let where = [], params = [], n = 1;
  if (req.query.space_id) { where.push(`space_id=$${n++}`); params.push(req.query.space_id); }
  if (req.query.user_id) {
    if (req.query.user_id !== req.user.id && !isOrgAdmin(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    where.push(`user_id=$${n++}`); params.push(req.query.user_id);
  } else if (!req.query.space_id && !isOrgAdmin(req.user.role)) {
    where.push(`space_id IN (SELECT space_id FROM space_members WHERE user_id=$${n++})`);
    params.push(req.user.user_id || req.user.id);
  }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q('SELECT * FROM saved_filters' + w + ' ORDER BY name', params);
  res.json(r.rows);
}));

app.post('/api/filters', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, b.space_id, 'filter.manage'))) return;
  const r = await q(`INSERT INTO saved_filters(id,space_id,user_id,name,conditions,is_shared)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [uid(), b.space_id, req.user.id, b.name, JSON.stringify(b.conditions || b.filter_config || {}), b.is_shared || false]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/filters/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getFilterSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Filter not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'filter.manage'))) return;
  const body = { ...req.body };
  if (body.conditions && typeof body.conditions === 'object') body.conditions = JSON.stringify(body.conditions);
  const upd = buildDynamicUpdate('saved_filters', body, 2);
  if (!upd) return res.status(400).json({ error: 'Nothing to update' });
  const r = await q(`UPDATE saved_filters SET ${upd.set} WHERE id=$1 RETURNING *`, [req.params.id, ...upd.vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/filters/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getFilterSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Filter not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'filter.manage'))) return;
  await q('DELETE FROM saved_filters WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Move issue (drag/drop backlog ↔ sprint) ───────────────
app.put('/api/issues/:id/move', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'issue.move'))) return;
  const { sprint_id } = req.body;
  const oldRow = (await q('SELECT sprint_id FROM issues WHERE id=$1', [req.params.id])).rows[0];
  // Clearing former_sprint_id: an explicit move is the user's decision about where
  // this ticket belongs, so restoring its old deleted sprint must not undo it.
  const r = await q('UPDATE issues SET sprint_id=$1,former_sprint_id=NULL,updated_at=NOW() WHERE id=$2 RETURNING *',
    [sprint_id || null, req.params.id]);
  if (oldRow) {
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
      [uid(), req.params.id, req.user.id, 'sprint_id',
       oldRow.sprint_id ? String(oldRow.sprint_id) : null,
       sprint_id ? String(sprint_id) : null]).catch(()=>{});
  }
  res.json(r.rows[0]);
}));

// ── Reports ───────────────────────────────────────────────
app.get('/api/reports/sprint/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const stats = (await q(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='Done')::int AS done,
      COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
      COALESCE(SUM(story_points) FILTER (WHERE status='Done'),0)::int AS points_completed,
      COALESCE(SUM(story_points) FILTER (WHERE status!='Done'),0)::int AS points_remaining
    FROM issues WHERE sprint_id=$1 AND deleted_at IS NULL`, [sid])).rows[0];
  res.json({ sprint, ...stats });
}));

app.get('/api/reports/velocity', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q(`SELECT id, name, velocity, start_date, end_date
    FROM sprints WHERE space_id=$1 AND status='completed' AND deleted_at IS NULL ORDER BY end_date`,
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/status', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q('SELECT status, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY status ORDER BY status',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/priority', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  const r = await q('SELECT priority, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY priority ORDER BY priority',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/workload', requireAuth, wrap(async (req, res) => {
  const spaceId = req.query.space_id;
  if (!spaceId) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'report.view'))) return;
  const r = await q(`SELECT u.id, u.name, COUNT(i.id)::int AS issue_count,
      COALESCE(SUM(i.story_points),0)::int AS total_points
    FROM users u JOIN issues i ON i.assignee_id=u.id
    WHERE i.space_id=$1 GROUP BY u.id, u.name ORDER BY issue_count DESC`,
    [spaceId]);
  res.json(r.rows);
}));

app.get('/api/reports/burndown/:sprintId', requireAuth, wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [req.params.sprintId])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const issues = (await q('SELECT id, story_points AS points, status FROM issues WHERE sprint_id=$1', [sprint.id])).rows;
  const total = issues.length;
  const totalPts = issues.reduce((s, i) => s + (i.points || 0), 0);

  const hist = issues.length
    ? (await q(
        `SELECT issue_id, MIN(created_at) AS done_at FROM issue_history
         WHERE field_name='status' AND new_value='Done' AND issue_id = ANY($1)
         GROUP BY issue_id`,
        [issues.map(i => i.id)]
      )).rows
    : [];

  // Project the x-axis across the FULL sprint (start → end date), not just
  // days elapsed so far — otherwise the ideal line's slope gets divided
  // across only the elapsed days instead of the real sprint length, making
  // it plunge to zero within the first few days of a still-active sprint.
  // Days beyond "today" have no actual data yet, so remaining/remainingPts
  // stay null for them — the chart draws the actual line only up to today
  // and leaves the ideal line spanning the whole range.
  // All arithmetic here uses UTC getters/setters (not local-time
  // getDate/setHours) so the "is this day in the future" check can't drift
  // by a day relative to the toISOString() UTC date label depending on the
  // server's timezone.
  const start = new Date(sprint.start_date);
  const end = sprint.end_date ? new Date(sprint.end_date) : new Date(Math.min(new Date(sprint.end_date), Date.now()));
  const now = new Date();
  const todayDateMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const series = [];
  for (
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    d <= end;
    d = new Date(d.getTime() + 86400000)
  ) {
    const dayDateMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayEndMs = dayDateMs + 86399999; // 23:59:59.999 that day, for done_at comparisons below
    // Compare calendar dates, not "day-end timestamp vs right now" — today's
    // 23:59:59 hasn't happened yet either, so that comparison would wrongly
    // mark today itself as a future day with no data.
    const isFuture = dayDateMs > todayDateMs;
    let remaining = null, remainingPts = null;
    if (!isFuture) {
      const doneRows = hist.filter(h => new Date(h.done_at).getTime() <= dayEndMs);
      const doneCnt = doneRows.length;
      const donePts = doneRows.reduce((s, h) => {
        const iss = issues.find(i => i.id === h.issue_id);
        return s + (iss ? (iss.points || 0) : 0);
      }, 0);
      remaining = total - doneCnt;
      remainingPts = totalPts - donePts;
    }
    series.push({ date: d.toISOString().slice(0,10), remaining, remainingPts, future: isFuture });
  }
  res.json({ sprint, total, totalPts, series });
}));

app.get('/api/reports/cycle-time', requireAuth, wrap(async (req, res) => {
  if (!req.query.space_id) return res.status(400).json({ error: 'space_id is required' });
  if (!(await denyUnlessCanAct(q, req.user, res, req.query.space_id, 'report.view'))) return;
  // Try issue_history first (accurate)
  let rows = (await q(
    `SELECT i.id, i.key, i.title, i.created_at,
            MIN(h.created_at) AS done_at,
            ROUND(EXTRACT(EPOCH FROM (MIN(h.created_at) - i.created_at))/86400, 1)::float AS cycle_days
     FROM issues i
     JOIN issue_history h ON h.issue_id=i.id AND h.field_name='status' AND h.new_value='Done'
     WHERE i.space_id=$1
     GROUP BY i.id, i.key, i.title, i.created_at
     ORDER BY done_at DESC LIMIT 50`,
    [req.query.space_id]
  )).rows;

  // Fallback: use updated_at as proxy for done_at when no history exists
  if (!rows.length) {
    rows = (await q(
      `SELECT id, key, title, created_at,
              updated_at AS done_at,
              ROUND(EXTRACT(EPOCH FROM (updated_at - created_at))/86400, 1)::float AS cycle_days
       FROM issues WHERE space_id=$1 AND status='Done'
       ORDER BY updated_at DESC LIMIT 50`,
      [req.query.space_id]
    )).rows;
  }
  res.json(rows);
}));

// Control Chart — cycle time per completed issue IN A GIVEN SPRINT, measured
// from when it first entered "In Progress" to when it was finally marked
// "Done" (not creation-to-done, which conflates backlog wait time with
// actual work time). Includes assignee and story points so the chart can
// break cycle time down by who worked the ticket.
app.get('/api/reports/control-chart/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const rows = (await q(`
    SELECT i.id, i.key, i.title, i.story_points, i.assignee_id,
      u.name AS assignee_name, u.color AS assignee_color, u.avatar_url AS assignee_avatar,
      sub.started_at, sub.done_at,
      ROUND(EXTRACT(EPOCH FROM (sub.done_at - sub.started_at))/86400, 1)::float AS cycle_days
    FROM issues i
    LEFT JOIN users u ON u.id = i.assignee_id
    JOIN LATERAL (
      SELECT
        (SELECT MIN(created_at) FROM issue_history
         WHERE issue_id = i.id AND field_name='status' AND new_value='In Progress') AS started_at,
        (SELECT MAX(created_at) FROM issue_history
         WHERE issue_id = i.id AND field_name='status' AND new_value='Done') AS done_at
    ) sub ON true
    WHERE i.sprint_id = $1 AND i.status = 'Done' AND i.deleted_at IS NULL
      AND sub.started_at IS NOT NULL AND sub.done_at IS NOT NULL AND sub.done_at > sub.started_at
    ORDER BY sub.done_at DESC
  `, [sid])).rows;

  const items = rows.map(r => ({
    id: r.id, key: r.key, title: r.title, story_points: r.story_points,
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name, color: r.assignee_color, avatar_url: r.assignee_avatar } : null,
    started_at: r.started_at, done_at: r.done_at, cycle_days: r.cycle_days
  }));
  res.json({ sprint, items });
}));

// Sprint-specific team workload
app.get('/api/reports/team-workload/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  const devIds = sprint.developer_ids || [];
  const qaIds = sprint.qa_ids || [];
  const teamIds = Array.from(new Set([...devIds, ...qaIds]));

  const rows = (await q(`
    WITH assignee_stats AS (
      SELECT i.assignee_id AS id,
        COUNT(i.id)::int AS assigned,
        COUNT(i.id) FILTER (WHERE i.status='Done')::int AS completed,
        COUNT(i.id) FILTER (WHERE i.status!='Done')::int AS remaining,
        COALESCE(SUM(i.story_points),0)::int AS assigned_sp,
        COALESCE(SUM(i.story_points) FILTER (WHERE i.status='Done'),0)::int AS completed_sp
      FROM issues i
      WHERE i.sprint_id=$1 AND i.deleted_at IS NULL AND i.assignee_id IS NOT NULL
      GROUP BY i.assignee_id
    ),
    all_ids AS (
      SELECT unnest($2::text[]) AS id
      UNION
      SELECT id FROM assignee_stats
    )
    SELECT u.id, u.name, u.color, u.avatar_url,
      COALESCE(s.assigned,0)::int AS assigned,
      COALESCE(s.completed,0)::int AS completed,
      COALESCE(s.remaining,0)::int AS remaining,
      COALESCE(s.assigned_sp,0)::int AS assigned_sp,
      COALESCE(s.completed_sp,0)::int AS completed_sp
    FROM all_ids a
    JOIN users u ON u.id = a.id
    LEFT JOIN assignee_stats s ON s.id = a.id
    ORDER BY assigned_sp DESC, u.name ASC
  `, [sid, teamIds])).rows;

  const devSet = new Set(devIds);
  const qaSet = new Set(qaIds);
  const leaves = sprint.developer_leaves || {};
  const decorated = rows.map(r => ({
    ...r,
    role: devSet.has(r.id) && qaSet.has(r.id) ? 'Dev + QA' : devSet.has(r.id) ? 'Developer' : qaSet.has(r.id) ? 'QA' : 'Other',
    leave_days: leaves[r.id] || 0
  }));

  res.json({ sprint, rows: decorated });
}));

// Scope change for a sprint (committed vs added/removed after start)
app.get('/api/reports/scope-change/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const current = (await q(
    'SELECT id, key, title, status, type, priority, assignee_id, story_points FROM issues WHERE sprint_id=$1 AND deleted_at IS NULL', [sid]
  )).rows;
  const addedRows = sprint.start_date ? (await q(
    `SELECT DISTINCT issue_id FROM issue_history
     WHERE field_name='sprint_id' AND new_value=$1 AND created_at > $2`,
    [sid, sprint.start_date]
  )).rows : [];
  const addedIds = new Set(addedRows.map(r => r.issue_id));
  const committed = current.filter(i => !addedIds.has(i.id));
  const added = current.filter(i => addedIds.has(i.id));
  const removed = sprint.start_date ? (await q(
    `SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.type, i.priority, i.assignee_id, i.story_points
     FROM issue_history ih
     JOIN issues i ON i.id=ih.issue_id
     WHERE ih.field_name='sprint_id' AND ih.old_value=$1 AND ih.created_at > $2
       AND (i.sprint_id IS NULL OR i.sprint_id != $1) AND i.deleted_at IS NULL
     ORDER BY i.id, ih.created_at DESC`,
    [sid, sprint.start_date]
  )).rows : [];
  res.json({ sprint, committed, added, removed });
}));

// Bug summary for a sprint
app.get('/api/reports/bugs/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT space_id FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;
  const r = (await q(`
    SELECT
      COUNT(*) FILTER (WHERE status!='Done')::int AS open_bugs,
      COUNT(*) FILTER (WHERE status='Done')::int AS closed_bugs,
      COUNT(*)::int AS total_bugs,
      COUNT(*) FILTER (WHERE priority='highest')::int AS critical_bugs
    FROM issues WHERE sprint_id=$1 AND type='bug' AND deleted_at IS NULL
  `, [sid])).rows[0];
  res.json(r);
}));

// Spillover report — issues that were in a sprint but not completed
app.get('/api/reports/spillover/:sprintId', requireAuth, wrap(async (req, res) => {
  const sid = req.params.sprintId;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, sprint.space_id, 'report.view'))) return;

  let spillover = [];
  if (sprint.status === 'completed') {
    // Approach 1: issues explicitly recorded in history as spilled out by
    // Complete Sprint (field_name='spillover', distinct from the generic
    // 'sprint_id' entries that PUT /api/issues/:id writes for manual moves
    // to backlog — this keeps genuine end-of-sprint spillover from being
    // confused with tickets a user dragged to backlog mid-sprint).
    // This works for sprints completed after the fix was deployed.
    const fromHistory = (await q(`
      SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.priority, i.type,
        i.story_points, i.assignee_id, ih.created_at AS spilled_at
      FROM issue_history ih
      JOIN issues i ON i.id = ih.issue_id
      WHERE ih.field_name = 'spillover'
        AND ih.old_value = $1
        AND (ih.new_value IS NULL OR ih.new_value = '' OR ih.new_value = 'null')
        AND i.deleted_at IS NULL
      ORDER BY i.id, ih.created_at DESC
    `, [sid])).rows;

    if (fromHistory.length > 0) {
      spillover = fromHistory;
    } else {
      // Fallback for old sprints: find backlog issues that were ever assigned to this sprint
      // (recorded as new_value=sprintId in history) and are now not Done
      spillover = (await q(`
        SELECT DISTINCT ON (i.id) i.id, i.key, i.title, i.status, i.priority, i.type,
          i.story_points, i.assignee_id, ih.created_at AS spilled_at
        FROM issue_history ih
        JOIN issues i ON i.id = ih.issue_id
        WHERE ih.field_name = 'sprint_id'
          AND ih.new_value = $1
          AND i.sprint_id IS NULL
          AND i.status != 'Done'
          AND i.deleted_at IS NULL
        ORDER BY i.id, ih.created_at DESC
      `, [sid])).rows;
    }
  } else {
    // Active/planning sprint: projected spillover = current non-done issues
    spillover = (await q(`
      SELECT i.id, i.key, i.title, i.status, i.priority, i.type,
        i.story_points, i.assignee_id, NULL AS spilled_at
      FROM issues i
      WHERE i.sprint_id = $1 AND i.status != 'Done' AND i.deleted_at IS NULL
      ORDER BY i.key
    `, [sid])).rows;
  }

  const assigneeIds = [...new Set(spillover.map(i => i.assignee_id).filter(Boolean))];
  let userMap = {};
  if (assigneeIds.length) {
    const users = (await q('SELECT id, name, color FROM users WHERE id = ANY($1)', [assigneeIds])).rows;
    users.forEach(u => { userMap[u.id] = u; });
  }

  const totalPts = spillover.reduce((s, i) => s + (Number(i.story_points) || 0), 0);
  res.json({
    sprint,
    spillover: spillover.map(i => ({ ...i, assignee: userMap[i.assignee_id] || null })),
    count: spillover.length,
    totalPts
  });
}));

// ── Notifications ─────────────────────────────────────────

// Helper: create a notification (fire-and-forget, never throws)
async function createNotif({ user_id, space_id, type, title, body, link }) {
  if (!user_id) return;
  try {
    await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  } catch(e) { /* non-fatal */ }
  // Send email for issue-related notifications
  const emailTypes = ['issue_assigned', 'status_changed', 'comment_added', 'mention', 'priority_changed'];
  if (emailTypes.includes(type)) {
    try {
      const userRow = await q('SELECT email FROM users WHERE id=$1', [user_id]);
      const toEmail = userRow.rows[0]?.email;
      if (toEmail) {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const issueLink = link ? appUrl + link : appUrl;
        const emailBody = `
          <h2 style="color:#1e293b;margin-top:0">${title}</h2>
          ${body ? `<p style="color:#475569">${body}</p>` : ''}
          <div style="text-align:center;margin:24px 0">
            <a href="${issueLink}" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">View Issue</a>
          </div>`;
        sendEmail(toEmail, title, emailBody).catch(() => {});
      }
    } catch(e) { /* non-fatal */ }
  }
}

app.get('/api/notifications', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY is_read ASC, created_at DESC LIMIT 100',
    [req.user.id]);
  res.json(r.rows);
}));

app.post('/api/notifications', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const { user_id, space_id, type, title, body, link } = req.body;
  if (!user_id || !type || !title) return res.status(400).json({ error: 'user_id, type, title required' });
  const r = await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/notifications/:id', requireAuth, wrap(async (req, res) => {
  await q('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.put('/api/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  const r = await q('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(r.rows[0]);
}));

app.put('/api/notifications/read-all', requireAuth, wrap(async (req, res) => {
  await q('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.user.id]);
  res.json({ ok: true });
}));

// ── Auth Utilities ────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return derived === hash;
  } catch { return false; }
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Auth Middleware ────────────────────────────────────────
async function resolveSessionFromToken(token) {
  const r = await q(`SELECT s.user_id, u.name, u.email, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=$1 AND s.expires_at>NOW()`, [token]);
  if (!r.rows[0] || !r.rows[0].is_active) return null;
  const user = r.rows[0];
  user.id = user.user_id;
  return user;
}

/** Bearer header or ?t= session token (for img/a tags that cannot send Authorization). */
async function requireAuthFile(req, res, next) {
  let token = null;
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.query && req.query.t) token = String(req.query.t);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const user = await resolveSessionFromToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: 'Auth error' }); }
}

async function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  try {
    const user = await resolveSessionFromToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: 'Auth error' }); }
}

// ── Microsoft OAuth2 config (set these env vars on the server) ────────────
const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID     || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT_ID     = process.env.MICROSOFT_TENANT_ID     || '';
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI  || 'https://sprintboard.cftools.live/api/auth/callback/microsoft';
const APP_BASE_URL     = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// ── Microsoft OAuth2 helpers ──────────────────────────────
function msTokenExchange(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: MS_REDIRECT_URI,
      scope: 'openid profile email User.Read'
    }).toString();
    const opts = {
      hostname: 'login.microsoftonline.com',
      path: `/${MS_TENANT_ID}/oauth2/v2.0/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function msGraphMe(accessToken) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com',
      path: '/v1.0/me?$select=displayName,mail,userPrincipalName',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Microsoft OAuth2 routes ───────────────────────────────
app.get('/auth/microsoft', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: 'openid profile email User.Read',
    response_mode: 'query',
    state
  });
  res.redirect(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/authorize?${params}&prompt=login`);
});

app.get('/api/auth/callback/microsoft', wrap(async (req, res) => {
  const { code, state, error } = req.query;
  const loginErr = (code) => res.redirect(`${APP_BASE_URL}/login.html?error=${code}`);

  // Validate CSRF state
  if (!state || !oauthStates.has(state)) {
    return loginErr('invalid_state');
  }
  oauthStates.delete(state);

  if (error) {
    return res.redirect(`${APP_BASE_URL}/login.html?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return loginErr('no_code');
  }

  // Exchange code for access token
  const tokenData = await msTokenExchange(code);
  if (!tokenData || !tokenData.access_token) {
    console.error('[MS OAuth] Token exchange failed:', tokenData);
    return loginErr('token_exchange_failed');
  }

  // Get user profile from Microsoft Graph
  const profile = await msGraphMe(tokenData.access_token);
  if (!profile) {
    return loginErr('no_email');
  }

  const email = (profile.mail || profile.userPrincipalName || '').toLowerCase().trim();
  if (!email) {
    return loginErr('no_email');
  }

  // Look up user in database — auto-create on first Microsoft login
  let userRows = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email]);
  if (!userRows.rows.length) {
    const displayName = profile.displayName || profile.givenName || email.split('@')[0];
    const orgRow = await q('SELECT id FROM organizations LIMIT 1');
    if (!orgRow.rows.length) {
      console.error('[MS OAuth] No organization found in DB');
      return loginErr('no_org');
    }
    const orgId = orgRow.rows[0].id;
    const newUserId = `usr-${uid()}`;
    const colors = ['#0052cc','#00875a','#ff5630','#ff991f','#6554c0','#00b8d9'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await q(
      `INSERT INTO users (id, org_id, name, email, avatar_url, color, role, password_hash, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,'member',NULL,true)`,
      [newUserId, orgId, displayName, email, null, color]
    );
    console.log('[MS OAuth] Auto-created user:', email, newUserId);
    userRows = await q('SELECT * FROM users WHERE id=$1', [newUserId]);
  }
  const user = userRows.rows[0];

  if (user.is_active === false) {
    return loginErr('account_deactivated');
  }

  // Create session
  const sessionToken = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)',
    [`ses-${uid()}`, user.id, sessionToken, expires]);
  await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

  // Always redirect to APP_URL (avoids wrong port if Azure callback URI differs)
  res.redirect(`${APP_BASE_URL}/?token=${sessionToken}`);
}));

// Public auth routes (no middleware)
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const r = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated' });
  if (!user.password_hash || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)', [`ses-${uid()}`, user.id, token, expires]);
  await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
}));

app.get('/api/auth/invite/:token', wrap(async (req, res) => {
  const r = await q(`SELECT email, role, expires_at, status FROM invitations WHERE token=$1`, [req.params.token]);
  const inv = r.rows[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status !== 'pending') return res.status(410).json({ error: 'This invitation has already been used' });
  if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'This invitation has expired' });
  res.json({ email: inv.email, role: inv.role });
}));

app.get('/api/auth/invitations', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q(`SELECT id, email, role, status, expires_at, invited_by, created_at
    FROM invitations ORDER BY created_at DESC`);
  res.json(r.rows);
}));

app.delete('/api/auth/invitations/:id', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  await q(`UPDATE invitations SET status='cancelled' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/auth/accept-invite', wrap(async (req, res) => {
  const { token, name, password } = req.body;
  if (!token || !name || !password) return res.status(400).json({ error: 'Token, name and password required' });
  const r = await q(`SELECT * FROM invitations WHERE token=$1 AND status='pending' AND expires_at>NOW()`, [token]);
  const inv = r.rows[0];
  if (!inv) return res.status(400).json({ error: 'Invalid or expired invitation' });
  const orgR = await q('SELECT id FROM organizations LIMIT 1');
  const orgId = orgR.rows[0]?.id;
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const userId = `usr-${uid()}`;
  const hash = hashPassword(password);
  await q(`INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
    [userId, orgId, name, inv.email, color, inv.role || 'member', hash]);
  await q(`UPDATE invitations SET status='accepted' WHERE id=$1`, [inv.id]);
  const sessionToken = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)', [`ses-${uid()}`, userId, sessionToken, expires]);
  const newUser = (await q('SELECT id,name,email,role,color,is_active FROM users WHERE id=$1', [userId])).rows[0];
  res.status(201).json({ token: sessionToken, user: newUser });
}));

// Protected auth routes
app.post('/api/auth/logout', requireAuth, wrap(async (req, res) => {
  const token = req.headers['authorization'].slice(7);
  await q('DELETE FROM sessions WHERE token=$1', [token]);
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users WHERE id=$1', [req.user.user_id]);
  res.json(r.rows[0]);
}));

// ── User Management ────────────────────────────────────────
app.get('/api/users', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,created_at,theme FROM users ORDER BY created_at');
  res.json(r.rows);
}));

app.put('/api/users/:id', requireAuth, wrap(async (req, res) => {
  const isSelf = req.user.user_id === req.params.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { name, email, role, is_active, theme, color, avatar_url } = req.body;
  const before = (await q('SELECT name,email,role,is_active,theme FROM users WHERE id=$1', [req.params.id])).rows[0];

  // Build dynamic update — self can only update name/theme/color/avatar; admins can also update role/is_active
  const setClauses = [], vals = [];
  const push = (col, val) => { setClauses.push(`${col}=$${vals.length + 1}`); vals.push(val); };

  if (name     !== undefined) push('name', name);
  if (email    !== undefined && isAdmin && !isSelf) push('email', email);
  if (theme    !== undefined) push('theme', theme);
  if (color    !== undefined) push('color', color);
  if (avatar_url !== undefined) push('avatar_url', avatar_url);
  if (isAdmin) {
    if (role     !== undefined) push('role', role);
    if (is_active !== undefined) push('is_active', is_active);
  }
  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.id);
  const r = await q(`UPDATE users SET ${setClauses.join(',')} WHERE id=$${vals.length} RETURNING id,name,email,role,is_active,color,avatar_url,theme`, vals);
  const updated = r.rows[0];
  if (updated && isAdmin && before) {
    if (role && before.role !== role) sendRoleChangeEmail(updated, role).catch(()=>{});
    if (typeof is_active === 'boolean' && before.is_active !== is_active) sendActivationEmail(updated, is_active).catch(()=>{});
  }
  res.json(updated);
}));

app.put('/api/users/:id/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  const userId = req.params.id;
  if (req.user.user_id !== userId && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Forbidden' });
  if (req.user.user_id === userId && current_password) {
    const r = await q('SELECT password_hash FROM users WHERE id=$1', [userId]);
    if (r.rows[0]?.password_hash && !verifyPassword(current_password, r.rows[0].password_hash))
      return res.status(400).json({ error: 'Current password is incorrect' });
  }
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), userId]);
  // Send password reset notification if admin reset someone else's password
  if (req.user.user_id !== userId) {
    const user = (await q('SELECT name,email FROM users WHERE id=$1', [userId])).rows[0];
    if (user) sendPasswordResetEmail(user).catch(()=>{});
  }
  res.json({ ok: true });
}));

app.post('/api/users', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can create users' });
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  const ex = await q('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  if (ex.rows.length) return res.status(409).json({ error: 'User with this email already exists' });
  const orgR = await q('SELECT id FROM organizations LIMIT 1');
  const orgId = orgR.rows[0]?.id;
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const userId = `usr-${uid()}`;
  const hash = hashPassword(password);
  const r = await q(
    `INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING id,name,email,role,is_active`,
    [userId, orgId, name, email.toLowerCase().trim(), color, role || 'member', hash]
  );
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/users/:id', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can delete users' });
  const { id } = req.params;
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  const ex = await q('SELECT id FROM users WHERE id=$1', [id]);
  if (!ex.rows.length) return res.status(404).json({ error: 'User not found' });
  // Clear all FK references before deleting user
  await q('UPDATE issues SET assignee_id=NULL WHERE assignee_id=$1', [id]).catch(()=>{});
  await q('UPDATE issues SET reporter_id=NULL WHERE reporter_id=$1', [id]).catch(()=>{});
  await q('UPDATE roadmap_items SET created_by=NULL WHERE created_by=$1', [id]).catch(()=>{});
  await q('UPDATE roadmap_items SET assigned_to=NULL WHERE assigned_to=$1', [id]).catch(()=>{});
  await q('UPDATE worklogs SET user_id=NULL WHERE user_id=$1', [id]).catch(()=>{});
  await q('UPDATE spaces SET owner_id=$1 WHERE owner_id=$2', [req.user.id, id]).catch(()=>{});
  await q('DELETE FROM saved_filters WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM space_favorites WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM space_members WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM comments WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM notifications WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM issue_field_values WHERE issue_id IN (SELECT id FROM issues WHERE assignee_id=$1 OR reporter_id=$1)', [id]).catch(()=>{});
  await q('DELETE FROM invitations WHERE invited_by=$1', [id]).catch(()=>{});
  await q('DELETE FROM sessions WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM audit_logs WHERE user_id=$1', [id]).catch(()=>{});
  await q('DELETE FROM roadmap_colors WHERE created_by=$1', [id]).catch(()=>{});
  await q('DELETE FROM users WHERE id=$1', [id]);
  res.json({ success: true });
}));

// ── Email Helpers ──────────────────────────────────────────
async function getEmailSettings() {
  // DB settings take priority; fall back to .env SMTP_* variables
  const r = await q(`SELECT email_settings FROM organizations LIMIT 1`);
  const dbCfg = r.rows[0]?.email_settings;
  if (dbCfg && dbCfg.smtp_host && dbCfg.smtp_user && dbCfg.smtp_pass) return dbCfg;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS &&
      !process.env.SMTP_USER.includes('your@')) {
    return {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: parseInt(process.env.SMTP_PORT) || 587,
      smtp_user: process.env.SMTP_USER,
      smtp_pass: process.env.SMTP_PASS,
      smtp_from: process.env.SMTP_FROM || process.env.SMTP_USER
    };
  }
  return null;
}

function emailWrapper(bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f0f4f8;padding:32px;border-radius:8px">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="color:#174F96;font-size:22px;margin:0">Neutara Technologies</h1>
      <p style="color:#64748b;margin:4px 0 0;font-size:13px">SprintBoard Enterprise</p>
    </div>
    <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e2e8f0">${bodyHtml}</div>
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px">© Neutara Technologies. This is an automated notification.</p>
  </div>`;
}

async function sendEmail(toEmail, subject, bodyHtml) {
  if (!nodemailer) return { sent: false, reason: 'nodemailer not available' };
  const cfg = await getEmailSettings();
  if (!cfg) return { sent: false, reason: 'SMTP not configured' };
  try {
    const isMicrosoft = cfg.smtp_host && (cfg.smtp_host.includes('office365') || cfg.smtp_host.includes('outlook') || cfg.smtp_host.includes('hotmail'));
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port || 587,
      secure: cfg.smtp_port == 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
      ...(isMicrosoft ? { tls: { ciphers: 'SSLv3', rejectUnauthorized: false } } : {})
    });
    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: toEmail,
      subject,
      html: emailWrapper(bodyHtml)
    });
    console.log(`[email] Sent "${subject}" → ${toEmail}`);
    return { sent: true };
  } catch(e) {
    console.error('[email] Send error:', e.message);
    return { sent: false, reason: e.message };
  }
}

async function sendInviteEmail(toEmail, inviteUrl, inviterName, orgName, isResend) {
  const action = isResend ? 'renewed' : 'sent';
  const heading = isResend ? 'Your Invitation Has Been Renewed' : "You've Been Invited!";
  const body = `<h2 style="color:#1e293b;margin-top:0">${heading}</h2>
    <p style="color:#475569">${inviterName} has invited you to join <strong>${orgName}</strong> on SprintBoard.</p>
    <p style="color:#475569">Click the button below to accept your invitation and set up your account:</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${inviteUrl}" style="background:#174F96;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Accept Invitation &amp; Set Password</a>
    </div>
    <p style="color:#94a3b8;font-size:12px">This invitation link expires in 7 days.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
    <p style="color:#94a3b8;font-size:11px;margin:0">Or copy: <a href="${inviteUrl}" style="color:#174F96">${inviteUrl}</a></p>`;
  return sendEmail(toEmail, `You've been invited to join ${orgName} on SprintBoard`, body);
}

async function sendActivationEmail(user, activated) {
  const status = activated ? 'Activated' : 'Deactivated';
  const color = activated ? '#16a34a' : '#dc2626';
  const msg = activated
    ? 'Your account has been <strong>activated</strong>. You can now sign in to SprintBoard.'
    : 'Your account has been <strong>deactivated</strong> by an administrator. Please contact your admin if you believe this is an error.';
  const body = `<h2 style="color:${color};margin-top:0">Account ${status}</h2>
    <p style="color:#475569">Hi <strong>${user.name}</strong>,</p>
    <p style="color:#475569">${msg}</p>
    ${activated ? `<div style="text-align:center;margin:24px 0"><a href="http://localhost:3000/login.html" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Sign In Now</a></div>` : ''}`;
  return sendEmail(user.email, `Your SprintBoard account has been ${status.toLowerCase()}`, body);
}

async function sendPasswordResetEmail(user) {
  const body = `<h2 style="color:#1e293b;margin-top:0">Password Reset</h2>
    <p style="color:#475569">Hi <strong>${user.name}</strong>,</p>
    <p style="color:#475569">Your SprintBoard password has been <strong>reset by an administrator</strong>.</p>
    <p style="color:#475569">Please sign in with your new password. If you did not expect this change, contact your administrator immediately.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="http://localhost:3000/login.html" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Sign In</a>
    </div>`;
  return sendEmail(user.email, 'Your SprintBoard password has been reset', body);
}

async function sendRoleChangeEmail(user, newRole) {
  const roleColors = { owner: '#7c3aed', admin: '#174F96', member: '#0891b2' };
  const color = roleColors[newRole] || '#174F96';
  const body = `<h2 style="color:#1e293b;margin-top:0">Role Updated</h2>
    <p style="color:#475569">Hi <strong>${user.name}</strong>,</p>
    <p style="color:#475569">Your role in SprintBoard has been updated to:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="background:${color};color:#fff;padding:8px 24px;border-radius:20px;font-weight:700;font-size:15px;text-transform:capitalize">${newRole}</span>
    </div>
    <p style="color:#94a3b8;font-size:12px">If you have questions about your permissions, contact your administrator.</p>`;
  return sendEmail(user.email, `Your SprintBoard role has been updated to ${newRole}`, body);
}

// ── Admin Audit Log ───────────────────────────────────────
app.get('/api/admin/audit-log', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const limit = parseInt(req.query.limit) || 100;
  const r = await q(`SELECT h.*, u.name AS user_name, u.color AS user_color,
      i.key AS issue_key, i.title AS issue_title
    FROM issue_history h
    LEFT JOIN users u ON u.id=h.user_id
    LEFT JOIN issues i ON i.id=h.issue_id
    ORDER BY h.created_at DESC
    LIMIT $1`, [limit]);
  res.json(r.rows);
}));

app.get('/api/admin/email-settings', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const r = await q(`SELECT email_settings FROM organizations LIMIT 1`);
  const dbCfg = r.rows[0]?.email_settings || {};
  if (dbCfg.smtp_pass) dbCfg.smtp_pass = '••••••••';
  const envActive = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && !process.env.SMTP_USER.includes('your@'));
  res.json({ ...dbCfg, env_active: envActive, env_user: envActive ? process.env.SMTP_USER : null });
}));

app.put('/api/admin/email-settings', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body;
  let passToSave = smtp_pass;
  if (smtp_pass === '••••••••') {
    const existing = (await q(`SELECT email_settings FROM organizations LIMIT 1`)).rows[0]?.email_settings;
    passToSave = existing?.smtp_pass || '';
  }
  const cfg = { smtp_host, smtp_port: parseInt(smtp_port)||587, smtp_user, smtp_pass: passToSave, smtp_from };
  await q(`UPDATE organizations SET email_settings=$1 WHERE id=(SELECT id FROM organizations LIMIT 1)`, [JSON.stringify(cfg)]);
  res.json({ ok: true });
}));

app.post('/api/admin/email-test', requireAuth, wrap(async (req, res) => {
  if (!requireOrgAdmin(req.user, res)) return;
  const body = `<h2 style="color:#1e293b;margin-top:0">Test Email</h2>
    <p style="color:#475569">Hi <strong>${req.user.name}</strong>,</p>
    <p style="color:#475569">This is a test email from SprintBoard. Your SMTP configuration is working correctly!</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px;margin-top:16px">
      <p style="color:#16a34a;margin:0;font-weight:600">✅ Email delivery is configured and working.</p>
    </div>`;
  const result = await sendEmail(req.user.email, 'SprintBoard — Test Email', body);
  res.json(result);
}));

app.post('/api/auth/invite', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can invite users' });
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const ex = await q('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
  if (ex.rows.length) return res.status(409).json({ error: 'User with this email already exists' });
  const orgR = await q('SELECT * FROM organizations LIMIT 1');
  const org = orgR.rows[0];
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q(`INSERT INTO invitations(id,email,org_id,invited_by,role,token,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [`inv-${uid()}`, email.toLowerCase().trim(), org?.id, req.user.user_id, role || 'member', token, expires]);
  const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?invite=${token}`;
  const emailResult = await sendInviteEmail(email, inviteUrl, req.user.name, org?.name || 'Neutara Technologies');
  res.status(201).json({ ok: true, invite_url: inviteUrl, token, email_sent: emailResult.sent, email_reason: emailResult.reason });
}));

app.post('/api/auth/invitations/:id/resend', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Admins only' });
  const r = await q(`SELECT * FROM invitations WHERE id=$1`, [req.params.id]);
  const inv = r.rows[0];
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  // Generate new token and reset expiry
  const newToken = generateToken();
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q(`UPDATE invitations SET token=$1, expires_at=$2, status='pending' WHERE id=$3`, [newToken, newExpiry, inv.id]);
  const orgR = await q('SELECT * FROM organizations LIMIT 1');
  const org = orgR.rows[0];
  const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?invite=${newToken}`;
  const emailResult = await sendInviteEmail(inv.email, inviteUrl, req.user.name, org?.name || 'Neutara Technologies');
  res.json({ ok: true, invite_url: inviteUrl, email_sent: emailResult.sent, email_reason: emailResult.reason });
}));

// ── Error Handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Crash Protection ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});

// SPA routes — refresh-safe deep links
const SPA_HTML = path.join(__dirname, 'index.html');
app.get([
  '/',
  '/spaces',
  '/reports',
  '/work-log',
  '/roadmap',
  '/settings',
  '/my-work',
  '/my-work/open',
  '/my-work/assigned',
  '/my-work/reported',
  '/my-work/recent'
], (req, res) => {
  res.sendFile(SPA_HTML);
});
app.get('/space/:key/:tab?', (req, res) => {
  res.sendFile(SPA_HTML);
});

// ── Startup (read-only — no DDL) ─────────────────────────
(async () => {
  try {
    await pool.query('SELECT 1');

    // Bring the schema up to what this build expects, before anything serves
    // traffic. Tracked in schema_migrations, so this is a no-op on every boot
    // after the first. MIGRATE_ON_BOOT=off skips it (apply manually with
    // `npm run migrate`); =warn starts the server even if a migration fails.
    const migrateMode = (process.env.MIGRATE_ON_BOOT || 'on').toLowerCase();
    if (migrateMode === 'off') {
      console.log('[migrate] Skipped (MIGRATE_ON_BOOT=off).');
    } else {
      try {
        await runMigrations(pool);
      } catch (e) {
        if (migrateMode === 'warn') {
          console.error('[migrate] Continuing despite failure (MIGRATE_ON_BOOT=warn):', e.message);
        } else {
          console.error('');
          console.error('  DEPLOY ABORTED — a database migration failed.');
          console.error('  ' + e.message);
          console.error('  The schema was rolled back to its previous state and no');
          console.error('  traffic was served. Fix the migration or restore the last');
          console.error('  release; data is unchanged.');
          console.error('');
          process.exit(1);
        }
      }
    }

    await validateSchemaReadOnly(pool);
    await logProductTeamCombinationStatus(pool, q);
    await logDuplicateKeyWarning(pool, q);

    console.log('==================================================');
    console.log('  SprintBoard Server');
    console.log('  Database connected (schema read-only at boot)');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log('  Listening on http://localhost:' + PORT);
      console.log('==================================================');
      // Started after listen so a slow first sweep never delays accepting traffic.
      startRetentionSweeper(q);
    });
  } catch (e) {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
  }
})();
