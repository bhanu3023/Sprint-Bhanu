const { requireAuth } = require('../auth');
const { isReservedFieldName, reservedNameBlockedForUpdate, uid, wrap } = require('../core');
const { q } = require('../db');
const { buildDynamicUpdate, denyUnlessCanAct, getIssueSpaceId, isOrgAdmin, requireOrgAdmin, seedBuiltinIssueFields } = require('../deps');
const { app } = require('../express-app');
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
  const existing = await q('SELECT id, value FROM issue_field_values WHERE issue_id=$1 AND field_id=$2', [issueId, fieldId]);
  const oldValue = existing.rows.length ? (existing.rows[0].value || '') : '';
  const newValue = String(value || '');
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
  // Track in history -- skip when the debounced picker re-saves the same value
  // (the Product Type + Combination picker always PUTs this field alongside
  // its own product_type PUT, so a pure product-type-only change used to still
  // write a no-op "combination changed" row here every time).
  if (oldValue !== newValue) {
    await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value,created_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW())`, [uid(), issueId, req.user.id, 'custom_field_' + fieldId, oldValue, newValue]);
  }
  res.json({ ok: true });
}));

app.delete('/api/custom-fields/:id', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  if (field.is_builtin && ['title', 'type', 'priority'].includes(field.field_key)) {
    return res.status(400).json({ error: 'This is a required built-in field and cannot be removed' });
  }
  await q('DELETE FROM issue_field_values WHERE field_id=$1', [req.params.id]);
  await q('DELETE FROM custom_fields WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

