/**
 * Built-in issue fields — stored in custom_fields with is_builtin=true.
 * Presence in custom_fields for a space controls visibility; delete = hide for that space.
 */
const { buildCombinationOptionsPayload } = require('../combination-options');

const BUILTIN_ISSUE_FIELDS = [
  { field_key: 'title', name: 'Title', field_type: 'text', is_required: true, position: 0, show_in: ['create', 'drawer'], locked: true },
  { field_key: 'type', name: 'Type', field_type: 'select', position: 1, show_in: ['create', 'drawer'] },
  { field_key: 'priority', name: 'Priority', field_type: 'select', position: 2, show_in: ['create', 'drawer'] },
  { field_key: 'assignee', name: 'Assignee', field_type: 'user', position: 3, show_in: ['create', 'drawer'] },
  { field_key: 'reporter', name: 'Reporter', field_type: 'user', position: 4, show_in: ['create', 'drawer'] },
  { field_key: 'sprint', name: 'Sprint', field_type: 'select', position: 5, show_in: ['create', 'drawer'] },
  { field_key: 'story_points', name: 'Story Points', field_type: 'number', position: 6, show_in: ['create', 'drawer'] },
  { field_key: 'team', name: 'Team', field_type: 'select', position: 7, show_in: ['create', 'drawer'] },
  { field_key: 'product_type', name: 'Product Type', field_type: 'select', position: 8, show_in: ['create', 'drawer'] },
  { field_key: 'start_date', name: 'Start Date', field_type: 'date', position: 9, show_in: ['create', 'drawer'] },
  { field_key: 'due_date', name: 'Due Date', field_type: 'date', position: 10, show_in: ['create', 'drawer'] },
  { field_key: 'description', name: 'Description', field_type: 'textarea', position: 11, show_in: ['create', 'drawer'] },
  { field_key: 'fix_description', name: 'Fix Description', field_type: 'textarea', position: 12, show_in: ['drawer'] },
  { field_key: 'combination', name: 'Combination', field_type: 'multi_select', position: 13, show_in: ['create', 'drawer'], productTeamOnly: true }
];

function isProductTeamSpace(spaceRow) {
  if (!spaceRow) return false;
  return spaceRow.name === 'Product_Team' || spaceRow.key === 'PTM';
}

function builtinFieldOptions(field) {
  if (field.field_key === 'combination') {
    return buildCombinationOptionsPayload();
  }
  const defaults = {
    type: ['epic', 'story', 'task', 'bug', 'subtask'],
    priority: ['highest', 'high', 'medium', 'low', 'lowest'],
    team: ['Dev', 'QA', 'Infra', 'Manage', 'Product_Team'],
    product_type: ['Message', 'Email', 'Content', 'Manage', 'Infra']
  };
  return defaults[field.field_key] || [];
}

function optionsAreEmpty(opts) {
  if (opts == null) return true;
  if (typeof opts === 'string') {
    try {
      opts = JSON.parse(opts);
    } catch (_) {
      return !String(opts).trim();
    }
  }
  if (opts && opts.v === 2 && opts.groups) return false;
  if (Array.isArray(opts)) return opts.length === 0;
  return true;
}

/** Ensure custom_fields has is_builtin + field_key (idempotent; same as migration 006). */
async function ensureBuiltinFieldColumns(q) {
  await q(`
    ALTER TABLE custom_fields
      ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS field_key VARCHAR
  `);
}

/** Insert missing built-in field rows for a space (idempotent). Returns names added. */
async function seedBuiltinIssueFields(q, uidFn, spaceId, spaceRow) {
  await ensureBuiltinFieldColumns(q);
  const added = [];
  let space = spaceRow;
  if (!space) {
    space = (await q('SELECT id, name, key FROM spaces WHERE id = $1', [spaceId])).rows[0];
  }
  if (!space) return added;

  for (const field of BUILTIN_ISSUE_FIELDS) {
    if (field.productTeamOnly && !isProductTeamSpace(space)) continue;

    const byKey = (await q(
      'SELECT id, is_builtin, field_key FROM custom_fields WHERE space_id = $1 AND field_key = $2 LIMIT 1',
      [spaceId, field.field_key]
    )).rows[0];

    const byName = !byKey ? (await q(
      'SELECT id, is_builtin, field_key FROM custom_fields WHERE space_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
      [spaceId, field.name]
    )).rows[0] : null;

    const existing = byKey || byName;
    if (existing) {
      const defOpts = builtinFieldOptions(field);
      const needsOpts = defOpts.length && optionsAreEmpty(
        (await q('SELECT options FROM custom_fields WHERE id = $1', [existing.id])).rows[0]?.options
      );
      if (!existing.is_builtin || !existing.field_key || needsOpts) {
        await q(
          `UPDATE custom_fields SET is_builtin = true, field_key = $1${needsOpts ? ', options = $3::jsonb' : ''} WHERE id = $2`,
          needsOpts
            ? [field.field_key, existing.id, JSON.stringify(defOpts)]
            : [field.field_key, existing.id]
        );
      }
      continue;
    }

    const opts = JSON.stringify(builtinFieldOptions(field));
    await q(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in, is_builtin, field_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, true, $9)`,
      [
        uidFn(),
        spaceId,
        field.name,
        field.field_type,
        opts,
        field.is_required || false,
        field.position,
        field.show_in,
        field.field_key
      ]
    );
    added.push(field.name);
  }
  return added;
}

module.exports = {
  BUILTIN_ISSUE_FIELDS,
  ensureBuiltinFieldColumns,
  seedBuiltinIssueFields,
  isProductTeamSpace
};
