const { Pool } = require('pg');
const crypto = require('crypto');
const http = require('http');

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }
    : { host: 'sprint-postgres', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres' }
);

const uid = () => crypto.randomUUID();

const FORCE_RESET = process.argv.includes('--reset');

async function main() {
  const client = await pool.connect();

  try {
    // ──────────────────────────────────────────────
    // 1. CHECK IF DB ALREADY EXISTS (skip seed unless --reset)
    // ──────────────────────────────────────────────
    if (!FORCE_RESET) {
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'spaces'
        )
      `);
      if (tableCheck.rows[0].exists) {
        console.log('✅ Database already exists. Running migrations...');
        // ── Add new columns if missing ──
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
        // ── Seed default password for users that don't have one ──
        const defaultHash = hashPasswordSync('password123');
        await client.query(`UPDATE users SET password_hash=$1, is_active=true WHERE password_hash IS NULL`, [defaultHash]);
        // ── Create sessions table if not exists ──
        await client.query(`CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR PRIMARY KEY,
          user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
          token VARCHAR UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )`);
        // ── Create invitations table if not exists ──
        await client.query(`CREATE TABLE IF NOT EXISTS invitations (
          id VARCHAR PRIMARY KEY,
          email VARCHAR NOT NULL,
          org_id VARCHAR REFERENCES organizations(id),
          invited_by VARCHAR REFERENCES users(id),
          role VARCHAR CHECK (role IN ('owner','admin','member')) DEFAULT 'member',
          token VARCHAR UNIQUE NOT NULL,
          status VARCHAR CHECK (status IN ('pending','accepted','expired','cancelled')) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP
        )`);
        // ── Seed Sujana admin account if not exists ──
        const orgR = await client.query('SELECT id FROM organizations LIMIT 1');
        const orgId = orgR.rows[0]?.id;
        const sujanaEmail = 'sujana.manapuram@cloudfuze.com';
        const sujanaCheck = await client.query('SELECT id FROM users WHERE LOWER(email)=$1', [sujanaEmail]);
        if (!sujanaCheck.rows.length) {
          const sujanaHash = hashPasswordSync('Neutara@2025');
          await client.query(
            `INSERT INTO users(id,org_id,name,email,color,role,password_hash,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
            [`usr-${uid()}`, orgId, 'Sujana Manapuram', sujanaEmail, '#174F96', 'admin', sujanaHash]
          );
          console.log('✅ Admin user sujana.manapuram@cloudfuze.com created.');
        } else {
          // Ensure password is up-to-date in case it changed
          const sujanaHash = hashPasswordSync('Neutara@2025');
          await client.query('UPDATE users SET password_hash=$1, role=\'admin\', is_active=true WHERE LOWER(email)=$2', [sujanaHash, sujanaEmail]);
          console.log('✅ Admin user sujana.manapuram@cloudfuze.com updated.');
        }
        console.log('✅ Migrations applied successfully.');
        return;
      }
      console.log('📦 Database is empty. Running initial seed...');
    } else {
      console.log('🗑️  --reset flag detected. Dropping and recreating public schema...');
    }

    // ──────────────────────────────────────────────
    // 1b. RESET SCHEMA
    // ──────────────────────────────────────────────
    await client.query(`DROP SCHEMA public CASCADE`);
    await client.query(`CREATE SCHEMA public`);
    await client.query(`GRANT ALL ON SCHEMA public TO public`);

    // ──────────────────────────────────────────────
    // 2. CREATE TABLES
    // ──────────────────────────────────────────────
    console.log('🏗️  Creating tables...');

    await client.query(`
      CREATE TABLE organizations (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        slug VARCHAR UNIQUE NOT NULL,
        logo_url VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE users (
        id VARCHAR PRIMARY KEY,
        org_id VARCHAR REFERENCES organizations(id),
        name VARCHAR NOT NULL,
        email VARCHAR UNIQUE NOT NULL,
        avatar_url VARCHAR,
        color VARCHAR,
        role VARCHAR CHECK (role IN ('owner','admin','member')) DEFAULT 'member',
        password_hash VARCHAR,
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE spaces (
        id VARCHAR PRIMARY KEY,
        org_id VARCHAR REFERENCES organizations(id),
        name VARCHAR NOT NULL,
        key VARCHAR NOT NULL,
        description TEXT,
        icon VARCHAR,
        color VARCHAR,
        space_type VARCHAR CHECK (space_type IN ('scrum','kanban','hybrid')) DEFAULT 'scrum',
        visibility VARCHAR CHECK (visibility IN ('private','team','org')) DEFAULT 'team',
        owner_id VARCHAR REFERENCES users(id),
        is_archived BOOLEAN DEFAULT false,
        issue_counter INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE space_members (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        user_id VARCHAR REFERENCES users(id),
        role VARCHAR CHECK (role IN ('site_admin','manager','member','viewer')) DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(space_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE space_favorites (
        user_id VARCHAR REFERENCES users(id),
        space_id VARCHAR REFERENCES spaces(id),
        PRIMARY KEY(user_id, space_id)
      )
    `);

    await client.query(`
      CREATE TABLE sprints (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        name VARCHAR NOT NULL,
        goal TEXT,
        start_date DATE,
        end_date DATE,
        status VARCHAR CHECK (status IN ('planning','active','completed')) DEFAULT 'planning',
        velocity INTEGER DEFAULT 0,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE issues (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        sprint_id VARCHAR REFERENCES sprints(id),
        parent_id VARCHAR REFERENCES issues(id),
        key VARCHAR UNIQUE,
        title VARCHAR NOT NULL,
        description TEXT,
        fix_description TEXT,
        type VARCHAR CHECK (type IN ('epic','story','task','bug','subtask')) DEFAULT 'task',
        status VARCHAR CHECK (status IN ('To Do','In Progress','In Review','Done')) DEFAULT 'To Do',
        priority VARCHAR CHECK (priority IN ('highest','high','medium','low','lowest')) DEFAULT 'medium',
        assignee_id VARCHAR REFERENCES users(id),
        reporter_id VARCHAR REFERENCES users(id),
        story_points INTEGER,
        labels TEXT[] DEFAULT '{}',
        start_date DATE,
        due_date DATE,
        original_estimate INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP,
        deleted_by UUID,
        team VARCHAR(50),
        product_type VARCHAR(50)
      )
    `);

    await client.query(`
      CREATE TABLE custom_fields (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        name VARCHAR NOT NULL,
        field_type VARCHAR CHECK (field_type IN ('text','textarea','number','date','select','multi_select','user','checkbox')) DEFAULT 'text',
        options JSONB DEFAULT '[]',
        is_required BOOLEAN DEFAULT false,
        position INTEGER DEFAULT 0,
        show_in TEXT[] DEFAULT '{drawer}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE issue_field_values (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id),
        field_id VARCHAR REFERENCES custom_fields(id),
        value TEXT,
        UNIQUE(issue_id, field_id)
      )
    `);

    await client.query(`
      CREATE TABLE issue_links (
        id VARCHAR PRIMARY KEY,
        source_id VARCHAR REFERENCES issues(id),
        target_id VARCHAR REFERENCES issues(id),
        link_type VARCHAR DEFAULT 'relates_to',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(source_id, target_id, link_type)
      )
    `);

    await client.query(`
      CREATE TABLE comments (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id),
        user_id VARCHAR REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE worklogs (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id),
        user_id VARCHAR REFERENCES users(id),
        time_spent INTEGER,
        work_date DATE,
        description TEXT,
        is_billable BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE saved_filters (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        user_id VARCHAR REFERENCES users(id),
        name VARCHAR NOT NULL,
        conditions JSONB DEFAULT '{}',
        is_shared BOOLEAN DEFAULT false,
        is_pinned BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE notifications (
        id VARCHAR PRIMARY KEY,
        user_id VARCHAR REFERENCES users(id),
        space_id VARCHAR REFERENCES spaces(id),
        type VARCHAR,
        title VARCHAR,
        body TEXT,
        is_read BOOLEAN DEFAULT false,
        link VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE audit_logs (
        id VARCHAR PRIMARY KEY,
        space_id VARCHAR REFERENCES spaces(id),
        user_id VARCHAR REFERENCES users(id),
        action VARCHAR,
        entity_type VARCHAR,
        entity_id VARCHAR,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE sessions (
        id VARCHAR PRIMARY KEY,
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE invitations (
        id VARCHAR PRIMARY KEY,
        email VARCHAR NOT NULL,
        org_id VARCHAR REFERENCES organizations(id),
        invited_by VARCHAR REFERENCES users(id),
        role VARCHAR CHECK (role IN ('owner','admin','member')) DEFAULT 'member',
        token VARCHAR UNIQUE NOT NULL,
        status VARCHAR CHECK (status IN ('pending','accepted','expired','cancelled')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE file_storage (
        id VARCHAR PRIMARY KEY,
        original_name VARCHAR NOT NULL,
        mime_type VARCHAR NOT NULL,
        size INTEGER,
        data BYTEA NOT NULL,
        uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ All 19 tables created');

    // ──────────────────────────────────────────────
    // 3. SEED DATA
    // ──────────────────────────────────────────────

    // ── Organization ──
    console.log('🏢 Seeding organization...');
    const orgId = `org-${uid()}`;
    await client.query(
      `INSERT INTO organizations (id, name, slug, logo_url) VALUES ($1, $2, $3, $4)`,
      [orgId, 'Neutara Technologies', 'neutara', '/assets/neutara-logo.png']
    );

    // ── Users ──
    console.log('👥 Seeding users...');
    const usersData = [
      { name: 'Sarah Chen',         email: 'sarah@neutara.dev',                   color: '#6366f1', role: 'owner'  },
      { name: 'Alex Kumar',         email: 'alex@neutara.dev',                    color: '#ec4899', role: 'admin'  },
      { name: 'Jordan Smith',       email: 'jordan@neutara.dev',                  color: '#10b981', role: 'member' },
      { name: 'Maya Patel',         email: 'maya@neutara.dev',                    color: '#f59e0b', role: 'member' },
      { name: "Liam O'Brien",       email: 'liam@neutara.dev',                    color: '#ef4444', role: 'member' },
      { name: 'Priya Gupta',        email: 'priya@neutara.dev',                   color: '#8b5cf6', role: 'member' },
      { name: 'Sujana Manapuram',   email: 'sujana.manapuram@cloudfuze.com',      color: '#174F96', role: 'admin'  },
    ];

    const defaultHash = hashPasswordSync('password123');
    const sujanaHash = hashPasswordSync('Neutara@2025');
    const userIds = [];
    for (const u of usersData) {
      const id = `usr-${uid()}`;
      userIds.push(id);
      const pwHash = u.email === 'sujana.manapuram@cloudfuze.com' ? sujanaHash : defaultHash;
      await client.query(
        `INSERT INTO users (id, org_id, name, email, avatar_url, color, role, password_hash, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [id, orgId, u.name, u.email, null, u.color, u.role, pwHash]
      );
    }
    const [sarah, alex, jordan, maya, liam, priya, sujana] = userIds;

    // ── Spaces ──
    console.log('📦 Seeding spaces...');
    const spaceEng = `sp-${uid()}`;
    const spaceDsn = `sp-${uid()}`;
    const spaceOps = `sp-${uid()}`;

    const spacesData = [
      { id: spaceEng, name: 'Engineering',    key: 'ENG', desc: 'Core product engineering workspace',        icon: '🚀', color: '#174F96', type: 'scrum',  vis: 'org',     owner: sarah,  counter: 12 },
      { id: spaceDsn, name: 'Design System',  key: 'DSN', desc: 'Shared design system and component library', icon: '🎨', color: '#8b5cf6', type: 'kanban', vis: 'team',    owner: alex,   counter: 8  },
      { id: spaceOps, name: 'Operations',     key: 'OPS', desc: 'DevOps, infrastructure, and monitoring',    icon: '⚙️', color: '#10b981', type: 'scrum',  vis: 'private', owner: jordan, counter: 6  },
    ];

    for (const s of spacesData) {
      await client.query(
        `INSERT INTO spaces (id, org_id, name, key, description, icon, color, space_type, visibility, owner_id, issue_counter)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [s.id, orgId, s.name, s.key, s.desc, s.icon, s.color, s.type, s.vis, s.owner, s.counter]
      );
    }

    // ── Space Members ──
    console.log('👤 Seeding space members...');
    const memberships = [
      // Engineering: all 6 users
      { space: spaceEng, user: sarah,  role: 'manager'  },
      { space: spaceEng, user: alex,   role: 'manager'  },
      { space: spaceEng, user: jordan, role: 'member'   },
      { space: spaceEng, user: maya,   role: 'member'   },
      { space: spaceEng, user: liam,   role: 'member'   },
      { space: spaceEng, user: priya,  role: 'member'   },
      // Design System: 4 users
      { space: spaceDsn, user: alex,   role: 'manager'  },
      { space: spaceDsn, user: maya,   role: 'manager'  },
      { space: spaceDsn, user: priya,  role: 'member'   },
      { space: spaceDsn, user: sarah,  role: 'member'   },
      // Operations: 3 users
      { space: spaceOps, user: jordan, role: 'manager'  },
      { space: spaceOps, user: liam,   role: 'member'   },
      { space: spaceOps, user: sarah,  role: 'viewer'   },
    ];

    for (const m of memberships) {
      await client.query(
        `INSERT INTO space_members (id, space_id, user_id, role) VALUES ($1,$2,$3,$4)`,
        [`spm-${uid()}`, m.space, m.user, m.role]
      );
    }

    // ── Space Favorites ──
    console.log('⭐ Seeding space favorites...');
    await client.query(`INSERT INTO space_favorites (user_id, space_id) VALUES ($1,$2)`, [sarah, spaceEng]);
    await client.query(`INSERT INTO space_favorites (user_id, space_id) VALUES ($1,$2)`, [sarah, spaceDsn]);

    // ── Sprints ──
    console.log('🏃 Seeding sprints...');
    const engSpr1 = `spr-${uid()}`;
    const engSpr2 = `spr-${uid()}`;
    const engSpr3 = `spr-${uid()}`;
    const dsnSpr1 = `spr-${uid()}`;
    const dsnSpr2 = `spr-${uid()}`;
    const opsSpr1 = `spr-${uid()}`;
    const opsSpr2 = `spr-${uid()}`;

    const sprintsData = [
      { id: engSpr1, space: spaceEng, name: 'Sprint 1', goal: 'Core authentication and API foundation',     start: '2026-02-16', end: '2026-03-01', status: 'completed', vel: 34, pos: 0 },
      { id: engSpr2, space: spaceEng, name: 'Sprint 2', goal: 'API gateway and database performance',       start: '2026-03-02', end: '2026-03-15', status: 'active',    vel: 0,  pos: 1 },
      { id: engSpr3, space: spaceEng, name: 'Sprint 3', goal: 'Real-time features and notification system', start: '2026-03-16', end: '2026-03-29', status: 'planning',  vel: 0,  pos: 2 },
      { id: dsnSpr1, space: spaceDsn, name: 'Sprint 1', goal: 'Design token system and core components',    start: '2026-02-23', end: '2026-03-08', status: 'completed', vel: 21, pos: 0 },
      { id: dsnSpr2, space: spaceDsn, name: 'Sprint 2', goal: 'Advanced components and documentation',      start: '2026-03-09', end: '2026-03-22', status: 'active',    vel: 0,  pos: 1 },
      { id: opsSpr1, space: spaceOps, name: 'Sprint 1', goal: 'CI/CD pipeline and monitoring setup',        start: '2026-02-23', end: '2026-03-08', status: 'completed', vel: 18, pos: 0 },
      { id: opsSpr2, space: spaceOps, name: 'Sprint 2', goal: 'Infrastructure scaling and alerting',        start: '2026-03-09', end: '2026-03-22', status: 'active',    vel: 0,  pos: 1 },
    ];

    for (const s of sprintsData) {
      await client.query(
        `INSERT INTO sprints (id, space_id, name, goal, start_date, end_date, status, velocity, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [s.id, s.space, s.name, s.goal, s.start, s.end, s.status, s.vel, s.pos]
      );
    }

    // ── Issues ──
    console.log('📋 Seeding issues...');

    const allIssues = [];
    const issueMap = {};

    function addIssue(space, sprintId, key, title, desc, type, status, priority, assignee, reporter, points, labels, pos, parentKey) {
      const id = `iss-${uid()}`;
      const parentId = parentKey ? issueMap[parentKey] : null;
      allIssues.push({ id, space, sprintId, parentId, key, title, desc, type, status, priority, assignee, reporter, points, labels, pos });
      issueMap[key] = id;
      return id;
    }

    // ── Engineering issues (12) ──
    addIssue(spaceEng, engSpr1, 'ENG-1',  'User Authentication System',      'Implement JWT-based authentication with refresh tokens and device fingerprinting',              'epic',  'Done',        'highest', sarah,  sarah,  13, '{auth,security}',   0, null);
    addIssue(spaceEng, engSpr1, 'ENG-2',  'Login & registration endpoints',  'Build REST endpoints for login, register, forgot-password, and email verification',             'story', 'Done',        'high',    alex,   sarah,  8,  '{auth,backend}',    1, null);
    addIssue(spaceEng, engSpr1, 'ENG-3',  'OAuth2 social login integration', 'Add Google and GitHub OAuth2 providers with account linking',                                   'story', 'Done',        'medium',  jordan, sarah,  5,  '{auth,backend}',    2, null);
    addIssue(spaceEng, engSpr1, 'ENG-4',  'Session token refresh bug',       'Refresh tokens are not rotating correctly on expiry, allowing stale sessions',                   'bug',   'Done',        'highest', alex,   jordan, 3,  '{auth,bug}',        3, null);
    addIssue(spaceEng, engSpr2, 'ENG-5',  'API Gateway Implementation',      'Set up API gateway with rate limiting, request validation, and intelligent routing',             'epic',  'In Progress', 'highest', sarah,  sarah,  13, '{api,infra}',       0, null);
    addIssue(spaceEng, engSpr2, 'ENG-6',  'Rate limiting middleware',        'Implement sliding-window rate limiter per user and IP with Redis backing',                       'task',  'In Progress', 'high',    maya,   sarah,  5,  '{api,backend}',     1, null);
    addIssue(spaceEng, engSpr2, 'ENG-7',  'Request validation layer',        'Add Zod schemas for request/response validation on all routes',                                 'task',  'To Do',       'medium',  liam,   alex,   3,  '{api,backend}',     2, null);
    addIssue(spaceEng, engSpr2, 'ENG-8',  'Database query optimization',     'Profile and optimize slow queries, add composite indexes for common access patterns',            'story', 'In Review',   'high',    priya,  alex,   8,  '{db,performance}',  3, null);
    addIssue(spaceEng, engSpr3, 'ENG-9',  'WebSocket real-time engine',      'Implement WebSocket server for live issue updates, presence, and typing indicators',             'epic',  'To Do',       'high',    jordan, sarah,  13, '{realtime,infra}',  0, null);
    addIssue(spaceEng, engSpr3, 'ENG-10', 'Push notification service',       'Build notification dispatch service supporting email, in-app, and browser push',                 'story', 'To Do',       'medium',  maya,   alex,   5,  '{notifications}',   1, null);
    addIssue(spaceEng, null,    'ENG-11', 'GraphQL API exploration',         'Evaluate adding a GraphQL layer alongside REST for flexible client queries',                     'task',  'To Do',       'low',     null,   sarah,  3,  '{api,research}',    2, null);
    addIssue(spaceEng, null,    'ENG-12', 'Migrate to connection pooling',   'Switch from single connections to pgBouncer connection pooling for production',                  'task',  'To Do',       'medium',  null,   priya,  5,  '{db,infra}',        3, null);

    // ── Design System issues (8) ──
    addIssue(spaceDsn, dsnSpr1, 'DSN-1', 'Design Token System',             'Define color, spacing, typography, and shadow tokens for the entire design system',               'epic',  'Done',        'highest', alex,   alex,   8,  '{tokens,foundation}', 0, null);
    addIssue(spaceDsn, dsnSpr1, 'DSN-2', 'Color palette & theme tokens',    'Create light/dark theme tokens with semantic naming and CSS custom properties',                   'task',  'Done',        'high',    maya,   alex,   5,  '{tokens,color}',      1, null);
    addIssue(spaceDsn, dsnSpr1, 'DSN-3', 'Typography scale',                'Define modular type scale from xs to 4xl with line-height and letter-spacing pairings',           'task',  'Done',        'high',    priya,  alex,   3,  '{tokens,typography}', 2, null);
    addIssue(spaceDsn, dsnSpr2, 'DSN-4', 'Component Library Foundation',    'Build button, input, select, checkbox, and radio base components using Radix primitives',         'epic',  'In Progress', 'highest', alex,   alex,   13, '{components}',        0, null);
    addIssue(spaceDsn, dsnSpr2, 'DSN-5', 'Button component variants',       'Primary, secondary, ghost, destructive, outline, and link button variants with loading states',   'story', 'In Progress', 'high',    maya,   alex,   5,  '{components,button}', 1, null);
    addIssue(spaceDsn, dsnSpr2, 'DSN-6', 'Form input components',          'Text input, textarea, and select components with validation states and error messages',            'story', 'To Do',       'high',    priya,  maya,   5,  '{components,forms}',  2, null);
    addIssue(spaceDsn, null,    'DSN-7', 'Storybook documentation setup',  'Configure Storybook with autodocs, accessibility addon, and dark mode toggle',                    'task',  'To Do',       'medium',  null,   alex,   3,  '{docs,tooling}',      3, null);
    addIssue(spaceDsn, null,    'DSN-8', 'Icon library integration',        'Integrate Lucide icons with tree-shaking support and size/color token bindings',                  'task',  'To Do',       'low',     sarah,  maya,   2,  '{icons,tooling}',     4, null);

    // ── Operations issues (6) ──
    addIssue(spaceOps, opsSpr1, 'OPS-1', 'CI/CD Pipeline Setup',            'Configure GitHub Actions with build, test, lint, and multi-environment deploy stages',             'epic',  'Done',        'highest', jordan, jordan, 8,  '{cicd,infra}',        0, null);
    addIssue(spaceOps, opsSpr1, 'OPS-2', 'Docker multi-stage builds',       'Optimize Docker images with multi-stage builds, layer caching, and distroless base',              'task',  'Done',        'high',    liam,   jordan, 5,  '{docker,cicd}',       1, null);
    addIssue(spaceOps, opsSpr2, 'OPS-3', 'Application monitoring stack',    'Set up Prometheus, Grafana, and custom application metrics with service dashboards',              'epic',  'In Progress', 'highest', jordan, jordan, 8,  '{monitoring}',        0, null);
    addIssue(spaceOps, opsSpr2, 'OPS-4', 'Log aggregation with Loki',       'Deploy Grafana Loki for centralized log collection, structured logging, and querying',            'task',  'In Progress', 'high',    liam,   jordan, 5,  '{monitoring,logs}',   1, null);
    addIssue(spaceOps, opsSpr2, 'OPS-5', 'Alerting rules configuration',    'Define alerting rules for error rates, P95 latency, and resource usage thresholds',              'task',  'To Do',       'medium',  jordan, sarah,  3,  '{monitoring,alerts}', 2, null);
    addIssue(spaceOps, null,    'OPS-6', 'Kubernetes migration plan',        'Research and plan phased migration from Docker Compose to Kubernetes with Helm charts',           'story', 'To Do',       'low',     null,   jordan, 5,  '{k8s,research}',      3, null);

    for (const i of allIssues) {
      await client.query(
        `INSERT INTO issues (id, space_id, sprint_id, parent_id, key, title, description, type, status, priority, assignee_id, reporter_id, story_points, labels, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [i.id, i.space, i.sprintId, i.parentId, i.key, i.title, i.desc, i.type, i.status, i.priority, i.assignee, i.reporter, i.points, i.labels, i.pos]
      );
    }

    console.log('✅ 26 issues seeded across 3 spaces');

    // ── Custom Fields ──
    console.log('🔧 Seeding custom fields...');
    const cfEnv = `cf-${uid()}`;
    const cfCat = `cf-${uid()}`;

    await client.query(
      `INSERT INTO custom_fields (id, space_id, name, field_type, options, is_required, position, show_in)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cfEnv, spaceEng, 'Environment', 'select', JSON.stringify([
        { label: 'Dev', value: 'dev' },
        { label: 'Staging', value: 'staging' },
        { label: 'Prod', value: 'prod' },
      ]), false, 0, '{drawer,detail}']
    );

    await client.query(
      `INSERT INTO custom_fields (id, space_id, name, field_type, options, is_required, position, show_in)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cfCat, spaceEng, 'Story Category', 'select', JSON.stringify([
        { label: 'Frontend', value: 'frontend' },
        { label: 'Backend', value: 'backend' },
        { label: 'Infra', value: 'infra' },
      ]), false, 1, '{drawer}']
    );

    // Field values on some engineering issues
    await client.query(
      `INSERT INTO issue_field_values (id, issue_id, field_id, value) VALUES ($1,$2,$3,$4)`,
      [`ifv-${uid()}`, issueMap['ENG-5'], cfEnv, 'staging']
    );
    await client.query(
      `INSERT INTO issue_field_values (id, issue_id, field_id, value) VALUES ($1,$2,$3,$4)`,
      [`ifv-${uid()}`, issueMap['ENG-8'], cfCat, 'backend']
    );
    await client.query(
      `INSERT INTO issue_field_values (id, issue_id, field_id, value) VALUES ($1,$2,$3,$4)`,
      [`ifv-${uid()}`, issueMap['ENG-6'], cfCat, 'backend']
    );

    // ── Issue Links ──
    console.log('🔗 Seeding issue links...');
    const linksData = [
      { source: 'ENG-2', target: 'ENG-1', type: 'is_child_of'   },
      { source: 'ENG-3', target: 'ENG-1', type: 'is_child_of'   },
      { source: 'ENG-4', target: 'ENG-2', type: 'is_blocked_by' },
      { source: 'ENG-6', target: 'ENG-5', type: 'is_child_of'   },
      { source: 'ENG-7', target: 'ENG-5', type: 'is_child_of'   },
      { source: 'ENG-9', target: 'ENG-5', type: 'relates_to'    },
      { source: 'DSN-5', target: 'DSN-4', type: 'is_child_of'   },
      { source: 'OPS-4', target: 'OPS-3', type: 'is_child_of'   },
    ];

    for (const l of linksData) {
      await client.query(
        `INSERT INTO issue_links (id, source_id, target_id, link_type) VALUES ($1,$2,$3,$4)`,
        [`lnk-${uid()}`, issueMap[l.source], issueMap[l.target], l.type]
      );
    }

    // ── Saved Filters ──
    console.log('🔍 Seeding saved filters...');
    await client.query(
      `INSERT INTO saved_filters (id, space_id, user_id, name, conditions, is_shared, is_pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`flt-${uid()}`, spaceEng, sarah, 'My Open Issues', JSON.stringify({
        assignee: 'me',
        status: ['To Do', 'In Progress', 'In Review'],
      }), false, true]
    );
    await client.query(
      `INSERT INTO saved_filters (id, space_id, user_id, name, conditions, is_shared, is_pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`flt-${uid()}`, spaceEng, alex, 'High Priority Bugs', JSON.stringify({
        type: 'bug',
        priority: ['highest', 'high'],
      }), true, false]
    );
    await client.query(
      `INSERT INTO saved_filters (id, space_id, user_id, name, conditions, is_shared, is_pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`flt-${uid()}`, spaceEng, sarah, 'Sprint Blockers', JSON.stringify({
        priority: ['highest'],
        status: ['To Do', 'In Progress'],
      }), true, true]
    );

    // ── Comments ──
    console.log('💬 Seeding comments...');
    const commentsData = [
      { issue: 'ENG-1', user: alex,   body: 'JWT implementation looks solid. Should we add device fingerprinting to prevent token theft?' },
      { issue: 'ENG-1', user: sarah,  body: 'Good call. I added device fingerprint hashing in the latest commit. See PR #42.' },
      { issue: 'ENG-4', user: jordan, body: 'Found the root cause — the refresh token rotation was not invalidating the previous token in Redis.' },
      { issue: 'ENG-5', user: sarah,  body: "Let's use Express middleware chaining for the gateway. We can swap to Fastify later if perf becomes an issue." },
      { issue: 'ENG-8', user: priya,  body: 'Added composite indexes on (space_id, status) and (assignee_id, created_at). Query time dropped from 340ms to 12ms.' },
      { issue: 'ENG-8', user: alex,   body: 'Impressive improvement! Can you document the before/after EXPLAIN plans in the PR description?' },
      { issue: 'DSN-4', user: maya,   body: "I'm basing the component API on Radix primitives for accessibility. Each component will have unstyled and styled variants." },
      { issue: 'DSN-5', user: alex,   body: 'Make sure we support the asChild pattern for polymorphic rendering. Check the Radix docs for reference.' },
      { issue: 'OPS-1', user: liam,   body: 'Pipeline runs are averaging 4m32s. Parallelizing lint and test stages should cut it to around 2 minutes.' },
      { issue: 'OPS-3', user: jordan, body: "Grafana dashboards are live. I've set up boards for API latency, error rates, and database connection pools." },
    ];

    for (const c of commentsData) {
      await client.query(
        `INSERT INTO comments (id, issue_id, user_id, body) VALUES ($1,$2,$3,$4)`,
        [`cmt-${uid()}`, issueMap[c.issue], c.user, c.body]
      );
    }

    // ── Worklogs ──
    console.log('⏱️  Seeding worklogs...');
    const worklogsData = [
      { issue: 'ENG-1', user: sarah,  time: 240, date: '2026-02-17', desc: 'Architecture design and JWT strategy planning',    billable: true  },
      { issue: 'ENG-2', user: alex,   time: 360, date: '2026-02-18', desc: 'Implemented login and registration endpoints',     billable: true  },
      { issue: 'ENG-3', user: jordan, time: 180, date: '2026-02-19', desc: 'Google OAuth2 provider integration',               billable: true  },
      { issue: 'ENG-4', user: alex,   time: 120, date: '2026-02-24', desc: 'Debugging token refresh rotation logic',           billable: false },
      { issue: 'ENG-5', user: sarah,  time: 300, date: '2026-03-03', desc: 'API gateway scaffolding and route configuration',  billable: true  },
      { issue: 'ENG-6', user: maya,   time: 180, date: '2026-03-05', desc: 'Sliding window rate limiter implementation',       billable: true  },
      { issue: 'ENG-8', user: priya,  time: 240, date: '2026-03-07', desc: 'Query profiling and index optimization',           billable: true  },
      { issue: 'DSN-1', user: alex,   time: 300, date: '2026-02-24', desc: 'Design token system architecture and naming',      billable: true  },
      { issue: 'DSN-4', user: maya,   time: 240, date: '2026-03-10', desc: 'Button and input component scaffolding',           billable: true  },
      { issue: 'OPS-1', user: jordan, time: 360, date: '2026-02-24', desc: 'GitHub Actions pipeline configuration and testing', billable: true  },
    ];

    for (const w of worklogsData) {
      await client.query(
        `INSERT INTO worklogs (id, issue_id, user_id, time_spent, work_date, description, is_billable)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`wl-${uid()}`, issueMap[w.issue], w.user, w.time, w.date, w.desc, w.billable]
      );
    }

    // ── Notifications ──
    console.log('🔔 Seeding notifications...');
    const notifsData = [
      { user: sarah,  space: spaceEng, type: 'issue_assigned', title: 'New assignment',         body: 'You were assigned to ENG-5: API Gateway Implementation',                    read: false, link: '/spaces/ENG/issues/ENG-5' },
      { user: alex,   space: spaceEng, type: 'comment_added',  title: 'New comment on ENG-8',   body: 'Priya Gupta commented on Database query optimization',                      read: false, link: '/spaces/ENG/issues/ENG-8' },
      { user: maya,   space: spaceDsn, type: 'issue_assigned', title: 'New assignment',         body: 'You were assigned to DSN-5: Button component variants',                     read: true,  link: '/spaces/DSN/issues/DSN-5' },
      { user: jordan, space: spaceOps, type: 'sprint_started', title: 'Sprint 2 started',       body: 'Operations Sprint 2 has started. Goal: Infrastructure scaling and alerting', read: false, link: '/spaces/OPS/board'         },
      { user: priya,  space: spaceEng, type: 'mention',        title: 'Mentioned in ENG-8',     body: 'Alex Kumar mentioned you in a comment on Database query optimization',       read: false, link: '/spaces/ENG/issues/ENG-8' },
    ];

    for (const n of notifsData) {
      await client.query(
        `INSERT INTO notifications (id, user_id, space_id, type, title, body, is_read, link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [`ntf-${uid()}`, n.user, n.space, n.type, n.title, n.body, n.read, n.link]
      );
    }

    // ── Audit Logs ──
    console.log('📝 Seeding audit logs...');
    const auditData = [
      { space: spaceEng, user: sarah,  action: 'space_created',  eType: 'space',  eId: spaceEng,           details: { name: 'Engineering' } },
      { space: spaceEng, user: sarah,  action: 'issue_created',  eType: 'issue',  eId: issueMap['ENG-1'],  details: { key: 'ENG-1', title: 'User Authentication System' } },
      { space: spaceEng, user: alex,   action: 'issue_updated',  eType: 'issue',  eId: issueMap['ENG-4'],  details: { field: 'status', from: 'In Progress', to: 'Done' } },
      { space: spaceDsn, user: alex,   action: 'space_created',  eType: 'space',  eId: spaceDsn,           details: { name: 'Design System' } },
      { space: spaceOps, user: jordan, action: 'sprint_started', eType: 'sprint', eId: opsSpr2,            details: { name: 'Sprint 2' } },
    ];

    for (const a of auditData) {
      await client.query(
        `INSERT INTO audit_logs (id, space_id, user_id, action, entity_type, entity_id, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`aud-${uid()}`, a.space, a.user, a.action, a.eType, a.eId, JSON.stringify(a.details)]
      );
    }

    console.log('');
    console.log('🎉 Database seeded successfully!');
    console.log('   📊 1 organization');
    console.log('   👥 6 users');
    console.log('   📦 3 spaces (Engineering, Design System, Operations)');
    console.log('   👤 13 space memberships');
    console.log('   ⭐ 2 space favorites');
    console.log('   🏃 7 sprints');
    console.log('   📋 26 issues (12 ENG + 8 DSN + 6 OPS)');
    console.log('   🔧 2 custom fields + 3 field values');
    console.log('   🔗 8 issue links');
    console.log('   🔍 3 saved filters');
    console.log('   💬 10 comments');
    console.log('   ⏱️  10 worklogs');
    console.log('   🔔 5 notifications');
    console.log('   📝 5 audit logs');
    console.log('');

  } finally {
    client.release();
  }

  // ──────────────────────────────────────────────
  // 4. KEEPALIVE HTTP SERVER
  // ──────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'sprintboard-db-seed' }));
  });

  server.listen(3002, () => {
    console.log('🌐 Keepalive server running on http://localhost:3002');
  });
}

main().catch((err) => {
  console.error('❌ Database seed failed:', err);
  process.exit(1);
});
