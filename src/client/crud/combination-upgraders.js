
// ═══════════════════════════════════════════════════════════
// COMBINATION UPGRADERS — admin / space admin only
// ═══════════════════════════════════════════════════════════
// Reachable only from the "Upgraders" button next to the Combination custom
// field in Space Settings → Custom Fields (paintSettingsCustomFields in
// settings.js). That button's own visibility is not gated further — every
// space member can already see the Custom Fields settings page — but the
// real boundary is server-side: GET is member-level (seeing who is
// responsible for a combination is useful to the team), while every write
// (assigning an Upgrader, adding/renaming/removing a role) is
// 'custom_field.manage' (site_admin tier), the same gate as editing the
// Combination field's own options. A plain member can open this modal and
// see assignments, but a save attempt 403s.
//
// A combination can have ONE Upgrader PER ROLE — Frontend/Backend today, but
// the role LIST is admin-configurable per field (combination_upgrader_roles,
// migration 024), not a hardcoded pair, so adding e.g. a QA role later is a
// UI action here, not a code change. Each Upgrader is looked up and saved by
// EMAIL, same as before: the server accepts any ACTIVE user in the same
// organization as this space, not only this space's own members.

var _cuField = null;
var _cuRoles = [];           // [{id, name, key, position}], ordered
var _cuUpgraders = {};       // combination -> { [roleKey]: {user_id, user_name, user_email} }
var _cuSelectedCombos = {};  // combination -> true, for the bulk-assign checkboxes

function openCombinationUpgradersModal(field) {
  _cuField = field;
  _cuRoles = [];
  _cuUpgraders = {};
  _cuSelectedCombos = {};
  var space = getSpace(field.space_id);
  var nameEl = $('cuSpaceName');
  if (nameEl) nameEl.textContent = space ? space.name : 'this space';
  if ($('cuFilterInput')) $('cuFilterInput').value = '';
  $('cuRolesBar').innerHTML = '';
  renderCuBulkBar();
  $('cuGroupsContainer').innerHTML = '<p class="text-muted" style="padding:16px;text-align:center">Loading…</p>';
  openModal('modal-combination-upgraders');

  renderCombinationUpgradersMembersList(field.space_id);

  Promise.all([
    api('/api/custom-fields/' + field.id + '/upgrader-roles', 'GET', null, { silent: true }),
    api('/api/custom-fields/' + field.id + '/upgraders', 'GET', null, { silent: true })
  ]).then(function (results) {
    _cuRoles = results[0] || [];
    (results[1] || []).forEach(function (r) {
      _cuUpgraders[r.combination] = _cuUpgraders[r.combination] || {};
      _cuUpgraders[r.combination][r.role] = r;
    });
    renderCuRolesBar();
    renderCombinationUpgradersList('');
  }).catch(function (e) {
    $('cuGroupsContainer').innerHTML = '<p style="padding:16px;text-align:center;color:var(--red,#dc2626)">Could not load upgraders — ' + esc(errorReason(e)) + '</p>';
  });
}
window.openCombinationUpgradersModal = openCombinationUpgradersModal;

// The datalist is autocomplete convenience only — the server accepts any
// active user in the organization by email regardless of what's suggested
// here — but this space's own members are the common case and always
// resolve locally with no extra request. An org admin additionally gets
// every OTHER org user merged in too, since GET /api/users (org-admin only)
// is the one place that full list is available; a plain space site_admin
// (not an org admin) still has to type a name from another space by hand,
// same as before, since there is no endpoint that would let them list users
// outside their own spaces.
function renderCombinationUpgradersMembersList(spaceId) {
  function paint(users) {
    var byEmail = {};
    users.forEach(function (m) { if (m.email) byEmail[m.email.toLowerCase()] = m; });
    var sorted = Object.keys(byEmail).map(function (k) { return byEmail[k]; }).sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    $('cuMembersList').innerHTML = sorted.map(function (m) {
      return '<option value="' + escAttr(m.email) + '" label="' + escAttr(m.name || m.email) + '">';
    }).join('');
  }

  var members = getSpaceMembers(spaceId);
  paint(members);
  if (typeof isOrgAdminUser === 'function' && isOrgAdminUser()) {
    api('/api/users', 'GET', null, { silent: true }).then(function (allUsers) {
      paint(members.concat((allUsers || []).filter(function (u) { return u.is_active !== false; })));
    }).catch(function () { /* keep the space-members-only list already painted */ });
  }
}

function closeCombinationUpgradersModal() {
  closeModal('modal-combination-upgraders');
  _cuField = null;
  _cuRoles = [];
  _cuUpgraders = {};
  _cuSelectedCombos = {};
}
window.closeCombinationUpgradersModal = closeCombinationUpgradersModal;

// ── Role management (add / rename / remove) ──────────────────────────────
function renderCuRolesBar() {
  var bar = $('cuRolesBar');
  if (!bar) return;
  bar.innerHTML = _cuRoles.map(function (role) {
    return '<span class="cu-role-chip" data-role-id="' + esc(role.id) + '">' + esc(role.name) +
      '<button type="button" class="cu-role-chip-remove" data-role-id="' + esc(role.id) + '" data-role-name="' + escAttr(role.name) + '" title="Remove this role">&times;</button>' +
      '</span>';
  }).join('') +
    '<span class="cu-role-add">' +
      '<input type="text" id="cuNewRoleName" placeholder="+ Add role" maxlength="40">' +
      '<button type="button" class="btn btn-outline btn-sm" id="cuAddRoleBtn">Add</button>' +
    '</span>';

  qsa('.cu-role-chip-remove', bar).forEach(function (btn) {
    btn.addEventListener('click', function () { removeCombinationUpgraderRole(btn.dataset.roleId, btn.dataset.roleName); });
  });
  var addBtn = $('cuAddRoleBtn');
  var addInput = $('cuNewRoleName');
  if (addBtn) addBtn.addEventListener('click', addCombinationUpgraderRole);
  if (addInput) addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCombinationUpgraderRole(); } });
}

async function addCombinationUpgraderRole() {
  var input = $('cuNewRoleName');
  var name = input ? input.value.trim() : '';
  if (!name) return;
  var addBtn = $('cuAddRoleBtn');
  if (addBtn) addBtn.disabled = true;
  try {
    var role = await api('/api/custom-fields/' + _cuField.id + '/upgrader-roles', 'POST', { name: name });
    _cuRoles.push(role);
    if (input) input.value = '';
    renderCuRolesBar();
    renderCuBulkBar();
    renderCombinationUpgradersList($('cuFilterInput') ? $('cuFilterInput').value : '');
  } catch (e) {
    toast('Could not add role — ' + errorReason(e), 'error');
  } finally {
    if (addBtn) addBtn.disabled = false;
  }
}

async function removeCombinationUpgraderRole(roleId, roleName) {
  var ok = await confirmDialog(
    'Remove the "' + roleName + '" role? Any Upgrader assigned under it will be cleared. Tickets that already recorded this role keep showing it.',
    { noLabel: 'Cancel', yesLabel: 'Remove', forceChoice: true }
  );
  if (!ok) return;
  try {
    await api('/api/custom-fields/' + _cuField.id + '/upgrader-roles/' + roleId, 'DELETE');
    var removed = _cuRoles.find(function (r) { return r.id === roleId; });
    _cuRoles = _cuRoles.filter(function (r) { return r.id !== roleId; });
    if (removed) {
      Object.keys(_cuUpgraders).forEach(function (combo) { delete _cuUpgraders[combo][removed.key]; });
    }
    renderCuRolesBar();
    renderCuBulkBar();
    renderCombinationUpgradersList($('cuFilterInput') ? $('cuFilterInput').value : '');
  } catch (e) {
    toast('Could not remove role — ' + errorReason(e), 'error');
  }
}

// ── Bulk assign ───────────────────────────────────────────────────────────
function renderCuBulkBar() {
  var bar = $('cuBulkBar');
  if (!bar) return;
  var n = Object.keys(_cuSelectedCombos).length;
  if (!n || !_cuRoles.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  var prevRole = bar.dataset.role || (_cuRoles[0] && _cuRoles[0].key) || '';
  bar.innerHTML =
    '<span class="cu-bulk-bar-count">' + n + ' combination' + (n === 1 ? '' : 's') + ' selected</span>' +
    '<select id="cuBulkRole" class="input">' +
      _cuRoles.map(function (r) { return '<option value="' + esc(r.key) + '"' + (r.key === prevRole ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') +
    '</select>' +
    '<input type="text" id="cuBulkEmail" class="input" list="cuMembersList" placeholder="Upgrader email — blank clears it">' +
    '<button type="button" class="btn btn-primary btn-sm" id="cuBulkApplyBtn">Apply</button>' +
    '<button type="button" class="btn btn-outline btn-sm" id="cuBulkClearBtn">Clear selection</button>';
  $('cuBulkRole').addEventListener('change', function () { bar.dataset.role = this.value; });
  $('cuBulkApplyBtn').addEventListener('click', applyCuBulkAssign);
  $('cuBulkClearBtn').addEventListener('click', function () {
    _cuSelectedCombos = {};
    renderCuBulkBar();
    renderCombinationUpgradersList($('cuFilterInput') ? $('cuFilterInput').value : '');
  });
}

async function applyCuBulkAssign() {
  var role = $('cuBulkRole').value;
  var email = $('cuBulkEmail').value.trim();
  var combos = Object.keys(_cuSelectedCombos);
  if (!combos.length) return;
  var applyBtn = $('cuBulkApplyBtn');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying…';
  try {
    var result = await api('/api/custom-fields/' + _cuField.id + '/upgraders/bulk', 'PUT', { combinations: combos, role: role, email: email });
    combos.forEach(function (combo) {
      _cuUpgraders[combo] = _cuUpgraders[combo] || {};
      if (result.user_id) {
        _cuUpgraders[combo][role] = { combination: combo, role: role, user_id: result.user_id, user_name: result.user_name, user_email: result.user_email };
      } else {
        delete _cuUpgraders[combo][role];
      }
    });
    toast('Updated ' + combos.length + ' combination' + (combos.length === 1 ? '' : 's'));
    _cuSelectedCombos = {};
    renderCuBulkBar();
    renderCombinationUpgradersList($('cuFilterInput') ? $('cuFilterInput').value : '');
  } catch (e) {
    toast('Bulk assign failed — ' + errorReason(e), 'error');
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Apply';
  }
}

// ── The combination list itself ──────────────────────────────────────────
// One section per Product Type this space has configured, same grouping as
// the Edit Combination editor itself — a combination appearing in more than
// one group (the data model permits it) shares a single underlying set of
// role assignments either way, since it is keyed by the combination string
// alone.
function renderCombinationUpgradersList(filter) {
  var container = $('cuGroupsContainer');
  if (!container || !_cuField) return;
  var parsed = parseCombinationFieldOptions(_cuField);
  var ptOptions = getProductTypeOptionsForSpace(_cuField.space_id);
  var q = (filter || '').trim().toLowerCase();

  if (!_cuRoles.length) {
    container.innerHTML = '<p class="text-muted" style="padding:16px;text-align:center">Add at least one Upgrader role above (e.g. Frontend, Backend) before assigning combinations to anyone.</p>';
    return;
  }

  var html = '';
  var shownAny = false;
  ptOptions.forEach(function (pt) {
    var combos = (parsed.groups[pt.v] || []).filter(function (c) {
      return !q || c.toLowerCase().indexOf(q) !== -1;
    });
    if (!combos.length) return;
    shownAny = true;
    html += '<div class="cu-group"><h4 class="cu-group-title">' + esc(pt.l) + '</h4>';
    combos.forEach(function (combo) {
      var assigned = _cuUpgraders[combo] || {};
      html += '<div class="cu-row" data-combo="' + escAttr(combo) + '">' +
        '<input type="checkbox" class="cu-row-check" data-combo="' + escAttr(combo) + '"' + (_cuSelectedCombos[combo] ? ' checked' : '') + ' title="Select for bulk assign">' +
        '<span class="cu-combo-label">' + esc(combo) + '</span>' +
        _cuRoles.map(function (role) {
          var current = assigned[role.key];
          var email = current ? (current.user_email || '') : '';
          return '<div class="cu-role-field">' +
            '<span class="cu-role-label">' + esc(role.name) + '</span>' +
            '<div class="cu-role-input-row">' +
              '<input type="text" class="input cu-input" list="cuMembersList" placeholder="— None —" ' +
                'value="' + escAttr(email) + '" data-combination="' + escAttr(combo) + '" data-role="' + escAttr(role.key) + '" data-last-value="' + escAttr(email) + '">' +
              '<span class="cu-status"></span>' +
            '</div></div>';
        }).join('') +
        '</div>' +
        // A rejection message (an unknown combination, a non-member/non-cloudfuze
        // email, or a 403) can run much longer than a single role field's width, so
        // it gets its own full-width line below the row instead of being squeezed
        // into one role's narrow column. Hidden until there is actually something
        // to show.
        '<div class="cu-row-error" hidden></div>';
    });
    html += '</div>';
  });

  container.innerHTML = shownAny ? html : '<p class="text-muted" style="padding:16px;text-align:center">' +
    (q ? 'No combinations match "' + esc(filter) + '"' : 'No combinations configured yet — add some in Edit Combination first.') + '</p>';

  qsa('.cu-input', container).forEach(bindCombinationUpgraderInput);
  qsa('.cu-row-check', container).forEach(function (cb) {
    cb.addEventListener('change', function () {
      if (cb.checked) _cuSelectedCombos[cb.dataset.combo] = true;
      else delete _cuSelectedCombos[cb.dataset.combo];
      renderCuBulkBar();
    });
  });
}

function bindCombinationUpgraderInput(input) {
  input.addEventListener('blur', function () { saveCombinationUpgraderInput(input); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
  // A native <datalist> has no dedicated "option picked" event — the current
  // value exactly matching one of the datalist's own option values is the
  // standard way to tell a pick apart from ordinary typing, so choosing a
  // suggestion saves immediately rather than waiting for the field to lose
  // focus.
  input.addEventListener('input', function () {
    if (isKnownCombinationUpgraderEmail(input.value.trim())) saveCombinationUpgraderInput(input);
  });
}

function isKnownCombinationUpgraderEmail(value) {
  if (!value) return false;
  var opts = document.querySelectorAll('#cuMembersList option');
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].value === value) return true;
  }
  return false;
}

async function saveCombinationUpgraderInput(input) {
  var statusEl = input.parentElement ? input.parentElement.querySelector('.cu-status') : null;
  var row = input.closest('.cu-row');
  var errorEl = row ? row.nextElementSibling : null; // .cu-row-error, a sibling of .cu-row ITSELF
  var combo = input.dataset.combination;
  var role = input.dataset.role;
  var newVal = input.value.trim();
  var lastVal = input.dataset.lastValue || '';
  if (newVal === lastVal) return;

  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--text3)'; }
  input.disabled = true;
  try {
    var result = await api('/api/custom-fields/' + _cuField.id + '/upgraders', 'PUT', { combination: combo, role: role, email: newVal }, { silent: true });
    _cuUpgraders[combo] = _cuUpgraders[combo] || {};
    if (result.user_id) {
      _cuUpgraders[combo][role] = result;
      input.value = result.user_email || newVal;
    } else {
      delete _cuUpgraders[combo][role];
      input.value = '';
    }
    input.dataset.lastValue = input.value;
    if (statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.style.color = 'var(--green,#10b981)';
      setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 1500);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = '';
    if (errorEl) { errorEl.textContent = errorReason(err); errorEl.hidden = false; }
    input.value = lastVal; // revert — the server rejected it
  } finally {
    input.disabled = false;
  }
}

if ($('cuFilterInput')) {
  $('cuFilterInput').addEventListener('input', function () { renderCombinationUpgradersList(this.value); });
}
