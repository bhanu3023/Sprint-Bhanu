// ===== SprintBoard — QA / Comprehensive Test Seed =====
// Run: node db/seed-qa-data.js
// Safe to re-run — upserts QA users and adds missing scenario data.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }
    : { host: 'localhost', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres' }
);

const uid = () => crypto.randomUUID();
const QA_PASSWORD = 'Test@12345';

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

async function ensureMigrations(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS issue_history (
    id VARCHAR PRIMARY KEY, issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
    user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    field_name VARCHAR NOT NULL, old_value TEXT, new_value TEXT,
    created_at TIMESTAMP DEFAULT NOW())`);
  await client.query(`CREATE TABLE IF NOT EXISTS issue_attachments (
    id VARCHAR PRIMARY KEY, issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL, original_name VARCHAR NOT NULL, size BIGINT DEFAULT 0,
    mime_type VARCHAR, uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW())`);
  await client.query(`CREATE TABLE IF NOT EXISTS roadmap_items (
    id VARCHAR PRIMARY KEY, title VARCHAR NOT NULL, description TEXT,
    status VARCHAR DEFAULT 'planned', start_date DATE, end_date DATE,
    space_id VARCHAR REFERENCES spaces(id) ON DELETE SET NULL,
    issue_id VARCHAR REFERENCES issues(id) ON DELETE SET NULL,
    color VARCHAR DEFAULT '#4d90e0', priority VARCHAR DEFAULT 'medium',
    assigned_to VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
  await client.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS group_name VARCHAR DEFAULT 'General'`);
  await client.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS category VARCHAR DEFAULT 'Items'`);
  await client.query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS milestone BOOLEAN DEFAULT FALSE`);
  await client.query(`CREATE TABLE IF NOT EXISTS roadmap_colors (
    color_key VARCHAR NOT NULL, color VARCHAR NOT NULL,
    created_by VARCHAR REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (color_key, created_by))`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_settings JSONB`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR DEFAULT 'dark'`);
}

async function upsertUser(client, orgId, { email, name, role, color, is_active = true, theme = 'dark', password = QA_PASSWORD, microsoftOnly = false }) {
  const hash = microsoftOnly ? null : hashPasswordSync(password);
  const existing = await client.query('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase()]);
  if (existing.rows.length) {
    await client.query(
      `UPDATE users SET name=$1, role=$2, color=$3, is_active=$4, theme=$5, password_hash=$6, org_id=$7 WHERE id=$8`,
      [name, role, color, is_active, theme, hash, orgId, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const id = `usr-${uid()}`;
  await client.query(
    `INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active,theme) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, orgId, name, email.toLowerCase(), color, role, hash, is_active, theme]
  );
  return id;
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureMigrations(client);

    const orgR = await client.query('SELECT id FROM organizations LIMIT 1');
    if (!orgR.rows.length) {
      console.error('❌ No organization found. Run: node db/create-db.js first (or start server once).');
      process.exit(1);
    }
    const orgId = orgR.rows[0].id;
    const pwHash = hashPasswordSync(QA_PASSWORD);

    console.log('👥 Seeding QA test accounts (password: Test@12345)...');
    const qaOwner     = await upsertUser(client, orgId, { email: 'qa-owner@test.local',     name: 'QA Owner',     role: 'owner',  color: '#6366f1' });
    const qaAdmin     = await upsertUser(client, orgId, { email: 'qa-admin@test.local',     name: 'QA Admin',     role: 'admin',  color: '#ec4899' });
    const qaMember    = await upsertUser(client, orgId, { email: 'qa-member@test.local',    name: 'QA Member',    role: 'member', color: '#10b981' });
    const qaViewer    = await upsertUser(client, orgId, { email: 'qa-viewer@test.local',    name: 'QA Viewer',    role: 'member', color: '#f59e0b' });
    const qaManager   = await upsertUser(client, orgId, { email: 'qa-manager@test.local',   name: 'QA Manager',   role: 'member', color: '#ef4444' });
    const qaSiteAdmin = await upsertUser(client, orgId, { email: 'qa-siteadmin@test.local', name: 'QA Site Admin', role: 'member', color: '#8b5cf6' });
    const qaInactive  = await upsertUser(client, orgId, { email: 'qa-inactive@test.local',  name: 'QA Inactive',  role: 'member', color: '#6b7280', is_active: false });
    const qaNoSpaces  = await upsertUser(client, orgId, { email: 'qa-nospaces@test.local',  name: 'QA No Spaces', role: 'member', color: '#64748b' });
    const manmadha    = await upsertUser(client, orgId, {
      email: 'manmadha.jayamangala@cloudfuze.com',
      name: 'Manmadha Jayamangala',
      role: 'admin',
      color: '#174F96',
      theme: 'dark',
      microsoftOnly: true,
    });

    // ── QA Test Space (hybrid) ──
    let qaSpaceId;
    const qaSpaceR = await client.query(`SELECT id FROM spaces WHERE key='QAT'`);
    if (qaSpaceR.rows.length) {
      qaSpaceId = qaSpaceR.rows[0].id;
    } else {
      qaSpaceId = `sp-${uid()}`;
      await client.query(
        `INSERT INTO spaces(id,org_id,name,key,description,icon,color,space_type,visibility,owner_id,issue_counter)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [qaSpaceId, orgId, 'QA Test Lab', 'QAT', 'Comprehensive test scenarios space', '🧪', '#dc2626', 'hybrid', 'team', qaOwner, 20]
      );
    }

    // ── Product_Team space (for Combination custom field migration) ──
    let productSpaceId;
    const ptR = await client.query(`SELECT id FROM spaces WHERE name='Product_Team'`);
    if (ptR.rows.length) {
      productSpaceId = ptR.rows[0].id;
    } else {
      productSpaceId = `sp-${uid()}`;
      await client.query(
        `INSERT INTO spaces(id,org_id,name,key,description,icon,color,space_type,visibility,owner_id,issue_counter)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [productSpaceId, orgId, 'Product_Team', 'PTM', 'Product team board with Combination field', '📦', '#174F96', 'scrum', 'org', qaAdmin, 5]
      );
    }

    // ── Archived space ──
    const archR = await client.query(`SELECT id FROM spaces WHERE key='ARC'`);
    if (!archR.rows.length) {
      await client.query(
        `INSERT INTO spaces(id,org_id,name,key,description,icon,color,space_type,visibility,owner_id,is_archived,issue_counter)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
        [`sp-${uid()}`, orgId, 'Archived Project', 'ARC', 'Archived space for testing', '📁', '#94a3b8', 'kanban', 'private', qaAdmin, 0]
      );
    }

    async function ensureMember(spaceId, userId, role) {
      const ex = await client.query('SELECT id FROM space_members WHERE space_id=$1 AND user_id=$2', [spaceId, userId]);
      if (ex.rows.length) {
        await client.query('UPDATE space_members SET role=$1 WHERE id=$2', [role, ex.rows[0].id]);
      } else {
        await client.query('INSERT INTO space_members(id,space_id,user_id,role) VALUES($1,$2,$3,$4)',
          [`spm-${uid()}`, spaceId, userId, role]);
      }
    }

    await ensureMember(qaSpaceId, qaOwner, 'owner');
    await ensureMember(qaSpaceId, qaAdmin, 'site_admin');
    await ensureMember(qaSpaceId, qaSiteAdmin, 'site_admin');
    await ensureMember(qaSpaceId, qaManager, 'manager');
    await ensureMember(qaSpaceId, qaMember, 'member');
    await ensureMember(qaSpaceId, qaViewer, 'viewer');
    await ensureMember(qaSpaceId, manmadha, 'manager');
    await ensureMember(productSpaceId, qaAdmin, 'manager');
    await ensureMember(productSpaceId, qaMember, 'member');
    await ensureMember(productSpaceId, manmadha, 'manager');

    // Add QA users to Engineering if it exists
    const engR = await client.query(`SELECT id FROM spaces WHERE key='ENG' LIMIT 1`);
    if (engR.rows.length) {
      await ensureMember(engR.rows[0].id, qaMember, 'member');
      await ensureMember(engR.rows[0].id, qaViewer, 'viewer');
      await ensureMember(engR.rows[0].id, manmadha, 'manager');
    }

    // ── Sprints for QA space ──
    let qaSprintActive, qaSprintPlanning, qaSprintDone;
    const sprR = await client.query(`SELECT id, status FROM sprints WHERE space_id=$1 ORDER BY position`, [qaSpaceId]);
    if (sprR.rows.length >= 3) {
      qaSprintDone = sprR.rows.find(s => s.status === 'completed')?.id || sprR.rows[0].id;
      qaSprintActive = sprR.rows.find(s => s.status === 'active')?.id || sprR.rows[1].id;
      qaSprintPlanning = sprR.rows.find(s => s.status === 'planning')?.id || sprR.rows[2].id;
    } else {
      qaSprintDone = `spr-${uid()}`;
      qaSprintActive = `spr-${uid()}`;
      qaSprintPlanning = `spr-${uid()}`;
      await client.query(`INSERT INTO sprints(id,space_id,name,goal,start_date,end_date,status,velocity,position) VALUES
        ($1,$2,'QA Sprint 1','Done sprint test','2026-01-01','2026-01-14','completed',21,0),
        ($3,$2,'QA Sprint 2','Active sprint test','2026-02-01','2026-02-14','active',0,1),
        ($4,$2,'QA Sprint 3','Planning sprint test','2026-03-01','2026-03-14','planning',0,2)`,
        [qaSprintDone, qaSpaceId, qaSprintActive, qaSprintPlanning]);
    }

    // ── Issues covering all types/statuses ──
    const issueCount = (await client.query(`SELECT COUNT(*)::int AS c FROM issues WHERE space_id=$1`, [qaSpaceId])).rows[0].c;
    let epicId, storyId, subtaskId, blockedId, spilloverId;
    if (issueCount < 10) {
      epicId = `iss-${uid()}`;
      storyId = `iss-${uid()}`;
      subtaskId = `iss-${uid()}`;
      blockedId = `iss-${uid()}`;
      spilloverId = `iss-${uid()}`;
      const issues = [
        [epicId, qaSpaceId, qaSprintActive, null, 'QAT-1', 'QA Epic — Full Workflow', 'Epic covering all scenarios', 'epic', 'In Progress', 'highest', qaMember, qaOwner, 13, 0],
        [storyId, qaSpaceId, qaSprintActive, epicId, 'QAT-2', 'QA Story — Blocked Example', 'Story with blocked status', 'story', 'Blocked', 'high', qaMember, qaOwner, 5, 1],
        [subtaskId, qaSpaceId, qaSprintActive, storyId, 'QAT-3', 'QA Subtask — Child Issue', 'Subtask linked to story', 'subtask', 'To Do', 'medium', qaMember, qaOwner, 2, 2],
        [blockedId, qaSpaceId, qaSprintActive, null, 'QAT-4', 'QA Bug — In Review', 'Bug in review status', 'bug', 'In Review', 'high', qaManager, qaAdmin, 3, 3],
        [`iss-${uid()}`, qaSpaceId, qaSprintActive, null, 'QAT-5', 'QA Task — Done', 'Completed task', 'task', 'Done', 'medium', qaMember, qaOwner, 3, 4],
        [spilloverId, qaSpaceId, qaSprintDone, null, 'QAT-6', 'QA Spillover Candidate', 'Was in completed sprint, not done', 'task', 'In Progress', 'medium', qaMember, qaOwner, 5, 0],
        [`iss-${uid()}`, qaSpaceId, null, null, 'QAT-7', 'QA Backlog Item', 'Backlog with dates and estimates', 'story', 'To Do', 'low', null, qaOwner, 8, 0],
        [`iss-${uid()}`, qaSpaceId, qaSprintPlanning, null, 'QAT-8', 'QA Planning Sprint Item', 'Future sprint item', 'task', 'To Do', 'medium', qaViewer, qaOwner, 3, 0],
      ];
      for (const i of issues) {
        await client.query(
          `INSERT INTO issues(id,space_id,sprint_id,parent_id,key,title,description,type,status,priority,assignee_id,reporter_id,story_points,position,start_date,due_date,original_estimate,time_spent,team,product_type)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'2026-02-01','2026-03-31',480,120,'Platform','SaaS')
           ON CONFLICT (key) DO NOTHING`,
          i
        );
      }
      await client.query(`UPDATE spaces SET issue_counter=GREATEST(issue_counter,8) WHERE id=$1`, [qaSpaceId]);
    } else {
      const keyMap = {};
      const rows = (await client.query(`SELECT id, key FROM issues WHERE space_id=$1 AND key LIKE 'QAT-%'`, [qaSpaceId])).rows;
      rows.forEach(r => { keyMap[r.key] = r.id; });
      epicId = keyMap['QAT-1'];
      storyId = keyMap['QAT-2'];
      blockedId = keyMap['QAT-4'];
      spilloverId = keyMap['QAT-6'];
    }

    // Soft-deleted issue
    const delR = await client.query(`SELECT id FROM issues WHERE key='QAT-DEL'`);
    if (!delR.rows.length && epicId) {
      await client.query(
        `INSERT INTO issues(id,space_id,key,title,type,status,priority,reporter_id,position,deleted_at,deleted_by)
         VALUES($1,$2,'QAT-DEL','QA Deleted Issue','task','Done','low',$3,99,NOW(),NULL)`,
        [`iss-${uid()}`, qaSpaceId, qaOwner]
      );
    }

    // ── Issue history (for reports) ──
    if (storyId) {
      const histCount = (await client.query(`SELECT COUNT(*)::int AS c FROM issue_history WHERE issue_id=$1`, [storyId])).rows[0].c;
      if (histCount === 0) {
        const history = [
          [storyId, qaOwner, 'status', 'To Do', 'In Progress'],
          [storyId, qaMember, 'status', 'In Progress', 'Blocked'],
          [storyId, qaAdmin, 'assignee_id', qaOwner, qaMember],
        ];
        if (spilloverId) history.push([spilloverId, qaAdmin, 'spillover', qaSprintDone, 'backlog']);
        for (const [issueId, userId, field, oldV, newV] of history) {
          const exists = await client.query('SELECT 1 FROM issues WHERE id=$1', [issueId]);
          if (!exists.rows.length) continue;
          await client.query(
            `INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
            [`ih-${uid()}`, issueId, userId, field, oldV, newV]
          );
        }
      }
    }

    // ── Issue links (all types) ──
    if (epicId && storyId && blockedId) {
      const linkTypes = [
        [storyId, epicId, 'is_child_of'],
        [blockedId, storyId, 'blocks'],
        [epicId, blockedId, 'relates_to'],
      ];
      for (const [src, tgt, type] of linkTypes) {
        const srcOk = (await client.query('SELECT 1 FROM issues WHERE id=$1', [src])).rows.length;
        const tgtOk = (await client.query('SELECT 1 FROM issues WHERE id=$1', [tgt])).rows.length;
        if (!srcOk || !tgtOk) continue;
        const ex = await client.query('SELECT id FROM issue_links WHERE source_id=$1 AND target_id=$2 AND link_type=$3', [src, tgt, type]);
        if (!ex.rows.length) {
          await client.query('INSERT INTO issue_links(id,source_id,target_id,link_type) VALUES($1,$2,$3,$4)',
            [`lnk-${uid()}`, src, tgt, type]);
        }
      }
    }

    // ── Custom fields (all types on QA space) ──
    const cfDefs = [
      { name: 'QA Text Field', type: 'text' },
      { name: 'QA Textarea', type: 'textarea' },
      { name: 'QA Number', type: 'number' },
      { name: 'QA Date', type: 'date' },
      { name: 'QA Select', type: 'select', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      { name: 'QA Multi Select', type: 'multi_select', options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }] },
      { name: 'QA Checkbox', type: 'checkbox' },
    ];
    for (const cf of cfDefs) {
      const ex = await client.query('SELECT id FROM custom_fields WHERE space_id=$1 AND name=$2', [qaSpaceId, cf.name]);
      if (!ex.rows.length) {
        await client.query(
          `INSERT INTO custom_fields(id,space_id,name,field_type,options,is_required,position,show_in) VALUES($1,$2,$3,$4,$5,false,$6,$7)`,
          [`cf-${uid()}`, qaSpaceId, cf.name, cf.type, JSON.stringify(cf.options || []), cfDefs.indexOf(cf), ['drawer', 'detail']]
        );
      }
    }

    // ── Invitations (all statuses) ──
    const invites = [
      { email: 'pending-invite@test.local', status: 'pending', role: 'member' },
      { email: 'expired-invite@test.local', status: 'expired', role: 'member' },
      { email: 'cancelled-invite@test.local', status: 'cancelled', role: 'admin' },
      { email: 'accepted-invite@test.local', status: 'accepted', role: 'member' },
    ];
    for (const inv of invites) {
      const ex = await client.query('SELECT id FROM invitations WHERE email=$1', [inv.email]);
      if (!ex.rows.length) {
        const expires = inv.status === 'expired' ? new Date(Date.now() - 86400000) : new Date(Date.now() + 7 * 86400000);
        await client.query(
          `INSERT INTO invitations(id,email,org_id,invited_by,role,token,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [`inv-${uid()}`, inv.email, orgId, qaAdmin, inv.role, `tok-${uid()}`, inv.status, expires]
        );
      }
    }

    // ── Notifications (all types) ──
    const notifTypes = [
      { user: qaMember, type: 'issue_assigned', title: 'QA: Assigned', body: 'You were assigned QAT-2', read: false },
      { user: qaMember, type: 'status_changed', title: 'QA: Status changed', body: 'QAT-4 moved to In Review', read: false },
      { user: qaMember, type: 'comment_added', title: 'QA: New comment', body: 'QA Admin commented', read: true },
      { user: qaAdmin, type: 'sprint_started', title: 'QA: Sprint started', body: 'QA Sprint 2 started', read: false },
      { user: qaOwner, type: 'sprint_completed', title: 'QA: Sprint completed', body: 'QA Sprint 1 completed', read: false },
      { user: qaViewer, type: 'mention', title: 'QA: Mentioned', body: 'You were mentioned in QAT-8', read: false },
    ];
    for (const n of notifTypes) {
      const ex = await client.query(`SELECT id FROM notifications WHERE user_id=$1 AND title=$2`, [n.user, n.title]);
      if (!ex.rows.length) {
        await client.query(
          `INSERT INTO notifications(id,user_id,space_id,type,title,body,is_read,link) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [`ntf-${uid()}`, n.user, qaSpaceId, n.type, n.title, n.body, n.read, `/spaces/QAT/issues/QAT-2`]
        );
      }
    }

    // ── Comments & worklogs on QAT-2 (by key lookup) ──
    const qat2 = (await client.query(`SELECT id FROM issues WHERE key='QAT-2' LIMIT 1`)).rows[0]?.id;
    if (qat2) {
      const cmtEx = await client.query(`SELECT id FROM comments WHERE issue_id=$1 LIMIT 1`, [qat2]);
      if (!cmtEx.rows.length) {
        await client.query(`INSERT INTO comments(id,issue_id,user_id,body) VALUES($1,$2,$3,$4)`,
          [`cmt-${uid()}`, qat2, qaAdmin, 'QA test comment — verify notifications and @mentions work.']);
        await client.query(`INSERT INTO worklogs(id,issue_id,user_id,time_spent,work_date,description,is_billable) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [`wl-${uid()}`, qat2, qaMember, 90, '2026-02-10', 'QA worklog entry', true]);
      }
      const histCount = (await client.query(`SELECT COUNT(*)::int AS c FROM issue_history WHERE issue_id=$1`, [qat2])).rows[0].c;
      if (histCount === 0) {
        for (const [field, oldV, newV, userId] of [
          ['status', 'To Do', 'In Progress', qaOwner],
          ['status', 'In Progress', 'Blocked', qaMember],
        ]) {
          await client.query(
            `INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)`,
            [`ih-${uid()}`, qat2, userId, field, oldV, newV]
          );
        }
      }
    }

    // ── Saved filters ──
    const filters = [
      { name: 'QA My Open', user: qaMember, shared: false, pinned: true, conditions: { assignee: 'me', status: ['To Do', 'In Progress', 'Blocked'] } },
      { name: 'QA All Bugs', user: qaAdmin, shared: true, pinned: false, conditions: { type: 'bug' } },
      { name: 'QA Blocked Items', user: qaManager, shared: true, pinned: true, conditions: { status: ['Blocked'] } },
    ];
    for (const f of filters) {
      const ex = await client.query(`SELECT id FROM saved_filters WHERE space_id=$1 AND name=$2`, [qaSpaceId, f.name]);
      if (!ex.rows.length) {
        await client.query(
          `INSERT INTO saved_filters(id,space_id,user_id,name,conditions,is_shared,is_pinned) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [`flt-${uid()}`, qaSpaceId, f.user, f.name, JSON.stringify(f.conditions), f.shared, f.pinned]
        );
      }
    }

    // ── Roadmap items ──
    const rmCount = (await client.query(`SELECT COUNT(*)::int AS c FROM roadmap_items WHERE space_id=$1`, [qaSpaceId])).rows[0].c;
    if (rmCount === 0) {
      await client.query(
        `INSERT INTO roadmap_items(id,title,description,status,start_date,end_date,space_id,color,priority,assigned_to,created_by,group_name,category,milestone) VALUES
         ($1,'Q1 Platform Launch','Major platform release','in_progress','2026-01-01','2026-03-31',$2,'#2563eb','high',$3,$4,'Platform','Releases',true),
         ($5,'Mobile App v2','Mobile redesign','planned','2026-04-01','2026-06-30',$2,'#10b981','medium',$6,$4,'Mobile','Features',false),
         ($7,'API Deprecation','Sunset v1 API','done','2025-10-01','2025-12-31',$2,'#6b7280','low',null,$4,'Platform','Maintenance',false)`,
        [`rm-${uid()}`, qaSpaceId, qaMember, qaOwner, `rm-${uid()}`, qaManager, `rm-${uid()}`]
      );
      await client.query(
        `INSERT INTO roadmap_colors(color_key,color,created_by) VALUES('planned','#3b82f6',$1) ON CONFLICT DO NOTHING`,
        [qaOwner]
      );
    }

    // ── File storage sample (inline comment file) ──
    const fileEx = await client.query(`SELECT id FROM file_storage LIMIT 1`);
    if (!fileEx.rows.length && storyId) {
      const storyOk = (await client.query('SELECT 1 FROM issues WHERE id=$1', [storyId])).rows.length;
      if (storyOk) {
        const fileId = `file-${uid()}`;
        const content = Buffer.from('QA test file content for SprintBoard attachments.');
        await client.query(
          `INSERT INTO file_storage(id,original_name,mime_type,size,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)`,
          [fileId, 'qa-test-file.txt', 'text/plain', content.length, content, qaMember]
        );
        await client.query(
          `INSERT INTO issue_attachments(id,issue_id,filename,original_name,size,mime_type,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [`att-${uid()}`, storyId, fileId, 'qa-test-file.txt', content.length, 'text/plain', qaMember]
        );
      }
    }

    // ── Favorites ──
    await client.query(`INSERT INTO space_favorites(user_id,space_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [qaMember, qaSpaceId]);
    await client.query(`INSERT INTO space_favorites(user_id,space_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [manmadha, qaSpaceId]);

    // ── Manmadha — Microsoft login test data ──
    console.log('👤 Setting up manmadha.jayamangala@cloudfuze.com (Microsoft login)...');
    const allSpaces = (await client.query(`SELECT id, key FROM spaces WHERE is_archived=false OR is_archived IS NULL`)).rows;
    for (const sp of allSpaces) {
      const role = sp.key === 'QAT' ? 'owner' : 'manager';
      await ensureMember(sp.id, manmadha, role);
      if (['ENG', 'QAT', 'DSN'].includes(sp.key)) {
        await client.query(`INSERT INTO space_favorites(user_id,space_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [manmadha, sp.id]);
      }
    }

    // Assign issues to Manmadha across spaces
    const assignIssues = [
      { key: 'QAT-2', assignee: manmadha },
      { key: 'QAT-5', assignee: manmadha, reporter: manmadha },
      { key: 'ENG-5', assignee: manmadha },
      { key: 'ENG-8', assignee: manmadha },
      { key: 'DSN-4', assignee: manmadha },
    ];
    for (const a of assignIssues) {
      await client.query(
        `UPDATE issues SET assignee_id=COALESCE($1, assignee_id), reporter_id=COALESCE($2, reporter_id) WHERE key=$3`,
        [a.assignee, a.reporter || null, a.key]
      );
    }

    // Notifications for Manmadha
    const manmadhaNotifs = [
      { type: 'issue_assigned', title: 'Assigned: QAT-2', body: 'You were assigned QA Story — Blocked Example', read: false, link: '/spaces/QAT/issues/QAT-2' },
      { type: 'status_changed', title: 'Status update on ENG-5', body: 'API Gateway moved to In Progress', read: false, link: '/spaces/ENG/issues/ENG-5' },
      { type: 'comment_added', title: 'New comment on QAT-2', body: 'QA Admin left a comment on your issue', read: true, link: '/spaces/QAT/issues/QAT-2' },
      { type: 'sprint_started', title: 'QA Sprint 2 started', body: 'Active sprint test is now running', read: false, link: '/spaces/QAT/board' },
      { type: 'mention', title: 'You were mentioned', body: 'You were mentioned in ENG-8 discussion', read: false, link: '/spaces/ENG/issues/ENG-8' },
    ];
    for (const n of manmadhaNotifs) {
      const ex = await client.query(`SELECT id FROM notifications WHERE user_id=$1 AND title=$2`, [manmadha, n.title]);
      if (!ex.rows.length) {
        await client.query(
          `INSERT INTO notifications(id,user_id,space_id,type,title,body,is_read,link) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [`ntf-${uid()}`, manmadha, qaSpaceId, n.type, n.title, n.body, n.read, n.link]
        );
      }
    }

    // Saved filter pinned for Manmadha
    const mfEx = await client.query(`SELECT id FROM saved_filters WHERE user_id=$1 AND name='My Assigned Issues'`, [manmadha]);
    if (!mfEx.rows.length) {
      await client.query(
        `INSERT INTO saved_filters(id,space_id,user_id,name,conditions,is_shared,is_pinned) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [`flt-${uid()}`, qaSpaceId, manmadha, 'My Assigned Issues', JSON.stringify({ assignee: 'me' }), false, true]
      );
    }

    // Roadmap item assigned to Manmadha
    await client.query(
      `UPDATE roadmap_items SET assigned_to=$1 WHERE space_id=$2 AND title='Q1 Platform Launch' AND assigned_to IS DISTINCT FROM $1`,
      [manmadha, qaSpaceId]
    ).catch(() => {});

    // ── Audit logs ──
    await client.query(
      `INSERT INTO audit_logs(id,space_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [`aud-${uid()}`, qaSpaceId, qaAdmin, 'qa_seed', 'space', qaSpaceId, JSON.stringify({ note: 'QA comprehensive seed applied' })]
    ).catch(() => {});

    console.log('');
    console.log('✅ QA seed complete!');
    console.log('');
    console.log('📋 Test accounts (password: Test@12345):');
    console.log('   qa-owner@test.local      — org owner');
    console.log('   qa-admin@test.local      — org admin');
    console.log('   qa-member@test.local     — space member');
    console.log('   qa-viewer@test.local     — space viewer (read-only)');
    console.log('   qa-manager@test.local    — space manager');
    console.log('   qa-siteadmin@test.local  — space site_admin');
    console.log('   qa-inactive@test.local   — deactivated account');
    console.log('   qa-nospaces@test.local   — no space access');
    console.log('   manmadha.jayamangala@cloudfuze.com — admin (Microsoft login, no password)');
    console.log('');
    console.log('🔑 Microsoft login: http://localhost:3000/login.html');
    console.log('   Sign in with manmadha.jayamangala@cloudfuze.com');
    console.log('   → Admin access to all spaces, assigned issues, notifications');
    console.log('');
    console.log('📦 Also available: sarah@neutara.dev / password123 (owner)');
    console.log('                   sujana.manapuram@cloudfuze.com / Neutara@2025 (admin)');
    console.log('');
    console.log('🧪 QA Test Lab space (key: QAT) — all issue types, statuses, links, filters, roadmap');
    console.log('📦 Product_Team space — Combination custom field (auto-created on server start)');
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('❌ QA seed failed:', err.message); process.exit(1); });
