/**
 * Read-only schema validation at server boot.
 * Never runs DDL — only SELECT against information_schema / catalog tables.
 */

const REQUIRED_TABLES = [
  'organizations', 'users', 'spaces', 'space_members', 'sprints', 'issues',
  'custom_fields', 'issue_field_values', 'comments', 'worklogs', 'saved_filters',
  'notifications', 'sessions', 'invitations'
];

const OPTIONAL_TABLES = [
  'issue_favorites', 'issue_history', 'issue_attachments', 'roadmap_items',
  'roadmap_colors', 'file_storage', 'audit_logs', 'space_favorites',
  'combination_upgraders', 'issue_drafts'
];

const REQUIRED_ISSUE_COLUMNS = [
  'story_points', 'fix_description', 'start_date', 'due_date', 'original_estimate',
  'team', 'product_type', 'deleted_at'
];

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS ok`,
    [name]
  );
  return !!r.rows[0]?.ok;
}

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS ok`,
    [table, column]
  );
  return !!r.rows[0]?.ok;
}

async function validateSchemaReadOnly(pool) {
  console.log('[schema] Read-only validation (no DDL will run)...');
  let warnings = 0;

  for (const t of REQUIRED_TABLES) {
    if (!(await tableExists(pool, t))) {
      console.error('[schema] MISSING required table: ' + t + ' — run scripts/migrations/001-production-schema.sql');
      warnings++;
    }
  }

  for (const t of OPTIONAL_TABLES) {
    if (!(await tableExists(pool, t))) {
      console.warn('[schema] Optional table not present: ' + t);
      warnings++;
    }
  }

  if (await tableExists(pool, 'issues')) {
    for (const col of REQUIRED_ISSUE_COLUMNS) {
      if (!(await columnExists(pool, 'issues', col))) {
        console.warn('[schema] issues.' + col + ' missing — run 001-production-schema.sql');
        warnings++;
      }
    }
  }

  if (await tableExists(pool, 'sprints')) {
    if (!(await columnExists(pool, 'sprints', 'developer_leaves'))) {
      console.warn('[schema] sprints.developer_leaves missing — run scripts/migrations/005-sprint-developer-leaves.js');
      warnings++;
    }
  }

  if (warnings === 0) {
    console.log('[schema] OK — all required objects present.');
  } else {
    console.warn('[schema] ' + warnings + ' warning(s). Server will start; run manual migrations if needed.');
  }

  return warnings;
}

/** Log-only check for Product_Team Combination field — never INSERT/UPDATE on boot. */
async function logProductTeamCombinationStatus(pool, q) {
  try {
    const combSpaces = await q(
      "SELECT id, key FROM spaces WHERE name = $1 AND (is_archived = false OR is_archived IS NULL)",
      ['Product_Team']
    );
    if (!combSpaces.rows.length) {
      console.log('[schema] Product_Team space not found — no Combination field check.');
      return;
    }
    for (const sp of combSpaces.rows) {
      const combField = (await q(
        'SELECT id, field_type, options FROM custom_fields WHERE space_id = $1 AND LOWER(name) = LOWER($2)',
        [sp.id, 'Combination']
      )).rows[0];
      if (!combField) {
        console.warn(
          '[schema] Product_Team (' + sp.key + '): Combination custom field MISSING. ' +
          'Create via Space Settings → Custom Fields, or run scripts/migrations/003-product-team-combination.sql'
        );
        continue;
      }
      let existing = combField.options;
      if (typeof existing === 'string') {
        try { existing = JSON.parse(existing); } catch (_) { existing = null; }
      }
      if (!existing || existing.v !== 2 || !existing.groups) {
        console.warn(
          '[schema] Product_Team (' + sp.key + '): Combination field exists but options may need upgrade (v2 groups). ' +
          'Run scripts/migrations/003-product-team-combination.js if needed — boot will NOT auto-change it.'
        );
      } else {
        console.log('[schema] Product_Team (' + sp.key + '): Combination field OK.');
      }
    }
  } catch (e) {
    console.warn('[schema] Product_Team Combination check skipped:', e.message);
  }
}

/** Log duplicate issue keys — data fix is scripts/data-fix-duplicate-issue-keys.js (manual). */
async function logDuplicateKeyWarning(pool, q) {
  try {
    const dupRows = await q(`
      SELECT i.key, i.space_id, COUNT(*)::int AS cnt
      FROM issues i
      WHERE i.deleted_at IS NULL
      GROUP BY i.key, i.space_id
      HAVING COUNT(*) > 1
      LIMIT 20
    `);
    if (dupRows.rows.length) {
      console.warn(
        '[schema] Found duplicate issue keys (' + dupRows.rows.length + '+ groups). ' +
        'Run: node scripts/data-fix-duplicate-issue-keys.js'
      );
    }
  } catch (e) {
    /* deleted_at may not exist on very old DB — ignore */
  }
}

module.exports = {
  validateSchemaReadOnly,
  logProductTeamCombinationStatus,
  logDuplicateKeyWarning
};
