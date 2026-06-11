require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const uid = () => crypto.randomUUID();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

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
app.use(express.json());
app.use(express.static(__dirname));

// Serve uploaded files
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Multer storage config — max 500 MB
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

  const [org, users, allSpaces, allSm, sf] = await Promise.all([
    q('SELECT * FROM organizations LIMIT 1'),
    q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,theme FROM users'),
    q('SELECT * FROM spaces WHERE is_archived=false'),
    q('SELECT * FROM space_members'),
    q('SELECT * FROM space_favorites')
  ]);

  // Members only see spaces they are assigned to
  const myMemberships = allSm.rows.filter(function(m) { return m.user_id === userId; });
  const mySpaceIds = myMemberships.map(function(m) { return m.space_id; });
  const spaces = isAdmin ? allSpaces.rows : allSpaces.rows.filter(function(s) { return mySpaceIds.includes(s.id); });
  // Admins see all space_members; members only see memberships for their spaces
  const space_members = isAdmin ? allSm.rows : allSm.rows.filter(function(m) { return mySpaceIds.includes(m.space_id); });

  // Determine which space IDs to load issues/sprints for
  const visibleSpaceIds = spaces.map(function(s) { return s.id; });

  const sf1 = sid ? ' WHERE space_id=$1' : '';
  const p = sid ? [sid] : [];
  const [sprints, issues, worklogs, comments, cf, filters, notifs, ifv] = await Promise.all([
    q('SELECT * FROM sprints' + sf1, p),
    q('SELECT * FROM issues' + (sf1 ? sf1 + ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'), p),
    q(`SELECT w.* FROM worklogs w${sid ? ' JOIN issues i ON w.issue_id=i.id WHERE i.space_id=$1' : ''}`, p),
    q(`SELECT c.* FROM comments c${sid ? ' JOIN issues i ON c.issue_id=i.id WHERE i.space_id=$1' : ''}`, p),
    q('SELECT * FROM custom_fields' + sf1, p),
    q('SELECT * FROM saved_filters' + sf1, p),
    q('SELECT * FROM notifications WHERE user_id=$1', [userId]),
    q(`SELECT ifv.* FROM issue_field_values ifv JOIN issues i ON ifv.issue_id=i.id${sid ? ' WHERE i.space_id=$1' : ''}`, p)
  ]);

  // Filter issues/sprints to only non-archived visible spaces (everyone, including admins)
  const filteredIssues = issues.rows.filter(function(i) { return visibleSpaceIds.includes(i.space_id); });
  const filteredSprints = sprints.rows.filter(function(s) { return visibleSpaceIds.includes(s.space_id); });

  res.json({
    org: org.rows[0] || null, users: users.rows, spaces: spaces,
    space_members: space_members, space_favorites: sf.rows, sprints: filteredSprints,
    issues: filteredIssues, worklogs: worklogs.rows, comments: comments.rows,
    custom_fields: cf.rows, saved_filters: filters.rows, notifications: notifs.rows,
    issue_field_values: ifv.rows
  });
}));

// ── My Issues (fast, cross-space) ────────────────────────
app.get('/api/my-issues', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id;
  const [assigned, reported, recent] = await Promise.all([
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.assignee_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.updated_at DESC`, [userId]),
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.reporter_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.updated_at DESC`, [userId]),
    q(`SELECT i.*, s.name AS space_name, s.key AS project_key,
              a.name AS assignee_name, a.color AS assignee_color
       FROM issues i
       LEFT JOIN spaces s ON s.id = i.space_id
       LEFT JOIN users a ON a.id = i.assignee_id
       WHERE i.deleted_at IS NULL
       ORDER BY i.updated_at DESC LIMIT 30`)
  ]);
  res.json({ assigned: assigned.rows, reported: reported.rows, recent: recent.rows });
}));

// ── Organization ─────────────────────────────────────────
app.get('/api/org', wrap(async (req, res) => {
  const r = await q('SELECT * FROM organizations LIMIT 1');
  res.json(r.rows[0] || null);
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
app.get('/api/spaces', wrap(async (req, res) => {
  const r = await q(`SELECT s.*, COUNT(sm.id)::int AS member_count
    FROM spaces s LEFT JOIN space_members sm ON sm.space_id=s.id
    WHERE s.is_archived=false GROUP BY s.id ORDER BY s.name`);
  res.json(r.rows);
}));

app.post('/api/spaces', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Only admins can create spaces' });
  const { name, key, description, icon, color, space_type, visibility, owner_id } = req.body;
  const id = uid();
  const r = await q(`INSERT INTO spaces(id,name,key,description,icon,color,space_type,visibility,owner_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, name, key, description, icon, color, space_type, visibility, owner_id]);
  await q(`INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,'site_admin')`, [uid(), id, owner_id]);
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
  if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Not authorized' });
  const keys = Object.keys(req.body), vals = Object.values(req.body);
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const r = await q(`UPDATE spaces SET ${set},updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/spaces/:id', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Not authorized' });
  await q('UPDATE spaces SET is_archived=true,updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/spaces/:id/favorite', wrap(async (req, res) => {
  const { user_id } = req.body, spid = req.params.id;
  const ex = await q('SELECT 1 FROM space_favorites WHERE space_id=$1 AND user_id=$2', [spid, user_id]);
  if (ex.rows.length) {
    await q('DELETE FROM space_favorites WHERE space_id=$1 AND user_id=$2', [spid, user_id]);
    res.json({ favorited: false });
  } else {
    await q('INSERT INTO space_favorites(user_id,space_id) VALUES($1,$2)', [user_id, spid]);
    res.json({ favorited: true });
  }
}));

app.get('/api/spaces/:id/members', wrap(async (req, res) => {
  const r = await q(`SELECT sm.*, u.name, u.email, u.avatar_url, u.color
    FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=$1`, [req.params.id]);
  res.json(r.rows);
}));

// ── Space Members ─────────────────────────────────────────
app.post('/api/space-members', wrap(async (req, res) => {
  const { space_id, user_id, role } = req.body;
  const r = await q('INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), space_id, user_id, role || 'member']);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/space-members/:id', wrap(async (req, res) => {
  const r = await q('UPDATE space_members SET role=$1 WHERE id=$2 RETURNING *', [req.body.role, req.params.id]);
  res.json(r.rows[0]);
}));

app.delete('/api/space-members/:id', wrap(async (req, res) => {
  await q('DELETE FROM space_members WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Sprints ───────────────────────────────────────────────
app.get('/api/sprints', wrap(async (req, res) => {
  const r = await q('SELECT * FROM sprints WHERE space_id=$1 ORDER BY created_at DESC', [req.query.space_id]);
  res.json(r.rows);
}));

app.post('/api/sprints', wrap(async (req, res) => {
  const { space_id, name, goal, start_date, end_date } = req.body;
  const r = await q('INSERT INTO sprints(id,space_id,name,goal,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [uid(), space_id, name, goal, start_date || null, end_date || null]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/sprints/:id', wrap(async (req, res) => {
  const keys = Object.keys(req.body), vals = Object.values(req.body);
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const r = await q(`UPDATE sprints SET ${set} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/sprints/:id', wrap(async (req, res) => {
  await q('UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1', [req.params.id]);
  await q('DELETE FROM sprints WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/sprints/:id/start', wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [req.params.id])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  const active = await q("SELECT id FROM sprints WHERE space_id=$1 AND status='active' AND id!=$2",
    [sprint.space_id, sprint.id]);
  if (active.rows.length) return res.status(400).json({ error: 'Another sprint is already active in this space' });
  const r = await q("UPDATE sprints SET status='active' WHERE id=$1 RETURNING *", [req.params.id]);
  // Notify all space members
  const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
  members.rows.forEach(function(m) {
    createNotif({ user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_started',
      title: sprint.name + ' has started',
      body: 'Sprint is now active. Time to get to work!' });
  });
  res.json(r.rows[0]);
}));

app.post('/api/sprints/:id/complete', wrap(async (req, res) => {
  const sid = req.params.id;
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [sid])).rows[0];
  const done = await q("SELECT COALESCE(SUM(story_points),0)::int AS pts FROM issues WHERE sprint_id=$1 AND status='Done'", [sid]);
  await q("UPDATE sprints SET status='completed',velocity=$2 WHERE id=$1", [sid, done.rows[0].pts]);
  await q("UPDATE issues SET sprint_id=NULL WHERE sprint_id=$1 AND status!='Done'", [sid]);
  const r = await q('SELECT * FROM sprints WHERE id=$1', [sid]);
  // Notify all space members
  if (sprint) {
    const members = await q('SELECT user_id FROM space_members WHERE space_id=$1', [sprint.space_id]);
    members.rows.forEach(function(m) {
      createNotif({ user_id: m.user_id, space_id: sprint.space_id, type: 'sprint_completed',
        title: sprint.name + ' has been completed',
        body: 'Sprint completed with ' + done.rows[0].pts + ' story points.' });
    });
  }
  res.json(r.rows[0]);
}));

// ── Issues ────────────────────────────────────────────────
app.get('/api/issues', wrap(async (req, res) => {
  const { space_id, sprint_id, type, status, assignee_id, priority, search } = req.query;
  let where = [], params = [], n = 1;
  const add = (col, val) => { where.push(`${col}=$${n++}`); params.push(val); };
  if (space_id) add('i.space_id', space_id);
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

app.get('/api/issues/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const issue = (await q(`SELECT i.*,
      a.name AS assignee_name, a.color AS assignee_color,
      rep.name AS reporter_name, rep.color AS reporter_color,
      s.key AS project_key,
      p.key AS parent_key, p.title AS parent_title, p.type AS parent_type
    FROM issues i
    LEFT JOIN users a ON a.id=i.assignee_id
    LEFT JOIN users rep ON rep.id=i.reporter_id
    LEFT JOIN spaces s ON s.id=i.space_id
    LEFT JOIN issues p ON p.id=i.parent_id
    WHERE i.id=$1`, [id])).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  const [worklogs, comments, links, subtasks, cfv, history, attachments] = await Promise.all([
    q(`SELECT w.*, u.name AS user_name, u.color AS user_color FROM worklogs w
      LEFT JOIN users u ON u.id=w.user_id WHERE w.issue_id=$1 ORDER BY w.created_at DESC`, [id]),
    q(`SELECT c.*, u.name AS user_name, u.avatar_url, u.color AS user_color
      FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.issue_id=$1 ORDER BY c.created_at`, [id]),
    q(`SELECT l.*, t.key AS target_key, t.title AS target_title, t.status AS target_status, t.type AS target_type
      FROM issue_links l
      LEFT JOIN issues t ON (t.id=CASE WHEN l.source_id=$1 THEN l.target_id ELSE l.source_id END)
      WHERE l.source_id=$1 OR l.target_id=$1`, [id]),
    q(`SELECT id, key, title, status, type, priority, assignee_id, story_points
      FROM issues WHERE parent_id=$1 ORDER BY position, created_at`, [id]),
    q(`SELECT v.*, f.name AS field_name, f.field_type
      FROM issue_field_values v JOIN custom_fields f ON f.id=v.field_id WHERE v.issue_id=$1`, [id]),
    q(`SELECT h.*, u.name AS user_name, u.color AS user_color
      FROM issue_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.issue_id=$1 ORDER BY h.created_at DESC`, [id]),
    q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
      LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [id])
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

app.post('/api/issues', wrap(async (req, res) => {
  const b = req.body;
  if (!b.space_id) return res.status(400).json({ error: 'space_id is required' });
  const cnt = (await q("SELECT COUNT(*)::int AS c FROM issues WHERE space_id=$1", [b.space_id])).rows[0].c;
  const spaceKeyRow = (await q('SELECT key FROM spaces WHERE id=$1', [b.space_id])).rows[0];
  if (!spaceKeyRow) return res.status(400).json({ error: 'Invalid space_id' });
  const spaceKey = spaceKeyRow.key;
  const key = `${spaceKey}-${cnt + 1}`;
  const id = uid();
  const r = await q(`INSERT INTO issues(id,key,space_id,sprint_id,parent_id,title,description,type,priority,
      assignee_id,reporter_id,story_points,labels,start_date,due_date,original_estimate)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [id, key, b.space_id, b.sprint_id || null, b.parent_id || null, b.title, b.description || null,
     b.type || 'task', b.priority || 'medium', b.assignee_id || null, b.reporter_id || null,
     b.story_points || b.points || null, b.labels || null, b.start_date || null, b.due_date || null, b.original_estimate || null]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/issues/:id', requireAuth, wrap(async (req, res) => {
  const keys = Object.keys(req.body), vals = Object.values(req.body);
  if (!keys.length) return res.json((await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0]);
  // Fetch old values before update to track history
  const oldRow = (await q('SELECT * FROM issues WHERE id=$1', [req.params.id])).rows[0];
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const r = await q(`UPDATE issues SET ${set},updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  const newRow = r.rows[0];
  // Record history for each changed field
  const TRACKED = ['title','status','priority','assignee_id','reporter_id','sprint_id','labels','story_points','start_date','due_date','description','fix_description'];
  if (oldRow) {
    for (const key of keys) {
      if (!TRACKED.includes(key)) continue;
      const oldVal = oldRow[key] != null ? String(oldRow[key]) : null;
      const newVal = req.body[key] != null ? String(req.body[key]) : null;
      if (oldVal !== newVal) {
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
          [uid(), req.params.id, req.user.user_id, key, oldVal, newVal]).catch(()=>{});
      }
    }
    const actor = req.user.user_id;
    const issueKey = oldRow.key || req.params.id;
    const spaceId = oldRow.space_id;
    const link = '/?' + issueKey;
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
  }
  res.json(newRow);
}));

app.delete('/api/issues/:id', wrap(async (req, res) => {
  const id = req.params.id;
  await q('DELETE FROM comments WHERE issue_id=$1', [id]);
  await q('DELETE FROM worklogs WHERE issue_id=$1', [id]);
  await q('DELETE FROM issue_links WHERE source_id=$1 OR target_id=$1', [id]);
  await q('DELETE FROM issue_field_values WHERE issue_id=$1', [id]);
  await q('DELETE FROM issues WHERE parent_id=$1', [id]);
  await q('DELETE FROM issues WHERE id=$1', [id]);
  res.json({ ok: true });
}));

app.put('/api/issues/:id/move', wrap(async (req, res) => {
  const { sprint_id, position } = req.body;
  const r = await q('UPDATE issues SET sprint_id=$2,position=$3,updated_at=NOW() WHERE id=$1 RETURNING *',
    [req.params.id, sprint_id === undefined ? null : sprint_id, position || 0]);
  res.json(r.rows[0]);
}));

app.post('/api/issues/bulk', wrap(async (req, res) => {
  const { ids, updates } = req.body;
  const keys = Object.keys(updates), vals = Object.values(updates);
  if (!keys.length || !ids.length) return res.json({ ok: true, updated: 0 });
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const r = await q(`UPDATE issues SET ${set},updated_at=NOW() WHERE id=ANY($1) RETURNING *`, [ids, ...vals]);
  res.json({ ok: true, updated: r.rowCount, issues: r.rows });
}));

// ── Comments ──────────────────────────────────────────────
app.post('/api/comments', wrap(async (req, res) => {
  const { issue_id, user_id, body } = req.body;
  const r = await q('INSERT INTO comments(id,issue_id,user_id,body) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), issue_id, user_id, body]);
  // Notify assignee and reporter (skip commenter)
  const issue = (await q('SELECT * FROM issues WHERE id=$1', [issue_id])).rows[0];
  if (issue) {
    const commenter = user_id;
    const link = '/?' + (issue.key || issue_id);
    const preview = body.length > 80 ? body.slice(0, 80) + '…' : body;
    const notifyUsers = new Set([issue.assignee_id, issue.reporter_id].filter(Boolean));
    notifyUsers.forEach(function(uid_) {
      if (uid_ !== commenter) {
        createNotif({ user_id: uid_, space_id: issue.space_id, type: 'comment_added',
          title: 'New comment on ' + (issue.key || issue_id),
          body: preview, link });
      }
    });
  }
  res.status(201).json(r.rows[0]);
}));

app.put('/api/comments/:id', wrap(async (req, res) => {
  const r = await q('UPDATE comments SET body=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.body, req.params.id]);
  res.json(r.rows[0]);
}));

app.delete('/api/comments/:id', wrap(async (req, res) => {
  await q('DELETE FROM comments WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Worklogs ──────────────────────────────────────────────
app.get('/api/worklogs', wrap(async (req, res) => {
  const { space_id, user_id, from, to } = req.query;
  let where = [], params = [], n = 1;
  if (space_id) { where.push(`i.space_id=$${n++}`); params.push(space_id); }
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
  const user_id = req.user.user_id; // always use session user, ignore any client-sent user_id
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
  if (space_id) { params.push(space_id); sql += ` AND r.space_id=$${params.length}`; }
  if (status)   { params.push(status);   sql += ` AND r.status=$${params.length}`; }
  sql += ' ORDER BY r.start_date ASC NULLS LAST, r.created_at ASC';
  res.json((await q(sql, params)).rows);
}));

app.post('/api/roadmap', requireAuth, wrap(async (req, res) => {
  const { title, description, status, start_date, end_date, space_id, issue_id, color, priority, assigned_to, group_name, category, milestone } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

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
app.post('/api/links', wrap(async (req, res) => {
  const { source_id, target_id, link_type } = req.body;
  const r = await q('INSERT INTO issue_links(id,source_id,target_id,link_type) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), source_id, target_id, link_type]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/links/:id', wrap(async (req, res) => {
  await q('DELETE FROM issue_links WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Attachments ───────────────────────────────────────────
app.get('/api/issues/:id/attachments', wrap(async (req, res) => {
  const r = await q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [req.params.id]);
  res.json(r.rows);
}));

app.post('/api/issues/:id/attachments', requireAuth, (req, res, next) => {
  if (!upload) return res.status(503).json({ error: 'File upload not available' });
  upload.array('files', 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const saved = [];
      for (const f of req.files) {
        const r = await q(`INSERT INTO issue_attachments(id,issue_id,filename,original_name,size,mime_type,uploaded_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [uid(), req.params.id, f.filename, f.originalname, f.size, f.mimetype, req.user.user_id]);
        saved.push(r.rows[0]);
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
          VALUES($1,$2,$3,'attachment',NULL,$4)`,
          [uid(), req.params.id, req.user.user_id, f.originalname]);
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
app.get('/api/custom-fields', wrap(async (req, res) => {
  const r = await q('SELECT * FROM custom_fields WHERE space_id=$1 ORDER BY position', [req.query.space_id]);
  res.json(r.rows);
}));

app.post('/api/custom-fields', wrap(async (req, res) => {
  const b = req.body;
  // options must be JSON-stringified for jsonb column (pg binds arrays as PG arrays otherwise)
  const opts = b.options != null ? JSON.stringify(Array.isArray(b.options) ? b.options : []) : '[]';
  const r = await q(`INSERT INTO custom_fields(id,space_id,name,field_type,options,is_required,position)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
    [uid(), b.space_id, b.name, b.field_type, opts, b.is_required || false, b.position || 0]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/custom-fields/:id', wrap(async (req, res) => {
  const body = { ...req.body };
  // Fix options jsonb binding same as POST
  if (body.options !== undefined) {
    body.options = JSON.stringify(Array.isArray(body.options) ? body.options : []);
  }
  const keys = Object.keys(body);
  const vals = keys.map(k => k === 'options' ? body[k] + '::jsonb' : body[k]);
  // Build set clause, casting options to jsonb
  const set = keys.map((k, i) => k === 'options' ? `options=$${i+2}::jsonb` : `${k}=$${i+2}`).join(',');
  const r = await q(`UPDATE custom_fields SET ${set} WHERE id=$1 RETURNING *`,
    [req.params.id, ...keys.map(k => body[k])]);
  res.json(r.rows[0]);
}));

// Upsert a single custom field value for an issue
app.put('/api/issues/:id/field-values/:fieldId', requireAuth, wrap(async (req, res) => {
  const { id: issueId, fieldId } = req.params;
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

app.delete('/api/custom-fields/:id', wrap(async (req, res) => {
  await q('DELETE FROM issue_field_values WHERE field_id=$1', [req.params.id]);
  await q('DELETE FROM custom_fields WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Saved Filters ─────────────────────────────────────────
app.get('/api/filters', wrap(async (req, res) => {
  let where = [], params = [], n = 1;
  if (req.query.space_id) { where.push(`space_id=$${n++}`); params.push(req.query.space_id); }
  if (req.query.user_id) { where.push(`user_id=$${n++}`); params.push(req.query.user_id); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const r = await q('SELECT * FROM saved_filters' + w + ' ORDER BY name', params);
  res.json(r.rows);
}));

app.post('/api/filters', wrap(async (req, res) => {
  const b = req.body;
  const r = await q(`INSERT INTO saved_filters(id,space_id,user_id,name,conditions,is_shared)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [uid(), b.space_id, b.user_id, b.name, JSON.stringify(b.conditions || b.filter_config || {}), b.is_shared || false]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/filters/:id', wrap(async (req, res) => {
  const fields = { ...req.body };
  if (fields.conditions && typeof fields.conditions === 'object') fields.conditions = JSON.stringify(fields.conditions);
  const keys = Object.keys(fields), vals = Object.values(fields);
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
  const r = await q(`UPDATE saved_filters SET ${set} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  res.json(r.rows[0]);
}));

app.delete('/api/filters/:id', wrap(async (req, res) => {
  await q('DELETE FROM saved_filters WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Move issue (drag/drop backlog ↔ sprint) ───────────────
app.put('/api/issues/:id/move', requireAuth, wrap(async (req, res) => {
  const { sprint_id } = req.body;
  const oldRow = (await q('SELECT sprint_id FROM issues WHERE id=$1', [req.params.id])).rows[0];
  const r = await q('UPDATE issues SET sprint_id=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
    [sprint_id || null, req.params.id]);
  if (oldRow) {
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
      [uid(), req.params.id, req.user.user_id, 'sprint_id',
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
  const stats = (await q(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='Done')::int AS done,
      COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
      COALESCE(SUM(story_points) FILTER (WHERE status='Done'),0)::int AS points_completed,
      COALESCE(SUM(story_points) FILTER (WHERE status!='Done'),0)::int AS points_remaining
    FROM issues WHERE sprint_id=$1`, [sid])).rows[0];
  res.json({ sprint, ...stats });
}));

app.get('/api/reports/velocity', requireAuth, wrap(async (req, res) => {
  const r = await q(`SELECT id, name, velocity, start_date, end_date
    FROM sprints WHERE space_id=$1 AND status='completed' ORDER BY end_date`,
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/status', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT status, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY status ORDER BY status',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/priority', requireAuth, wrap(async (req, res) => {
  const r = await q('SELECT priority, COUNT(*)::int AS count FROM issues WHERE space_id=$1 GROUP BY priority ORDER BY priority',
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/workload', requireAuth, wrap(async (req, res) => {
  const r = await q(`SELECT u.id, u.name, COUNT(i.id)::int AS issue_count,
      COALESCE(SUM(i.points),0)::int AS total_points
    FROM users u JOIN issues i ON i.assignee_id=u.id
    WHERE i.space_id=$1 GROUP BY u.id, u.name ORDER BY issue_count DESC`,
    [req.query.space_id]);
  res.json(r.rows);
}));

app.get('/api/reports/burndown/:sprintId', requireAuth, wrap(async (req, res) => {
  const sprint = (await q('SELECT * FROM sprints WHERE id=$1', [req.params.sprintId])).rows[0];
  if (!sprint) return res.status(404).json({ error: 'Not found' });

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

  const start = new Date(sprint.start_date);
  const end = new Date(Math.min(new Date(sprint.end_date), Date.now()));
  const series = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayEnd = new Date(d); dayEnd.setHours(23,59,59,999);
    const doneRows = hist.filter(h => new Date(h.done_at) <= dayEnd);
    const doneCnt = doneRows.length;
    const donePts = doneRows.reduce((s, h) => {
      const iss = issues.find(i => i.id === h.issue_id);
      return s + (iss ? (iss.points || 0) : 0);
    }, 0);
    series.push({ date: d.toISOString().slice(0,10), remaining: total - doneCnt, remainingPts: totalPts - donePts });
  }
  res.json({ sprint, total, totalPts, series });
}));

app.get('/api/reports/cycle-time', requireAuth, wrap(async (req, res) => {
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

// ── Notifications ─────────────────────────────────────────

// Helper: create a notification (fire-and-forget, never throws)
async function createNotif({ user_id, space_id, type, title, body, link }) {
  if (!user_id) return;
  try {
    await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  } catch(e) { /* non-fatal */ }
}

app.get('/api/notifications', wrap(async (req, res) => {
  const r = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY is_read ASC, created_at DESC LIMIT 100',
    [req.query.user_id]);
  res.json(r.rows);
}));

app.post('/api/notifications', requireAuth, wrap(async (req, res) => {
  const { user_id, space_id, type, title, body, link } = req.body;
  if (!user_id || !type || !title) return res.status(400).json({ error: 'user_id, type, title required' });
  const r = await q('INSERT INTO notifications(id,user_id,space_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [uid(), user_id, space_id || null, type, title, body || null, link || null]);
  res.status(201).json(r.rows[0]);
}));

app.delete('/api/notifications/:id', requireAuth, wrap(async (req, res) => {
  await q('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.user_id]);
  res.json({ ok: true });
}));

app.put('/api/notifications/:id/read', wrap(async (req, res) => {
  const r = await q('UPDATE notifications SET is_read=true WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(r.rows[0]);
}));

app.put('/api/notifications/read-all', wrap(async (req, res) => {
  await q('UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false', [req.body.user_id]);
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
async function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  try {
    const r = await q(`SELECT s.user_id, u.name, u.email, u.role, u.is_active
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=$1 AND s.expires_at>NOW()`, [token]);
    if (!r.rows[0] || !r.rows[0].is_active) return res.status(401).json({ error: 'Session expired' });
    req.user = r.rows[0];
    next();
  } catch (e) { return res.status(401).json({ error: 'Auth error' }); }
}

// ── Microsoft OAuth2 config (set these env vars on the server) ────────────
const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID     || '';
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT_ID     = process.env.MICROSOFT_TENANT_ID     || '';
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI  || 'https://sprintboard.cftools.live/api/auth/callback/microsoft';

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

  // Validate CSRF state
  if (!state || !oauthStates.has(state)) {
    return res.redirect('/login.html?error=invalid_state');
  }
  oauthStates.delete(state);

  if (error) {
    return res.redirect('/login.html?error=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect('/login.html?error=no_code');
  }

  // Exchange code for access token
  const tokenData = await msTokenExchange(code);
  if (!tokenData || !tokenData.access_token) {
    console.error('[MS OAuth] Token exchange failed:', tokenData);
    return res.redirect('/login.html?error=token_exchange_failed');
  }

  // Get user profile from Microsoft Graph
  const profile = await msGraphMe(tokenData.access_token);
  if (!profile) {
    return res.redirect('/login.html?error=no_email');
  }

  const email = (profile.mail || profile.userPrincipalName || '').toLowerCase().trim();
  if (!email) {
    return res.redirect('/login.html?error=no_email');
  }

  // Look up user in database
  const userRows = await q('SELECT * FROM users WHERE LOWER(email)=$1', [email]);
  if (!userRows.rows.length) {
    console.error('[MS OAuth] User not found for email:', email);
    return res.redirect('/login.html?error=user_not_found');
  }
  const user = userRows.rows[0];

  if (user.is_active === false) {
    return res.redirect('/login.html?error=account_deactivated');
  }

  // Create session
  const sessionToken = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await q('INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,$4)',
    [`ses-${uid()}`, user.id, sessionToken, expires]);
  await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

  // Redirect to app with token in URL param
  res.redirect(`/?token=${sessionToken}`);
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
  const r = await q(`SELECT id, email, role, status, expires_at, invited_by, created_at
    FROM invitations ORDER BY created_at DESC`);
  res.json(r.rows);
}));

app.delete('/api/auth/invitations/:id', requireAuth, wrap(async (req, res) => {
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
  const r = await q('SELECT id,name,email,role,color,avatar_url,is_active,last_login,created_at,theme FROM users ORDER BY created_at');
  res.json(r.rows);
}));

app.put('/api/users/:id', requireAuth, wrap(async (req, res) => {
  const isSelf = req.user.user_id === req.params.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { name, role, is_active, theme, color, avatar_url } = req.body;
  const before = (await q('SELECT name,email,role,is_active,theme FROM users WHERE id=$1', [req.params.id])).rows[0];

  // Build dynamic update — self can only update name/theme/color/avatar; admins can also update role/is_active
  const setClauses = [], vals = [];
  const push = (col, val) => { setClauses.push(`${col}=$${vals.length + 1}`); vals.push(val); };

  if (name     !== undefined) push('name', name);
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
  const inviteUrl = `http://localhost:3000/login.html?invite=${token}`;
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
  const inviteUrl = `http://localhost:3000/login.html?invite=${newToken}`;
  const emailResult = await sendInviteEmail(inv.email, inviteUrl, req.user.name, org?.name || 'Neutara Technologies');
  res.json({ ok: true, invite_url: inviteUrl, email_sent: emailResult.sent, email_reason: emailResult.reason });
}));

// ── Temporary: Git push helper (removed after deploy) ────
app.post('/api/admin/git-run', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Admins only' });
  const { cmd } = req.body;
  const ALLOWED = ['git init','git add','git commit','git remote','git push','git config','git branch','git status','git log'];
  if (!cmd || !ALLOWED.some(function(p){ return cmd.startsWith(p); })) return res.status(400).json({ error: 'Command not allowed' });
  const { exec } = require('child_process');
  const cwd = __dirname;
  exec(cmd, { cwd: cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, function(err, stdout, stderr) {
    res.json({ ok: !err || stderr === '', stdout: stdout, stderr: stderr, code: err ? err.code : 0 });
  });
}));

// ── Error Handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ── Crash Protection ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});

// ── Admin: DB Sync endpoint ───────────────────────────────
app.post('/api/admin/sync-db', async (req, res) => {
  const secret = req.headers['x-sync-secret'] || req.body?.secret;
  if (secret !== 'neutara-sync-2026') return res.status(403).json({ error: 'Forbidden' });
  try {
    const output = await new Promise((resolve, reject) => {
      require('child_process').exec('node db/create-db.js', { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) reject(stderr || err.message);
        else resolve(stdout);
      });
    });
    console.log('[sync-db]', output);
    res.json({ ok: true, output });
  } catch(e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Startup ───────────────────────────────────────────────
(async () => {
  try {
    await pool.query('SELECT 1');

    // Bootstrap: if tables don't exist (fresh deployment), run create-db.js
    try {
      const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='users')`);
      if (!tableCheck.rows[0].exists) {
        console.log('🏗️  No tables found — running initial DB setup...');
        await new Promise((resolve, reject) => {
          require('child_process').exec('node db/create-db.js', { cwd: __dirname }, (err, stdout, stderr) => {
            if (stdout) console.log(stdout);
            if (err) { console.error('DB setup error:', stderr); reject(err); }
            else resolve();
          });
        });
        console.log('✅ Initial DB setup complete.');
      }
    } catch(e) { console.error('Bootstrap check failed:', e.message); }

    // Migration: add 'cancelled' to invitations status constraint
    try {
      await pool.query(`ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check`);
      await pool.query(`ALTER TABLE invitations ADD CONSTRAINT invitations_status_check CHECK (status IN ('pending','accepted','expired','cancelled'))`);
    } catch(e) { console.error('Migration warning (invitations status):', e.message); }

    // Migration: create issue_history table
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS issue_history (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
        user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        field_name VARCHAR NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch(e) { console.error('Migration warning (issue_history):', e.message); }

    // Migration: add worklogs created_at if missing
    try {
      await pool.query(`ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    } catch(e) {}

    // Migration: create issue_attachments table
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS issue_attachments (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
        filename VARCHAR NOT NULL,
        original_name VARCHAR NOT NULL,
        size BIGINT DEFAULT 0,
        mime_type VARCHAR,
        uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch(e) { console.error('Migration warning (issue_attachments):', e.message); }

    // Migration: add email_settings column to organizations
    try {
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_settings JSONB`);
    } catch(e) { console.error('Migration warning (email_settings):', e.message); }

    // Migration: replace 'admin' with 'site_admin' in space_members role constraint
    try {
      await pool.query(`ALTER TABLE space_members DROP CONSTRAINT IF EXISTS space_members_role_check`);
      await pool.query(`UPDATE space_members SET role='site_admin' WHERE role='admin'`);
      await pool.query(`ALTER TABLE space_members ADD CONSTRAINT space_members_role_check CHECK (role IN ('site_admin','manager','member','viewer'))`);
    } catch(e) { console.error('Migration warning (space_members role):', e.message); }

    // Migration: create roadmap_items table
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS roadmap_items (
        id VARCHAR PRIMARY KEY,
        title VARCHAR NOT NULL,
        description TEXT,
        status VARCHAR DEFAULT 'planned',
        start_date DATE,
        end_date DATE,
        space_id VARCHAR REFERENCES spaces(id) ON DELETE SET NULL,
        issue_id VARCHAR REFERENCES issues(id) ON DELETE SET NULL,
        color VARCHAR DEFAULT '#4d90e0',
        priority VARCHAR DEFAULT 'medium',
        assigned_to VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch(e) { console.error('Migration warning (roadmap_items):', e.message); }

    // Migration: add group_name + category to roadmap_items
    try {
      await pool.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS group_name VARCHAR DEFAULT 'General'`);
      await pool.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS category  VARCHAR DEFAULT 'Items'`);
      await pool.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS milestone BOOLEAN DEFAULT FALSE`);
    } catch(e) { console.error('Migration warning (roadmap group/category):', e.message); }

    // Migration: create roadmap_colors table
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS roadmap_colors (
        color_key  VARCHAR NOT NULL,
        color      VARCHAR NOT NULL,
        created_by VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (color_key, created_by)
      )`);
    } catch(e) { console.error('Migration warning (roadmap_colors):', e.message); }

    // Migration: rename issues.points → story_points to match UI field name
    try {
      await pool.query(`ALTER TABLE issues RENAME COLUMN points TO story_points`);
    } catch(e) { /* already renamed or doesn't exist */ }

    // Migration: add story_points column if it still doesn't exist (fresh installs)
    try {
      await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS story_points INTEGER`);
    } catch(e) {}

    // Migration: add theme preference to users
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR DEFAULT 'dark'`);
    } catch(e) { console.error('Migration warning (user theme):', e.message); }

    // Migration: add fix_description to issues
    try {
      await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS fix_description TEXT`);
    } catch(e) { console.error('Migration warning (fix_description):', e.message); }

    // Migration: add start_date, due_date, original_estimate to issues
    try {
      await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS start_date DATE`);
      await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date DATE`);
      await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS original_estimate INTEGER`);
    } catch(e) { console.error('Migration warning (issues dates/estimate):', e.message); }

    // Migration: create notifications table
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
        id         VARCHAR PRIMARY KEY,
        user_id    VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        space_id   VARCHAR REFERENCES spaces(id) ON DELETE SET NULL,
        type       VARCHAR NOT NULL,
        title      VARCHAR NOT NULL,
        body       TEXT,
        link       VARCHAR,
        is_read    BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch(e) { console.error('Migration warning (notifications):', e.message); }

    console.log('==================================================');
    console.log('  SprintBoard Server');
    console.log('  Database connected');
    app.listen(3000, () => {
      console.log('  Listening on http://localhost:3000');
      console.log('==================================================');
    });
  } catch (e) {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
  }
})();
