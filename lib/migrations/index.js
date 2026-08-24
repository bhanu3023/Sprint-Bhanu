/**
 * Ordered, tracked schema migrations — applied once each at server boot by
 * lib/migrate.js and recorded in the schema_migrations table.
 *
 * RULES for anything added here:
 *  1. Idempotent. Every migration must survive running against a database that
 *     already has the objects (production predates this runner, so the first
 *     boot applies the whole list to an already-populated schema).
 *  2. Additive only. No DROP COLUMN / DROP TABLE / destructive UPDATE. Rolling
 *     the app back to an older release must stay safe — old code simply
 *     ignores new columns.
 *  3. One concern per migration, and never edit an id that has shipped. A
 *     migration already recorded in schema_migrations will not run again, so
 *     changing it silently does nothing. Add a new one instead.
 *
 * Each entry: { id, description, up(client) } — `client` is a pg client already
 * inside a transaction; throwing rolls the whole migration back.
 */

const crypto = require('crypto');
const { seedBuiltinIssueFields } = require('../builtin-issue-fields');

const uid = () => crypto.randomUUID();

const MIGRATIONS = [
  {
    id: '001-baseline-objects',
    description: 'Tables/columns/constraints that older releases created at boot',
    async up(client) {
      // Tables that used to be CREATE TABLE IF NOT EXISTS on every startup.
      await client.query(`CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR PRIMARY KEY,
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        space_id VARCHAR REFERENCES spaces(id) ON DELETE SET NULL,
        type VARCHAR NOT NULL,
        title VARCHAR NOT NULL,
        body TEXT,
        link VARCHAR,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS issue_history (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
        user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        field_name VARCHAR NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS issue_attachments (
        id VARCHAR PRIMARY KEY,
        issue_id VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
        filename VARCHAR NOT NULL,
        original_name VARCHAR NOT NULL,
        size BIGINT DEFAULT 0,
        mime_type VARCHAR,
        uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS file_storage (
        id VARCHAR PRIMARY KEY,
        original_name VARCHAR NOT NULL,
        mime_type VARCHAR NOT NULL,
        size INTEGER,
        data BYTEA NOT NULL,
        uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS roadmap_items (
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

      await client.query(`CREATE TABLE IF NOT EXISTS roadmap_colors (
        color_key  VARCHAR NOT NULL,
        color      VARCHAR NOT NULL,
        created_by VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (color_key, created_by)
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS space_favorites (
        user_id  VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        space_id VARCHAR NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, space_id)
      )`);

      // points -> story_points. Only when the old column is still there and the
      // new one isn't, so this can't clobber an already-renamed column.
      await client.query(`DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='issues' AND column_name='points')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='issues' AND column_name='story_points')
          THEN
            ALTER TABLE issues RENAME COLUMN points TO story_points;
          END IF;
        END $$`);

      await client.query(`ALTER TABLE issues
        ADD COLUMN IF NOT EXISTS story_points INTEGER,
        ADD COLUMN IF NOT EXISTS fix_description TEXT,
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS due_date DATE,
        ADD COLUMN IF NOT EXISTS original_estimate INTEGER,
        ADD COLUMN IF NOT EXISTS team VARCHAR(50),
        ADD COLUMN IF NOT EXISTS product_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

      await client.query(`ALTER TABLE sprints
        ADD COLUMN IF NOT EXISTS developer_ids TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS qa_ids TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS public_holidays TEXT[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS developer_leaves JSONB DEFAULT '{}'`);

      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR DEFAULT 'dark'`);
      await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_settings JSONB`);
      await client.query(`ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
      await client.query(`ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS show_in TEXT[] DEFAULT '{drawer}'`);
      await client.query(`ALTER TABLE roadmap_items
        ADD COLUMN IF NOT EXISTS group_name VARCHAR DEFAULT 'General',
        ADD COLUMN IF NOT EXISTS category  VARCHAR DEFAULT 'Items',
        ADD COLUMN IF NOT EXISTS milestone BOOLEAN DEFAULT FALSE`);

      // CHECK constraints widened by earlier releases. Recreated once here
      // instead of on every boot, which is what made this risky before.
      await client.query(`ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check`);
      await client.query(`ALTER TABLE invitations ADD CONSTRAINT invitations_status_check
        CHECK (status IN ('pending','accepted','expired','cancelled'))`);

      await client.query(`ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check`);
      await client.query(`ALTER TABLE issues ADD CONSTRAINT issues_status_check
        CHECK (status IN ('To Do','In Progress','In Review','Done','Blocked'))`);

      await client.query(`UPDATE space_members SET role='site_admin' WHERE role='admin'`);
      await client.query(`ALTER TABLE space_members DROP CONSTRAINT IF EXISTS space_members_role_check`);
      await client.query(`ALTER TABLE space_members ADD CONSTRAINT space_members_role_check
        CHECK (role IN ('owner','site_admin','manager','member','viewer'))`);
    }
  },

  {
    id: '002-issue-favorites',
    description: 'Starred tickets per user (GET /api/data reads this unconditionally)',
    async up(client) {
      // Never existed on main: the release that added the queries also dropped
      // the boot-time CREATE that made it. Without this table /api/data throws
      // and no page in the app can load.
      await client.query(`CREATE TABLE IF NOT EXISTS issue_favorites (
        user_id    VARCHAR REFERENCES users(id)  ON DELETE CASCADE,
        issue_id   VARCHAR REFERENCES issues(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, issue_id)
      )`);
    }
  },

  {
    id: '003-custom-fields-builtin-columns',
    description: 'custom_fields.is_builtin + field_key',
    async up(client) {
      await client.query(`ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS field_key VARCHAR`);
    }
  },

  {
    id: '004-seed-builtin-issue-fields',
    description: 'Built-in field registry rows for every active space',
    async up(client) {
      // Without these rows isSpaceBuiltinFieldEnabled() returns false for
      // everything except Title/Status, so the Create Issue form renders with
      // only a Title box. seedBuiltinIssueFields is insert-or-tag only.
      const spaces = (await client.query(
        `SELECT id, name, key FROM spaces
         WHERE is_archived = false OR is_archived IS NULL
         ORDER BY name`
      )).rows;
      let total = 0;
      for (const sp of spaces) {
        const added = await seedBuiltinIssueFields(
          (sql, params) => client.query(sql, params), uid, sp.id, sp
        );
        total += added.length;
      }
      return total + ' built-in field row(s) across ' + spaces.length + ' space(s)';
    }
  },

  {
    id: '005-issues-deleted-by-varchar',
    description: 'Widen issues.deleted_by from uuid to varchar',
    async up(client) {
      // User ids are 'usr-<uuid>' varchar, so writing one into a uuid column
      // raises 22P02 and DELETE /api/issues/:id fails with a 500 every time.
      // The column is empty in practice (the write never succeeded), so the
      // cast is a no-op on data.
      await client.query(`DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='issues' AND column_name='deleted_by'
                        AND data_type='uuid')
          THEN
            ALTER TABLE issues ALTER COLUMN deleted_by TYPE VARCHAR USING deleted_by::text;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='issues' AND column_name='deleted_by')
          THEN
            ALTER TABLE issues ADD COLUMN deleted_by VARCHAR;
          END IF;
        END $$`);
    }
  },

  {
    id: '006-hot-column-indexes',
    description: 'Indexes on columns every list/report query filters by',
    async up(client) {
      // issue_history is joined by every report and had no index at all.
      await client.query(`CREATE INDEX IF NOT EXISTS idx_issue_history_issue_id ON issue_history(issue_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_issues_sprint_id      ON issues(sprint_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_issues_assignee_id    ON issues(assignee_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_issues_parent_id      ON issues(parent_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ifv_issue_id          ON issue_field_values(issue_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_custom_fields_space   ON custom_fields(space_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_space_members_user    ON space_members(user_id)`);
    }
  },

  {
    id: '007-sprint-soft-delete',
    description: 'Tombstone columns so a deleted sprint goes to the bin instead of vanishing',
    async up(client) {
      // DELETE /api/sprints/:id used to hard-delete the row, so a deleted sprint
      // could never appear in Deleted Items. Additive only: existing rows get
      // NULL, which every query reads as "not deleted".
      await client.query(`ALTER TABLE sprints
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS deleted_by VARCHAR`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sprints_deleted_at ON sprints(deleted_at)`);
    }
    },
  {
    id: '008-issues-former-sprint',
    description: 'Remember which sprint a ticket was pulled out of, so restoring the sprint refills it',
    async up(client) {
      // Deleting a sprint detaches its tickets to the backlog (they must not be
      // stranded inside a binned sprint). Without a breadcrumb, restoring the
      // sprint brought it back empty. This column is that breadcrumb: it is set
      // only by the sprint-delete path and cleared as soon as anyone moves the
      // ticket into a sprint themselves, so a restore can never override a
      // re-plan someone did in the meantime.
      await client.query(`ALTER TABLE issues
        ADD COLUMN IF NOT EXISTS former_sprint_id VARCHAR`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_issues_former_sprint_id
        ON issues(former_sprint_id) WHERE former_sprint_id IS NOT NULL`);
    }
  },
  {
    id: '009-custom-fields-required-types',
    description: 'Let a field be required for only certain issue types (e.g. Story Points not for bugs)',
    async up(client) {
      // NULL / empty deliberately means "required for EVERY type", so every
      // existing required field keeps behaving exactly as it does today. Only a
      // non-empty list narrows the rule.
      await client.query(`ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS required_types VARCHAR[]`);
    }
  },
  {
    id: '010-spillover-developer-filter',
    description: 'Per-space toggle: Spillover report defaults to Developer-assigned tickets only',
    async up(client) {
      await client.query(`ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS spillover_developers_only BOOLEAN DEFAULT true`);
    }
  },
  {
    id: '011-spillover-report-settings',
    description: 'Replace the single Developer-only toggle with per-type/per-role Spillover settings',
    async up(client) {
      await client.query(`ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS spillover_settings JSONB`);
      // Carry forward intent from the boolean this replaces: anyone who had
      // already turned "Developer-only" off gets the equivalent new setting
      // (QA-assigned tickets included) instead of silently reverting to the
      // strict default.
      await client.query(`
        UPDATE spaces
        SET spillover_settings = '{"include_qa_assigned": true}'::jsonb
        WHERE spillover_settings IS NULL AND spillover_developers_only = false
      `);
    }
  },
  {
    id: '012-sprint-achievements',
    description: 'Manually-entered per-sprint achievement highlights for the MBR Achievements tab',
    async up(client) {
      await client.query(`ALTER TABLE sprints
        ADD COLUMN IF NOT EXISTS achievements JSONB DEFAULT '[]'`);
    }
  },
  {
    id: '013-sprint-auto-complete-exempt',
    description: 'Shield already-overdue sprints from the new 23:59 auto-complete sweep',
    async up(client) {
      await client.query(`ALTER TABLE sprints
        ADD COLUMN IF NOT EXISTS auto_complete_exempt BOOLEAN DEFAULT false`);
      // Sprints that were ALREADY past their end date when auto-complete
      // shipped are grandfathered out of it. Without this the first sweep
      // would close months-old sprints in one go — freezing their velocity,
      // spilling their tickets to the backlog and firing a sprint_completed
      // notification to every member, none of which anyone asked for. They
      // stay Active until a human clicks Complete. Sprints ending today or
      // later are NOT exempt and close normally at 23:59.
      const r = await client.query(`
        UPDATE sprints SET auto_complete_exempt = true
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND end_date IS NOT NULL
          AND end_date < CURRENT_DATE
          AND auto_complete_exempt IS NOT TRUE
      `);
      return r.rowCount + ' overdue sprint(s) grandfathered out of auto-complete';
    }
  },
  {
    id: '014-spaces-key-unique',
    description: 'Space keys must be unique — they are the /space/:key route segment',
    async up(client) {
      // Case-insensitive: PROJ and proj resolve to the same space in
      // getSpaceByKey(), so treating them as distinct would still break
      // navigation. Keys are upper-cased on write, this catches the rest.
      //
      // Archived spaces are included on purpose. Archiving only sets
      // is_archived — the row keeps its key and can be unarchived or
      // recovered, so letting a new space claim that key just defers the
      // collision to whenever someone restores the old one.
      const dupes = (await client.query(`
        SELECT UPPER(key) AS k, COUNT(*)::int AS cnt
        FROM spaces WHERE key IS NOT NULL
        GROUP BY UPPER(key) HAVING COUNT(*) > 1
      `)).rows;
      if (dupes.length) {
        // Deliberately not fatal. The server-side check added alongside this
        // migration already blocks NEW duplicates, so booting without the
        // index is strictly better than refusing to boot at all. Rename the
        // offenders and restart to pick the index up.
        console.warn('[migrate] 014: spaces.key already has duplicates — unique index NOT created. ' +
          'Duplicated keys: ' + dupes.map(d => d.k + ' x' + d.cnt).join(', ') + '. ' +
          'Rename them in Space Settings, then restart to apply the constraint.');
        return 'skipped — ' + dupes.length + ' duplicate key(s) present';
      }
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_key_unique ON spaces (UPPER(key))`);
      return 'unique index on UPPER(key) created';
    }
  },
  {
    id: '015-sprint-completed-at',
    description: 'Actual completion timestamp, separate from the planned end_date, so the backlog page can order completed sprints by when they really finished',
    async up(client) {
      await client.query(`ALTER TABLE sprints
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
      // Backfill sprints completed before this column existed. end_date (the
      // planned date, not a real timestamp) is the best signal available for
      // them — still far better than leaving every historical sprint tied at
      // NULL, which would leave their relative order undefined.
      const r = await client.query(`
        UPDATE sprints SET completed_at = end_date::timestamp
        WHERE status = 'completed' AND completed_at IS NULL AND end_date IS NOT NULL
      `);
      return r.rowCount + ' already-completed sprint(s) backfilled from end_date';
    }
  },
  {
    id: '016-configurable-type-priority',
    description: 'Drop the fixed CHECK constraints on issues.type/priority so each space can configure its own type/priority option list (same model as Team/Product Type) — validation moves to the app layer; existing stored values are untouched',
    async up(client) {
      await client.query('ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_type_check');
      await client.query('ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_priority_check');
    }
  },
  {
    id: '017-spaces-org-id-backfill',
    description: 'Backfill spaces.org_id where NULL -- POST /api/spaces omitted the column entirely, so every space created through it got NULL',
    async up(client) {
      // How many spaces actually need a value. If none do, this migration
      // has nothing to decide, and the org count below is irrelevant to it --
      // there is no guess to avoid making. Checked first so an unrelated
      // multi-org fact never blocks a deploy that does not touch org_id at
      // all.
      const missing = (await client.query(
        'SELECT COUNT(*)::int AS c FROM spaces WHERE org_id IS NULL'
      )).rows[0].c;
      if (!missing) return 'no NULL org_id spaces -- nothing to backfill';

      const orgs = await client.query('SELECT id FROM organizations');
      if (orgs.rows.length === 0) {
        // No organization exists to backfill against. Not an ambiguous
        // choice among candidates -- there are no candidates at all -- so
        // this is a harmless no-op, not the guess the multi-org case would be.
        return missing + ' NULL org_id space(s) found, but no organizations exist -- left NULL';
      }
      if (orgs.rows.length > 1) {
        // Exactly the case the write-path fix (req.user.org_id, not
        // "organizations LIMIT 1") exists to prevent: with more than one
        // organization, there is no way to know which one a NULL space
        // belongs to. Picking one -- even the "first" by whatever arbitrary
        // order postgres returns -- risks silently attributing a space to
        // the wrong tenant, which is worse and harder to notice than leaving
        // it NULL. Abort loudly; a human must resolve which org each of
        // these spaces belongs to before this migration can run.
        const orphans = (await client.query(
          'SELECT id, key, name FROM spaces WHERE org_id IS NULL ORDER BY name LIMIT 20'
        )).rows;
        throw new Error(
          missing + ' space(s) have NULL org_id, and ' + orgs.rows.length + ' organizations exist -- ' +
          'cannot determine which org each NULL space belongs to. Resolve manually ' +
          '(UPDATE spaces SET org_id=... WHERE id=...) then re-run. Affected: ' +
          orphans.map(function (s) { return (s.key || s.id) + ' "' + s.name + '"'; }).join(', ') +
          (missing > orphans.length ? ', ... (' + (missing - orphans.length) + ' more)' : '')
        );
      }
      // Exactly one organization: the only case where a backfill is not a
      // guess. WHERE org_id IS NULL means an already-set value -- right or
      // wrong -- is never touched; this migration only fills blanks.
      const orgId = orgs.rows[0].id;
      const r = await client.query('UPDATE spaces SET org_id=$1 WHERE org_id IS NULL', [orgId]);
      return r.rowCount + ' space(s) backfilled to the sole organization ' + orgId;
    }
  },
  {
    id: '018-issues-key-unique-constraint',
    description: 'issues_key_key UNIQUE(key) -- the duplicate-key-race fix depends on this constraint entirely, and it exists on no schema file or migration in this repo, only by an undocumented manual patch on one database',
    async up(client, pool) {
      // Everything real happens on ONE dedicated connection, not on `client`.
      // A first version split the work across `client` (already inside the
      // runner's transaction) and a second connection for the CONCURRENTLY
      // build, and hit a real cross-connection visibility race: the ALTER
      // TABLE on `client` occasionally ran before the just-committed index
      // was visible to it, failing with "index does not exist" on a
      // genuinely fresh database. Doing the whole sequence on one connection
      // removes the race instead of papering over it with a retry.
      // `client`'s transaction ends up wrapping nothing but the runner's own
      // schema_migrations bookkeeping insert, which is exactly what it
      // should wrap.
      // `pool` is the SAME pool runMigrations was invoked with (see lib/migrate.js),
      // never a separately-required singleton -- so this targets whichever database
      // is actually being migrated, not whatever DATABASE_URL happens to resolve to.
      const raw = await pool.connect();
      try {
        const already = await raw.query(
          "SELECT 1 FROM pg_constraint WHERE conname = 'issues_key_key' AND conrelid = 'issues'::regclass"
        );
        if (already.rows.length) return 'issues_key_key already present -- no-op';

        // Never auto-dedupe. Two issues sharing a key is data the user owns;
        // silently renaming one of them out from under a live production
        // database is a worse outcome than refusing to run.
        const dupes = (await raw.query(`
          SELECT key, COUNT(*)::int AS c, array_agg(id) AS ids
          FROM issues WHERE key IS NOT NULL GROUP BY key HAVING COUNT(*) > 1
          ORDER BY key LIMIT 20
        `)).rows;
        if (dupes.length) {
          throw new Error(
            dupes.length + ' duplicate issue key(s) exist -- cannot add the UNIQUE constraint. ' +
            'Resolve manually (rename or merge the duplicates), then re-run. Affected: ' +
            dupes.map(function (d) { return d.key + ' x' + d.c + ' (' + d.ids.join(',') + ')'; }).join('; ')
          );
        }

        // CREATE INDEX CONCURRENTLY cannot run inside a transaction, and this
        // connection has none open. A plain CREATE INDEX would take a lock
        // that blocks writes to `issues` for however long the build takes --
        // on a live table of unknown size, that is a production incident.
        //
        // A prior run that crashed mid-build can leave an INVALID index under
        // this name; IF NOT EXISTS alone would then skip it forever without
        // ever finishing the build. Detect and clear that case first.
        const existing = await raw.query(
          "SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_issues_key_unique'::regclass"
        ).catch(function () { return { rows: [] }; });
        if (existing.rows.length && !existing.rows[0].indisvalid) {
          await raw.query('DROP INDEX CONCURRENTLY IF EXISTS idx_issues_key_unique');
        }
        await raw.query('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_key_unique ON issues (key)');

        // Attaching a pre-built index as a constraint is metadata-only --
        // fast, and safe on this same connection with no lock surprises.
        await raw.query('ALTER TABLE issues ADD CONSTRAINT issues_key_key UNIQUE USING INDEX idx_issues_key_unique');
        return 'issues_key_key created from a concurrently-built index';
      } finally {
        raw.release();
      }
    }
  },
  {
    id: '019-hot-column-indexes-at-scale',
    description: 'Indexes measured against a 150k-issue / 90k-comment / 60k-worklog database, not the 72-issue local one -- issues.space_id, issues.reporter_id, comments.issue_id, worklogs.issue_id, and a PARTIAL index on issues.deleted_at (only the rare deleted_at IS NOT NULL rows). issues.updated_at deliberately excluded: the planner selects it but measured timing showed no real improvement over sorting the already-small filtered result.',
    async up(client, pool) {
      // Same reasoning as 018: CREATE INDEX CONCURRENTLY cannot run inside a
      // transaction, and everything here runs on ONE connection from the
      // pool this run was actually invoked with (see 018 and lib/migrate.js).
      const raw = await pool.connect();
      try {
        const specs = [
          // issues.space_id -- every space-scoped list, report, and the bulk
          // /api/data load filter by this. Measured 4-9x on the queries that
          // are dominated by this filter (report status breakdown 50.7ms ->
          // 5.7ms; team workload 47.5ms -> 7.3ms; /api/data issues load
          // 31.6ms -> 7.4ms; dashboard activity 57.2ms -> 8.8ms). Neutral --
          // not a regression, not a win -- on the single full issue-list query
          // that self-joins issues to itself for parent_id, because that join
          // always seq-scans the hash side regardless of this index.
          { name: 'idx_issues_space_id', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_space_id ON issues (space_id)' },
          // issues.reporter_id -- had NO index anywhere, not even in
          // db/init.sql. GET /api/my-issues "reported" measured 43-54ms
          // (sequential scan of the whole table) -> 0.06-0.11ms.
          { name: 'idx_issues_reporter_id', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_reporter_id ON issues (reporter_id)' },
          // comments.issue_id -- every issue detail view loads an issue's
          // comments by this. Measured 21.7ms (seq scan of 90k comments) ->
          // 0.05ms.
          { name: 'idx_comments_issue_id', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_issue_id ON comments (issue_id)' },
          // worklogs.issue_id -- same shape as comments. Measured 2.8-6.7ms
          // (seq scan of 60k worklogs) -> 0.07-0.08ms.
          { name: 'idx_worklogs_issue_id', sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worklogs_issue_id ON worklogs (issue_id)' },
          // issues.deleted_at -- PARTIAL (WHERE deleted_at IS NOT NULL), not a
          // full index like the one db/init.sql happens to carry. Almost
          // every row has deleted_at NULL, so a full index is not selective in
          // the common direction and is pure write overhead; the only query
          // that benefits is the rare "find the deleted ones" (the bin view),
          // which only needs the few rows where it IS NOT NULL. Measured
          // 52.6ms (seq scan) -> 0.003ms, and the partial index itself is
          // 8KB at this scale versus 3.4MB for a full index built on the same
          // column (measured against issues.updated_at as the comparison
          // point) for a query pattern that turned out not to help at all.
          { name: 'idx_issues_deleted_at', sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_deleted_at ON issues (deleted_at) WHERE deleted_at IS NOT NULL" }
        ];
        const built = [];
        for (const s of specs) {
          const already = await raw.query('SELECT indexdef FROM pg_indexes WHERE indexname = $1', [s.name]);
          if (already.rows.length) {
            // db/init.sql already ships idx_issues_deleted_at as a FULL index
            // (no WHERE clause) on a fresh database -- name matches but the
            // definition is the one this migration deliberately replaces with
            // a partial index. Any other name match here really is a no-op.
            const isPartial = /\bWHERE\b/i.test(already.rows[0].indexdef);
            if (s.name === 'idx_issues_deleted_at' && !isPartial) {
              await raw.query('DROP INDEX CONCURRENTLY idx_issues_deleted_at');
            } else {
              continue;
            }
          }
          // Clear an INVALID index (a prior crashed CONCURRENTLY build) before retrying.
          const invalid = await raw.query(
            'SELECT indisvalid FROM pg_index WHERE indexrelid = $1::regclass', [s.name]
          ).catch(function () { return { rows: [] }; });
          if (invalid.rows.length && !invalid.rows[0].indisvalid) {
            await raw.query('DROP INDEX CONCURRENTLY IF EXISTS ' + s.name);
          }
          await raw.query(s.sql);
          built.push(s.name);
        }
        return built.length ? built.join(', ') + ' built' : 'all 5 already present -- no-op';
      } finally {
        raw.release();
      }
    }
  }
];

module.exports = { MIGRATIONS };
