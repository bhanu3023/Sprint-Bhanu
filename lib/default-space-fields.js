/**
 * Optional custom field templates (not auto-seeded on new spaces).
 * Admins add these manually via Settings → Issue Fields → + Add Field,
 * or use "Apply to all boards" from an existing space.
 */

const DEFAULT_SPACE_CUSTOM_FIELDS = [
  {
    name: 'Environment',
    field_type: 'select',
    options: ['Development', 'Staging', 'Production', 'UAT'],
    is_required: false,
    position: 0,
    show_in: ['drawer', 'create']
  },
  {
    name: 'Severity',
    field_type: 'select',
    options: ['Critical', 'Major', 'Minor', 'Trivial'],
    is_required: false,
    position: 1,
    show_in: ['drawer', 'create']
  },
  {
    name: 'Release Version',
    field_type: 'text',
    options: [],
    is_required: false,
    position: 2,
    show_in: ['drawer']
  },
  {
    name: 'Customer',
    field_type: 'text',
    options: [],
    is_required: false,
    position: 3,
    show_in: ['drawer', 'create']
  },
  {
    name: 'Root Cause',
    field_type: 'textarea',
    options: [],
    is_required: false,
    position: 4,
    show_in: ['drawer']
  }
];

/** Insert default fields missing from this space (by name). Returns names added. */
async function ensureDefaultCustomFields(q, uidFn, spaceId) {
  const added = [];
  for (const field of DEFAULT_SPACE_CUSTOM_FIELDS) {
    const ex = await q(
      'SELECT id FROM custom_fields WHERE space_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
      [spaceId, field.name]
    );
    if (ex.rows.length) continue;
    const opts = JSON.stringify(Array.isArray(field.options) ? field.options : []);
    await q(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        uidFn(),
        spaceId,
        field.name,
        field.field_type,
        opts,
        field.is_required || false,
        field.position || 0,
        field.show_in || ['drawer']
      ]
    );
    added.push(field.name);
  }
  return added;
}

async function seedDefaultCustomFields(q, uidFn, spaceId) {
  return ensureDefaultCustomFields(q, uidFn, spaceId);
}

module.exports = {
  DEFAULT_SPACE_CUSTOM_FIELDS,
  ensureDefaultCustomFields,
  seedDefaultCustomFields
};
