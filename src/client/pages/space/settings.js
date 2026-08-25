
// ═══════════════════════════════════════════════════════════
// SPACE SETTINGS TAB (with sub-tabs: General, People, Custom Fields)
// ═══════════════════════════════════════════════════════════
var _settingsActiveTab = 'general';

function renderSpaceSettings(subTab) {
  var space = getSpace(S.currentSpace);
  if (!space) return;
  if (!canManageSpace(space.id)) {
    toast('Only admins and space admins can access Settings', 'error');
    navigateToSpace(S.currentSpace, 'summary');
    return;
  }
  if (subTab) _settingsActiveTab = subTab;
  // Update tab bar active state
  qsa('#settingsTabBar .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.stab === _settingsActiveTab);
  });
  // Render active sub-tab content
  switch (_settingsActiveTab) {
    case 'general': renderSettingsGeneral(space); break;
    case 'people': renderSettingsPeople(space); break;
    case 'customfields':
      renderSettingsCustomFields(space);
      break;
    // Space admins reach the bin here (their space only). renderDeletedTickets
    // decides read-only vs actionable from the server's can_restore flag, so a
    // space admin sees the list without Restore / Delete forever buttons.
    case 'deleted':
      renderDeletedTickets($('settingsTabContent'), { spaceId: space.id });
      break;
    case 'reports':
      renderSettingsReports(space);
      break;
    default: renderSettingsGeneral(space);
  }
}

window._switchSettingsTab = function (tab) {
  _settingsActiveTab = tab;
  renderSpaceSettings(tab);
  syncAppUrl();
};

function renderSettingsGeneral(space) {
  var canManage = canManageSpace(space.id);
  var canDelete = canDeleteSpace();
  $('settingsTabContent').innerHTML =
    '<div class="settings-section"><h3>General</h3>' +
    '<p><strong>Name:</strong> ' + esc(space.name) + '</p>' +
    '<p><strong>Key:</strong> ' + esc(space.key) + '</p>' +
    '<p><strong>Description:</strong> ' + esc(space.description || 'No description') + '</p>' +
    '<p><strong>Icon:</strong> ' + esc(space.icon || 'None') + '</p>' +
    '<p><strong>Color:</strong> <span class="space-dot" style="background:' + (space.color || '#0129ac') + ';display:inline-block;vertical-align:middle"></span> ' + esc(space.color || '#0129ac') + '</p>' +
    '<p><strong>Type:</strong> ' + cap(space.space_type || 'scrum') + '</p>' +
    '<p><strong>Visibility:</strong> ' + visLabel(space.visibility) + '</p>' +
    '<div class="settings-actions">' +
    (canManage ? '<button class="btn btn-outline" onclick="window._editSpaceSettings()">Edit Space</button>' : '') +
    (canDelete ? '<button class="btn btn-danger" onclick="window._deleteSpace(\'' + space.id + '\')">Delete Space</button>' : '') +
    '</div></div>';
}

// Defaults mirror what the Spillover report already showed before this
// setting existed, so turning the feature on doesn't change anyone's report
// until they actually touch a toggle.
var SPILLOVER_SETTINGS_DEFAULTS = {
  show_issues_with_points: true,
  show_tasks: true,
  show_bugs: true,
  include_qa_assigned: false,
  include_unassigned: true
};

function getSpilloverSettings(space) {
  var raw = (space && space.spillover_settings) || {};
  var merged = Object.assign({}, SPILLOVER_SETTINGS_DEFAULTS, raw);
  // Carry forward a board's prior "stories with points" choice the first time
  // it's read under the new, type-agnostic key.
  if (raw.show_issues_with_points === undefined && raw.show_stories_with_points !== undefined) {
    merged.show_issues_with_points = raw.show_stories_with_points;
  }
  return merged;
}

function renderSettingsReports(space) {
  var canManage = canManageSpace(space.id);
  var s = getSpilloverSettings(space);

  function toggleRow(key, label, desc) {
    return '<label style="display:flex;align-items:flex-start;gap:8px;cursor:' + (canManage ? 'pointer' : 'default') + ';margin-bottom:14px">' +
      '<input type="checkbox" class="spillover-setting-toggle" data-key="' + escAttr(key) + '"' + (s[key] ? ' checked' : '') + (canManage ? '' : ' disabled') +
      ' onchange="window._updateSpilloverSetting(this.dataset.key, this.checked)" style="width:14px;height:14px;padding:0;flex-shrink:0;accent-color:var(--accent);margin-top:3px">' +
      '<span style="flex:1"><strong>' + esc(label) + '</strong>' +
      (desc ? '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(desc) + '</div>' : '') +
      '</span></label>';
  }

  $('settingsTabContent').innerHTML =
    '<div class="settings-section"><h3>Spillover Report</h3>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Choose which spilled tickets show up in the Spillover report for this board.</p>' +
    toggleRow('show_issues_with_points', 'Spilled Issues (With Points)', 'Any spilled ticket that carries story points — story, task, or bug alike — regardless of type.') +
    toggleRow('show_tasks', 'Display spilled tasks', '') +
    toggleRow('show_bugs', 'Display spilled bugs', '') +
    toggleRow('include_qa_assigned', 'Include tickets assigned to Test Engineers (QA)', 'Off by default — only Developer-assigned tickets count. Turn on to also see tickets assigned to someone in the sprint\'s QA list.') +
    toggleRow('include_unassigned', 'Include unassigned tickets', 'Spilled tickets with no assignee at all.') +
    '</div>';
}

window._updateSpilloverSetting = async function (key, checked) {
  // Read every checkbox's live DOM state rather than the cached space object —
  // toggling two settings back-to-back would otherwise race: the second save
  // could read a stale pre-first-toggle value and overwrite it.
  var next = {};
  document.querySelectorAll('.spillover-setting-toggle').forEach(function (box) {
    next[box.dataset.key] = box.checked;
  });
  try {
    // silent: the catch below renders its own message with the reason
    var updated = await api('/api/spaces/' + S.currentSpace, 'PUT', { spillover_settings: next }, { silent: true });
    var cached = (S.data.spaces || []).find(function (sp) { return sp.id === S.currentSpace; });
    if (cached) cached.spillover_settings = updated.spillover_settings;
    toast('Spillover setting updated', 'success');
  } catch (e) {
    toast('Spillover setting update failed — ' + errorReason(e), 'error');
    var box = document.querySelector('.spillover-setting-toggle[data-key="' + key + '"]');
    if (box) box.checked = !checked; // revert the visible toggle on failure
  }
};

// Settings-tab table search. Rows carry a data-search haystack and are shown or
// hidden in place rather than re-rendered, so role selects and Remove buttons
// keep their bound handlers and the box keeps focus while typing.
function settingsSearchBoxHtml(id, placeholder) {
  return '<input type="text" id="' + escAttr(id) + '" class="input input-sm" placeholder="' + escAttr(placeholder) + '" ' +
    'autocomplete="off" style="width:220px">';
}

function wireSettingsTableSearch(inputId, emptyMessage) {
  var input = $(inputId);
  if (!input) return;
  var table = $('settingsTabContent').querySelector('table');
  if (!table) return;
  var tbody = table.querySelector('tbody');

  // Placeholder row reused for "nothing matched", separate from the table's own
  // "none yet" row so clearing the box restores the original empty state.
  var noHit = document.createElement('tr');
  noHit.className = 'settings-search-empty';
  noHit.hidden = true;
  noHit.innerHTML = '<td colspan="' + (table.querySelectorAll('thead th').length || 1) +
    '" class="text-muted" style="text-align:center;padding:24px"></td>';
  tbody.appendChild(noHit);

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0, total = 0;
    tbody.querySelectorAll('tr[data-search]').forEach(function (row) {
      total++;
      var hit = !q || row.getAttribute('data-search').indexOf(q) >= 0;
      row.hidden = !hit;
      if (hit) shown++;
    });
    if (total && !shown) {
      noHit.querySelector('td').textContent = emptyMessage.replace('%s', input.value.trim());
      noHit.hidden = false;
    } else {
      noHit.hidden = true;
    }
  });
}

function renderSettingsPeople(space) {
  var memberRecs = (S.data.space_members || []).filter(function (m) { return m.space_id == space.id; });
  var orgAdmin = isOrgAdminUser();
  var spaceAdmin = canManageSpace(space.id) && !orgAdmin;
  var assignableRoles = orgAdmin
    ? [{ value: 'member', label: 'Member' }, { value: 'site_admin', label: 'Space Admin' }]
    : [{ value: 'member', label: 'Member' }];

  var rowsHtml = '';
  for (var i = 0; i < memberRecs.length; i++) {
    var rec = memberRecs[i];
    var user = findUser(rec.user_id);
    if (!user) continue;
    var role = normalizeSpaceRole(rec.role || 'member');
    var joined = fmtDate(rec.joined_at || rec.created_at);
    var isTargetSpaceAdmin = role === 'site_admin';

    var roleCell;
    if (orgAdmin) {
      var roleOptions = '';
      for (var r = 0; r < assignableRoles.length; r++) {
        roleOptions += '<option value="' + assignableRoles[r].value + '"' + (assignableRoles[r].value === role ? ' selected' : '') + '>' + assignableRoles[r].label + '</option>';
      }
      roleCell = '<select class="input input-sm people-role-select" data-member-id="' + rec.id + '" data-user-id="' + user.id + '" style="max-width:140px">' + roleOptions + '</select>';
    } else if (spaceAdmin && isTargetSpaceAdmin) {
      roleCell = spaceRoleBadgeHtml(rec.role);
    } else if (spaceAdmin) {
      roleCell = '<select class="input input-sm people-role-select" data-member-id="' + rec.id + '" data-user-id="' + user.id + '" style="max-width:140px"><option value="member" selected>Member</option></select>';
    } else {
      roleCell = spaceRoleBadgeHtml(rec.role);
    }

    rowsHtml += '<tr data-search="' + escAttr(((user.name || '') + ' ' + (user.email || '')).toLowerCase()) + '">' +
      '<td>' + avatarHtml(user, 28) + '</td>' +
      '<td>' + esc(user.name) + '</td>' +
      '<td class="text-muted">' + esc(user.email || '') + '</td>' +
      '<td>' + roleCell + '</td>' +
      '<td class="text-muted text-sm">' + joined + '</td>' +
      '<td>' + (canManageSpace(space.id) ? '<button class="btn btn-outline btn-sm people-remove-btn" data-member-id="' + rec.id + '" data-user-name="' + esc(user.name) + '">Remove</button>' : '') + '</td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Members</h3>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    settingsSearchBoxHtml('peopleSearchInput', 'Search name or email…') +
    (canManageSpace(space.id) ? '<button class="btn btn-primary btn-sm" id="inviteMemberBtnSettings">+ Add User</button>' : '') +
    '</div>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th style="width:40px"></th><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th style="width:80px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">No members yet</td></tr>') + '</tbody></table></div>';

  $('settingsTabContent').innerHTML = html;

  wireSettingsTableSearch('peopleSearchInput', 'No members match "%s"');

  // Invite member button
  var invBtn = $('inviteMemberBtnSettings');
  if (invBtn) {
    invBtn.onclick = function () { openInviteMemberModal(); };
  }

  // Role change handlers
  qsa('.people-role-select').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      var memberId = sel.dataset.memberId;
      var newRole = sel.value;
      try {
        await api('/api/space-members/' + memberId, 'PUT', { role: newRole });
        var roleUser = findUser(sel.dataset.userId);
        toast((roleUser ? roleUser.name : 'Member') + ' set to ' + formatSpaceRoleLabel(newRole));
      } catch (e) { /* error shown by api() */ }
    });
  });

  // Remove member handlers
  qsa('.people-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var memberId = btn.dataset.memberId;
      var userName = btn.dataset.userName;
      var ok = await confirmDialog('Remove ' + userName + ' from this space?');
      if (!ok) return;
      try {
        await api('/api/space-members/' + memberId, 'DELETE');
        await refreshData();
        renderSettingsPeople(getSpace(S.currentSpace));
        renderSidebar();
        toast(userName + ' removed from this space');
      } catch (e) { /* error shown by api() */ }
    });
  });
}

function customFieldShowsIn(field, place) {
  var show = field && field.show_in;
  if (!show || !show.length) return place === 'drawer';
  if (Array.isArray(show)) return show.indexOf(place) >= 0;
  return false;
}

function getSpaceFieldRows(spaceId) {
  if (!spaceId) return [];
  return (S.data.custom_fields || []).filter(function (f) { return String(f.space_id) === String(spaceId); });
}

function findSpaceFieldByKey(spaceId, fieldKey) {
  return getSpaceFieldRows(spaceId).find(function (f) {
    if (f.field_key === fieldKey) return true;
    if (fieldKey === 'combination' && isCombinationField(f)) return true;
    if (fieldKey === 'product_type' && (f.name || '').toLowerCase().trim() === 'product type') return true;
    return false;
  }) || null;
}

function ensureSpaceFieldsLoaded(spaceId) {
  if (!spaceId) return Promise.resolve([]);
  if (getSpaceFieldRows(spaceId).length) return Promise.resolve(getSpaceFieldRows(spaceId));
  return api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId), 'GET', null, { silent: true })
    .then(function (data) {
      if (Array.isArray(data) && data.length) {
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return String(f.space_id) !== String(spaceId); })
          .concat(data);
      }
      return getSpaceFieldRows(spaceId);
    })
    .catch(function (e) {
      // Returned [] silently, so every caller behaved as if the space had no
      // custom fields at all -- required fields stopped being enforced and
      // pickers came up empty with no explanation.
      toast('Could not load custom fields for this space — ' + errorReason(e), 'error');
      return [];
    });
}

function isSpaceBuiltinFieldEnabled(spaceId, fieldKey, place) {
  if (fieldKey === 'title' || fieldKey === 'status') return true;
  var field = findSpaceFieldByKey(spaceId, fieldKey);
  if (!field) return false;
  if (place && !customFieldShowsIn(field, place)) return false;
  return true;
}

function applyBuiltinFieldVisibility(spaceId, rootEl, place) {
  var root = rootEl || document;
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-builtin-field]').forEach(function (el) {
    var key = el.getAttribute('data-builtin-field');
    if (key === 'combination' || key === 'product_type') return;
    var locked = el.getAttribute('data-builtin-locked') === 'true';
    var show = locked || isSpaceBuiltinFieldEnabled(spaceId, key, place);
    el.hidden = !show;
  });
}

// ── Required-field validation (create form) ───────────────
// Maps a built-in field_key to its control in the Create Issue modal so the
// "Required" flag set per space in Settings → Custom Fields can actually be
// enforced, instead of only rendering a red asterisk. Keys deliberately
// absent: `combination` (bespoke picker with its own validation) and
// `fix_description`/`status` (not on the create form at all) — a key with no
// entry here is skipped rather than blocking submit on a control that
// doesn't exist.
var CREATE_BUILTIN_INPUTS = {
  title:        { id: 'issueTitleInput',  label: 'Title' },
  type:         { id: 'issueType',        label: 'Type' },
  priority:     { id: 'issuePriority',    label: 'Priority' },
  assignee:     { id: 'issueAssignee',    label: 'Assignee', focusId: 'issueAssigneeSearch' },
  reporter:     { id: 'issueReporter',    label: 'Reporter', focusId: 'issueReporterSearch' },
  sprint:       { id: 'issueSprint',      label: 'Sprint' },
  story_points: { id: 'issuePoints',      label: 'Story Points' },
  start_date:   { id: 'issueStartDate',   label: 'Start Date' },
  due_date:     { id: 'issueDueDate',     label: 'Due Date' },
  team:         { id: 'issueTeam',        label: 'Team' },
  product_type: { id: 'issueProductType', label: 'Product Type', wrapId: 'issueProductTypeGroup' },
  description:  { id: 'issueDescContent', label: 'Description', rich: true }
};

// A control the user can't see must never block submit — Product Type and any
// built-in switched off for this space are hidden via the `hidden` attribute
// by applyBuiltinFieldVisibility, so walk ancestors looking for that.
function isCreateFieldHidden(el) {
  for (var node = el; node && node !== document.body; node = node.parentElement) {
    if (node.hidden) return true;
  }
  return false;
}

function createFieldIsEmpty(el, opts) {
  if (opts && opts.rich) return htmlFieldIsEmpty(el.innerHTML);
  if (el.type === 'checkbox') return !el.checked;
  if (el.tagName === 'SELECT' && el.multiple) return !el.selectedOptions.length;
  return !String(el.value == null ? '' : el.value).trim();
}

// Every required field on the create form that the user left empty, in the
// order they appear, so the first one can be focused.
function getCreateRequiredErrors(spaceId) {
  var errors = [];
  var rows = getSpaceFieldRows(spaceId);
  var checkedTitle = false;
  // The type currently chosen on the form decides which required rules apply,
  // so Story Points can be mandatory for a story but not for a bug.
  var selectedType = $('issueType') ? $('issueType').value : '';

  rows.forEach(function (field) {
    if (!fieldRequiredForType(field, selectedType)) return;
    if (!customFieldShowsIn(field, 'create')) return;

    var el, opts = null, label = field.name;
    if (field.is_builtin) {
      if (isCombinationField(field)) return;
      var desc = CREATE_BUILTIN_INPUTS[field.field_key];
      if (!desc) return;
      el = $(desc.id);
      if (!el) return;
      var wrap = desc.wrapId ? $(desc.wrapId) : el;
      if (wrap && isCreateFieldHidden(wrap)) return;
      opts = desc;
      label = field.name || desc.label;
      if (field.field_key === 'title') checkedTitle = true;
    } else {
      var container = $('issueCustomFieldsContainer');
      el = container && container.querySelector('[data-cf-id="' + field.id + '"]');
      if (!el || isCreateFieldHidden(el)) return;
    }

    if (createFieldIsEmpty(el, opts)) {
      errors.push({ label: label, el: el, focusEl: (opts && opts.focusId && $(opts.focusId)) || el });
    }
  });

  // Title is required regardless of the stored flag (it's the locked built-in,
  // and NOT NULL in the DB). Covers spaces whose built-in rows predate the
  // registry and so have no Title row to iterate.
  if (!checkedTitle) {
    var titleEl = $('issueTitleInput');
    if (titleEl && createFieldIsEmpty(titleEl)) {
      errors.unshift({ label: 'Title', el: titleEl, focusEl: titleEl });
    }
  }
  return errors;
}

function validateCreateRequiredFields(spaceId) {
  var errors = getCreateRequiredErrors(spaceId);
  if (!errors.length) return true;
  var first = errors[0];
  var names = errors.map(function (e) { return e.label; });
  toast(errors.length === 1
    ? 'Please fill in the required field: ' + names[0]
    : 'Please fill in the required fields: ' + names.join(', '), 'error');
  // Flash the control the user can actually see — for Assignee/Reporter the
  // value lives on a hidden input, so highlighting that would show nothing.
  errors.forEach(function (e) {
    var target = e.focusEl || e.el;
    target.style.border = '2px solid #e53e3e';
    setTimeout(function () { target.style.border = ''; }, 3000);
  });
  if (first.focusEl && first.focusEl.focus) first.focusEl.focus();
  return false;
}

// Show a red asterisk on built-in create-form labels whose field is required
// for this space, so required built-ins are as visible as required customs.
function markCreateRequiredLabels(spaceId) {
  var modal = $('modal-issue');
  if (!modal) return;
  modal.querySelectorAll('.cf-req-star').forEach(function (s) { s.remove(); });
  var selectedType = $('issueType') ? $('issueType').value : '';
  function addStar(label) {
    if (!label || label.querySelector('.cf-req-star')) return;
    var star = document.createElement('span');
    star.className = 'cf-req-star';
    star.style.color = 'var(--red)';
    star.textContent = ' *';
    label.appendChild(star);
  }
  getSpaceFieldRows(spaceId).forEach(function (field) {
    if (!fieldRequiredForType(field, selectedType)) return;
    if (!customFieldShowsIn(field, 'create')) return;
    if (field.is_builtin) {
      var desc = CREATE_BUILTIN_INPUTS[field.field_key];
      if (!desc) return;
      var wrap = desc.wrapId ? $(desc.wrapId) : ($(desc.id) && $(desc.id).closest('.form-group'));
      addStar(wrap && wrap.querySelector('.form-label'));
      return;
    }
    // Custom fields: their star is rendered inline at build time, but a type
    // change clears every .cf-req-star, so it has to be re-added here too.
    var input = modal.querySelector('[data-cf-id="' + field.id + '"]');
    var group = input && input.closest('.form-group');
    addStar(group && group.querySelector('.form-label'));
  });
}

function formatFieldShowIn(field) {
  var show = field && field.show_in;
  if (!show || !show.length) return 'Drawer';
  var labels = [];
  if (show.indexOf('create') >= 0) labels.push('Create');
  if (show.indexOf('drawer') >= 0) labels.push('Drawer');
  return labels.join(', ') || 'Drawer';
}

function isLockedBuiltinField(field) {
  // Options are now freely editable on type/priority (migration 016), but the
  // field itself must always exist — deleting it would leave the space with no
  // way to set a value that Create Issue always shows as required.
  return !!(field && field.is_builtin && ['title', 'type', 'priority'].indexOf(field.field_key) >= 0);
}

function isCombinationField(field) {
  if (!field) return false;
  if (field.field_key === 'combination') return true;
  return (field.name || '').toLowerCase().trim() === 'combination';
}

function isBuiltinProductTypeField(field) {
  return !!(field && (field.field_key === 'product_type' || ((field.name || '').toLowerCase().trim() === 'product type' && field.is_builtin)));
}

var BUILTIN_SELECT_DEFAULTS = {
  type: ['epic', 'story', 'task', 'bug', 'subtask'],
  priority: ['highest', 'high', 'medium', 'low', 'lowest'],
  team: ['Dev', 'QA', 'Infra', 'Manage', 'Product_Team'],
  product_type: ['Message', 'Email', 'Content', 'Manage', 'Infra']
};

function getBuiltinDefaultOptions(field) {
  if (!field || !field.field_key) return [];
  return (BUILTIN_SELECT_DEFAULTS[field.field_key] || []).slice();
}

function formatFieldOptionsForEditor(field) {
  if (!field) return '';
  var raw = field.options;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) {}
  }
  if (raw && raw.v === 2 && raw.groups) return '';
  if (Array.isArray(raw) && raw.length) {
    return raw.map(function (o) {
      if (o && typeof o === 'object') return String(o.value != null ? o.value : (o.label != null ? o.label : o));
      return String(o);
    }).join(', ');
  }
  return getBuiltinDefaultOptions(field).join(', ');
}

function readShowInFromField(field) {
  var show = field && field.show_in;
  if (!show || !show.length) return { create: false, drawer: true };
  return { create: show.indexOf('create') >= 0, drawer: show.indexOf('drawer') >= 0 };
}

function writeShowInToForm(field) {
  var places = readShowInFromField(field);
  if ($('customFieldShowInCreate')) $('customFieldShowInCreate').checked = places.create;
  if ($('customFieldShowInDrawer')) $('customFieldShowInDrawer').checked = places.drawer;
}

function readShowInFromForm() {
  var show = [];
  if ($('customFieldShowInCreate') && $('customFieldShowInCreate').checked) show.push('create');
  if ($('customFieldShowInDrawer') && $('customFieldShowInDrawer').checked) show.push('drawer');
  return show.length ? show : ['drawer'];
}

// ── "Required, but only for these issue types" ────────────
// Story Points is the motivating case: mandatory on a story or task, meaningless
// on a bug. `required_types` narrows is_required to the listed types.
// An EMPTY or missing list means "every type", so every field that was already
// required before this feature keeps behaving exactly the same.
function normalizeTypeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (t) { return String(t).toLowerCase().trim(); }).filter(Boolean);
}

// The single rule every caller uses. `type` is the issue type being created/edited.
function fieldRequiredForType(field, type) {
  if (!field || !field.is_required) return false;
  var types = normalizeTypeList(field.required_types);
  if (!types.length) return true;                 // unset = required for all types
  return types.indexOf(String(type || '').toLowerCase().trim()) >= 0;
}

// Type is admin-configurable per space (migration 016) — the checkbox list
// must reflect the SPACE's own current Type options, not the fixed 5, or a
// newly-added type could never be selected here and a removed one would show
// as a stale, unremovable checkbox.
function renderRequiredTypeChoices(selected, spaceId) {
  var box = $('customFieldRequiredTypes');
  if (!box) return;
  var choices = getIssueTypeOptionsForSpace(spaceId || S.currentSpace);
  var sel = normalizeTypeList(selected);
  var all = sel.length === 0;                     // unset shows as "all ticked"
  box.innerHTML = choices.map(function (c) {
    var on = all || sel.indexOf(c.v) >= 0;
    return '<label><input type="checkbox" class="cf-req-type" value="' + c.v + '"' +
      (on ? ' checked' : '') + '> ' + c.l + '</label>';
  }).join('');
}

function readRequiredTypesFromForm() {
  var box = $('customFieldRequiredTypes');
  if (!box) return [];
  return Array.prototype.slice.call(box.querySelectorAll('.cf-req-type'))
    .filter(function (c) { return c.checked; })
    .map(function (c) { return c.value; });
}

// The type checkboxes are meaningless unless Required is on.
function syncRequiredTypesVisibility() {
  var group = $('customFieldRequiredTypesGroup');
  var req = $('customFieldRequired');
  if (group) group.hidden = !(req && req.checked);
}

function formatRequiredForTypes(field) {
  if (!field || !field.is_required) return 'No';
  var choices = getIssueTypeOptionsForSpace(field.space_id);
  var types = normalizeTypeList(field.required_types);
  if (!types.length || types.length === choices.length) return 'Yes — all types';
  var labels = choices
    .filter(function (c) { return types.indexOf(c.v) >= 0; })
    .map(function (c) { return c.l; });
  return 'Yes — ' + (labels.length ? labels.join(', ') : 'no types');
}

function renderSettingsCustomFields(space) {
  $('settingsTabContent').innerHTML =
    '<div class="text-muted" style="padding:24px;text-align:center">Loading custom fields…</div>';
  api('/api/custom-fields?space_id=' + encodeURIComponent(space.id), 'GET', null, { silent: true })
    .then(function (fetched) {
      if (Array.isArray(fetched)) {
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return f.space_id != space.id; })
          .concat(fetched);
      }
      paintSettingsCustomFields(space);
    })
    .catch(function (e) {
      // Painted from whatever happened to be cached (often nothing), so a
      // failed load was indistinguishable from a space with no fields.
      toast('Could not load custom fields — ' + errorReason(e), 'error');
      $('settingsTabContent').innerHTML =
        '<div class="text-muted" style="padding:24px;text-align:center">' +
        'Custom fields could not be loaded. Refresh to try again.</div>';
    });
}

function paintSettingsCustomFields(space) {
  var fields = getSpaceFieldRows(space.id).slice().sort(function (a, b) {
    if (!!a.is_builtin !== !!b.is_builtin) return a.is_builtin ? -1 : 1;
    return (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name));
  });

  var rowsHtml = '';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var optionsDisplay = '\u2014';
    if (isCombinationField(f)) {
      var pg = parseCombinationFieldOptions(f);
      var ptOpts = getProductTypeOptionsForSpace(space.id);
      optionsDisplay = ptOpts.length
        ? ptOpts.map(function (o) { return o.l + ': ' + (pg.groups[o.v] || []).length; }).join(', ')
        : 'No Product Type options configured';
    } else if (f.is_builtin && (f.field_key === 'product_type' || f.field_key === 'team' || f.field_key === 'type' || f.field_key === 'priority')) {
      var optVals = normalizeCFOptions(f.options);
      optionsDisplay = optVals.length ? optVals.join(', ') : formatFieldOptionsForEditor(f);
    } else if (f.is_builtin) {
      optionsDisplay = 'Built-in issue column';
    } else if (f.options) {
      optionsDisplay = Array.isArray(f.options) ? f.options.join(', ') : String(f.options);
    }
    var sourceBadge = f.is_builtin
      ? '<span class="badge" style="background:var(--primary-light,#ede9fe);color:var(--primary,#5b21b6)">Built-in</span>'
      : '<span class="badge badge-muted">Custom</span>';
    var deleteBtn = isLockedBuiltinField(f)
      ? '<span class="text-muted text-sm">Required</span>'
      : '<button class="btn btn-outline btn-sm text-danger cf-delete-btn" data-field-id="' + f.id + '" data-field-name="' + esc(f.name) + '">Remove</button>';
    // "Apply to all boards" posts to /api/custom-fields/:id/apply-to-all, which is
    // org-admin-only. A space admin could see and click it and only get a 403, so
    // it is hidden for anyone who is not an org admin.
    var applyBtn = (f.is_builtin || !isOrgAdminUser())
      ? ''
      : '<button class="btn btn-outline btn-sm cf-apply-all-btn" data-field-id="' + f.id + '" data-field-name="' + esc(f.name) + '" title="Add this field to every other board that doesn\'t already have one with this name">Apply to all boards</button> ';
    // Everything shown in the row is searchable, plus field_key and the raw
    // option values \u2014 so "slack", "multi_select", "built-in", "required" or an
    // option that got truncated in the Options column all still match.
    var haystack = [
      f.name,
      f.field_key,
      f.is_builtin ? 'built-in builtin' : 'custom',
      f.field_type || f.type,
      formatRequiredForTypes(f),
      formatFieldShowIn(f),
      optionsDisplay,
      normalizeCFOptions(f.options).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();

    rowsHtml += '<tr data-search="' + escAttr(haystack) + '">' +
      '<td>' + esc(f.name) + '</td>' +
      '<td>' + sourceBadge + '</td>' +
      '<td><span class="badge badge-muted">' + esc(f.field_type || f.type) + '</span></td>' +
      '<td class="text-sm">' + esc(formatRequiredForTypes(f)) + '</td>' +
      '<td class="text-muted text-sm">' + esc(formatFieldShowIn(f)) + '</td>' +
      '<td class="text-muted text-sm">' + esc(optionsDisplay) + '</td>' +
      '<td>' +
        '<button class="btn btn-outline btn-sm cf-edit-btn" data-field-id="' + f.id + '">Edit</button> ' +
        applyBtn +
        deleteBtn +
      '</td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Issue Fields</h3>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    settingsSearchBoxHtml('cfSearchInput', 'Search name, type, options…') +
    '<button class="btn btn-primary btn-sm" id="addCustomFieldBtnSettings">+ Add Field</button>' +
    '</div>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th>Name</th><th>Source</th><th>Type</th><th>Required</th><th>Show in</th><th>Options</th><th style="width:300px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px">No fields yet — refresh the page</td></tr>') + '</tbody></table></div>' +
    '<p class="text-muted text-sm" style="margin-top:12px">Built-in fields (Title, Team, Sprint, etc.) are added automatically for each space. Remove a field to hide it on create/drawer forms. Use <strong>+ Add Field</strong> for extra custom fields (Environment, Severity, etc.).</p>';

  $('settingsTabContent').innerHTML = html;

  wireSettingsTableSearch('cfSearchInput', 'No fields match "%s"');

  // Add field button
  $('addCustomFieldBtnSettings').onclick = function () { openCustomFieldModal(); };

  // Edit buttons
  qsa('.cf-edit-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fieldId = btn.dataset.fieldId;
      var field = fields.find(function (f) { return f.id == fieldId; });
      if (field) openCustomFieldModal(field);
    });
  });

  // Delete buttons
  qsa('.cf-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var fieldId = btn.dataset.fieldId;
      var fieldName = btn.dataset.fieldName;
      var ok = await confirmDialog('Remove "' + fieldName + '" from this space? It will be hidden on create and issue forms.');
      if (!ok) return;
      try {
        await api('/api/custom-fields/' + fieldId, 'DELETE');
        await refreshData();
        renderSettingsCustomFields(getSpace(S.currentSpace));
        toast('"' + fieldName + '" deleted');
      } catch (e) { /* error shown by api() */ }
    });
  });

  // Apply-to-all-boards buttons
  qsa('.cf-apply-all-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var fieldId = btn.dataset.fieldId;
      var fieldName = btn.dataset.fieldName;
      var ok = await confirmDialog('Add "' + fieldName + '" to every other board that doesn\'t already have a field with this name?');
      if (!ok) return;
      btn.disabled = true;
      var origText = btn.textContent;
      btn.textContent = 'Applying…';
      try {
        var result = await api('/api/custom-fields/' + fieldId + '/apply-to-all', 'POST');
        await refreshData();
        await refreshAllCustomFields();
        if (result.added > 0) {
          toast('Added "' + fieldName + '" to: ' + result.addedTo.join(', '));
        } else if (result.totalSpaces === 0) {
          toast('No other boards exist to add "' + fieldName + '" to', 'warning');
        } else {
          toast('Every other board already has a field named "' + fieldName + '" (' + result.skipped.join(', ') + ')', 'warning');
        }
      } catch (e) {
        /* error shown by api() */
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });
}

window._editSpaceSettings = function () {
  var space = getSpace(S.currentSpace);
  if (space) openSpaceModal(space);
};

window._deleteSpace = async function (spaceId) {
  var space = getSpace(spaceId);
  var spaceName = space ? space.name : 'this space';
  if (!canDeleteSpace()) {
    toast('Only an org admin can delete a space.', 'error');
    return;
  }
  var issueCount = (S.data.issues || []).filter(function (i) { return i.space_id === spaceId; }).length;
  // DELETE /api/spaces/:id archives the space — nothing is destroyed. The old copy
  // claimed "all issues, sprints, and data will be permanently lost", which was
  // simply untrue and made a reversible action look terrifying.
  var ok = await typedConfirmDialog({
    title: 'Delete space "' + spaceName + '"?',
    intro: 'The space and its ' + issueCount + ' ticket' + (issueCount === 1 ? '' : 's') +
      ' are removed from the sidebar and from everyone\'s boards, searches and reports.',
    note: 'Nothing is destroyed: the space is archived and appears in Deleted Items, where an org admin can restore it. ' +
      'Archived spaces are never auto-deleted.',
    phrase: spaceName,
    phraseHint: 'To confirm, type the space name',
    confirmLabel: 'Delete space'
  });
  if (!ok) return;
  try {
    await api('/api/spaces/' + spaceId, 'DELETE', null, { silent: true });
    await refreshData();
    if (S.currentSpace === spaceId) S.currentSpace = null;
    navigateTo('home');
    renderSidebar();
    popupAlert('Space deleted', '"' + spaceName + '" is in Deleted Items. An org admin can restore it from Admin Settings.', 'success');
  } catch (e) {
    popupAlert('Delete failed', e.message || 'Could not delete the space. Please try again.', 'error');
  }
};
