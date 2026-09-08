const { requireAuth } = require('../auth');
const { isReservedFieldName, reservedNameBlockedForUpdate, uid, wrap } = require('../core');
const { q } = require('../db');
const { buildDynamicUpdate, denyUnlessCanAct, getIssueSpaceId, isOrgAdmin, requireOrgAdmin, seedBuiltinIssueFields, upsertIssueFieldValue } = require('../deps');
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
  const updated = r.rows[0];

  // Combination options just changed — drop any Upgrader assignment for a
  // combination value that no longer exists, so editing/removing a
  // combination here (the textarea editor above) can never leave a stale,
  // invisible assignment behind. New/still-present combinations are
  // untouched, so this never disturbs an existing assignment that is still
  // valid.
  if (body.options !== undefined && isCombinationFieldRow(updated)) {
    const flat = combinationFlatOptions(updated);
    await q(
      flat.length
        ? 'DELETE FROM combination_upgraders WHERE field_id=$1 AND NOT (combination = ANY($2))'
        : 'DELETE FROM combination_upgraders WHERE field_id=$1',
      flat.length ? [updated.id, flat] : [updated.id]
    );
  }

  res.json(updated);
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
  await upsertIssueFieldValue(issueId, fieldId, req.body.value, req.user.id);
  res.json({ ok: true });
}));

// ── Combination "Upgrader" assignment ──────────────────────
// The person(s) who handle a given Source-Destination combination,
// independent of the combination options themselves — see
// combination_upgraders (migration 022) and combination_upgrader_roles
// (migration 024). A combination can have one Upgrader per ROLE (Frontend,
// Backend, or whatever roles this field's admin has configured — the role
// list itself is per-field data, not a hardcoded pair), keyed by the exact
// combination string, not by product type, so a combination that happens to
// appear under more than one product type group shares its assignments.
function isCombinationFieldRow(field) {
  return !!field && (field.field_key === 'combination' || String(field.name || '').toLowerCase().trim() === 'combination');
}
function combinationFlatOptions(field) {
  let raw = field.options;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
  if (raw && raw.v === 2 && Array.isArray(raw.flat)) return raw.flat;
  return Array.isArray(raw) ? raw : [];
}
async function resolveUpgraderRole(fieldId, roleKey) {
  const key = String(roleKey || '').trim().toLowerCase();
  if (!key) return null;
  return (await q('SELECT id, name, key FROM combination_upgrader_roles WHERE field_id=$1 AND key=$2', [fieldId, key])).rows[0] || null;
}
async function resolveUpgraderTarget(spaceId, emailRaw) {
  return (await q(
    `SELECT u.id, u.name, u.email FROM users u
     JOIN spaces sp ON sp.org_id = u.org_id
     WHERE sp.id=$1 AND u.is_active=true AND LOWER(u.email)=LOWER($2)`,
    [spaceId, emailRaw]
  )).rows[0] || null;
}

// GET is member-level (custom_field.read) — seeing who is responsible for a
// combination is useful to the whole team, not just whoever can edit it.
app.get('/api/custom-fields/:id/upgraders', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.read'))) return;
  if (!isCombinationFieldRow(field)) return res.status(400).json({ error: 'This field is not the Combination field' });
  const r = await q(
    `SELECT cu.combination, cu.role, cu.user_id, u.name AS user_name, u.email AS user_email, cu.updated_at
     FROM combination_upgraders cu LEFT JOIN users u ON u.id = cu.user_id
     WHERE cu.field_id=$1 ORDER BY cu.combination, cu.role`,
    [field.id]
  );
  res.json(r.rows);
}));

// ── Upgrader roles (the configurable list, e.g. Frontend/Backend) ─────────
// GET is member-level, same reasoning as the assignments themselves — every
// space member sees which roles exist, only custom_field.manage can add,
// rename, reorder, or remove one.
app.get('/api/custom-fields/:id/upgrader-roles', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.read'))) return;
  if (!isCombinationFieldRow(field)) return res.status(400).json({ error: 'This field is not the Combination field' });
  const r = await q('SELECT id, name, key, position FROM combination_upgrader_roles WHERE field_id=$1 ORDER BY position, name', [field.id]);
  res.json(r.rows);
}));

app.post('/api/custom-fields/:id/upgrader-roles', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  if (!isCombinationFieldRow(field)) return res.status(400).json({ error: 'This field is not the Combination field' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A role name is required' });
  // Slugified so it's a stable, URL/JSON-safe key even if the display name
  // is renamed later (renaming below only ever touches `name`, never `key`
  // — a role's key is its permanent identity once tickets and assignments
  // start referencing it).
  const key = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) return res.status(400).json({ error: 'That name has no usable characters — try a name with letters or numbers' });
  const existing = await resolveUpgraderRole(field.id, key);
  if (existing) return res.status(409).json({ error: 'A role named "' + existing.name + '" already exists for this field' });
  const maxPos = (await q('SELECT COALESCE(MAX(position), -1) AS m FROM combination_upgrader_roles WHERE field_id=$1', [field.id])).rows[0].m;
  const r = await q(
    'INSERT INTO combination_upgrader_roles(id, field_id, name, key, position) VALUES($1,$2,$3,$4,$5) RETURNING id, name, key, position',
    [uid(), field.id, name, key, Number(maxPos) + 1]
  );
  res.status(201).json(r.rows[0]);
}));

// Rename only — a role's key (its permanent identity, referenced by every
// existing combination_upgraders row and every ticket's own stored combo
// selection) never changes after creation.
app.put('/api/custom-fields/:id/upgrader-roles/:roleId', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  const role = (await q('SELECT * FROM combination_upgrader_roles WHERE id=$1 AND field_id=$2', [req.params.roleId, field.id])).rows[0];
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A role name is required' });
  const r = await q('UPDATE combination_upgrader_roles SET name=$1 WHERE id=$2 RETURNING id, name, key, position', [name, role.id]);
  res.json(r.rows[0]);
}));

// Removing a role deletes its Upgrader assignments (nothing left to point
// at), but deliberately leaves any ticket that already recorded this role
// against a chosen combination untouched — the same "never rewrite stored
// values" rule this app already applies to a removed Type or Priority value
// (see .claude/rules/issue-state-machine.md's sibling docs), so an old
// ticket keeps showing the role it was actually filed under.
app.delete('/api/custom-fields/:id/upgrader-roles/:roleId', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  const role = (await q('SELECT * FROM combination_upgrader_roles WHERE id=$1 AND field_id=$2', [req.params.roleId, field.id])).rows[0];
  if (!role) return res.status(404).json({ error: 'Role not found' });
  await q('DELETE FROM combination_upgraders WHERE field_id=$1 AND role=$2', [field.id, role.key]);
  await q('DELETE FROM combination_upgrader_roles WHERE id=$1', [role.id]);
  res.json({ ok: true });
}));

// PUT is site_admin tier (custom_field.manage) — same gate as editing the
// Combination field's options themselves. Body: { combination, role, email }
// — email blank/omitted clears that one (combination, role) assignment. The
// target only has to be an ACTIVE user in the SAME ORGANIZATION as this
// field's space, not a member of this specific space -- an Upgrader is very
// often a specialist who handles a given combination without being formally
// added to every space that has one, and this org's own users routinely
// live in several different spaces already. Anyone outside the organization
// entirely (or a typo matching no real account) still fails clearly.
app.put('/api/custom-fields/:id/upgraders', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  if (!isCombinationFieldRow(field)) return res.status(400).json({ error: 'This field is not the Combination field' });

  const combination = String(req.body.combination || '').trim();
  if (!combination) return res.status(400).json({ error: 'combination is required' });
  // Defense in depth: the client only ever offers combinations from the
  // field's own current options, but never trust that blindly — an
  // assignment against a value that isn't (or is no longer) configured would
  // be silently invisible everywhere the options list drives the UI.
  if (combinationFlatOptions(field).indexOf(combination) === -1) {
    return res.status(400).json({ error: '"' + combination + '" is not one of this field\'s configured combinations' });
  }
  const role = await resolveUpgraderRole(field.id, req.body.role);
  if (!role) return res.status(400).json({ error: '"' + req.body.role + '" is not one of this field\'s configured roles' });

  const emailRaw = req.body.email != null ? String(req.body.email).trim() : '';
  if (!emailRaw) {
    await q('DELETE FROM combination_upgraders WHERE field_id=$1 AND combination=$2 AND role=$3', [field.id, combination, role.key]);
    return res.json({ combination, role: role.key, user_id: null });
  }

  const member = await resolveUpgraderTarget(field.space_id, emailRaw);
  if (!member) {
    return res.status(400).json({ error: '"' + emailRaw + '" is not an active user in this organization' });
  }

  await q(
    `INSERT INTO combination_upgraders(id, field_id, combination, role, user_id, updated_at, updated_by)
     VALUES($1,$2,$3,$4,$5,NOW(),$6)
     ON CONFLICT (field_id, combination, role) DO UPDATE SET user_id=$5, updated_at=NOW(), updated_by=$6`,
    [uid(), field.id, combination, role.key, member.id, req.user.id]
  );
  res.json({ combination, role: role.key, user_id: member.id, user_name: member.name, user_email: member.email });
}));

// Bulk variant of the PUT above — one (role, email) pair applied across many
// combinations in a single request, for "assign this person as Frontend
// Upgrader for all of these at once" instead of repeating the same pick N
// times through the single-row endpoint. Every combination is independently
// validated exactly like the single-row route does; a bad one in the batch
// is reported without silently skipping it or aborting the rest.
app.put('/api/custom-fields/:id/upgraders/bulk', requireAuth, wrap(async (req, res) => {
  const field = (await q('SELECT * FROM custom_fields WHERE id=$1', [req.params.id])).rows[0];
  if (!field) return res.status(404).json({ error: 'Field not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, field.space_id, 'custom_field.manage'))) return;
  if (!isCombinationFieldRow(field)) return res.status(400).json({ error: 'This field is not the Combination field' });

  const combinations = Array.isArray(req.body.combinations) ? [...new Set(req.body.combinations.map(c => String(c || '').trim()).filter(Boolean))] : [];
  if (!combinations.length) return res.status(400).json({ error: 'At least one combination is required' });
  const role = await resolveUpgraderRole(field.id, req.body.role);
  if (!role) return res.status(400).json({ error: '"' + req.body.role + '" is not one of this field\'s configured roles' });
  const flatOptions = combinationFlatOptions(field);
  const unknown = combinations.filter(c => flatOptions.indexOf(c) === -1);
  if (unknown.length) return res.status(400).json({ error: 'Not configured combinations: ' + unknown.join(', ') });

  const emailRaw = req.body.email != null ? String(req.body.email).trim() : '';
  let member = null;
  if (emailRaw) {
    member = await resolveUpgraderTarget(field.space_id, emailRaw);
    if (!member) return res.status(400).json({ error: '"' + emailRaw + '" is not an active user in this organization' });
  }

  for (const combination of combinations) {
    if (!member) {
      await q('DELETE FROM combination_upgraders WHERE field_id=$1 AND combination=$2 AND role=$3', [field.id, combination, role.key]);
    } else {
      await q(
        `INSERT INTO combination_upgraders(id, field_id, combination, role, user_id, updated_at, updated_by)
         VALUES($1,$2,$3,$4,$5,NOW(),$6)
         ON CONFLICT (field_id, combination, role) DO UPDATE SET user_id=$5, updated_at=NOW(), updated_by=$6`,
        [uid(), field.id, combination, role.key, member.id, req.user.id]
      );
    }
  }
  res.json({
    ok: true, role: role.key, updated: combinations.length,
    user_id: member ? member.id : null, user_name: member ? member.name : null, user_email: member ? member.email : null
  });
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

