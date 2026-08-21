
// ═══════════════════════════════════════════════════════════
// SPACE CONTEXT MENU (3-dot on sidebar items)
// ═══════════════════════════════════════════════════════════
function showSpaceContextMenu(anchorBtn, spaceId) {
  // Remove any existing context menu
  var existing = qs('.space-context-menu');
  if (existing) existing.remove();

  var canManage = canManageSpace(spaceId);
  var isOrgAdmin = isOrgAdminUser();
  var menu = document.createElement('div');
  menu.className = 'space-context-menu';
  menu.innerHTML =
    (canManage ? '<div class="space-context-menu-item" data-action="people"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Manage people</div>' : '') +
    (canManage ? '<div class="space-context-menu-item" data-action="settings"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Space settings</div>' : '') +
    (isOrgAdmin ? '<div class="space-context-menu-item danger" data-action="delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete space</div>' : '');

  // Position relative to the button
  var rect = anchorBtn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = rect.right + 4 + 'px';
  menu.style.top = rect.top + 'px';
  document.body.appendChild(menu);

  // Adjust if menu goes off screen
  var menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth) {
    menu.style.left = (rect.left - menuRect.width - 4) + 'px';
  }
  if (menuRect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
  }

  // Handle menu item clicks
  menu.addEventListener('click', async function (e) {
    var item = e.target.closest('.space-context-menu-item');
    if (!item) return;
    var action = item.dataset.action;
    menu.remove();

    switch (action) {
      case 'people':
        _settingsActiveTab = 'people';
        navigateToSpace(spaceId, 'space-settings');
        break;
      case 'settings':
        _settingsActiveTab = 'general';
        navigateToSpace(spaceId, 'space-settings');
        break;
      case 'delete':
        window._deleteSpace(spaceId);
        break;
    }
  });

  // Close on outside click
  function closeMenu(e) {
    if (!menu.contains(e.target) && e.target !== anchorBtn) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  }
  setTimeout(function () {
    document.addEventListener('click', closeMenu);
  }, 0);
}

// (People management is now inside renderSettingsPeople, within Space Settings)

function openInviteMemberModal() {
  var space = getSpace(S.currentSpace);
  if (!space) return;

  // Get users not already members
  var memberUserIds = (S.data.space_members || [])
    .filter(function (m) { return m.space_id == space.id; })
    .map(function (m) { return m.user_id; });
  var availableUsers = (S.data.users || []).filter(function (u) {
    return u.is_active !== false && memberUserIds.indexOf(u.id) === -1;
  });

  var sel = $('inviteMemberSelect');
  var optionsHtml = '<option value="">— Select a user —</option>';
  for (var i = 0; i < availableUsers.length; i++) {
    var u = availableUsers[i];
    optionsHtml += '<option value="' + u.id + '">' + esc(u.name) + '  ·  ' + esc(u.email || '') + '</option>';
  }
  sel.innerHTML = optionsHtml;

  var roleWrap = $('inviteMemberRole') && $('inviteMemberRole').closest('.form-group');
  var roleSelect = $('inviteMemberRole');
  if (roleSelect) {
    if (isOrgAdminUser()) {
      roleSelect.innerHTML = '<option value="member">Member</option><option value="site_admin">Space Admin</option>';
      if (roleWrap) roleWrap.style.display = '';
    } else {
      roleSelect.innerHTML = '<option value="member">Member</option>';
      if (roleWrap) roleWrap.style.display = 'none';
    }
    roleSelect.value = 'member';
  }

  // Show user preview card when a user is selected
  sel.onchange = function () {
    var preview = $('selectedUserPreview');
    var uid = sel.value;
    var u = uid && (S.data.users || []).find(function(x){ return x.id === uid; });
    if (!u) { preview.style.display = 'none'; return; }
    var initials = u.name ? u.name.split(' ').map(function(p){ return p[0]; }).join('').toUpperCase().slice(0,2) : '?';
    var bg = u.color || '#2563eb';
    preview.style.display = 'flex';
    preview.innerHTML =
      '<div style="width:36px;height:36px;border-radius:50%;background:' + bg + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0">' + initials + '</div>' +
      '<div><div style="font-weight:600;font-size:13px">' + esc(u.name) + '</div>' +
      '<div style="font-size:12px;color:var(--text3)">' + esc(u.email || '') + '</div></div>';
  };

  openModal('modal-invite-member');
}
window.openInviteMemberModal = openInviteMemberModal;

$('inviteMemberForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var userId = $('inviteMemberSelect').value;
  var role = $('inviteMemberRole').value;
  if (!userId) { toast('Please select a user', 'error'); return; }
  try {
    await api('/api/space-members', 'POST', { space_id: S.currentSpace, user_id: userId, role: role });
    await refreshData();
    closeModal('modal-invite-member');
    if (S.currentTab === 'space-settings' && _settingsActiveTab === 'people') {
      renderSettingsPeople(getSpace(S.currentSpace));
    }
    renderSidebar();
    popupAlert('User Added', 'User has been added to the space successfully.', 'success');
  } catch (e) { /* error shown by api() */ }
});

// (Custom Fields management is now inside renderSettingsCustomFields, within Space Settings)

function openCustomFieldModal(field) {
  var isCombo = field && isCombinationField(field);
  var isBuiltin = !!(field && field.is_builtin);
  var isProductTypeBuiltin = field && isBuiltinProductTypeField(field);
  // Built-in selects whose choices are NOT ours to edit:
  //   status  → the workflow state machine (.claude/rules/issue-state-machine.md)
  //             hardcodes these 4 values and the transitions between them;
  //   sprint  → the choices come from the sprints table, not from options.
  // type/priority WERE in this list too, back when the issues table had a DB
  // CHECK constraint pinning them to 5 fixed values each (migration 016 dropped
  // it) — they're now configurable exactly like Team/Product Type.
  var FIXED_OPTION_BUILTINS = ['status', 'sprint'];
  var optionsAreFixed = isBuiltin && FIXED_OPTION_BUILTINS.indexOf(field.field_key) >= 0;
  var canEditOptions = isCombo || isProductTypeBuiltin ||
    (isBuiltin && field.field_type === 'select' && !optionsAreFixed) ||
    (!isBuiltin && field && (field.field_type === 'select' || field.field_type === 'multi_select'));
  if (field) {
    $('customFieldModalTitle').textContent = isCombo ? 'Edit Combination (by Product Type)' : (isProductTypeBuiltin ? 'Edit Product Type options' : (isBuiltin ? 'Edit Built-in Field' : 'Edit Custom Field'));
    $('customFieldId').value = field.id;
    $('customFieldName').value = field.name || '';
    $('customFieldType').value = field.field_type || field.type || 'text';
    $('customFieldRequired').checked = !!(field.is_required || field.required);
    renderRequiredTypeChoices(field.required_types, field.space_id);
    writeShowInToForm(field);
    if (isCombo) {
      $('customFieldOptions').value = '';
    } else {
      $('customFieldOptions').value = formatFieldOptionsForEditor(field);
    }
    // renderCombinationGroupEditors runs from toggleCustomFieldOptions below,
    // which is always called at the end of this function with the real field.
  } else {
    $('customFieldModalTitle').textContent = 'Add Custom Field';
    $('customFieldId').value = '';
    $('customFieldName').value = '';
    $('customFieldType').value = 'text';
    $('customFieldRequired').checked = false;
    renderRequiredTypeChoices([]);
    $('customFieldOptions').value = '';
    if ($('customFieldShowInCreate')) $('customFieldShowInCreate').checked = true;
    if ($('customFieldShowInDrawer')) $('customFieldShowInDrawer').checked = true;
    if ($('customFieldName')) $('customFieldName').readOnly = false;
    if ($('customFieldType')) $('customFieldType').disabled = false;
  }
  // "Add to all boards" posts to /api/custom-fields/create-for-all, which is
  // org-admin-only — hidden for space admins so it can't be ticked and then 403.
  var applyAllGroup = $('customFieldApplyAllGroup');
  if (applyAllGroup) applyAllGroup.hidden = !!field || !isOrgAdminUser();
  if ($('customFieldApplyAll')) $('customFieldApplyAll').checked = false;
  if ($('customFieldName')) {
    $('customFieldName').readOnly = !!isCombo || !!isBuiltin;
  }
  if ($('customFieldType')) {
    $('customFieldType').disabled = !!isBuiltin;
  }
  if ($('customFieldShowInGroup')) $('customFieldShowInGroup').hidden = false;
  syncRequiredTypesVisibility();
  var reqBox = $('customFieldRequired');
  if (reqBox && !reqBox._reqTypesBound) {
    reqBox._reqTypesBound = true;
    reqBox.addEventListener('change', syncRequiredTypesVisibility);
  }
  toggleCustomFieldOptions(isCombo ? field : (canEditOptions ? field : null), !isCombo && !canEditOptions);
  openModal('modal-custom-field');
}
window.openCustomFieldModal = openCustomFieldModal;

function toggleCustomFieldOptions(editingField, forceHide) {
  var type = $('customFieldType').value;
  var isCombo = editingField && isCombinationField(editingField);
  if (!isCombo && $('customFieldName') && ($('customFieldName').value || '').toLowerCase().trim() === 'combination') {
    isCombo = true;
  }
  var isProductType = editingField && isBuiltinProductTypeField(editingField);
  // forceHide is set by openCustomFieldModal for builtins whose options are NOT
  // editable (status/sprint) — without it, this fell back to reading the Field
  // Type select's raw DOM value ('select'), which stays 'select' for those
  // fields too, so the box showed anyway and a saved edit silently no-op'd.
  var show = !forceHide && (((type === 'select' || type === 'multi_select') && !isCombo) || isProductType);
  $('customFieldOptionsGroup').hidden = !show;
  if ($('customFieldCombinationGroups')) {
    $('customFieldCombinationGroups').hidden = !isCombo;
    if (isCombo) {
      var existingGroups = (editingField && isCombinationField(editingField))
        ? parseCombinationFieldOptions(editingField).groups
        : {};
      renderCombinationGroupEditors(existingGroups);
    }
  }
  if ($('customFieldOptions') && isProductType) {
    $('customFieldOptions').placeholder = 'Message, Email, Content, Manage, Infra';
  }
}

// One textarea per Product Type option THIS SPACE currently has configured
// (getProductTypeOptionsForSpace already reads that from custom_fields.options
// -- see the buildProductTypeComboPickerHtml call site, which was already
// wired this way). Combination used to offer exactly 3 fixed boxes
// (Message/Email/Content) regardless of what Product Type actually had
// configured, so a space could never set up combinations for any type beyond
// those three, no matter what it added to Product Type's own options.
// existingGroups keys that no longer match a current Product Type option are
// intentionally dropped from view here -- their combinations still exist in
// storage until this form is actually saved, but there's no live product type
// left to attach the box to.
function renderCombinationGroupEditors(existingGroups) {
  var container = $('cfComboGroupsList');
  if (!container) return;
  existingGroups = existingGroups || {};
  var ptOptions = getProductTypeOptionsForSpace(S.currentSpace);
  if (!ptOptions.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:12px">' +
      'This space has no Product Type options configured yet — add some on the Product Type field first.</p>';
    return;
  }
  container.innerHTML = '';
  ptOptions.forEach(function (o, i) {
    var label = document.createElement('label');
    label.className = 'form-label';
    label.style.marginTop = i === 0 ? '0' : '10px';
    label.style.display = 'block';
    label.textContent = o.l;
    var ta = document.createElement('textarea');
    ta.className = 'input';
    ta.dataset.ptGroup = o.v;
    ta.rows = 4;
    ta.placeholder = 'Source - Destination';
    ta.value = (existingGroups[o.v] || []).join('\n');
    container.appendChild(label);
    container.appendChild(ta);
  });
}

function parseCombinationLines(text) {
  return String(text || '').split(/\r?\n|,/).map(function (s) {
    return typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(s.trim()) : s.trim();
  }).filter(Boolean);
}

function buildCombinationOptionsFromEditor() {
  var groups = {};
  qsa('#cfComboGroupsList textarea[data-pt-group]').forEach(function (ta) {
    groups[ta.dataset.ptGroup] = parseCombinationLines(ta.value);
  });
  return {
    v: 2,
    groups: groups,
    flat: flattenCombinationGroups(groups)
  };
}

$('customFieldType').addEventListener('change', function () { toggleCustomFieldOptions(); });
if ($('customFieldName')) {
  $('customFieldName').addEventListener('input', function () { toggleCustomFieldOptions(); });
}

// Selected files for Create Issue modal (allows individual removal)
var _selectedFiles = [];
var _attachmentThumbUrls = [];
var ISSUE_MAX_FILE_BYTES = 1024 * 1024 * 1024;            // 1 GB per file
var ISSUE_MAX_TOTAL_ATTACH_BYTES = 1024 * 1024 * 1024;    // 1 GB per upload
// Every "too large" message derives its number from the constants above, so the
// text can never claim a limit the code no longer enforces.
function fmtByteLimit(bytes) {
  var gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return (Number.isInteger(gb) ? gb : gb.toFixed(1)) + ' GB';
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}
var ISSUE_MAX_ATTACHMENTS = 20;
var ISSUE_MAX_DESC_CHARS = 500000;
var _lastPasteFingerprint = '';
var _lastPasteTime = 0;
var _issuePasteBusy = false;

function _fileFingerprint(file) {
  if (!file) return '';
  if (file.type && file.type.indexOf('image/') === 0) {
    return 'img|' + file.size + '|' + file.type;
  }
  return (file.name || '') + '|' + file.size + '|' + (file.type || '') + '|' + (file.lastModified || 0);
}

function _isDuplicateAttachment(file) {
  var fp = _fileFingerprint(file);
  for (var i = 0; i < _selectedFiles.length; i++) {
    if (_fileFingerprint(_selectedFiles[i]) === fp) return true;
  }
  return false;
}

/** One paste can expose the same screenshot multiple times in clipboard items — keep one. */
function _dedupePasteFiles(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var file = null;
    if (items[i].kind === 'file') file = items[i].getAsFile();
    else if (items[i].type && items[i].type.indexOf('image/') === 0) file = items[i].getAsFile();
    if (!file) continue;
    var key = _fileFingerprint(file);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(file);
  }
  return out;
}

function _revokeAttachmentThumbUrls() {
  _attachmentThumbUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  _attachmentThumbUrls = [];
}

function _formatFileSize(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + 'MB';
  return Math.max(1, Math.round(bytes / 1024)) + 'KB';
}

function _addIssueAttachmentFile(file, sourceLabel) {
  if (!file) return false;
  if (_isDuplicateAttachment(file)) {
    if (sourceLabel) toast('This screenshot is already attached', 'warning');
    return false;
  }
  var fp = _fileFingerprint(file);
  var now = Date.now();
  if (fp === _lastPasteFingerprint && now - _lastPasteTime < 1500) return false;
  _lastPasteFingerprint = fp;
  _lastPasteTime = now;
  if (file.size > ISSUE_MAX_FILE_BYTES) {
    toast('File too large (max ' + fmtByteLimit(ISSUE_MAX_FILE_BYTES) + '): ' + (file.name || 'file'), 'error');
    return false;
  }
  if (_selectedFiles.length >= ISSUE_MAX_ATTACHMENTS) {
    toast('Maximum ' + ISSUE_MAX_ATTACHMENTS + ' attachments per issue', 'error');
    return false;
  }
  var total = file.size;
  for (var i = 0; i < _selectedFiles.length; i++) total += _selectedFiles[i].size;
  if (total > ISSUE_MAX_TOTAL_ATTACH_BYTES) {
    toast('Total attachment size too large (max ' + fmtByteLimit(ISSUE_MAX_TOTAL_ATTACH_BYTES) + '). Remove some files or use smaller screenshots.', 'error');
    return false;
  }
  _selectedFiles.push(file);
  _renderAttachmentFileList();
  if (sourceLabel) toast(sourceLabel, 'success');
  return true;
}

function _validateIssueAttachments() {
  if (_selectedFiles.length > ISSUE_MAX_ATTACHMENTS) {
    toast('Maximum ' + ISSUE_MAX_ATTACHMENTS + ' attachments per issue', 'error');
    return false;
  }
  var total = 0;
  for (var i = 0; i < _selectedFiles.length; i++) {
    if (_selectedFiles[i].size > ISSUE_MAX_FILE_BYTES) {
      toast('File too large (max ' + fmtByteLimit(ISSUE_MAX_FILE_BYTES) + '): ' + _selectedFiles[i].name, 'error');
      return false;
    }
    total += _selectedFiles[i].size;
  }
  if (total > ISSUE_MAX_TOTAL_ATTACH_BYTES) {
    toast('Total attachment size too large (max ' + fmtByteLimit(ISSUE_MAX_TOTAL_ATTACH_BYTES) + ')', 'error');
    return false;
  }
  return true;
}

function stripInlineBase64Images(html) {
  if (!html) return html;
  return html.replace(/<img[^>]+src=["']data:image[^"']*["'][^>]*>/gi, '');
}

var DESC_EDITOR_IDS = ['issueDescContent', 'drawerDesc', 'drawerFixDesc'];

function isDescEditor(el) {
  return el && DESC_EDITOR_IDS.indexOf(el.id) >= 0;
}

function getOrCreateDescImageTray(editorEl) {
  if (!editorEl) return null;
  var tray = editorEl.querySelector(':scope > .desc-image-tray');
  if (!tray) {
    tray = document.createElement('div');
    tray.className = 'desc-image-tray';
    tray.setAttribute('contenteditable', 'false');
    editorEl.appendChild(tray);
  }
  return tray;
}

function bindDescImageTray(root) {
  if (!root || root._descTrayBound) return;
  root._descTrayBound = true;
  root.addEventListener('click', function (e) {
    var chip = e.target.closest('.desc-image-chip');
    if (!chip) return;
    if (e.target.closest('.desc-image-remove')) {
      e.preventDefault();
      e.stopPropagation();
      chip.remove();
      var tray = root.querySelector(':scope > .desc-image-tray');
      if (tray && !tray.querySelector('.desc-image-chip')) tray.remove();
      if (root.id === 'drawerDesc' || root.id === 'drawerFixDesc') markDrawerDescDirty(root.id);
      return;
    }
    var img = chip.querySelector('img');
    if (img && img.src) window._openAttachmentPreviewFromDataUrl(img.src);
  });
}

function addDescInlineImageChip(tray, url, alt, fp) {
  if (!tray) return;
  var chip = document.createElement('div');
  chip.className = 'desc-image-chip';
  chip.dataset.url = url;
  if (fp) chip.dataset.fp = fp;
  chip.innerHTML = '<img src="' + esc(fileApiUrl(url)) + '" alt="' + esc(alt || 'Screenshot') + '">' +
    '<button type="button" class="desc-image-remove" aria-label="Remove">×</button>';
  tray.appendChild(chip);
}

async function uploadDescImageFile(file) {
  var fd = new FormData();
  fd.append('files', file, file.name || 'screenshot.png');
  var res;
  try {
    res = await fetch('/api/comments/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getAuthToken() },
      body: fd
    });
  } catch (networkErr) {
    throw new Error(friendlyFetchErrorMessage(networkErr, 'Upload failed'));
  }
  if (!res.ok) {
    var err = 'Upload failed';
    try { var j = await res.json(); if (j.error) err = j.error; } catch (_) {}
    throw new Error(err);
  }
  var data = await res.json();
  if (!data.files || !data.files.length) throw new Error('Upload failed');
  return data.files[0];
}

// ── Word-document behaviour for Description / Fix Description ──
// A screenshot goes in at the caret as a plain <img> in the editable flow, with a
// line break after it, so you carry on typing underneath and remove it with
// Backspace like any other character.
//
// Previously every image was appended to a contenteditable="false" tray pinned to
// the end of the field. That meant images always jumped to the bottom whatever
// the caret was doing, the keyboard could not delete them (hence the × button),
// and because the non-editable tray was the last child there was no editable node
// after it — so there was no way to type anything below a screenshot.
function insertDescImageAtCaret(editorEl, url, alt, fp) {
  if (!editorEl) return;
  var img = document.createElement('img');
  img.className = 'desc-inline-img';
  img.src = fileApiUrl(url);
  img.setAttribute('data-url', url);
  if (fp) img.setAttribute('data-fp', fp);
  img.alt = alt || 'Screenshot';

  var sel = window.getSelection();
  var range = null;
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0);
    // Only reuse the caret if it is actually inside THIS field.
    if (editorEl.contains(r.commonAncestorContainer)) range = r;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
  }
  range.deleteContents();
  var br = document.createElement('br');
  var frag = document.createDocumentFragment();
  frag.appendChild(img);
  frag.appendChild(br);
  range.insertNode(frag);

  // Park the caret after the break so the next keystroke lands below the image.
  // focus() FIRST: focusing a contenteditable collapses the caret to the start of
  // the element, so doing it afterwards threw the caret away — the next thing you
  // typed (or pasted) went in above the image instead of below it.
  editorEl.focus();
  var after = document.createRange();
  after.setStartAfter(br);
  after.collapse(true);
  var liveSel = window.getSelection();
  if (liveSel) { liveSel.removeAllRanges(); liveSel.addRange(after); }
}

// Descriptions saved before the change hold their screenshots inside the old
// tray markup. Convert them to inline images on load so existing content edits
// the same way — and the per-image × button stops appearing.
function normalizeDescInlineImages(editorEl) {
  if (!editorEl) return;
  var trays = editorEl.querySelectorAll('.desc-image-tray');
  for (var t = 0; t < trays.length; t++) {
    var tray = trays[t];
    var frag = document.createDocumentFragment();
    var chips = tray.querySelectorAll('.desc-image-chip');
    for (var i = 0; i < chips.length; i++) {
      var src = chips[i].querySelector('img');
      if (!src) continue;
      var img = document.createElement('img');
      img.className = 'desc-inline-img';
      img.src = src.getAttribute('src') || '';
      if (chips[i].dataset.url) img.setAttribute('data-url', chips[i].dataset.url);
      img.alt = src.getAttribute('alt') || 'Screenshot';
      frag.appendChild(img);
      frag.appendChild(document.createElement('br'));
    }
    if (tray.parentNode) tray.parentNode.replaceChild(frag, tray);
  }
}

async function handleDescImagePaste(editorEl, file, fieldLabel) {
  fieldLabel = fieldLabel || 'description';
  if (!editorEl || !file) return;
  var fp = _fileFingerprint(file);
  var already = editorEl.querySelectorAll('.desc-inline-img[data-fp]');
  for (var i = 0; i < already.length; i++) {
    if (already[i].getAttribute('data-fp') === fp) {
      toast('This screenshot is already in the ' + fieldLabel, 'warning');
      return;
    }
  }
  try {
    var uploaded = await uploadDescImageFile(file);
    insertDescImageAtCaret(editorEl, uploaded.url, file.name || 'Screenshot', fp);
    if (editorEl.id === 'drawerDesc' || editorEl.id === 'drawerFixDesc') markDrawerDescDirty(editorEl.id);
    toast('Screenshot added to ' + fieldLabel, 'success');
  } catch (e) {
    toast(e.message || 'Could not upload screenshot', 'error');
  }
}

function getDescriptionHtmlForSave(editorEl) {
  if (!editorEl) return '';
  var clone = editorEl.cloneNode(true);
  var tray = clone.querySelector('.desc-image-tray');
  if (tray && !tray.querySelector('.desc-image-chip')) tray.remove();
  var html = clone.innerHTML.trim();
  html = stripInlineBase64Images(html);
  html = stripFileAuthTokensFromHtml(html);
  return (html === '' || html === '<br>') ? '' : html;
}

function initDescEditorImageTrays() {
  DESC_EDITOR_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    normalizeDescInlineImages(el);
    // Kept as a safety net for any legacy tray that reaches an editor by another
    // path; once normalised there are no chips left for it to act on.
    bindDescImageTray(el);
  });
}

window._openAttachmentPreview = function (idx) {
  var file = _selectedFiles[idx];
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
  var url = URL.createObjectURL(file);
  var lb = document.createElement('div');
  lb.className = 'image-lightbox';
  lb.innerHTML = '<button type="button" class="image-lightbox-close" aria-label="Close">×</button>' +
    '<img src="' + url + '" alt="' + esc(file.name || 'Preview') + '">';
  function closeLb() {
    document.removeEventListener('keydown', onKey);
    URL.revokeObjectURL(url);
    if (lb.parentNode) lb.parentNode.removeChild(lb);
  }
  function onKey(ev) { if (ev.key === 'Escape') closeLb(); }
  lb.querySelector('.image-lightbox-close').onclick = function (ev) { ev.stopPropagation(); closeLb(); };
  lb.querySelector('img').onclick = function (ev) { ev.stopPropagation(); };
  lb.onclick = closeLb;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(lb);
};

function _renderAttachmentFileList() {
  var list = $('attachmentFileList');
  if (!list) return;
  _revokeAttachmentThumbUrls();
  if (!_selectedFiles.length) { list.innerHTML = ''; return; }

  var imageItems = [];
  var otherItems = [];
  _selectedFiles.forEach(function (f, i) {
    if (f.type && f.type.indexOf('image/') === 0) imageItems.push({ file: f, idx: i });
    else otherItems.push({ file: f, idx: i });
  });

  var html = '';
  if (imageItems.length) {
    html += '<div class="issue-attachment-thumbs">';
    imageItems.forEach(function (item) {
      var thumbUrl = URL.createObjectURL(item.file);
      _attachmentThumbUrls.push(thumbUrl);
      html += '<div class="issue-attachment-thumb" title="' + esc(item.file.name) + '">' +
        '<img src="' + thumbUrl + '" alt="' + esc(item.file.name) + '" onclick="window._openAttachmentPreview(' + item.idx + ')">' +
        '<button type="button" class="issue-attachment-thumb-remove" onclick="event.stopPropagation();_removeAttachmentFile(' + item.idx + ')" title="Remove">×</button>' +
        '</div>';
    });
    html += '</div>';
  }
  if (otherItems.length) {
    html += otherItems.map(function (item) {
      return '<div class="issue-attachment-file-row">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📄 ' + esc(item.file.name) + '</span>' +
        '<span style="color:var(--text3);flex-shrink:0">' + _formatFileSize(item.file.size) + '</span>' +
        '<button type="button" onclick="_removeAttachmentFile(' + item.idx + ')" title="Remove">×</button>' +
        '</div>';
    }).join('');
  }
  list.innerHTML = html;
}

window._removeAttachmentFile = function(idx) {
  _selectedFiles.splice(idx, 1);
  _renderAttachmentFileList();
};

// Show selected file names in Create Issue modal
document.addEventListener('change', function(e) {
  if (e.target.id === 'issueAttachments') {
    var files = e.target.files;
    for (var i = 0; i < files.length; i++) _addIssueAttachmentFile(files[i]);
    e.target.value = '';
  }
});

// Create Issue modal — single capture-phase paste handler (prevents duplicate screenshot uploads)
document.addEventListener('paste', function (e) {
  var modal = document.getElementById('modal-issue');
  if (!modal || modal.hidden) return;
  var items = e.clipboardData && e.clipboardData.items;
  if (!items || !items.length) return;
  var files = _dedupePasteFiles(items);
  if (!files.length) return;

  var imageFiles = files.filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
  if (imageFiles.length) {
    var active = document.activeElement;
    if (active && isDescEditor(active)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (_issuePasteBusy) return;
    _issuePasteBusy = true;
    setTimeout(function () { _issuePasteBusy = false; }, 500);
    _addIssueAttachmentFile(imageFiles[0], 'Screenshot added as attachment');
    return;
  }

  var active = document.activeElement;
  if (active && active.id === 'issueDescContent') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  var added = 0;
  for (var i = 0; i < files.length; i++) {
    if (_addIssueAttachmentFile(files[i])) added++;
  }
  if (added) toast(added + ' file' + (added > 1 ? 's' : '') + ' pasted', 'success');
}, true);

// Description editors — paste screenshot as bottom-left thumbnail inside description
document.addEventListener('paste', function (e) {
  var active = document.activeElement;
  if (!isDescEditor(active)) return;
  var items = e.clipboardData && e.clipboardData.items;
  if (!items || !items.length) return;
  var imageFiles = _dedupePasteFiles(items).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
  if (!imageFiles.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (_issuePasteBusy) return;
  _issuePasteBusy = true;
  handleDescImagePaste(active, imageFiles[0]).finally(function () {
    setTimeout(function () { _issuePasteBusy = false; }, 500);
  });
}, true);

// ── Comment file attachment helpers ──────────────────────
var _commentFiles = [];

function _renderCommentFileList() {
  var list = $('drawerCommentFileList');
  if (!list) return;
  if (!_commentFiles.length) { list.innerHTML = ''; return; }
  list.innerHTML = _commentFiles.map(function(f, i) {
    var size = f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB';
    return '<div class="comment-file-tag">📄 ' + esc(f.name) + ' <span class="comment-file-size">(' + size + ')</span>' +
      '<button type="button" onclick="window._removeCommentFile(' + i + ')" title="Remove">×</button></div>';
  }).join('');
}

window._removeCommentFile = function(i) {
  _commentFiles.splice(i, 1);
  _renderCommentFileList();
};

// Comment attach file input handler
document.addEventListener('change', function(e) {
  if (e.target.id === 'drawerCommentAttach') {
    var files = e.target.files;
    for (var i = 0; i < files.length; i++) {
      if (files[i].size > ISSUE_MAX_FILE_BYTES) {
        toast('File too large (max ' + fmtByteLimit(ISSUE_MAX_FILE_BYTES) + ')', 'error');
        continue;
      }
      _commentFiles.push(files[i]);
    }
    e.target.value = '';
    _renderCommentFileList();
  }
});

// Drawer attachment upload handler
document.addEventListener('change', function(e) {
  if (e.target.id === 'drawerAttachmentInput' && S.drawerIssueId) {
    var files = e.target.files;
    if (!files.length) return;
    var fd = new FormData();
    for (var i = 0; i < files.length; i++) fd.append('files', files[i]);
    toast('Uploading…');
    fetch('/api/issues/' + S.drawerIssueId + '/attachments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getAuthToken() },
      body: fd
    }).then(async function(r) {
      var data; try { data = await r.json(); } catch (_) { data = {}; }
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      toast('Attachment uploaded');
      var issue = await api('/api/issues/' + S.drawerIssueId);
      if (issue) renderDrawerAttachments(issue.attachments || []);
    }).catch(function(e) { toast(friendlyFetchErrorMessage(e, 'Upload failed'), 'error'); });
    e.target.value = '';
  }
});

$('customFieldForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var id = $('customFieldId').value;
  var name = $('customFieldName').value.trim();
  var type = $('customFieldType').value;
  var required = $('customFieldRequired').checked;
  var applyAll = $('customFieldApplyAll') && $('customFieldApplyAll').checked;
  var optionsRaw = $('customFieldOptions').value.trim();
  var isComboField = (name || '').toLowerCase().trim() === 'combination' || ($('customFieldCombinationGroups') && !$('customFieldCombinationGroups').hidden);
  var showIn = readShowInFromForm();
  // Only meaningful when Required is on; sent as [] otherwise so turning Required
  // off also clears any stale type list.
  var requiredTypes = required ? readRequiredTypesFromForm() : [];
  var options;
  if (isComboField) {
    options = buildCombinationOptionsFromEditor();
    type = 'multi_select';
  } else {
    options = (type === 'select' || type === 'multi_select') && optionsRaw
      ? optionsRaw.split(',').map(function (o) { return o.trim(); }).filter(Boolean)
      : [];
  }

  if (!name) { toast('Field name is required', 'error'); return; }
  // "Required, for no types" is a contradiction — say so rather than silently
  // storing a rule that can never fire.
  if (required && !requiredTypes.length) {
    toast('Pick at least one issue type this field is required for, or untick Required.', 'error');
    syncRequiredTypesVisibility();
    return;
  }

  var savingField = id ? (S.data.custom_fields || []).find(function (f) { return String(f.id) === String(id); }) : null;
  // 'epic' and 'subtask' are load-bearing string literals elsewhere (Roadmap
  // grouping, the Add Subtask flow) — unlike every other Type value, they can't
  // become admin-removable without rewriting those features, so the editor
  // blocks it here instead of silently letting a save break them.
  if (savingField && savingField.is_builtin && savingField.field_key === 'type') {
    var RESERVED_TYPES = ['epic', 'subtask'];
    var missingReserved = RESERVED_TYPES.filter(function (t) { return options.indexOf(t) < 0; });
    if (missingReserved.length) {
      toast('"' + missingReserved.join('", "') + '" can’t be removed from Type — required by Roadmap/subtasks.', 'error');
      return;
    }
  }

  try {
    if (id) {
      var editingField = savingField;
      var payload;
      if (editingField && editingField.is_builtin) {
        payload = { is_required: required, options: options, show_in: showIn, required_types: requiredTypes };
      } else {
        payload = { name: name, field_type: type, is_required: required, options: options, show_in: showIn, required_types: requiredTypes };
      }
      await api('/api/custom-fields/' + id, 'PUT', payload);
      await refreshData();
      await refreshAllCustomFields();
      closeModal('modal-custom-field');
      if (S.currentTab === 'space-settings' && _settingsActiveTab === 'customfields') {
        renderSettingsCustomFields(getSpace(S.currentSpace));
      }
      toast('Custom field updated');
    } else if (applyAll) {
      var result = await api('/api/custom-fields/create-for-all', 'POST', { name: name, field_type: type, is_required: required, options: options, show_in: showIn, required_types: requiredTypes });
      await refreshData();
      await refreshAllCustomFields();
      closeModal('modal-custom-field');
      if (S.currentTab === 'space-settings' && _settingsActiveTab === 'customfields') {
        renderSettingsCustomFields(getSpace(S.currentSpace));
      }
      toast(result.added > 0
        ? 'Added "' + name + '" to: ' + result.addedTo.join(', ')
        : 'Every board already has a field named "' + name + '"', result.added > 0 ? 'success' : 'warning');
    } else {
      var payload2 = { space_id: S.currentSpace, name: name, field_type: type, is_required: required, options: options, show_in: showIn, required_types: requiredTypes };
      await api('/api/custom-fields', 'POST', payload2);
      await refreshData();
      closeModal('modal-custom-field');
      if (S.currentTab === 'space-settings' && _settingsActiveTab === 'customfields') {
        renderSettingsCustomFields(getSpace(S.currentSpace));
      }
      toast('Custom field created');
    }
  } catch (e) { /* error shown by api() */ }
});

// ═══════════════════════════════════════════════════════════
// ISSUE DRAWER (open)
// ═══════════════════════════════════════════════════════════
function stripTitleNewlines(raw) {
  return String(raw || '').replace(/[\r\n\u2028\u2029]+/g, ' ');
}

function finalizeIssueTitle(raw) {
  return stripTitleNewlines(raw).replace(/\s+/g, ' ').trim();
}

function resizeDrawerTitleField() {
  var el = $('drawerTitle');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 28) + 'px';
}

function setDrawerTitleValue(title) {
  var el = $('drawerTitle');
  if (!el) return;
  el.value = finalizeIssueTitle(title);
  resizeDrawerTitleField();
}

function getDrawerTitleValue() {
  var el = $('drawerTitle');
  return el ? finalizeIssueTitle(el.value) : '';
}

// #drawerTitle is static markup that outlives every drawer open, so its listeners
// are bound once (rebinding stacked duplicates). It therefore must NOT capture an
// autoSave: the closure it captured on the first open kept saving to that first
// ticket, so editing any later ticket's title silently overwrote the first one's
// — and patched the wrong row in the local cache too. Resolve the save target at
// typing time instead, via _activeDrawerAutoSave.
function bindDrawerTitleField() {
  var el = $('drawerTitle');
  if (!el || el._titleBound) return;
  el._titleBound = true;
  var autoSave = function (field, value) {
    if (_activeDrawerAutoSave) _activeDrawerAutoSave(field, value);
  };

  el.addEventListener('input', function () {
    var noBreaks = stripTitleNewlines(el.value);
    if (el.value !== noBreaks) {
      var pos = el.selectionStart || 0;
      el.value = noBreaks;
      el.selectionStart = el.selectionEnd = Math.min(pos, noBreaks.length);
    }
    resizeDrawerTitleField();
    if (noBreaks.trim()) autoSave('title', noBreaks);
  });

  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });

  el.addEventListener('paste', function (e) {
    e.preventDefault();
    var text = finalizeIssueTitle((e.clipboardData || window.clipboardData).getData('text/plain'));
    if (!text) return;
    var start = el.selectionStart || 0;
    var end = el.selectionEnd || 0;
    var val = el.value;
    el.value = val.slice(0, start) + text + val.slice(end);
    var caret = start + text.length;
    el.selectionStart = el.selectionEnd = caret;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  el.addEventListener('blur', function () {
    var clean = finalizeIssueTitle(el.value);
    if (el.value !== clean) el.value = clean;
    resizeDrawerTitleField();
    if (clean) autoSave('title', clean);
  });
}

async function openDrawer(issueId) {
  // Save current location for back button - detect allwork from URL/view
  var currentTab = S.currentTab;
  if (!currentTab) {
    // Try to detect from active nav item
    var activeNav = document.querySelector('.nav-item.active[data-tab]');
    if (activeNav) currentTab = activeNav.dataset.tab;
  }
  if (!currentTab && document.getElementById('view-allwork') && !document.getElementById('view-allwork').hidden) {
    currentTab = 'allwork';
  }
  window._issueReturnTab = currentTab || 'allwork';
  window._issueReturnSpace = S.currentSpace;
  S.drawerIssueId = issueId;
  // Reset comment file attachments for the new issue
  _commentFiles = [];
  _renderCommentFileList();
  var issue;
  try {
    issue = await api('/api/issues/' + issueId);
  } catch (e) {
    toast('Could not load issue', 'error');
    return;
  }

  if (!issue) { toast('Could not load issue', 'error'); return; }
  // The fetch above is async — if the user hit Back (popstate → _closeIssueDrawer
  // clears drawerIssueId) or opened a different issue while it was in flight,
  // this response is stale. Rendering it anyway re-opens a drawer the user just
  // closed and stomps the URL popstate just restored, which is why Back
  // sometimes looked like it needed two clicks: the first click's popstate ran
  // correctly, then this exact code below undid it a moment later.
  if (S.drawerIssueId !== issueId) return;
  // Fallback for openIssuePage's same mount call — only needed when the issue
  // wasn't already in the local cache at click time, so its space_id wasn't
  // known synchronously yet.
  if (issue.space_id && !document.querySelector('.space-item[data-space-id="' + issue.space_id + '"] + .space-subnav')) {
    mountSpaceSubnav(issue.space_id, S.currentTab);
  }
  trackRecentIssueView(issue);
  updateDrawerStarBtn(issue.id);
  var starBtn = $('drawerStarBtn');
  if (starBtn && !starBtn._starBound) {
    starBtn._starBound = true;
    starBtn.onclick = function (e) {
      e.stopPropagation();
      toggleIssueFavorite(S.drawerIssueId);
    };
  }
  if (issue.key) {
    // Preserve an existing &from=<tab> query param rather than rebuilding the
    // URL bare -- this used to silently drop it, so a hard refresh landed back
    // on the boot path's hardcoded 'backlog' assumption every time regardless
    // of what openIssuePage had just encoded.
    var existingFrom = new URLSearchParams(window.location.search).get('from');
    var replaceUrl = '/?issue=' + encodeURIComponent(issue.key) + (existingFrom ? '&from=' + existingFrom : '');
    history.replaceState({ issueId: issueId }, '', replaceUrl);
    window._currentIssueKey = issue.key;
  }
  document.body.classList.add('issue-page'); void document.body.offsetHeight; var dp = document.querySelector('.drawer-panel'); if(dp){ dp.style.position='fixed'; dp.style.inset='0'; dp.style.width='100vw'; dp.style.maxWidth='100vw'; dp.style.height='100vh'; dp.style.zIndex='99999'; dp.style.display='flex'; dp.style.flexDirection='column'; } $('issueDrawer').removeAttribute('hidden');

  // Parent breadcrumb for subtasks
  var parentCrumb = $('drawerParentBreadcrumb');
  if (issue.parent_id && issue.parent_key) {
    parentCrumb.innerHTML = '<span class="drawer-crumb-icon">' + typeIcon(issue.parent_type || 'task') + '</span>' +
      '<a class="drawer-crumb-link" onclick="openIssuePage(\'' + issue.parent_id + '\')">' + esc(issue.parent_key) + '</a>' +
      ' <span class="drawer-crumb-sep">/</span> ' +
      '<span class="drawer-crumb-icon">' + typeIcon(issue.type) + '</span>' +
      '<span>' + esc(issue.key) + '</span>';
    parentCrumb.style.display = '';
    if ($('drawerKey')) $('drawerKey').style.display = 'none';
  } else {
    parentCrumb.style.display = 'none';
    parentCrumb.innerHTML = '';
    if ($('drawerKey')) $('drawerKey').style.display = '';
  }

  $('drawerKey').textContent = issue.key || (issue.project_key ? issue.project_key + '-?' : '#' + issue.id);
  $('drawerType').textContent = typeLabel(issue.type);
  applyTypeBadgeStyle($('drawerType'), issue.type || 'task');
  setDrawerTitleValue(issue.title || '');
  // Render description - convert plain text to HTML safely
  var descText = issue.description || '';
  var fixDescText = issue.fix_description || '';
  // If content has no HTML tags, convert newlines to <br>
  function renderDesc(text) {
    if (!text) return '';
    var linkStyle = 'color:#0129AC;text-decoration:underline;cursor:pointer';
    if (/<[a-z][\s\S]*>/i.test(text)) {
      // Fix broken <a href=""> by using the link text as the href
      var fixed = text.replace(/<a\s[^>]*href=["']["'][^>]*>(https?:\/\/[^<]+)<\/a>/gi, function(m, url) {
        return '<a href="' + url.trim() + '" style="' + linkStyle + '" target="_blank">' + url.trim() + '</a>';
      });
      // Linkify bare URLs not already inside an <a> tag
      fixed = fixed.replace(/(<a\s[^>]*>[\s\S]*?<\/a>)|(https?:\/\/[^\s<"]+)/g, function(m, anchor, url) {
        if (anchor) return anchor;
        return '<a href="' + url + '" style="' + linkStyle + '" target="_blank">' + url + '</a>';
      });
      return augmentFileUrlsInHtml(fixed
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/(<br\s*\/?>){3,}/gi, '<br>')
        .replace(/&nbsp;/gi, ' ')
        .trim());
    }
    var p = text.replace(/\n{3,}/g,'\n\n').replace(/\n/g,'<br>');
    var d = p.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    return d.replace(/(https?:\/\/[^\s<"]+)/g,'<a href="$1" style="' + linkStyle + '" target="_blank">$1</a>');
  }
  $('drawerDesc').innerHTML = renderDesc(descText);
  $('drawerFixDesc').innerHTML = renderDesc(fixDescText);
  // Before bindDrawerEdits() captures its dirty-state baseline, so converting old
  // tray markup does not make an untouched description look edited.
  normalizeDescInlineImages($('drawerDesc'));
  normalizeDescInlineImages($('drawerFixDesc'));
  var descBtns = $('drawerDescBtns'); if (descBtns) descBtns.style.display = 'none';
  var fixBtns = $('drawerFixDescBtns'); if (fixBtns) fixBtns.style.display = 'none';

  $('drawerStatus').value = issue.status || 'To Do';
  // Rebuilt from this issue's own space's Priority custom field — same reason
  // as Team/Product Type below: index.html's old fixed 5-option list never
  // reflected an admin's actual configured priority values for the space.
  $('drawerPriority').innerHTML = buildBuiltinSelectOptionsHtml('priority', issue.space_id, issue.priority, null);
  $('drawerPriority').value = issue.priority || 'medium';

  var spaceId = issue.space_id || S.currentSpace;
  // Always fetch fresh members from DB so newly-added members show immediately
  // Build member list: fetch fresh from DB, fall back to cached
  var freshMembers = [];
  try {
    var fetchedMembers = await api('/api/spaces/' + spaceId + '/members');
    if (fetchedMembers && fetchedMembers.length) {
      freshMembers = fetchedMembers.map(function(m) {
        return { id: m.user_id, name: m.name, email: m.email, color: m.color, avatar_url: m.avatar_url };
      });
    }
  } catch(_) {}
  if (!freshMembers.length) freshMembers = getSpaceMembers(spaceId);
  if (!freshMembers.length) freshMembers = S.data.users || [];

  // Always include current assignee + reporter + current user so they always appear
  var allUsers = S.data.users || [];
  [issue.assignee_id, issue.reporter_id, S.currentUser].forEach(function(uid) {
    if (!uid) return;
    var already = freshMembers.some(function(m) { return m.id == uid; });
    if (!already) {
      var u = allUsers.find(function(u) { return u.id == uid; });
      if (u) freshMembers.push(u);
    }
  });

  // Store for live sync repopulation
  window._drawerMembers = freshMembers;

  populateUserSelect($('drawerAssignee'), freshMembers, issue.assignee_id);
  // If no reporter set, default to current user and save to DB
  var reporterId = issue.reporter_id || S.currentUser;
  populateUserSelect($('drawerReporter'), freshMembers, reporterId);
  if (!issue.reporter_id && S.currentUser) {
    api('/api/issues/' + issue.id, 'PUT', { reporter_id: S.currentUser }).catch(function(){});
  }

  // Completed sprints aren't offered — you shouldn't be able to move a ticket
  // into a sprint that's already closed. The ticket's CURRENT sprint is kept
  // even if completed, otherwise the select would fall back to "None" and the
  // next save would silently rip the ticket out of its sprint.
  // Deliberately not getIssueFormSprints() here: that also restricts to sprints
  // the user is rostered on, which would leave most members with no options at
  // all in the drawer.
  var sprints = (S.data.sprints || []).filter(function (sp) {
    if (sp.space_id != spaceId) return false;
    if (sp.id === issue.sprint_id) return true;
    return sp.status !== 'completed';
  });
  populateSprintSelect($('drawerSprint'), sprints, issue.sprint_id);

  $('drawerPoints').value = issue.story_points != null ? issue.story_points : '';
  $('drawerStartDate').value = fmtDateISO(issue.start_date);
  $('drawerDueDate').value = fmtDateISO(issue.due_date);
  // Rebuilt from this issue's own space's custom_fields.options every render
  // -- see buildBuiltinSelectOptionsHtml -- rather than the fixed HTML option
  // list index.html used to carry, which never reflected an admin's actual
  // Team/Product Type configuration for the space.
  if ($('drawerTeam')) {
    $('drawerTeam').innerHTML = buildBuiltinSelectOptionsHtml('team', issue.space_id, issue.team, '— None —');
    $('drawerTeam').value = issue.team || '';
  }
  if ($('drawerProductType')) {
    $('drawerProductType').innerHTML = buildBuiltinSelectOptionsHtml('product_type', issue.space_id, issue.product_type, '— None —');
    $('drawerProductType').value = issue.product_type || '';
  }
  // Estimate field removed

  var totalSpent = 0;
  var worklogs = issue.worklogs || [];
  for (var w = 0; w < worklogs.length; w++) totalSpent += (worklogs[w].time_spent || 0);
  $('drawerTimeSpent').textContent = fmtMins(totalSpent);

  // Set current user avatar in comment box
  var curUser = findUser(S.currentUser);
  if (curUser) {
    $('drawerCommentAvatar').innerHTML = '';
    $('drawerCommentAvatar').style.background = curUser.color || '#6b7280';
    $('drawerCommentAvatar').textContent = initials(curUser.name);
    $('drawerCommentAvatar').style.color = '#fff';
    $('drawerCommentAvatar').style.display = 'flex';
    $('drawerCommentAvatar').style.alignItems = 'center';
    $('drawerCommentAvatar').style.justifyContent = 'center';
    $('drawerCommentAvatar').style.fontSize = '11px';
    $('drawerCommentAvatar').style.fontWeight = '700';
  }

  // Render linked issues
  renderDrawerLinks(issue);

  renderDrawerSubtasks(issue.subtasks || []);
  // Reset to "Comments" tab on open, sync data-active-tab attribute
  document.querySelectorAll('[data-activity-tab]').forEach(function(t){
    t.classList.toggle('active', t.dataset.activityTab === 'comments');
  });
  var actBody = $('activitySectionBody');
  if (actBody) actBody.dataset.activeTab = 'comments';
  renderDrawerActivity(issue);
  await ensureSpaceFieldsLoaded(issue.space_id || S.currentSpace);
  await renderDrawerCustomFields(issue.custom_field_values || [], issue.id, issue.space_id || S.currentSpace);
  await renderDrawerCombinationField(issue.id, issue.space_id || S.currentSpace, issue.custom_field_values || [], issue.product_type || '');
  applyBuiltinFieldVisibility(issue.space_id || S.currentSpace, $('issueDrawer'), 'drawer');
  renderDrawerAttachments(issue.attachments || []);

  $('drawerCreated').textContent = fmtDateTime(issue.created_at);
  $('drawerUpdated').textContent = fmtDateTime(issue.updated_at);

  bindDrawerEdits(issue);
  startDrawerLiveSync(issueId);
}

// Live sync: poll DB every 15s and update drawer if data changed
function startDrawerLiveSync(issueId) {
  stopDrawerLiveSync();
  _drawerSyncTimer = setInterval(async function () {
    // Don't overwrite while user has pending edits
    if (window._drawerPending && Object.keys(window._drawerPending).length) return;
    if (S.drawerIssueId !== issueId) return stopDrawerLiveSync();
    try {
      var fresh = await api('/api/issues/' + issueId);
      // Fetch custom field values separately if not included
      if (fresh && !fresh.custom_field_values) {
        var cfVals = await api('/api/issues/' + issueId + '/field-values');
        fresh.custom_field_values = cfVals || [];
      }
      if (!fresh) return;
      // Update right-side fields silently (only if not focused by user)
      var activeId = document.activeElement && document.activeElement.id;
      if (activeId !== 'drawerStatus')    $('drawerStatus').value    = fresh.status    || '';
      if (activeId !== 'drawerPriority') {
        $('drawerPriority').innerHTML = buildBuiltinSelectOptionsHtml('priority', fresh.space_id, fresh.priority, null);
        $('drawerPriority').value = fresh.priority || '';
      }
      if (activeId !== 'drawerAssignee') {
        // Ensure the new assignee is in the dropdown options before setting value
        var members = window._drawerMembers || [];
        if (fresh.assignee_id && !members.some(function(m){return m.id==fresh.assignee_id;})) {
          var u = (S.data.users||[]).find(function(u){return u.id==fresh.assignee_id;});
          if (u) { members.push(u); window._drawerMembers = members; populateUserSelect($('drawerAssignee'), members, fresh.assignee_id); }
        }
        $('drawerAssignee').value = fresh.assignee_id || '';
      }
      if (activeId !== 'drawerReporter') {
        var members2 = window._drawerMembers || [];
        if (fresh.reporter_id && !members2.some(function(m){return m.id==fresh.reporter_id;})) {
          var u2 = (S.data.users||[]).find(function(u){return u.id==fresh.reporter_id;});
          if (u2) { members2.push(u2); window._drawerMembers = members2; populateUserSelect($('drawerReporter'), members2, fresh.reporter_id); }
        }
        $('drawerReporter').value = fresh.reporter_id || '';
      }
      if (activeId !== 'drawerSprint')      $('drawerSprint').value      = fresh.sprint_id   || '';
      if (activeId !== 'drawerPoints')      $('drawerPoints').value      = fresh.story_points != null ? fresh.story_points : '';
      if (activeId !== 'drawerStartDate')   $('drawerStartDate').value   = fresh.start_date  ? fresh.start_date.slice(0,10) : '';
      if (activeId !== 'drawerDueDate')     $('drawerDueDate').value     = fresh.due_date    ? fresh.due_date.slice(0,10)   : '';
      if (activeId !== 'drawerTeam'        && $('drawerTeam')) {
        $('drawerTeam').innerHTML = buildBuiltinSelectOptionsHtml('team', fresh.space_id, fresh.team, '— None —');
        $('drawerTeam').value = fresh.team || '';
      }
      if (activeId !== 'drawerProductType' && $('drawerProductType')) {
        $('drawerProductType').innerHTML = buildBuiltinSelectOptionsHtml('product_type', fresh.space_id, fresh.product_type, '— None —');
        $('drawerProductType').value = fresh.product_type || '';
      }
      if (activeId !== 'drawerTitle') setDrawerTitleValue(fresh.title || '');
      // Update time tracking, attachments, activity
      // Sum from fresh.worklogs, matching the initial drawer-open computation
      // above (not fresh.time_spent, the cached column) — self-heals if that
      // column and the worklog rows ever drift apart.
      var timeSpentEl = $('drawerTimeSpent');
      if (timeSpentEl) {
        var freshWorklogs = fresh.worklogs || [];
        var freshTotalSpent = 0;
        for (var fw = 0; fw < freshWorklogs.length; fw++) freshTotalSpent += (freshWorklogs[fw].time_spent || 0);
        timeSpentEl.textContent = fmtMins(freshTotalSpent);
      }
      renderDrawerAttachments(fresh.attachments || []);
      $('drawerUpdated').textContent = fmtDateTime(fresh.updated_at);
      // Refresh custom fields silently (only if no input is focused inside them)
      var cfSection = $('drawerCustomFields');
      var cfFocused = cfSection && cfSection.contains(document.activeElement);
      var comboFocused = $('drawerCombinationField') && $('drawerCombinationField').contains(document.activeElement);
      if (!cfFocused && !comboFocused) {
        await renderDrawerCustomFields(fresh.custom_field_values || [], issueId, fresh.space_id || S.currentSpace);
        await renderDrawerCombinationField(issueId, fresh.space_id || S.currentSpace, fresh.custom_field_values || [], fresh.product_type || '');
      }
      // Refresh worklog tab if it is currently active
      var actBody = $('activitySectionBody');
      if (actBody && actBody.dataset.activeTab === 'worklog') _renderActivityTab('worklog', fresh);
      _drawerIssueData = fresh;
    } catch(_) {}
  }, 15000);
}
window.openDrawer = openDrawer;

// The autoSave closure belonging to the drawer that is open RIGHT NOW.
// Handlers bound once to persistent drawer markup (the title textarea) must call
// through this rather than capturing an autoSave, or they keep saving to the
// first ticket ever opened. See bindDrawerTitleField.
var _activeDrawerAutoSave = null;

// ── @mention autocomplete ──────────────────────────────────
// Parameterized on `el` (rather than closing over one hardcoded element) so it
// can bind to both the comment-compose box (drawerCommentInput) AND each
// dynamically-created comment EDIT box (edit-rich-<id>) -- previously this was
// wired to drawerCommentInput only, so typing "@" while editing an existing
// comment silently did nothing; there was no autocomplete listening on that
// element at all. Guarded per-element the same way the original was guarded
// per-drawer-open, since an edit box's DOM node persists (just hidden) across
// repeated Edit/Cancel clicks on the same comment without a full re-render.
function bindMentionAutocomplete(el) {
  if (!el || el._mentionBound) return;
  el._mentionBound = true;
  var dropdown = $('mentionDropdown');
  var activeMentionCharIdx = -1;

  function getMembers() {
    return window._drawerMembers || S.data.users || [];
  }

  function closeMention() {
    dropdown.style.display = 'none';
    activeMentionCharIdx = -1;
  }

  // #mentionDropdown is one shared element, sitting in the markup right after
  // drawerCommentInput. That was harmless when only drawerCommentInput ever
  // opened it, but a comment EDIT box lives elsewhere in the activity list --
  // anchoring the dropdown with a plain `top` offset (relative to whatever
  // ancestor happens to be positioned) would show it pinned near the compose
  // box instead of under whichever editor is actually active. Same fix as
  // positionComboDropdown/positionCFDropdown elsewhere in this file: switch to
  // position:fixed and place it from el's own live viewport coordinates.
  function positionMentionDropdown() {
    dropdown._activeEl = el;
    var elRect = el.getBoundingClientRect();
    // Anchor on the CARET, not el's own bottom edge. el.getBoundingClientRect()
    // covers the whole editor box -- fine for a short single-line compose box,
    // where "bottom of the box" and "bottom of the visible content" are the
    // same thing. An edit box with an embedded image (or just a few lines of
    // text) is much taller, so its bottom edge can sit far below the caret --
    // even off the bottom of the viewport entirely -- which is exactly why
    // typing "@" while editing an existing comment looked like nothing
    // happened: the dropdown WAS opening, just positioned off-screen.
    var rect = elRect;
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var caretRects = sel.getRangeAt(0).cloneRange().getClientRects();
      if (caretRects && caretRects.length) rect = caretRects[caretRects.length - 1];
    }
    dropdown.style.position = 'fixed';
    dropdown.style.left = elRect.left + 'px';
    dropdown.style.width = elRect.width + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.right = 'auto';
  }

  // Keeps the dropdown glued to el while its scroll container moves (the
  // activity list, a modal body, etc.) -- position:fixed coordinates are only
  // ever right at the instant they're set otherwise. dropdown._activeEl guards
  // this so only the element that's actually open right now repositions it;
  // this listener is added once per el thanks to the _mentionBound guard above.
  document.addEventListener('scroll', function () {
    if (dropdown._activeEl === el && dropdown.style.display !== 'none') positionMentionDropdown();
  }, { passive: true, capture: true });

  // Returns all text before the caret inside a contenteditable element
  function getTextBeforeCaret(node) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return '';
    var r = sel.getRangeAt(0).cloneRange();
    r.selectNodeContents(node);
    r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return r.toString();
  }

  function insertMentionAtCaret(name, userId) {
    // e.preventDefault() on mousedown keeps focus so caret is still valid
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    var caretRange = sel.getRangeAt(0);
    var endNode = caretRange.endContainer;
    var endOffset = caretRange.endOffset;

    // Find the @ in the current text node (most common case)
    var atPos = -1;
    var atNode = null;
    if (endNode.nodeType === 3) {
      var textUpToCaret = endNode.textContent.substring(0, endOffset);
      var idx = textUpToCaret.lastIndexOf('@');
      if (idx !== -1) {
        atPos = idx;
        atNode = endNode;
      }
    }

    // If @ wasn't found in the same text node, walk backwards
    if (atNode === null) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      // build full text before caret
      var fullText = getTextBeforeCaret(el);
      var atIdx2 = activeMentionCharIdx;
      if (atIdx2 < 0) {
        var active = findActiveMentionAt(fullText);
        if (!active) return;
        atIdx2 = active.atIdx;
      }
      // count chars to find the node containing @
      var charCount = 0;
      for (var ni = 0; ni < nodes.length; ni++) {
        var nodeLen = nodes[ni] === endNode ? endOffset : nodes[ni].textContent.length;
        if (charCount + nodeLen > atIdx2) {
          atNode = nodes[ni];
          atPos = atIdx2 - charCount;
          break;
        }
        charCount += nodeLen;
      }
    }

    if (!atNode) return;

    // Select from @ to current caret position and delete it
    var delRange = document.createRange();
    delRange.setStart(atNode, atPos);
    if (atNode === endNode) {
      delRange.setEnd(endNode, endOffset);
    } else {
      delRange.setEnd(endNode, endOffset);
    }
    sel.removeAllRanges();
    sel.addRange(delRange);
    document.execCommand('delete', false, null);

    // Insert mention chip + non-breaking space
    var chip = '<span class="mention-chip" data-user-id="' + (userId || '') + '" contenteditable="false">@' + esc(name) + '</span> ';
    document.execCommand('insertHTML', false, chip);
  }

  function showMention(query) {
    var members = getMembers().filter(function(m) {
      return !query || m.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
    });
    if (!members.length) { closeMention(); return; }

    positionMentionDropdown();
    dropdown.style.display = 'block';
    dropdown.innerHTML = members.map(function(m) {
      return '<div class="mention-item" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;"' +
        'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'">' +
        '<div style="width:26px;height:26px;border-radius:50%;background:' + (m.color || '#6b7280') + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">' +
        initials(m.name) + '</div>' +
        '<div><div style="font-size:13px;font-weight:600">' + esc(m.name) + '</div>' +
        (m.email ? '<div style="font-size:11px;color:var(--text2)">' + esc(m.email) + '</div>' : '') +
        '</div></div>';
    }).join('');

    dropdown.querySelectorAll('.mention-item').forEach(function(item) {
      item.addEventListener('mousedown', function(e) {
        e.preventDefault(); // keeps focus in el so selection is intact
        var name = item.dataset.name;
        var id = item.dataset.id;
        if (el.contentEditable === 'true') {
          insertMentionAtCaret(name, id);
        } else {
          var val = el.value;
          var before = val.substring(0, activeMentionCharIdx);
          var after = val.substring(el.selectionStart);
          el.value = before + '@' + name + ' ' + after;
          var pos = activeMentionCharIdx + name.length + 2;
          el.setSelectionRange(pos, pos);
          el.focus();
        }
        closeMention();
        activeMentionCharIdx = -1;
      });
    });
  }

  el.addEventListener('input', function() {
    var isContentEditable = el.contentEditable === 'true';
    var textBefore;
    if (isContentEditable) {
      textBefore = getTextBeforeCaret(el);
    } else {
      textBefore = el.value.substring(0, el.selectionStart);
    }
    var active = findActiveMentionAt(textBefore);
    if (!active) { closeMention(); return; }
    activeMentionCharIdx = active.atIdx;
    showMention(active.query);
  });

  el.addEventListener('keydown', function(e) {
    if (dropdown.style.display === 'none') return;
    var items = dropdown.querySelectorAll('.mention-item');
    var active = dropdown.querySelector('.mention-item.focused');
    var idx = Array.prototype.indexOf.call(items, active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('focused');
      var next = items[idx + 1] || items[0];
      next.classList.add('focused');
      next.style.background = 'var(--bg3)';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('focused');
      var prev = items[idx - 1] || items[items.length - 1];
      prev.classList.add('focused');
      prev.style.background = 'var(--bg3)';
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.click();
    } else if (e.key === 'Escape') {
      closeMention();
    }
  });

  // Guarded per-element for the same reason as the handlers above.
  if (!el._mentionOutsideBound) {
    el._mentionOutsideBound = true;
    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== el) closeMention();
    });
  }
}

// A comment EDIT box (edit-rich-<id>) had no image-paste handling at all --
// unlike the compose box's own _commentFiles flow, or the description
// editors' document-level delegated listener (which only covers the static
// DESC_EDITOR_IDS list, not a dynamically-created id like this one). Pasting
// a screenshot there fell through to the browser's raw default paste,
// inserting an unbounded base64 data: URI directly into the comment body
// instead of uploading it. Routes through the exact same handleDescImagePaste
// the description fields use -- it already uploads via /api/comments/upload,
// which comments and descriptions share.
function bindCommentEditImagePaste(el) {
  if (!el || el._commentEditPasteBound) return;
  el._commentEditPasteBound = true;
  el.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items || !items.length) return;
    var imageFiles = _dedupePasteFiles(items).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
    if (!imageFiles.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (el._pasteBusy) return;
    el._pasteBusy = true;
    handleDescImagePaste(el, imageFiles[0], 'comment').finally(function () {
      setTimeout(function () { el._pasteBusy = false; }, 500);
    });
  });
}

function bindDrawerEdits(issue) {
  var issueId = issue.id;
  var pending = {};
  var _saveTimer = null;

  function autoSave(field, value) {
    pending[field] = value;
    window._drawerPending = pending;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async function () {
      if (!Object.keys(pending).length) return;
      var toSave = Object.assign({}, pending);
      try {
        await api('/api/issues/' + issueId, 'PUT', toSave);
        Object.keys(toSave).forEach(function(k) { delete pending[k]; });
        window._drawerPending = pending;
        var updated = await api('/api/issues/' + issueId);
        if (updated) {
          $('drawerUpdated').textContent = fmtDateTime(updated.updated_at);
          var patch = Object.assign({}, toSave);
          if (updated.updated_at) patch.updated_at = updated.updated_at;
          afterIssueFieldUpdate(issueId, patch);
        }
        refreshData();
        toast('Saved');
      } catch(e) { toast('Save failed', 'error'); }
    }, 800);
  }
  // Point the once-bound handlers at THIS drawer's save.
  _activeDrawerAutoSave = autoSave;

  async function saveFieldNow(field, value) {
    try {
      var payload = {};
      payload[field] = value;
      await api('/api/issues/' + issueId, 'PUT', payload);
      var updated = await api('/api/issues/' + issueId);
      if (updated) {
        $('drawerUpdated').textContent = fmtDateTime(updated.updated_at);
        var patch = Object.assign({}, payload);
        if (updated.updated_at) patch.updated_at = updated.updated_at;
        afterIssueFieldUpdate(issueId, patch);
        if (window._drawerIssueData) window._drawerIssueData[field] = value;
      }
      refreshData();
      toast('Saved');
    } catch (e) {
      toast('Save failed', 'error');
      throw e;
    }
  }


  var _drawerStatusPrevious = issue.status || 'To Do';
  $('drawerStatus').onchange = function () {
    var newStatus = $('drawerStatus').value;
    if (newStatus === 'Done' && !canTransitionIssueToDone(issueId, _drawerStatusPrevious)) return;
    autoSave('status', newStatus);
    updateStatusBtn(newStatus);
    _drawerStatusPrevious = newStatus;
    if (window._drawerIssueData) window._drawerIssueData.status = newStatus;
  };
  updateStatusBtn($('drawerStatus').value);
  $('drawerPriority').onchange  = function () { autoSave('priority',     $('drawerPriority').value); };
  $('drawerAssignee').onchange  = function () { autoSave('assignee_id',  $('drawerAssignee').value || null); };
  $('drawerReporter').onchange  = function () { autoSave('reporter_id',  $('drawerReporter').value || null); };
  // ── Clickable type badge dropdown (Jira-like) ──
  var typeEl = $('drawerType');
  if (typeEl) {
    typeEl.style.cursor = 'pointer';
    typeEl.onclick = function(e) {
      e.stopPropagation();
      var old = document.getElementById('_typeMenu');
      if (old) { old.remove(); return; }
      // This issue's own space's configured Type list, not the fixed 5 --
      // an admin-added type was previously unreachable from this picker.
      var types = getIssueTypeOptionsForSpace(issue.space_id).map(function (o) { return o.v; });
      var rect = typeEl.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = '_typeMenu';
      menu.style.cssText = 'position:fixed;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px;background:#fff;border:1px solid #dfe1e6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:9999;min-width:160px;padding:4px;';
      types.forEach(function(t) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:13px;border-radius:4px;display:flex;align-items:center;gap:8px;';
        // Use the shared TYPE_ICONS set rather than a local emoji list, so this
        // menu can't drift from the icons shown on boards, tables and drawers.
        item.innerHTML = '<span style="display:inline-flex;align-items:center">'+ typeIcon(t) +'</span><span>'+esc(cap(t))+'</span>';
        item.onmouseover = function(){ this.style.background='#f4f5f7'; };
        item.onmouseout = function(){ this.style.background='';};
        item.onclick = function(){
          menu.remove();
          typeEl.textContent = cap(t);
          applyTypeBadgeStyle(typeEl, t);
          autoSave('type',t);
        };
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      setTimeout(function(){
        document.addEventListener('click',function h(ev){ if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',h);} });
      },100);
    };
  }
  $('drawerSprint').onchange = function () {
    var sprintId = $('drawerSprint').value;
    autoSave('sprint_id', sprintId || null);
    // Moving a ticket into a sprint adopts that sprint's dates — whether it came
    // from the backlog or from another sprint. This replaces the old behaviour of
    // only clearing a due date that overshot the sprint end, which left the start
    // date pointing at the previous sprint.
    // Clearing the sprint (→ backlog) leaves the dates alone: there are no sprint
    // dates to copy, and wiping them would lose information.
    var plan = sprintDateChanges(sprintId, $('drawerStartDate').value, $('drawerDueDate').value);
    if (!plan.sprint) return;
    plan.changes.forEach(function (ch) {
      $(ch.field === 'start_date' ? 'drawerStartDate' : 'drawerDueDate').value = ch.value;
      autoSave(ch.field, ch.value);
    });
    if (plan.changes.length) {
      toast('Dates set from ' + (plan.sprint.name || 'sprint') + ': ' +
        plan.changes.map(function (c) { return c.label; }).join(', '));
    } else if (!plan.start && !plan.end) {
      toast((plan.sprint.name || 'That sprint') + ' has no dates set, so the ticket dates were left as they are.', 'warning');
    }
  };
  $('drawerPoints').oninput     = function () {
    autoSave('story_points', $('drawerPoints').value ? parseInt($('drawerPoints').value, 10) : null);
  };
  if ($('drawerTeam')) {
    $('drawerTeam').onchange = function () {
      autoSave('team', $('drawerTeam').value || null);
      if (window._drawerIssueData) {
        renderDrawerProductTypeSets(
          window._drawerIssueData.id,
          window._drawerIssueData.space_id || S.currentSpace,
          window._drawerIssueData.custom_field_values || [],
          window._drawerIssueData.product_type || ''
        );
      }
    };
  }
  if ($('drawerProductType')) {
    $('drawerProductType').onchange = function () {
      var dSpace = (_drawerIssueData && _drawerIssueData.space_id) || S.currentSpace;
      // Skip only when the combined picker owns this field for this space — it
      // saves product_type together with the combination. Was gated on
      // "is Product_Team", which meant a Product_Team space WITHOUT a combination
      // field could never save a product type, and any other space with one
      // would have saved it twice.
      if (productTypeMode(dSpace, 'drawer') === 'combo') return;
      autoSave('product_type', $('drawerProductType').value || null);
    };
  }
  $('drawerStartDate').onchange = function () {
    var val = $('drawerStartDate').value;
    autoSave('start_date', val || null);
  };
  $('drawerDueDate').onchange = function () {
    var val = $('drawerDueDate').value;
    if (val) {
      var sprintId = $('drawerSprint').value;
      if (sprintId) {
        var sprint = (S.data.sprints || []).find(function(sp){ return sp.id === sprintId; });
        if (sprint && sprint.end_date) {
          var sprintEnd = new Date(sprint.end_date.slice(0,10) + 'T00:00:00');
          var picked    = new Date(val + 'T00:00:00');
          if (picked > sprintEnd) {
            toast('Due date cannot exceed sprint end date (' + sprint.end_date.slice(0,10) + ')', 'error');
            $('drawerDueDate').value = '';
            return;
          }
        }
      }
    }
    autoSave('due_date', val || null);
  };

  bindDrawerTitleField();

  var _drawerDescOriginal = $('drawerDesc') ? $('drawerDesc').innerHTML : (issue.description || '');
  window._drawerDescOriginalHtml = _drawerDescOriginal;
  attachScopedUndo($('drawerDesc'));
  // Deliberately NOT re-snapshotting _drawerDescOriginal here — it's already
  // the correct pre-edit baseline (set once above, then again only after a
  // successful save). Re-capturing "current == current" on every focus meant
  // that clicking away mid-edit (e.g. to review) and clicking back in before
  // hitting Save silently rebaselined to the ALREADY-EDITED text, disabling
  // Save with no error and no visible cause — reported as "editing the
  // description doesn't save".
  $('drawerDesc').onfocus = function() {
    updateDrawerDescEditorState('drawerDesc', _drawerDescOriginal);
  };

  // Open links inside contenteditable description.
  // Bound ONCE per element, like the paste handler below: #drawerDesc is static
  // markup and bindDrawerEdits() runs on every drawer open, so an unguarded
  // addEventListener stacked another pair each time — after opening N issues, a
  // click on a description link fired window.open N times and spawned N tabs.
  (function () {
    var descEl = $('drawerDesc');
    if (!descEl || descEl._linkOpenBound) return;
    descEl._linkOpenBound = true;
    var openLink = function (e) {
      var a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); e.stopPropagation(); window.open(a.href, '_blank', 'noopener'); }
    };
    descEl.addEventListener('mousedown', openLink);
    descEl.addEventListener('click', openLink);
  })();
  var drawerDescSaveBtn = $('drawerDescSave');
  var drawerDescCancelBtn = $('drawerDescCancel');
  if(drawerDescSaveBtn) drawerDescSaveBtn.onclick = async function(e) {
    e.preventDefault(); e.stopPropagation();
    var descEl = $('drawerDesc');
    if (!richTextHasMeaningfulChange(_drawerDescOriginal, descEl.innerHTML)) return;
    drawerDescSaveBtn.disabled = true;
    drawerDescSaveBtn.textContent = 'Saving...';
    try {
      var imgs = descEl.querySelectorAll('img[src^="data:"],img[src^="blob:"]');
      for (var i = 0; i < imgs.length; i++) {
        try {
          var resp = await fetch(imgs[i].src);
          var blob = await resp.blob();
          var fd = new FormData();
          fd.append('files', blob, 'desc-img-' + Date.now() + '.png');
          var up = await fetch('/api/upload-temp', { method:'POST', headers:{'Authorization':'Bearer '+getAuthToken()}, body:fd });
          var upJson = await up.json();
          if (upJson && upJson.files && upJson.files[0]) imgs[i].src = upJson.files[0].url;
        } catch(ex) { console.error('img upload failed', ex); }
      }
      // descEl.innerHTML still carries the LIVE session token baked into every
      // desc-inline-img src (fileApiUrl() puts it there so the image is visible
      // while editing) — stripping it here mirrors getDescriptionHtmlForSave(),
      // which the Create Issue path already uses. Without this, the stored
      // description keeps today's token forever; augmentFileUrlsInHtml() then
      // appends a SECOND ?t=... on every later render (its regex stops at the
      // first "?", so it can't tell the URL already has one), producing a
      // malformed src that always 401s — the exact "screenshot goes broken
      // after saving" bug, and re-pasting the same image then reports it as
      // already attached because the broken <img> is still sitting in the DOM.
      await saveFieldNow('description', stripFileAuthTokensFromHtml(descEl.innerHTML.trim()));
      _drawerDescOriginal = descEl.innerHTML;
      window._drawerDescOriginalHtml = _drawerDescOriginal;
      var b = $('drawerDescBtns'); if(b) b.style.display='none';
    } finally {
      drawerDescSaveBtn.disabled = false;
      drawerDescSaveBtn.textContent = 'Save';
      drawerDescSaveBtn.style.opacity = '1';
      drawerDescSaveBtn.style.cursor = 'pointer';
    }
  };
  if(drawerDescCancelBtn) drawerDescCancelBtn.onclick = function() {
    $('drawerDesc').innerHTML = _drawerDescOriginal;
    window._drawerDescOriginalHtml = _drawerDescOriginal;
    var b = $('drawerDescBtns'); if(b) b.style.display='none';
  };
  $('drawerDesc').oninput = function () {
    updateDrawerDescEditorState('drawerDesc', _drawerDescOriginal);
  };
  var _drawerFixDescOriginal = $('drawerFixDesc') ? $('drawerFixDesc').innerHTML : (issue.fix_description || '');
  window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
  attachScopedUndo($('drawerFixDesc'));
  // Same fix as drawerDesc above — don't rebaseline the "original" snapshot
  // on every focus, only on drawer-open and after a successful save.
  $('drawerFixDesc').onfocus = function() {
    updateDrawerDescEditorState('drawerFixDesc', _drawerFixDescOriginal);
  };
  var fixSaveBtn = $('drawerFixDescSave');
  var fixCancelBtn = $('drawerFixDescCancel');
  if(fixSaveBtn) fixSaveBtn.onclick = async function(e) {
    e.preventDefault(); e.stopPropagation();
    var fixEl = $('drawerFixDesc');
    if (!richTextHasMeaningfulChange(_drawerFixDescOriginal, fixEl.innerHTML)) return;
    fixSaveBtn.disabled = true;
    fixSaveBtn.textContent = 'Saving...';
    try {
      // Same token-stripping fix as the description save above.
      await saveFieldNow('fix_description', stripFileAuthTokensFromHtml(fixEl.innerHTML.trim()));
      _drawerFixDescOriginal = fixEl.innerHTML;
      window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
      var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
    } finally {
      fixSaveBtn.disabled = false;
      fixSaveBtn.textContent = 'Save';
      fixSaveBtn.style.opacity = '1';
      fixSaveBtn.style.cursor = 'pointer';
    }
  };
  if(fixCancelBtn) fixCancelBtn.onclick = function() {
    $('drawerFixDesc').innerHTML = _drawerFixDescOriginal;
    window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
    var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
  };
  $('drawerFixDesc').oninput = function () {
    updateDrawerDescEditorState('drawerFixDesc', _drawerFixDescOriginal);
  };

  // Expose pending to the global save handler (fallback)
  window._drawerPending = pending;

  bindMentionAutocomplete($('drawerCommentInput'));
  attachScopedUndo($('drawerCommentInput'));

  // Paste image support for comment box — bind ONCE per drawer element, not per click.
  // (Previously this was registered inside the onclick handler below, so every
  // "Comment" click added another listener; a later paste would then fire all of
  // them and push the same image into _commentFiles multiple times, producing
  // duplicate uploaded images and eventually failing once the server's file-count
  // limit was exceeded.)
  (function () {
    var _commentPasteEl = $('drawerCommentInput');
    if (!_commentPasteEl || _commentPasteEl._pasteBound) return;
    _commentPasteEl._pasteBound = true;
    _commentPasteEl.addEventListener('paste', function(e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var file = items[i].getAsFile();
          if (!file) continue;
          _commentFiles.push(file);
          _renderCommentFileList();
          toast('Image pasted — click Comment to post');
          break;
        }
      }
    });
  })();

  $('drawerCommentSubmit').onclick = async function () {
    var _ci = $('drawerCommentInput');
    var body;
    // Whether this comment's body is rich HTML (real <b>/<ul> from the
    // toolbar) or plain text -- decides which shape file-attachment refs get
    // appended in below, since bodyHtml()'s render function only expands
    // [img:...]/[file:...] bracket markup in its PLAIN-TEXT branch; appending
    // that bracket syntax onto an HTML body would show as literal text.
    var bodyIsRich = !!(_ci && _ci.value === undefined);
    if (!_ci) { body = ''; }
    else if (!bodyIsRich) {
      body = _ci.value.trim();
    } else {
      // contenteditable: convert mention chips to plain @Name text, keep the
      // rest of the markup as-is -- this used to flatten to .textContent,
      // which is what silently discarded every bold/bullet-list the toolbar
      // had just produced.
      var _clone = _ci.cloneNode(true);
      _clone.querySelectorAll('.mention-chip').forEach(function(chip) {
        chip.replaceWith('@' + chip.textContent.replace(/^@/, ''));
      });
      body = _clone.innerHTML.trim();
      if (body === '<br>') body = '';
    }
    var commentBody = body;
    if (!body && !_commentFiles.length) return;
    // Disable button to prevent duplicate submissions
    var submitBtn = $('drawerCommentSubmit');
    if (submitBtn._submitting) return;
    submitBtn._submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';
    var commentBody = body;

    // Upload attached files to comment-specific endpoint. On failure the files
    // are kept in _commentFiles (not cleared) so the user can just hit Comment
    // again instead of re-picking or re-pasting them — and the button is reset
    // and the whole submit is aborted here, rather than falling through to post
    // a comment silently missing the attachment the user thought was included
    // (or, for an image-only comment, posting nothing at all).
    if (_commentFiles.length) {
      var fd = new FormData();
      fd.append('issue_id', issueId);
      _commentFiles.forEach(function(f) { fd.append('files', f); });
      var uploadFailed = false;
      try {
        toast('Uploading attachment…');
        var uploadRes = await fetch('/api/comments/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
        var uploadData = await uploadRes.json().catch(function () { return {}; });
        if (!uploadRes.ok) {
          toast(uploadData.error || 'Attachment upload failed', 'error');
          uploadFailed = true;
        } else if (uploadData.files && uploadData.files.length) {
          if (bodyIsRich) {
            // Real tags, not [img:...]/[file:...] bracket markup -- bodyHtml()'s
            // render function only expands that bracket syntax in its plain-text
            // branch, so appending it onto an HTML body would show as literal
            // text. fileApiUrl()'s token gets stripped before saving below (same
            // as the rest of this body), then re-added fresh on every render by
            // augmentFileUrlsInHtml -- same convention _saveComment already uses.
            var fileRefsHtml = uploadData.files.map(function(f) {
              var isImg = f.type && f.type.startsWith('image/');
              var url = fileApiUrl(f.url);
              return isImg
                ? '<div style="margin-top:8px"><img class="desc-inline-img" src="' + esc(url) + '" alt="' + esc(f.name) + '"></div>'
                : '<div style="margin-top:6px"><a href="' + esc(url) + '" target="_blank">' + esc(f.name) + '</a></div>';
            }).join('');
            commentBody = commentBody + fileRefsHtml;
          } else {
            var fileRefs = uploadData.files.map(function(f) {
              var isImg = f.type && f.type.startsWith('image/');
              return (isImg ? '[img:' : '[file:') + f.name + '|' + f.url + ']';
            }).join('\n');
            commentBody = commentBody ? commentBody + '\n' + fileRefs : fileRefs;
          }
        }
      } catch(e) {
        toast(friendlyFetchErrorMessage(e, 'Attachment upload failed'), 'error');
        uploadFailed = true;
      }
      if (uploadFailed) {
        submitBtn._submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
        return;
      }
      _commentFiles = [];
      _renderCommentFileList();
    }
    // Strip the live session token the image ref above just embedded -- it's
    // only good for today; augmentFileUrlsInHtml adds a fresh one on every
    // future render instead. Same rule as description/fix-description saves.
    if (bodyIsRich) commentBody = stripFileAuthTokensFromHtml(commentBody);

    if (commentBody) {
      var mentionedUserIds = collectMentionUserIds(_ci, commentBody);
      // Optimistic UI - show comment instantly before API response
      var me = S.currentUserObj || {};
      var tempComment = {
        id: 'temp-' + Date.now(),
        user_id: S.currentUser,
        body: commentBody,
        created_at: new Date().toISOString(),
        user_name: me.name || '',
        user_color: me.color || '#666',
        user_avatar_url: me.avatar_url || null
      };
      if (_drawerIssueData) {
        _drawerIssueData.comments = (_drawerIssueData.comments || []).concat([tempComment]);
        renderDrawerActivity(_drawerIssueData);
      }
      var _ci2 = $('drawerCommentInput'); if (_ci2) { if (_ci2.value !== undefined) _ci2.value = ''; else _ci2.innerHTML = ''; }
      // Post the real comment — button stays disabled until this actually finishes,
      // so a fast repeat click can't slip through while the first request is in flight.
      await api('/api/comments', 'POST', {
        issue_id: issueId,
        user_id: S.currentUser,
        body: commentBody,
        mentioned_user_ids: mentionedUserIds
      });
    } else {
      var _ci3 = $('drawerCommentInput'); if (_ci3) { if (_ci3.value !== undefined) _ci3.value = ''; else _ci3.innerHTML = ''; }
    }
    submitBtn._submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Comment';
    // Refresh in background to get real comment ID
    api('/api/issues/' + issueId).then(function(updated) {
      if (updated) {
        _drawerIssueData = updated;
        renderDrawerActivity(updated);
      }
    });
    if (commentBody) toast('Comment added');
  };

  $('drawerLogTimeBtn').onclick = function () {
    $('worklogIssueId').value = issueId;
    $('worklogDate').value = fmtDateISO(new Date());
    $('worklogHours').value = 0;
    $('worklogMinutes').value = 0;
    $('worklogDesc').value = '';
    $('worklogBillable').checked = true;
    openModal('modal-worklog');
  };

  // Delete ticket — a direct control rather than a ⋯ menu. The button is only
  // rendered for someone the API would actually let through (canDeleteIssue ->
  // space admin or org admin), so nobody is offered an action that then fails.
  // This replaces a dropdown whose handler was gated on an `isOwner` variable
  // that was never declared: the ReferenceError killed the handler mid-run, so
  // the item bound no click AND the outside-click listener below it never
  // registered — the menu was inert and would not dismiss.
  var deleteBtn = $('drawerDeleteBtn');
  if (deleteBtn) {
    deleteBtn.style.display = canDeleteIssue(issue.space_id) ? '' : 'none';
    deleteBtn.onclick = async function (e) {
      e.stopPropagation();
      // Re-checked at click time, not just at render: the drawer stays open
      // across a refreshData(), so the role behind it can change underneath.
      if (!canDeleteIssue(issue.space_id)) {
        toast('Only a space admin can delete tickets. Ask a space admin or an org admin.', 'error');
        return;
      }
      var key = issueKeyStr(issue) || issueId;
      var ok = await typedConfirmDialog({
        title: 'Delete ' + key + '?',
        intro: issue.title || '',
        note: softDeleteNote(),
        phrase: key,
        phraseHint: 'To confirm, type the ticket number',
        confirmLabel: 'Delete ticket'
      });
      if (!ok) return;
      try {
        await api('/api/issues/' + issueId, 'DELETE');
        toast(key + ' moved to Deleted Items', 'success');
        var drawer = document.getElementById('issueDrawer');
        if (drawer) drawer.setAttribute('hidden', '');
        S.drawerIssueId = null;
        window.history.replaceState({}, '', '/');
        await refreshData();
        renderCurrentView();
      } catch (err) {
        toast(err.message || 'Failed to delete ticket', 'error');
      }
    };
  }
}

function renderDrawerSubtasks(subtasks) {
  var c = $('drawerSubtasks');
  var html = '';
  if (subtasks && subtasks.length) {
    // Progress bar
    var done = subtasks.filter(function(s){ return s.status === 'Done'; }).length;
    var pct = Math.round(done / subtasks.length * 100);
    html += '<div class="subtask-progress" style="margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:3px">' +
      '<span>' + done + ' of ' + subtasks.length + ' done</span><span>' + pct + '%</span></div>' +
      '<div style="height:4px;background:var(--bg4);border-radius:2px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--success);border-radius:2px;transition:width .3s"></div></div></div>';
    for (var i = 0; i < subtasks.length; i++) {
      var st = subtasks[i];
      var isDone = st.status === 'Done';
      html += '<div class="subtask-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;border-bottom:1px solid var(--border)" ' +
        'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'">' +
        '<span class="subtask-key" style="font-size:11px;font-weight:700;color:var(--accent);min-width:48px;cursor:pointer" onclick="event.stopPropagation();openIssuePage(\'' + st.id + '\')">' + esc(st.key || '') + '</span>' +
        '<span style="flex:1;font-size:13px;' + (isDone ? 'text-decoration:line-through;color:var(--text3)' : '') + '" onclick="openIssuePage(\'' + st.id + '\')">' + esc(st.title) + '</span>' +
        statusBadge(st.status, true) +
        '</div>';
    }
  } else {
    html += '<p class="text-muted text-sm" style="margin-bottom:4px">No subtasks yet</p>';
  }
  // Inline create form
  html += '<div id="subtaskCreateArea" style="margin-top:8px">' +
    '<button class="btn btn-outline btn-sm" id="subtaskAddBtn" onclick="window._showSubtaskInput()" style="gap:4px">\uD83D\uDCCC + Add subtask</button>' +
    '<div id="subtaskInputRow" style="display:none;gap:8px;align-items:center;margin-top:6px">' +
    '<input type="text" id="subtaskTitleInput" placeholder="What needs to be done?" class="input" style="flex:1;font-size:12px;padding:6px 8px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window._submitSubtask()}">' +
    '<button class="btn btn-primary btn-sm" onclick="window._submitSubtask()">Create</button>' +
    '<button class="btn btn-outline btn-sm" onclick="window._hideSubtaskInput()">Cancel</button>' +
    '</div></div>';
  c.innerHTML = html;
}

window._showSubtaskInput = function() {
  // Open full Create Issue modal pre-configured as subtask linked to parent
  var parentId = S.drawerIssueId;
  var parentIssue = parentId && S.data.issues && S.data.issues.find(function(i){ return i.id === parentId; });
  var spaceId = parentIssue ? parentIssue.space_id : S.currentSpace;

  resetIssueForm();
  $('issueSpaceId').value = spaceId;
  $('issueParentId').value = parentId || '';
  $('issueType').value = 'subtask';
  $('issuePriority').value = 'medium';
  $('issueModalTitle').textContent = 'Create Subtask' + (parentIssue ? ' — linked to ' + (parentIssue.key || parentIssue.id) : '');
  var parentSprintId = parentIssue && parentIssue.sprint_id;
  populateIssueFormSelects({ includeSprintId: parentSprintId });
  if (window._onIssueSpaceChange) window._onIssueSpaceChange(spaceId || '', parentSprintId);
  // Pre-fill sprint and assignee from parent
  if (parentIssue) {
    if (parentSprintId) {
      $('issueSprint').value = parentSprintId;
      applySprintDatesToIssueForm(parentSprintId);
    }
    if (parentIssue.assignee_id) $('issueAssignee').value = parentIssue.assignee_id;
  }
  openModal('modal-issue');
};

window._hideSubtaskInput = function() {
  $('subtaskAddBtn').style.display = '';
  $('subtaskInputRow').style.display = 'none';
  $('subtaskTitleInput').value = '';
};

window._submitSubtask = async function() {
  var title = $('subtaskTitleInput').value.trim();
  if (!title) return;
  var parentId = S.drawerIssueId;
  var parentIssue = S.data.issues.find(function(i){ return i.id === parentId; });
  var spaceId = parentIssue ? parentIssue.space_id : S.currentSpace;
  try {
    await api('/api/issues', 'POST', {
      space_id: spaceId,
      parent_id: parentId,
      sprint_id: parentIssue ? parentIssue.sprint_id : null,
      title: title,
      type: 'subtask',
      priority: 'medium',
      reporter_id: S.currentUser,
      assignee_id: parentIssue ? parentIssue.assignee_id : null,
      start_date: fmtDateISO(new Date()),
      status: 'To Do'
    });
    toast('Subtask created');
    $('subtaskTitleInput').value = '';
    // Refresh drawer
    var issue = await api('/api/issues/' + parentId);
    renderDrawerSubtasks(issue.subtasks || []);
    await refreshData();
  } catch(e) { toast(e.message, 'error'); }
};

// ═══════════════════════════════════════════════════════════
// LINKED ITEMS (Jira-style)
// ═══════════════════════════════════════════════════════════
// `selectable: false` = still rendered and removable for rows that already
// exist, but not offered for new links. Issue hierarchy lives on
// issues.parent_id (the Subtasks panel); a parallel is_child_of link was a
// second, unsynchronised source of truth — such a "child" never showed under
// Subtasks, never blocked the parent from going Done and never rolled up in
// reports. Keep in sync with LINK_TYPE_INVERSE in server.js.
var LINK_TYPES = [
  { value: 'blocks', label: 'blocks', inverse: 'is blocked by' },
  { value: 'is_blocked_by', label: 'is blocked by', inverse: 'blocks' },
  { value: 'clones', label: 'clones', inverse: 'is cloned by' },
  { value: 'is_cloned_by', label: 'is cloned by', inverse: 'clones' },
  { value: 'duplicates', label: 'duplicates', inverse: 'is duplicated by' },
  { value: 'is_duplicated_by', label: 'is duplicated by', inverse: 'duplicates' },
  { value: 'relates_to', label: 'relates to', inverse: 'relates to' },
  { value: 'is_child_of', label: 'is child of', inverse: 'is parent of', selectable: false },
  { value: 'is_parent_of', label: 'is parent of', inverse: 'is child of', selectable: false },
];

function linkTypeLabel(type) {
  var found = LINK_TYPES.find(function(t){ return t.value === type; });
  return found ? found.label : String(type || '').replace(/_/g, ' ');
}

// space_id of the issue whose drawer is open — links are space-local
var _linkDialogSpaceId = null;

function copyTextToClipboard(text) {
  var fallback = function () {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    toast('Link copied', 'success');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function () { toast('Link copied', 'success'); })
      .catch(fallback);
  } else {
    fallback();
  }
}

// Accept issue key, full URL, or partial URL (?issue=KEY) — same format as copy link
function parseIssueLinkReference(input) {
  if (!input) return '';
  var s = String(input).trim();
  if (!s) return '';
  var qMatch = s.match(/[?&]issue=([^&#\s]+)/i);
  if (qMatch) {
    try { return decodeURIComponent(qMatch[1]).trim(); } catch (_) { return qMatch[1].trim(); }
  }
  try {
    if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') {
      var u = new URL(s, window.location.origin);
      var q = u.searchParams.get('issue');
      if (q) return q.trim();
    }
  } catch (_) {}
  return s;
}

function renderLinkSearchResults(matches) {
  var results = $('linkSearchResults');
  if (!results) return;
  if (!matches.length) {
    results.innerHTML = '<p class="text-muted text-xs" style="padding:6px 4px">No matching issues found</p>';
    return;
  }
  // Identity travels in data-* attributes and the handler is attached in JS.
  // Interpolating the title into an inline onclick meant any title containing
  // a double quote terminated the attribute and broke the row.
  var html = '';
  for (var mi = 0; mi < matches.length; mi++) {
    var m = matches[mi];
    html += '<div class="link-search-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:12px" ' +
      'data-link-pick-id="' + escAttr(m.id) + '" data-link-pick-key="' + escAttr(m.key) + '" data-link-pick-title="' + escAttr(m.title) + '">' +
      '<span style="font-size:11px">' + typeIcon(m.type) + '</span>' +
      '<span style="font-weight:700;color:var(--accent);min-width:48px">' + esc(m.key) + '</span>' +
      '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.title) + '</span>' +
      statusBadge(m.status, true) +
      '</div>';
  }
  results.innerHTML = html;

  results.querySelectorAll('[data-link-pick-id]').forEach(function (row) {
    row.addEventListener('mouseenter', function () { row.style.background = 'var(--bg4)'; });
    row.addEventListener('mouseleave', function () { row.style.background = ''; });
    row.addEventListener('click', function () {
      window._selectLinkIssue(row.dataset.linkPickId, row.dataset.linkPickKey, row.dataset.linkPickTitle);
    });
  });
}

function renderDrawerLinks(issue) {
  var c = $('drawerLinks');
  var links = issue.links || [];
  var html = '';
  // The server only allows links within one space, so remember which space the
  // open issue belongs to and offer nothing else in the picker.
  _linkDialogSpaceId = issue.space_id || null;

  if (links.length) {
    // Group by link type
    var grouped = {};
    for (var li = 0; li < links.length; li++) {
      var lnk = links[li];
      var lt = lnk.link_type || 'relates_to';
      // Determine if this issue is source or target to show correct direction
      var isSource = lnk.source_id === issue.id;
      var displayType = isSource ? linkTypeLabel(lt) : (LINK_TYPES.find(function(t){ return t.value === lt; }) || {}).inverse || linkTypeLabel(lt);
      var targetId = isSource ? lnk.target_id : lnk.source_id;
      var targetKey = lnk.target_key || targetId;
      var targetTitle = lnk.target_title || '';
      var targetStatus = lnk.target_status || '';
      var targetType = lnk.target_type || 'task';
      if (!grouped[displayType]) grouped[displayType] = [];
      grouped[displayType].push({ id: targetId, key: targetKey, title: targetTitle, status: targetStatus, type: targetType, linkId: lnk.id });
    }

    for (var gtype in grouped) {
      html += '<div class="link-group" style="margin-bottom:10px">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:capitalize;margin-bottom:4px">' + esc(gtype) + '</div>';
      var items = grouped[gtype];
      for (var gi = 0; gi < items.length; gi++) {
        var it = items[gi];
        html += '<div class="link-item" data-link-row-id="' + escAttr(it.id) + '" data-link-row-key="' + escAttr(it.key) + '" data-link-row-link="' + escAttr(it.linkId) + '" ' +
          'style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;border:1px solid var(--border);margin-bottom:4px;background:var(--bg3);cursor:pointer">' +
          '<span style="font-size:12px">' + typeIcon(it.type) + '</span>' +
          '<span style="font-size:11px;font-weight:700;color:var(--accent)">' + esc(it.key) + '</span>' +
          '<span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</span>' +
          statusBadge(it.status, true) +
          '<button class="btn-icon link-copy-btn" style="width:22px;height:22px;flex-shrink:0;opacity:0.55;padding:2px" title="Copy link"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
          '<button class="btn-icon link-remove-btn" style="width:18px;height:18px;font-size:10px;opacity:0.4;flex-shrink:0" title="Remove link">\u2715</button>' +
          '</div>';
      }
      html += '</div>';
    }
  } else {
    html += '<p class="text-muted text-sm" style="margin-bottom:4px">No linked items</p>';
  }

  // Add link button
  html += '<button class="btn btn-outline btn-sm" style="margin-top:6px;gap:4px" onclick="window._showLinkDialog()">\uD83D\uDD17 Link an issue</button>';

  // Inline link dialog (hidden by default)
  html += '<div id="linkDialogInline" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2)">' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:8px">Link an issue</div>' +
    '<div style="margin-bottom:8px">' +
    '<label class="form-label">Link type</label>' +
    '<select id="linkTypeSelect" class="input input-sm" style="width:100%">';
  for (var lti = 0; lti < LINK_TYPES.length; lti++) {
    if (LINK_TYPES[lti].selectable === false) continue;
    html += '<option value="' + escAttr(LINK_TYPES[lti].value) + '">' + esc(LINK_TYPES[lti].label) + '</option>';
  }
  html += '</select></div>' +
    '<div style="margin-bottom:8px">' +
    '<label class="form-label">Search for an issue</label>' +
    '<input type="text" id="linkSearchInput" class="input input-sm" placeholder="Paste issue URL or search by key (e.g. ENG-5)" oninput="window._searchLinkIssues(this.value)" style="width:100%">' +
    '</div>' +
    '<div id="linkSearchResults" style="max-height:160px;overflow-y:auto;margin-bottom:8px"></div>' +
    '<div id="linkSelectedIssue" style="display:none;padding:6px 8px;border:1px solid var(--accent);border-radius:4px;background:var(--accent-bg);margin-bottom:8px;align-items:center;gap:6px"></div>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end">' +
    '<button class="btn btn-outline btn-sm" onclick="window._hideLinkDialog()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" id="linkSubmitBtn" disabled onclick="window._submitLink()">Link</button>' +
    '</div></div>';

  c.innerHTML = html;

  // Row behaviour bound here rather than inline, so keys/titles never have to
  // survive being interpolated into an attribute.
  c.querySelectorAll('[data-link-row-id]').forEach(function (row) {
    var issueId = row.dataset.linkRowId;
    var issueKey = row.dataset.linkRowKey;
    var linkId = row.dataset.linkRowLink;
    row.addEventListener('mouseenter', function () { row.style.borderColor = 'var(--accent)'; });
    row.addEventListener('mouseleave', function () { row.style.borderColor = 'var(--border)'; });
    row.addEventListener('click', function () { openIssuePage(issueId); });
    var copyBtn = row.querySelector('.link-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      copyTextToClipboard(window.location.origin + '/?issue=' + encodeURIComponent(issueKey));
    });
    var rmBtn = row.querySelector('.link-remove-btn');
    if (rmBtn) rmBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window._removeLink(linkId);
    });
  });
}

window._showLinkDialog = function() {
  var dlg = $('linkDialogInline');
  if (dlg) {
    dlg.style.display = '';
    $('linkSearchInput').value = '';
    var sel = $('linkSelectedIssue');
    sel.style.display = 'none';
    sel.dataset.issueId = '';
    sel.innerHTML = '';
    $('linkSubmitBtn').disabled = true;
    // Reset the type back to the default instead of keeping the last pick
    var typeSel = $('linkTypeSelect');
    if (typeSel) typeSel.value = 'relates_to';
    // Show recent issues immediately on open
    window._searchLinkIssues('');
    setTimeout(function(){ $('linkSearchInput').focus(); }, 50);
  }
};

window._hideLinkDialog = function() {
  var dlg = $('linkDialogInline');
  if (dlg) dlg.style.display = 'none';
};

window._searchLinkIssues = function(term) {
  var results = $('linkSearchResults');
  if (!results) return;
  var currentIssueId = S.drawerIssueId;
  var spaceId = _linkDialogSpaceId;
  var searchTerm = parseIssueLinkReference(term) || (term || '').trim();
  var lower = searchTerm.toLowerCase();
  var msg = function (text) {
    results.innerHTML = '<p class="text-muted text-xs" style="padding:6px 4px">' + esc(text) + '</p>';
  };

  // Only same-space issues are linkable (POST /api/links enforces it). Offering
  // other spaces meant picking one failed with a bare "Invalid issue link" —
  // S.data.issues spans every space when the drawer is opened from Home or
  // My Work, so this filter is what keeps the picker honest.
  var candidates = (S.data.issues || []).filter(function (i) {
    if (i.id === currentIssueId) return false;
    return !spaceId || i.space_id === spaceId;
  });

  if (searchTerm) {
    var exact = candidates.find(function (i) {
      return i.key && i.key.toLowerCase() === lower;
    });
    if (exact) { renderLinkSearchResults([exact]); return; }
  }

  var matches = candidates.filter(function (i) {
    if (!searchTerm) return true;
    return (i.key && i.key.toLowerCase().indexOf(lower) >= 0) ||
           (i.title && i.title.toLowerCase().indexOf(lower) >= 0);
  }).slice(0, 10);

  if (matches.length) { renderLinkSearchResults(matches); return; }
  if (!searchTerm) { msg('No other issues in this space to link'); return; }

  // Not in the local cache — the key may belong to an issue this client hasn't
  // loaded. Resolve it, but still refuse anything outside the current space so
  // the failure is explained here rather than as a 400 after clicking Link.
  msg('Looking up issue…');
  api('/api/issues/' + encodeURIComponent(searchTerm), 'GET', null, { silent: true }).then(function (iss) {
    if (!iss || !iss.id || iss.id === currentIssueId) { msg('No matching issues found'); return; }
    if (spaceId && iss.space_id !== spaceId) {
      msg(issueKeyStr(iss) + ' is in another space — issues can only be linked within the same space');
      return;
    }
    S.data.issues = S.data.issues || [];
    if (!S.data.issues.some(function (i) { return i.id == iss.id; })) S.data.issues.push(iss);
    renderLinkSearchResults([iss]);
  }).catch(function () {
    msg('No matching issues found');
  });
};

window._selectLinkIssue = function(id, key, title) {
  $('linkSearchResults').innerHTML = '';
  $('linkSearchInput').value = '';
  var sel = $('linkSelectedIssue');
  sel.style.display = 'flex';
  sel.dataset.issueId = id;
  sel.innerHTML = '<span style="font-size:11px;font-weight:700;color:var(--accent)">' + esc(key) + '</span>' +
    '<span style="flex:1;font-size:12px">' + esc(title) + '</span>' +
    '<button class="btn-icon" style="width:18px;height:18px;font-size:10px" onclick="event.stopPropagation();window._clearLinkSelection()">\u2715</button>';
  $('linkSubmitBtn').disabled = false;
};

window._clearLinkSelection = function() {
  var sel = $('linkSelectedIssue');
  sel.style.display = 'none';
  sel.dataset.issueId = '';
  sel.innerHTML = '';
  $('linkSubmitBtn').disabled = true;
};

// Re-read the open issue and repaint just the links section. Guarded on the
// drawer still showing the same issue, so a slow response can't paint one
// issue's links into another's drawer.
async function _refreshDrawerLinks() {
  var issueId = S.drawerIssueId;
  if (!issueId) return;
  try {
    var issue = await api('/api/issues/' + issueId, 'GET', null, { silent: true });
    if (issue && S.drawerIssueId === issueId) renderDrawerLinks(issue);
  } catch (_) { /* leave the current list in place */ }
}

window._submitLink = async function() {
  var btn = $('linkSubmitBtn');
  var targetId = $('linkSelectedIssue').dataset.issueId;
  var linkType = $('linkTypeSelect').value;
  if (!targetId) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Linking…'; }
  try {
    // silent: the server's 409/400 text ("already linked that way",
    // "conflicting link…") is more useful than api()'s generic toast, and
    // without this both would fire.
    await api('/api/links', 'POST', {
      source_id: S.drawerIssueId,
      target_id: targetId,
      link_type: linkType
    }, { silent: true });
    toast('Issue linked', 'success');
    window._hideLinkDialog();
    await _refreshDrawerLinks();
  } catch(e) {
    toast(e.message || 'Failed to create link', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
  }
};

window._removeLink = async function(linkId) {
  var ok = await confirmDialog('Remove this link?');
  if (!ok) return;
  try {
    await api('/api/links/' + linkId, 'DELETE', null, { silent: true });
    toast('Link removed', 'success');
    await _refreshDrawerLinks();
  } catch(e) { toast(e.message || 'Failed to remove link', 'error'); }
};

// Store current issue data for tab switching
var _drawerIssueData = null;

function renderDrawerActivity(issue) {
  // Support legacy call with just comments array
  if (Array.isArray(issue)) issue = { comments: issue, history: [], worklogs: [] };
  _drawerIssueData = issue;
  var activeTab = (document.querySelector('.drawer-atab.active') || {}).dataset && document.querySelector('.drawer-atab.active').dataset.activityTab || 'comments';
  _renderActivityTab(activeTab, issue);
}

function _renderActivityTab(tab, issue) {
  var c = $('drawerActivity');
  issue = issue || _drawerIssueData || {};
  var comments = issue.comments || [];
  var history  = issue.history  || [];
  var worklogs = issue.worklogs || [];

  function commentHtml(cm) {
    var user = findUser(cm.user_id);
    var name = user ? user.name : (cm.user_name || 'Unknown');
    var color = (user && user.color) || cm.user_color || '#6b7280';
    var btnStyle = 'background:none;border:none;cursor:pointer;font-size:11px;color:var(--text3);padding:2px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px';
    var actionBtns = '<span style="margin-left:auto;display:inline-flex;gap:4px">' +
      '<button onclick="window._editComment(\'' + cm.id + '\')" style="' + btnStyle + '" title="Edit"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>Edit</button>' +
      '<button onclick="window._deleteComment(\'' + cm.id + '\')" style="' + btnStyle + ';color:#dc2626" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>Delete</button>' +
      '</span>';
    var bodyHtml = (function(body) {
      if (/<[a-z][\s\S]*>/i.test(body)) {
        var safe = body.replace(/<script[\s\S]*?<\/script>/gi, '');
        // A comment that has been through the rich-edit-and-save cycle below
        // stores its images as real <img src="/api/files/id"> (no token, by
        // design — see _saveComment) rather than the [img:name|url] markup the
        // bracket branch below handles. Without this, those images would never
        // get a token at all, on any render, ever.
        return augmentFileUrlsInHtml(safe);
      }
      var html = highlightMentionsInCommentBody(body);
      html = html.replace(/\[img:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:8px"><img src="' + fileApiUrl(url) + '" style="max-width:300px;max-height:200px;border-radius:6px;border:1px solid #dfe1e6;cursor:pointer;display:block" onclick="window.open(this.src)" title="' + fname + '"><div style="font-size:11px;color:#6b778c;margin-top:2px">📷 ' + fname + '</div></div>';
      });
      html = html.replace(/\[file:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:6px"><a href="' + fileApiUrl(url) + '" target="_blank" style="color:#0052cc;text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #dfe1e6;border-radius:4px;font-size:13px;background:#f4f5f7">📎 ' + fname + '</a></div>';
      });
      return html;
    })(cm.body);

    // Rich editor toolbar (same as main comment editor)
    var richToolbar = '<div class="jira-comment-toolbar" style="border-radius:6px 6px 0 0">' +
      '<select class="jira-tb-select" onchange="richFormatBlock(this.value,\'edit-rich-' + cm.id + '\');this.value=\'\'" title="Text style"><option value="">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="p">Normal text</option></select>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'bold\')" title="Bold"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'italic\')" title="Italic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'underline\')" title="Underline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'strikeThrough\')" title="Strikethrough"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.3 4.9c-2.3-.6-4.4-1-6.2-.9-2.7 0-5.3.7-5.3 3.6 0 1.5 1.1 2.4 3.2 3.1H3"/><path d="M11.1 20.4c2.8 0 5.2-.7 5.2-3.8 0-1.6-1.1-2.5-3.3-3.4H21"/><line x1="3" y1="12" x2="21" y2="12"/></svg></button>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'insertUnorderedList\')" title="Bullet list"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'insertOrderedList\')" title="Numbered list"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg></button>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'removeFormat\')" title="Clear formatting"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4l-8 16"/><line x1="17" y1="11" x2="22" y2="16"/><line x1="22" y1="11" x2="17" y2="16"/></svg></button>' +
      '</div>';

    var editArea = '<div class="comment-edit-area-' + cm.id + '" style="display:none;margin-top:8px;border:1px solid var(--border);border-radius:6px;overflow:hidden">' +
      richToolbar +
      '<div id="edit-rich-' + cm.id + '" class="jira-editor-body" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13px;outline:none"></div>' +
      '<div style="display:flex;gap:8px;padding:8px 10px;background:var(--bg2);border-top:1px solid var(--border)">' +
      '<button onclick="window._saveComment(\'' + cm.id + '\')" style="background:#0052cc;color:#fff;border:none;border-radius:4px;padding:5px 16px;font-size:12px;cursor:pointer;font-weight:600">Save</button>' +
      '<button onclick="window._cancelEditComment(\'' + cm.id + '\')" style="background:none;border:1px solid var(--border);border-radius:4px;padding:5px 14px;font-size:12px;cursor:pointer">Cancel</button>' +
      '</div></div>';

    return '<div class="drawer-comment-item" id="comment-' + cm.id + '" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div class="drawer-comment-avatar-sm" style="background:' + color + ';width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(cm.created_at) + '</span>' +
      '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--bg3);color:var(--text3)">Comment</span>' +
      actionBtns +
      '</div>' +
      '<div class="comment-body-' + cm.id + '" style="font-size:13px;line-height:1.5;color:var(--text1)">' + bodyHtml + '</div>' +
      editArea +
      '</div></div>';
  }

  window._editComment = function(id) {
    var editArea = document.querySelector('.comment-edit-area-' + id);
    var richEl = document.getElementById('edit-rich-' + id);
    var bodyDiv = document.querySelector('.comment-body-' + id);
    if (!editArea || !richEl) return;
    // Hide the read-only render while editing — it used to stay visible the
    // whole time, so opening Edit just added a second copy of the comment
    // (text + screenshot) below the original instead of replacing it in place.
    if (bodyDiv) bodyDiv.style.display = 'none';
    // Pre-fill from the RAW stored body, not bodyDiv.innerHTML. The read-only
    // render wraps a pasted screenshot in a styled caption block (small gray
    // "📷 filename" text) meant only for display — copying that HTML in put the
    // caret right after that block, so anything typed next inherited its small
    // gray style instead of normal text. commentBodyToEditableHtml renders the
    // same image as a plain <img> (like the description editor does), which
    // leaves nothing after it for typed text to inherit.
    var cm = ((_drawerIssueData && _drawerIssueData.comments) || []).find(function(c) { return c.id === id; });
    richEl.innerHTML = cm ? commentBodyToEditableHtml(cm.body) : (bodyDiv ? bodyDiv.innerHTML : '');
    attachScopedUndo(richEl);
    editArea.style.display = '';
    // The edit box is a fresh element each time the activity list re-renders,
    // but re-opening Edit on the SAME comment without a re-render in between
    // reuses this exact node -- both binders below no-op on a repeat call via
    // their own bind-once guards, so this is safe to call every time.
    bindMentionAutocomplete(richEl);
    bindCommentEditImagePaste(richEl);
    richEl.focus();
    // Move cursor to end
    var range = document.createRange();
    range.selectNodeContents(richEl);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  window._cancelEditComment = function(id) {
    var editArea = document.querySelector('.comment-edit-area-' + id);
    var bodyDiv = document.querySelector('.comment-body-' + id);
    if (editArea) editArea.style.display = 'none';
    if (bodyDiv) bodyDiv.style.display = '';
  };

  window._deleteComment = function(id) {
    if (!confirm('Delete this comment?')) return;
    api('/api/comments/' + id, 'DELETE').then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          renderDrawerActivity(fresh);
        }).catch(function(){});
      }
    }).catch(function() { toast('Failed to delete comment', 'error'); });
  };

  window._saveComment = function(id) {
    var richEl = document.getElementById('edit-rich-' + id);
    if (!richEl) return;
    // richEl was pre-filled from the rendered comment body in _editComment,
    // which means any pasted screenshot's <img> now carries today's live
    // session token (bodyHtml embeds it for display). Strip it before saving
    // — same bug and same fix as the drawer description save handlers: saving
    // the token verbatim bakes today's token in permanently.
    var newBody = stripFileAuthTokensFromHtml(richEl.innerHTML.trim());
    if (!newBody || newBody === '<br>') return;
    api('/api/comments/' + id, 'PUT', { body: newBody }).then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          renderDrawerActivity(fresh);
        }).catch(function(){});
      }
    }).catch(function() { toast('Failed to save comment', 'error'); });
  };

  function historyHtml(h) {
    var user = findUser(h.user_id);
    var name = user ? user.name : (h.user_name || 'Unknown');
    var color = (user && user.color) || h.user_color || '#6b7280';
    var fieldLabel = { title:'Title', status:'Status', priority:'Priority', assignee_id:'Assignee', reporter_id:'Reporter', sprint_id:'Sprint', labels:'Labels', story_points:'Story Points', start_date:'Start Date', due_date:'Due Date', description:'Description', attachment:'Attachment' }[h.field_name] || h.field_name;
    function resolveVal(field, val) {
      if (!val || val === '—') return val || '—';
      if (field === 'sprint_id') {
        var sp = (S.data.sprints || []).find(function(s){ return s.id === val; });
        return sp ? sp.name : 'None';
      }
      if (field === 'assignee_id' || field === 'reporter_id') {
        var u = findUser(val);
        return u ? u.name : val;
      }
      return val;
    }
    function formatHistoryValue(field, val) {
      var resolved = resolveVal(field, val) || '—';
      if (resolved === '—') return resolved;
      if (field === 'description' || field === 'fix_description' || /<[a-z][\s\S]*>/i.test(resolved)) {
        resolved = stripHtmlForDisplay(resolved);
      }
      if (field === 'product_type' || field === 'team') {
        resolved = String(resolved).replace(/,/g, ', ');
      }
      if (resolved.charAt(0) === '{' || resolved.charAt(0) === '[') {
        try {
          var parsed = JSON.parse(resolved);
          if (parsed && parsed.combinations) {
            resolved = (parsed.combinations || []).join(', ') || resolved;
          } else if (Array.isArray(parsed)) {
            resolved = parsed.join(', ');
          }
        } catch (_) {}
      }
      return truncateForHistory(resolved, 120);
    }
    var oldVal = formatHistoryValue(h.field_name, h.old_value);
    var newVal = formatHistoryValue(h.field_name, h.new_value);
    var isAttach = h.field_name === 'attachment';
    var actionLine;
    if (isAttach && !h.old_value) {
      actionLine = 'Added attachment <strong>📎 ' + esc(h.new_value) + '</strong>';
    } else if (isAttach && !h.new_value) {
      actionLine = 'Removed attachment <span style="text-decoration:line-through;color:var(--text3)">📎 ' + esc(h.old_value) + '</span>';
    } else {
      actionLine = 'Updated <strong>' + esc(fieldLabel) + '</strong> from <span style="text-decoration:line-through;color:var(--text3)">' + esc(oldVal) + '</span> → <strong>' + esc(newVal) + '</strong>';
    }
    var badge = isAttach
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#fef9c3;color:#854d0e">Attachment</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dbeafe;color:#1e40af">Changed</span>';
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(h.created_at) + '</span>' +
      badge +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2)">' + actionLine + '</div>' +
      '</div></div>';
  }

  function worklogHtml(w) {
    var user = findUser(w.user_id);
    var name = user ? user.name : (w.user_name || 'Unknown');
    var color = (user && user.color) || w.user_color || '#6b7280';
    var mins = w.time_spent || 0;
    var timeStr = fmtMins(mins);
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(w.created_at || w.work_date) + '</span>' +
      '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dcfce7;color:#166534">Work log</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2)">' +
      'Logged <strong>' + timeStr + '</strong>' + (w.description ? ' — ' + esc(w.description) : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">Date: ' + fmtDate(w.work_date || w.created_at) + (w.is_billable ? ' · Billable' : '') + '</div>' +
      '</div></div>';
  }

  // Comment box: show only on Comments tab
  var commentBox = document.querySelector('.drawer-comment-box');
  if (commentBox) commentBox.style.display = (tab === 'comments') ? '' : 'none';

  // Helper: merge items into sorted timeline
  function buildTimeline(items) {
    return items.sort(function(a, b) { return b.date - a.date; });
  }

  var html = '';
  if (tab === 'comments') {
    // Comments only + comment box (shown above)
    if (!comments.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No comments yet.</p>'; return; }
    comments.slice().sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);})
      .forEach(function(cm){ html += commentHtml(cm); });

  } else if (tab === 'history') {
    // Full audit trail: field changes + comments + worklogs — all with date/time, no comment box
    var all = [];
    comments.forEach(function(x){ all.push({ type:'comment', date: new Date(x.created_at), data:x }); });
    history.forEach(function(x){ all.push({ type:'history', date: new Date(x.created_at), data:x }); });
    worklogs.forEach(function(x){ all.push({ type:'worklog', date: new Date(x.created_at||x.work_date), data:x }); });
    buildTimeline(all);
    if (!all.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No history yet.</p>'; return; }
    all.forEach(function(item){
      if (item.type==='comment') html += commentHtml(item.data);
      else if (item.type==='history') html += historyHtml(item.data);
      else html += worklogHtml(item.data);
    });

  } else if (tab === 'worklog') {
    // Worklogs only, no comment box
    if (!worklogs.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No time logged yet. Click "+ Log Time" to add.</p>'; return; }
    worklogs.forEach(function(w){ html += worklogHtml(w); });

  } else {
    // ALL: everything merged, with comment box (shown above)
    var all = [];
    comments.forEach(function(x){ all.push({ type:'comment', date: new Date(x.created_at), data:x }); });
    history.forEach(function(x){ all.push({ type:'history', date: new Date(x.created_at), data:x }); });
    worklogs.forEach(function(x){ all.push({ type:'worklog', date: new Date(x.created_at||x.work_date), data:x }); });
    buildTimeline(all);
    if (!all.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No activity yet.</p>'; return; }
    all.forEach(function(item){
      if (item.type==='comment') html += commentHtml(item.data);
      else if (item.type==='history') html += historyHtml(item.data);
      else html += worklogHtml(item.data);
    });
  }
  c.innerHTML = html || '<p class="text-muted text-sm" style="padding:12px 0">No activity yet.</p>';
}

function renderDrawerAttachments(attachments) {
  var c = $('drawerAttachments');
  if (!c) return;
  if (!attachments || !attachments.length) {
    c.innerHTML = '<p class="text-muted text-sm" style="padding:8px 0">No attachments yet.</p>';
    return;
  }
  function fileIcon(mime) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf')) return '📕';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('excel') || mime.includes('sheet')) return '📊';
    if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
    if (mime.includes('video/')) return '🎬';
    return '📄';
  }
  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }
  var html = '';
  attachments.forEach(function(a) {
    var canDelete = S.currentUser === a.uploaded_by || ((S.currentUserObj||{}).role === 'admin') || ((S.currentUserObj||{}).role === 'owner');
    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:18px">' + fileIcon(a.mime_type) + '</span>' +
      '<div style="flex:1;min-width:0">' +
      '<a href="' + esc(fileApiUrl(a.filename)) + '" target="_blank" style="font-size:13px;color:var(--accent);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Click to open">' + esc(a.original_name) + '</a>' +
      '<div style="font-size:11px;color:var(--text3)">' + fmtSize(a.size) + (a.uploader_name ? ' · ' + esc(a.uploader_name) : '') + ' · ' + fmtDateTime(a.created_at) + '</div>' +
      '</div>' +
      '<a href="' + esc(fileApiUrl(a.filename)) + '" download="' + esc(a.original_name) + '" title="Download" style="color:var(--text3);font-size:15px;text-decoration:none;padding:2px 4px;border-radius:4px;line-height:1" onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">⬇</a>' +
      '<button title="Rename" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--text3);padding:2px 4px;border-radius:4px" onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'" onclick="renameAttachment(\'' + a.id + '\',\'' + esc(a.original_name).replace(/'/g,"&#39;") + '\')">✏</button>' +
      (canDelete ? '<button class="btn btn-sm btn-outline text-danger" style="padding:2px 8px;font-size:11px" onclick="deleteAttachment(\'' + a.id + '\')">✕</button>' : '') +
      '</div>';
  });
  c.innerHTML = html;
}

window.renameAttachment = async function(id, currentName) {
  var newName = prompt('Rename attachment:', currentName);
  if (!newName || newName.trim() === currentName.trim()) return;
  try {
    await api('/api/attachments/' + id, 'PATCH', { original_name: newName.trim() });
    var issue = await api('/api/issues/' + S.drawerIssueId);
    if (issue) renderDrawerAttachments(issue.attachments || []);
    toast('Attachment renamed');
  } catch(e) { toast('Rename failed', 'error'); }
};

window.deleteAttachment = async function(id) {
  var ok = await confirmDialog('Delete this attachment?');
  if (!ok) return;
  try {
    await api('/api/attachments/' + id, 'DELETE');
    var issue = await api('/api/issues/' + S.drawerIssueId);
    if (issue) renderDrawerAttachments(issue.attachments || []);
    toast('Attachment deleted');
  } catch(e) {}
};

// Close any open custom-field select dropdown when clicking outside it.
// Bound once at script load (not inside renderDrawerCustomFields, which can
// re-run many times per drawer session via live-sync) — previously this was
// added fresh on every render, stacking a new document-level listener each
// time and leaking a growing pile of stale closures over a session.
document.addEventListener('click', function(e) {
  if (e.target.closest('.cf-select-wrap')) return;
  qsa('.cf-select-dropdown').forEach(function(d) {
    d.style.display = 'none';
    resetCFDropdownPosition(d);
  });
  if (!e.target.closest('.combo-box')) {
    qsa('.combo-dropdown').forEach(function (d) {
      d.hidden = true;
      var box = d.closest('.combo-box');
      if (box) box.classList.remove('combo-open');
    });
  }
});
window.addEventListener('resize', function () {
  qsa('.cf-select-dropdown').forEach(function (d) {
    if (d.style.display !== 'none') {
      var wrap = d.closest('.cf-select-wrap');
      if (wrap) positionCFDropdown(wrap);
    }
  });
  qsa('.combo-box.combo-open').forEach(function (el) {
    positionComboDropdown(el);
  });
});

// ── Custom field select / multi-select (shared: drawer + create modal) ──
function getProductTeamSpaceId() {
  var sp = (S.data.spaces || []).find(function (s) {
    return s.name === 'Product_Team' || s.key === 'PTM';
  });
  return sp ? sp.id : null;
}

// ── Product Type / Combination visibility ─────────────────
// Driven by what the space actually has in Settings → Custom Fields, not by
// whether the space happens to be Product_Team:
//   has Combination (+ Product Type)  → the combined Product Type + Combinations
//                                       picker, exactly what Product_Team shows
//   has Product Type only             → the plain Product Type dropdown
//   has neither                       → nothing
// Previously both surfaces gated on `spaceId === Product_Team`, so every other
// space got nothing on create even with Product Type enabled in its settings —
// and the standalone dropdown was hard-hidden for ALL spaces, Product_Team
// included, which is why ticking the field in Custom Fields did nothing.
function spaceHasCombinationField(spaceId, place) {
  var meta = findCombinationFieldMeta(spaceId);
  if (!meta) return false;
  return customFieldShowsIn(meta, place);
}
function spaceHasProductTypeField(spaceId, place) {
  return isSpaceBuiltinFieldEnabled(spaceId, 'product_type', place);
}
// 'combo' | 'plain' | 'none' — the single decision both surfaces follow.
function productTypeMode(spaceId, place) {
  if (!spaceId) return 'none';
  var hasPt = spaceHasProductTypeField(spaceId, place);
  if (spaceHasCombinationField(spaceId, place) && hasPt) return 'combo';
  return hasPt ? 'plain' : 'none';
}

function getIssueFormTeam() {
  return $('issueTeam') ? $('issueTeam').value : '';
}

function findCombinationFieldMeta(spaceId) {
  if (!spaceId) return null;
  return (S.data.custom_fields || []).find(function (f) {
    return f.space_id === spaceId && isCombinationField(f);
  }) || null;
}

async function ensureCombinationFieldMeta(spaceId) {
  var meta = findCombinationFieldMeta(spaceId);
  if (meta && meta.id) return meta;
  // Used to bail out for anything that wasn't Product_Team, so a space with its
  // own Combination field could never load its options. Any space may have one now.
  if (!spaceId) return null;
  try {
    var data = await api('/api/data?space_id=' + encodeURIComponent(spaceId));
    if (data && data.custom_fields && data.custom_fields.length) {
      S.data.custom_fields = (S.data.custom_fields || [])
        .filter(function (f) { return f.space_id !== spaceId; })
        .concat(data.custom_fields);
      meta = findCombinationFieldMeta(spaceId);
      if (meta && meta.id) return meta;
    }
    var cfs = await api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId));
    if (Array.isArray(cfs) && cfs.length) {
      S.data.custom_fields = (S.data.custom_fields || [])
        .filter(function (f) { return f.space_id !== spaceId; })
        .concat(cfs);
      return findCombinationFieldMeta(spaceId);
    }
  } catch (_) {}
  return null;
}

function renderIssueProductTypeSets(spaceId) {
  var group = $('issueCombinationGroup');
  var container = $('issueCombinationField');
  var productTypeGroup = $('issueProductTypeGroup');

  if (!group || !container) return Promise.resolve();

  var team = getIssueFormTeam();
  var mode = productTypeMode(spaceId, 'create');

  if (mode === 'none') {
    if (productTypeGroup) productTypeGroup.hidden = true;
    group.hidden = true;
    container.innerHTML = '';
    _issuePtComboSel = null;
    if ($('issueProductType')) $('issueProductType').value = '';
    return Promise.resolve();
  }

  if (mode === 'plain') {
    // Product Type on its own — the plain dropdown, no Combinations picker.
    group.hidden = true;
    container.innerHTML = '';
    _issuePtComboSel = null;
    if (productTypeGroup) productTypeGroup.hidden = false;
    return Promise.resolve();
  }

  // mode === 'combo'
  if (productTypeGroup) productTypeGroup.hidden = true;
  group.hidden = false;
  // No outer label — the picker carries its own "Product Type" / "Combinations"
  // section headings, so a wrapper label just repeated them.

  if (!_issuePtComboSel) _issuePtComboSel = emptyPtComboSelection();

  // The space's OWN combination field, so a non-Product_Team space uses its own
  // configured options rather than borrowing Product_Team's.
  return ensureCombinationFieldMeta(spaceId).then(function (meta) {
    if (!meta || !meta.id) {
      // Combination is configured but its options failed to load — fall back to
      // the plain dropdown rather than showing an empty box.
      group.hidden = true;
      container.innerHTML = '';
      if (productTypeGroup) productTypeGroup.hidden = !spaceHasProductTypeField(spaceId, 'create');
      return;
    }
    container.innerHTML = buildProductTypeComboPickerHtml(_issuePtComboSel, meta, spaceId);
    bindProductTypeComboPicker(container, meta, { stateKey: '_issuePtComboSel' });
  });
}

function renderIssueCombinationField(spaceId) {
  return renderIssueProductTypeSets(spaceId);
}

async function renderDrawerProductTypeSets(issueId, spaceId, cfValues, productType) {
  var row = $('drawerCombinationRow');
  var container = $('drawerCombinationField');
  var ptRow = $('drawerProductTypeRow');

  if (!row || !container) return;

  var team = $('drawerTeam') ? $('drawerTeam').value : '';
  var mode = productTypeMode(spaceId, 'drawer');

  if (mode === 'none') {
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow) ptRow.hidden = true;
    return;
  }

  if (mode === 'plain') {
    // Plain Product Type row; its own onchange already saves product_type.
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow) {
      ptRow.hidden = false;
      if ($('drawerProductType')) $('drawerProductType').value = productType || '';
    }
    return;
  }

  // mode === 'combo'
  if (ptRow) ptRow.hidden = true;
  row.hidden = false;
  // The row is a single full-width cell now; the picker supplies its own
  // section headings, so there is no .dfl label to fill in.

  var meta = await ensureCombinationFieldMeta(spaceId);
  if (!meta || !meta.id) {
    // Same fallback as the create form: show the plain row rather than an
    // "unavailable" dead end, so the user can still set a product type.
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow && spaceHasProductTypeField(spaceId, 'drawer')) {
      ptRow.hidden = false;
      if ($('drawerProductType')) $('drawerProductType').value = productType || '';
    }
    return;
  }

  var combinationVal = '';
  (cfValues || []).forEach(function (v) {
    if (v.field_id === meta.id) combinationVal = v.value;
    else if ((v.field_name || '').toLowerCase() === 'combination') combinationVal = v.value;
  });
  if (!combinationVal) {
    var bulk = (S.data.issue_field_values || []).find(function (v) {
      return v.issue_id == issueId && v.field_id == meta.id;
    });
    if (bulk) combinationVal = bulk.value;
  }

  _drawerPtComboSel = parsePtComboSelection(productType, combinationVal);
  container.innerHTML = buildProductTypeComboPickerHtml(_drawerPtComboSel, meta, spaceId);
  bindProductTypeComboPicker(container, meta, {
    stateKey: '_drawerPtComboSel',
    onChange: function (sel) {
      if (issueId) saveDrawerPtComboSelection(issueId, sel, meta);
    }
  });
}

async function renderDrawerCombinationField(issueId, spaceId, cfValues, productType) {
  return renderDrawerProductTypeSets(issueId, spaceId, cfValues, productType);
}

function buildCombinationComboboxHtml(fieldId, selectedVal) {
  selectedVal = selectedVal || '';
  return '<div class="combo-box" data-cf-id="' + esc(fieldId) + '" data-value="' + esc(selectedVal) + '">' +
    '<div class="combo-input-wrap">' +
      '<svg class="combo-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input type="text" class="combo-input" placeholder="Search source e.g. Box, SharePoint" value="' + esc(selectedVal) + '" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="combo-clear" title="Clear"' + (selectedVal ? '' : ' hidden') + '>×</button>' +
      '<span class="combo-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>' +
    '</div>' +
    '<div class="combo-dropdown" hidden>' +
      '<div class="combo-list"></div>' +
      '<div class="combo-empty" hidden>No combinations match your search</div>' +
    '</div>' +
  '</div>';
}

function bindCombinationCombobox(el, config) {
  config = config || {};
  if (!el || el._comboBound) return;
  el._comboBound = true;
  var fieldId = el.dataset.cfId;
  var input = el.querySelector('.combo-input');
  var dropdown = el.querySelector('.combo-dropdown');
  var listEl = el.querySelector('.combo-list');
  var emptyEl = el.querySelector('.combo-empty');
  var clearBtn = el.querySelector('.combo-clear');
  var chevron = el.querySelector('.combo-chevron');

  function resolveOptions() {
    if (typeof config.getOptions === 'function') return config.getOptions() || [];
    if (config.options && config.options.length) return config.options.slice();
    return getCombinationOptionsList();
  }

  var options = resolveOptions();
  var selectedVal = el.dataset.value || '';
  if (selectedVal && typeof normalizeCombinationLabel === 'function') {
    selectedVal = normalizeCombinationLabel(selectedVal);
    el.dataset.value = selectedVal;
    input.value = selectedVal;
  }
  var highlightIdx = -1;

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(selectedVal);
  }

  function setValue(val) {
    selectedVal = val ? (typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(val) : val) : '';
    el.dataset.value = selectedVal;
    input.value = selectedVal;
    if (clearBtn) clearBtn.hidden = !selectedVal;
    closeDropdown();
    notify();
  }

  function renderList(filter) {
    options = resolveOptions();
    var matches = options.filter(function (o) {
      return matchCombinationSearch(o, filter);
    });
    highlightIdx = matches.length ? 0 : -1;
    listEl.innerHTML = matches.map(function (o, i) {
      var active = o === selectedVal;
      var hi = i === highlightIdx;
      return '<button type="button" class="combo-option' + (active ? ' is-selected' : '') + (hi ? ' is-highlighted' : '') + '" data-val="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
    emptyEl.hidden = matches.length > 0;
    listEl.hidden = matches.length === 0;
  }

  function openDropdown() {
    qsa('.combo-dropdown').forEach(function (d) {
      if (d !== dropdown) d.hidden = true;
    });
    dropdown.hidden = false;
    el.classList.add('combo-open');
    renderList(input.value);
    positionComboDropdown(el);
  }

  function closeDropdown() {
    dropdown.hidden = true;
    el.classList.remove('combo-open');
    highlightIdx = -1;
    if (selectedVal) input.value = selectedVal;
  }

  function selectHighlighted() {
    var hi = listEl.querySelector('.combo-option.is-highlighted');
    if (hi) setValue(hi.dataset.val);
  }

  input.addEventListener('focus', function () { openDropdown(); });
  input.addEventListener('input', function () {
    openDropdown();
    renderList(input.value);
  });
  input.addEventListener('keydown', function (ev) {
    var opts = listEl.querySelectorAll('.combo-option');
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (dropdown.hidden) openDropdown();
      highlightIdx = Math.min(highlightIdx + 1, opts.length - 1);
      opts.forEach(function (o, i) { o.classList.toggle('is-highlighted', i === highlightIdx); });
      if (opts[highlightIdx]) opts[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      opts.forEach(function (o, i) { o.classList.toggle('is-highlighted', i === highlightIdx); });
      if (opts[highlightIdx]) opts[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      selectHighlighted();
    } else if (ev.key === 'Escape') {
      closeDropdown();
      input.blur();
    }
  });

  listEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.combo-option');
    if (btn) setValue(btn.dataset.val);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      setValue('');
      input.focus();
      openDropdown();
    });
  }

  if (chevron) {
    chevron.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (dropdown.hidden) { input.focus(); openDropdown(); }
      else closeDropdown();
    });
  }

  el.addEventListener('click', function (ev) { ev.stopPropagation(); });
}

function positionComboDropdown(el) {
  var dropdown = el.querySelector('.combo-dropdown');
  var wrap = el.querySelector('.combo-input-wrap');
  if (!dropdown || !wrap || dropdown.hidden) return;
  var rect = wrap.getBoundingClientRect();
  var maxH = Math.min(280, window.innerHeight - rect.bottom - 12);
  if (maxH < 140 && rect.top > 160) {
    dropdown.style.top = '';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(280, rect.top - 12) + 'px';
  } else {
    dropdown.style.bottom = '';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = maxH + 'px';
  }
  dropdown.style.position = 'fixed';
  dropdown.style.left = Math.max(8, rect.left) + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.style.zIndex = '10050';
}

function repositionOpenFloatingDropdowns() {
  qsa('.combo-box.combo-open').forEach(positionComboDropdown);
  qsa('.cf-select-dropdown').forEach(function (d) {
    if (d.style.display !== 'none') {
      var wrap = d.closest('.cf-select-wrap');
      if (wrap) positionCFDropdown(wrap);
    }
  });
}

(function bindFloatingDropdownScrollReposition() {
  if (window._floatDropScrollBound) return;
  window._floatDropScrollBound = true;
  document.addEventListener('DOMContentLoaded', function () {
    var modalBody = document.querySelector('#modal-issue .modal-body');
    if (modalBody) modalBody.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true });
    qsa('.drawer-sidebar').forEach(function (el) {
      el.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true });
    });
  });
  document.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true, capture: true });
})();

var _issuePtComboSel = null;
var _drawerPtComboSel = null;

var PRODUCT_TYPE_CHECKBOX_OPTIONS = [
  { v: 'Message', l: 'Message Type' },
  { v: 'Email', l: 'Mail Type' },
  { v: 'Content', l: 'Content Type' },
  { v: 'Manage', l: 'Manage' },
  { v: 'Infra', l: 'Infra' }
];

function emptyPtComboSelection() {
  return { productTypes: [], combinations: [] };
}

function parsePtComboSelection(productType, combinationValue) {
  var sel = emptyPtComboSelection();
  if (combinationValue && String(combinationValue).trim().charAt(0) === '{') {
    try {
      var parsed = JSON.parse(combinationValue);
      if (parsed && parsed.v === 2) {
        sel.productTypes = (parsed.productTypes || []).slice();
        sel.combinations = (parsed.combinations || []).slice();
        return sel;
      }
      if (parsed && parsed.v === 1 && Array.isArray(parsed.sets)) {
        parsed.sets.forEach(function (s) {
          if (s.productType && sel.productTypes.indexOf(s.productType) < 0) sel.productTypes.push(s.productType);
          (s.combinations || []).forEach(function (c) {
            if (sel.combinations.indexOf(c) < 0) sel.combinations.push(c);
          });
        });
        return sel;
      }
    } catch (_) {}
  }
  var pt = (productType || '').trim();
  if (pt.indexOf(',') >= 0) {
    sel.productTypes = pt.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  } else if (pt) {
    sel.productTypes = [pt];
  }
  if (combinationValue && String(combinationValue).trim() && String(combinationValue).trim().charAt(0) !== '{') {
    sel.combinations = String(combinationValue).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (sel.combinations.length === 1 && typeof normalizeCombinationLabel === 'function') {
      sel.combinations[0] = normalizeCombinationLabel(sel.combinations[0]);
    }
  }
  return sel;
}

// Plain-text render of a Combination field's raw stored value, for contexts
// (the All Work table) that just print a custom field's value as text rather
// than driving the combo-box picker UI. Existing rows saved before the
// serializePtComboSelection fix above can still carry the old
// {"v":2,"productTypes":[...],"combinations":[]} JSON form, so this has to
// handle that regardless of what gets newly saved going forward.
//
// Deliberately does NOT fall back to showing productTypes when there are no
// real combinations: that would put the same values in both the Combination
// and Product Type columns, which is exactly the "one field showing as
// another" mixing this whole fix exists to undo. No combination selected
// means the cell is genuinely empty -- the table already renders '' as the
// dash, so returning '' here is correct, not a missing case.
function formatCombinationFieldDisplayValue(rawValue) {
  if (!rawValue) return '';
  var trimmed = String(rawValue).trim();
  if (trimmed.charAt(0) !== '{') return rawValue; // already a plain combination string
  var sel = parsePtComboSelection('', rawValue);
  if (sel.combinations.length) {
    return sel.combinations.map(function (c) {
      return typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(c) : c;
    }).join(', ');
  }
  return '';
}

function serializePtComboSelection(sel) {
  sel = sel || emptyPtComboSelection();
  var types = (sel.productTypes || []).filter(Boolean);
  var combos = (sel.combinations || []).filter(Boolean);
  // Product Type and Combination are two different fields (issues.product_type
  // vs. the "Combination" custom field's own value) and should stay that way.
  // This used to JSON-encode {productTypes, combinations:[]} into the
  // COMBINATION field even when zero combinations were selected -- e.g. two
  // product types picked with no specific combination -- so the All Work
  // table's Combination column showed a raw {"v":2,"productTypes":[...]}
  // blob for rows that had no combination at all. That encoding was also
  // never necessary: product_type below already fully captures a multi-type
  // selection on its own, and parsePtComboSelection's non-JSON fallback path
  // reconstructs it from that plain string when combinationValue is empty.
  // The JSON form is only actually needed when there's more than one REAL
  // combination to store, or exactly one combination that needs to say which
  // of several product types it belongs to.
  var combinationValue = null;
  if (combos.length > 1 || (combos.length === 1 && types.length > 1)) {
    combinationValue = JSON.stringify({ v: 2, productTypes: types, combinations: combos });
  } else if (combos.length === 1) {
    combinationValue = combos[0];
  }
  return {
    product_type: types.length ? types.join(',') : null,
    combination: combinationValue
  };
}

// Every selected product type now participates in combinations -- there's no
// more fixed subset of "types that get grouped combinations" vs "types that
// see everything" vs "types that get nothing" (that used to be exactly
// Message/Email/Content, plus Manage/Infra hardcoded by literal name here).
// A type with no combinations configured for it yet just has an empty list.
function getComboTypesFromSelection(types) {
  return (types || []).slice();
}

function pruneCombinationsForTypes(sel, meta) {
  var allowed = {};
  getComboTypesFromSelection(sel.productTypes).forEach(function (t) {
    getCombinationsForProductType(t, meta).forEach(function (c) { allowed[c] = true; });
  });
  sel.combinations = (sel.combinations || []).filter(function (c) { return allowed[c]; });
}

function buildProductTypeCheckboxListHtml(selectedTypes, ptOptions) {
  ptOptions = ptOptions || PRODUCT_TYPE_CHECKBOX_OPTIONS;
  return ptOptions.map(function (t) {
    var val = t.v != null ? t.v : t;
    var label = t.l != null ? t.l : getProductTypeLabel(val);
    var checked = selectedTypes.indexOf(val) >= 0;
    return '<label class="pt-combo-check" title="' + escAttr(label) + '">' +
      '<input type="checkbox" class="pt-combo-cb-input pt-type-cb" value="' + esc(val) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="pt-combo-check-label">' + esc(label) + '</span></label>';
  }).join('');
}

function getProductTypeOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'product_type') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = PRODUCT_TYPE_CHECKBOX_OPTIONS.map(function (o) { return o.v; });
  return vals.map(function (v) {
    return { v: v, l: getProductTypeLabel(v) };
  });
}

// Type/priority equivalent of getProductTypeOptionsForSpace — order is the
// order configured in Settings, which for priority IS the severity order
// (index 0 = most severe) per the admin-facing convention documented on the
// Combination-group editor's sibling: what's typed in Options is what shows,
// in that order, everywhere the field is picked.
function getIssueTypeOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'type') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = BUILTIN_SELECT_FALLBACKS.type;
  return vals.map(function (v) { return { v: v, l: cap(v) }; });
}
function getIssuePriorityOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'priority') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = BUILTIN_SELECT_FALLBACKS.priority;
  return vals.map(function (v) { return { v: v, l: cap(v) }; });
}

function buildCombinationCheckboxListHtml(selectedTypes, selectedCombos, meta, filter) {
  filter = (filter || '').trim();
  var comboTypes = getComboTypesFromSelection(selectedTypes);
  if (!comboTypes.length) {
    return '<p class="pt-combo-hint">Select a product type above to see combinations.</p>';
  }
  var html = '';
  comboTypes.forEach(function (type) {
    var combos = getCombinationsForProductType(type, meta).filter(function (c) {
      return matchCombinationFilter(c, filter);
    });
    if (!combos.length) return;
    html += '<div class="pt-combo-group" data-type="' + esc(type) + '">' +
      '<div class="pt-combo-group-title">' + esc(getProductTypeLabel(type)) + '</div>';
    html += combos.map(function (c) {
      var checked = selectedCombos.indexOf(c) >= 0;
      // title carries the full value — labels are single-line with an ellipsis.
      return '<label class="pt-combo-check" title="' + escAttr(c) + '">' +
        '<input type="checkbox" class="pt-combo-cb-input pt-combo-cb" value="' + esc(c) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="pt-combo-check-label">' + esc(c) + '</span></label>';
    }).join('');
    html += '</div>';
  });
  if (!html) {
    return '<p class="pt-combo-hint">' + (filter ? 'No combinations match “' + esc(filter) + '”.' : 'No combinations available.') + '</p>';
  }
  return html;
}

function buildProductTypeComboPickerHtml(sel, meta, spaceId) {
  var fieldId = meta && meta.id ? meta.id : '';
  sel = sel || emptyPtComboSelection();
  var ptOptions = getProductTypeOptionsForSpace(spaceId || (meta && meta.space_id));
  return '<div class="pt-combo-picker" data-field-id="' + esc(fieldId) + '">' +
    '<div class="pt-combo-section">' +
      '<div class="pt-combo-section-title">Product Type</div>' +
      '<div class="pt-combo-panel pt-combo-panel-types">' +
        '<div class="pt-combo-checklist pt-type-list">' + buildProductTypeCheckboxListHtml(sel.productTypes, ptOptions) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="pt-combo-section">' +
      '<div class="pt-combo-section-title">Combinations</div>' +
      '<div class="pt-combo-panel">' +
        '<div class="pt-combo-panel-toolbar">' +
          '<div class="pt-combo-search-wrap">' +
            '<svg class="pt-combo-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" class="pt-combo-search" placeholder="Search…" autocomplete="off" spellcheck="false">' +
          '</div>' +
        '</div>' +
        '<div class="pt-combo-checklist pt-combo-list">' +
          buildCombinationCheckboxListHtml(sel.productTypes, sel.combinations, meta, '') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function bindProductTypeComboPicker(container, meta, config) {
  config = config || {};
  var stateKey = config.stateKey || '_issuePtComboSel';
  var sel = window[stateKey] || emptyPtComboSelection();
  window[stateKey] = sel;

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(sel);
  }

  function readTypeCheckboxes() {
    sel.productTypes = [];
    container.querySelectorAll('.pt-type-cb:checked').forEach(function (cb) {
      sel.productTypes.push(cb.value);
    });
    pruneCombinationsForTypes(sel, meta);
    refreshComboList();
    notify();
  }

  function readComboCheckboxes(ev) {
    var target = ev && ev.target;
    if (target && target.classList.contains('pt-combo-cb')) {
      var val = target.value;
      var idx = sel.combinations.indexOf(val);
      if (target.checked && idx < 0) sel.combinations.push(val);
      else if (!target.checked && idx >= 0) sel.combinations.splice(idx, 1);
    } else {
      var merged = sel.combinations.slice();
      container.querySelectorAll('.pt-combo-cb:checked').forEach(function (cb) {
        if (merged.indexOf(cb.value) < 0) merged.push(cb.value);
      });
      container.querySelectorAll('.pt-combo-cb:not(:checked)').forEach(function (cb) {
        var i = merged.indexOf(cb.value);
        if (i >= 0) merged.splice(i, 1);
      });
      sel.combinations = merged;
    }
    notify();
  }

  function refreshComboList() {
    var list = container.querySelector('.pt-combo-list');
    var search = container.querySelector('.pt-combo-search');
    if (!list) return;
    var filter = search ? search.value : '';
    list.innerHTML = buildCombinationCheckboxListHtml(sel.productTypes, sel.combinations, meta, filter);
    list.querySelectorAll('.pt-combo-cb').forEach(function (cb) {
      cb.addEventListener('change', readComboCheckboxes);
    });
  }

  container.querySelectorAll('.pt-type-cb').forEach(function (cb) {
    cb.addEventListener('change', readTypeCheckboxes);
  });

  var search = container.querySelector('.pt-combo-search');
  if (search) {
    search.addEventListener('input', refreshComboList);
    search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        search.value = '';
        refreshComboList();
        search.blur();
      }
    });
  }

  container.querySelectorAll('.pt-combo-cb').forEach(function (cb) {
    cb.addEventListener('change', readComboCheckboxes);
  });
}

function readPtComboSelectionFromContainer(container) {
  var sel = emptyPtComboSelection();
  if (!container) return sel;
  container.querySelectorAll('.pt-type-cb:checked').forEach(function (cb) {
    sel.productTypes.push(cb.value);
  });
  container.querySelectorAll('.pt-combo-cb:checked').forEach(function (cb) {
    sel.combinations.push(cb.value);
  });
  return sel;
}

function getProductTypeSetsFieldValue() {
  var spaceId = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || '';
  // Read the combined picker whenever THIS space is in combo mode — was gated on
  // spaceId === Product_Team, so another space's picker would have been ignored
  // on submit and its combination silently dropped.
  if (productTypeMode(spaceId, 'create') === 'combo') {
    var container = $('issueCombinationField');
    var sel = _issuePtComboSel || readPtComboSelectionFromContainer(container);
    if (!sel.productTypes.length && !sel.combinations.length && container) {
      sel = readPtComboSelectionFromContainer(container);
    }
    var meta = findCombinationFieldMeta(spaceId);
    var serialized = serializePtComboSelection(sel);
    return {
      product_type: serialized.product_type,
      combination: serialized.combination,
      fieldId: meta ? meta.id : null
    };
  }
  var pt = $('issueProductType') ? $('issueProductType').value : '';
  return pt ? { product_type: pt, combination: null, fieldId: null } : null;
}

function saveDrawerPtComboSelection(issueId, sel, meta) {
  if (!window._drawerPtComboSaveTimer) window._drawerPtComboSaveTimer = null;
  clearTimeout(window._drawerPtComboSaveTimer);
  window._drawerPtComboSaveTimer = setTimeout(function () {
    var serialized = serializePtComboSelection(sel || emptyPtComboSelection());
    api('/api/issues/' + issueId, 'PUT', { product_type: serialized.product_type }).catch(function () {
      toast('Failed to save product type', 'error');
    });
    if (meta && meta.id) {
      api('/api/issues/' + issueId + '/field-values/' + meta.id, 'PUT', { value: serialized.combination || '' })
        .catch(function () { toast('Failed to save combinations', 'error'); });
    }
  }, 350);
}

function getCombinationFieldValue() {
  var ptPayload = getProductTypeSetsFieldValue();
  if (ptPayload && ptPayload.fieldId && ptPayload.combination) {
    return { fieldId: ptPayload.fieldId, value: ptPayload.combination };
  }
  var container = $('issueCombinationField');
  if (!container) return null;
  var box = container.querySelector('.combo-box');
  if (!box) {
    return ptPayload && ptPayload.combination && ptPayload.fieldId
      ? { fieldId: ptPayload.fieldId, value: ptPayload.combination }
      : null;
  }
  var val = box.dataset.value || '';
  var fieldId = box.dataset.cfId;
  if (!fieldId || !val) return null;
  return { fieldId: fieldId, value: val };
}

function normalizeCFOptions(opts) {
  if (!opts) return [];
  var arr = Array.isArray(opts) ? opts : (typeof opts === 'string' ? (function () { try { return JSON.parse(opts); } catch (_) { return []; } })() : []);
  return arr.map(function (o) {
    if (o && typeof o === 'object') return String(o.value != null ? o.value : (o.label != null ? o.label : o));
    return String(o);
  });
}

// Builds <option> HTML for the builtin Team / Product Type <select>s from
// whatever the space's own custom_fields.options actually says right now --
// index.html used to hardcode a fixed 5-option list for each, so editing a
// space's Team/Product Type options in Custom Field settings never showed up
// in Create Issue or the drawer at all. currentValue is kept as a visible
// option even if it's since been removed from the configured list (labeled
// "(removed)"), so a ticket that already has that value doesn't look like it
// silently lost it -- but it isn't offered as a fresh choice for anything
// else, since it no longer appears in the space's real option list.
var BUILTIN_SELECT_FALLBACKS = {
  type: ['epic', 'story', 'task', 'bug', 'subtask'],
  priority: ['highest', 'high', 'medium', 'low', 'lowest']
};

function buildBuiltinSelectOptionsHtml(fieldKey, spaceId, currentValue, placeholderLabel) {
  var field = (S.data.custom_fields || []).find(function (f) {
    return f.space_id == spaceId && f.field_key === fieldKey;
  });
  var opts = field ? getCustomFieldOptions(field) : [];
  // Every space is seeded with a real type/priority custom_fields row (see
  // seedBuiltinIssueFields), so this only fires before that data has loaded —
  // still needed so the dropdown isn't empty during that window.
  if (!opts.length && BUILTIN_SELECT_FALLBACKS[fieldKey]) opts = BUILTIN_SELECT_FALLBACKS[fieldKey];
  var label = function (v) {
    if (fieldKey === 'product_type') return getProductTypeLabel(v);
    if (fieldKey === 'type' || fieldKey === 'priority') return cap(v);
    return v;
  };
  var html = placeholderLabel ? ('<option value="">' + esc(placeholderLabel) + '</option>') : '';
  var found = false;
  opts.forEach(function (o) {
    if (String(o) === String(currentValue)) found = true;
    html += '<option value="' + escAttr(o) + '">' + esc(label(o)) + '</option>';
  });
  if (currentValue && !found) {
    html += '<option value="' + escAttr(currentValue) + '">' + esc(label(currentValue)) + ' (removed)</option>';
  }
  return html;
}

// Just the configured value itself -- used to map PRODUCT_TYPE_LABELS
// (combination-options.js), a fixed {Message: 'Message Type', ...} override
// that didn't cover every value (Manage/Infra passed through unchanged) and
// disagreed with the plain value shown everywhere else a Product Type is
// displayed (dropdowns, badges, filters). Removed for consistency.
function getProductTypeLabel(value) {
  return value || '';
}

// Any group key, not just the original fixed Message/Email/Content trio --
// groups now has one entry per Product Type option the space actually has
// configured (see renderCombinationGroupEditors), which can be any name.
function flattenCombinationGroups(groups) {
  var out = [];
  var seen = {};
  if (!groups) return out;
  Object.keys(groups).forEach(function (k) {
    (groups[k] || []).forEach(function (o) {
      var key = String(o).toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(o); }
    });
  });
  return out.sort(function (a, b) { return a.localeCompare(b); });
}

function parseCombinationFieldOptions(field) {
  var raw = field && field.options !== undefined ? field.options : field;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  if (raw && raw.v === 2 && raw.groups) {
    return {
      groups: raw.groups,
      flat: raw.flat || flattenCombinationGroups(raw.groups)
    };
  }
  // No groups info at all (a bare flat array, or nothing usable) -- there is
  // no per-type breakdown to recover here, so this is just the flat list with
  // an empty groups map, rather than guessing a category for each entry.
  var flat = Array.isArray(raw) ? raw.slice() : getCombinationOptionsList();
  return { groups: {}, flat: flat };
}

// Every Product Type gets its own group, keyed by whatever that type's real
// value is -- no more special-casing specific type names to see "all"
// combinations or none. A type with nothing configured for it yet correctly
// returns [], which the picker already renders as "No combinations available".
function getCombinationsForProductType(productType, fieldMeta) {
  var parsed = fieldMeta ? parseCombinationFieldOptions(fieldMeta) : null;
  if (parsed && parsed.groups && parsed.groups[productType]) {
    return parsed.groups[productType].slice();
  }
  return [];
}

function getCombinationOptionsList(fieldMeta) {
  if (fieldMeta) {
    var parsed = parseCombinationFieldOptions(fieldMeta);
    if (parsed.flat && parsed.flat.length) return parsed.flat.slice();
  }
  return (typeof COMBINATION_OPTIONS !== 'undefined' ? COMBINATION_OPTIONS : (window.COMBINATION_OPTIONS || [])).slice();
}

/** Source label = text before " - " (e.g. "Box" from "Box - SharePoint"). */
function getCombinationSourceLabel(option) {
  if (!option) return '';
  var idx = String(option).indexOf(' - ');
  return idx >= 0 ? String(option).slice(0, idx).trim() : String(option).trim();
}

/** Match query against source only, from the start — not destination/middle. */
function matchCombinationSearch(option, query) {
  if (!query || !String(query).trim()) return true;
  var q = String(query).trim().toLowerCase();
  return getCombinationSourceLabel(option).toLowerCase().startsWith(q);
}

/** Full-text filter for checkbox lists — matches source, destination, or anywhere in label. */
function matchCombinationFilter(option, query) {
  if (!query || !String(query).trim()) return true;
  var q = String(query).trim().toLowerCase();
  var full = String(option || '').toLowerCase();
  if (full.indexOf(q) >= 0) return true;
  var parts = String(option || '').split(' - ');
  var src = (parts[0] || '').trim().toLowerCase();
  var dst = (parts[1] || parts[0] || '').trim().toLowerCase();
  if (src.indexOf(q) >= 0 || dst.indexOf(q) >= 0) return true;
  return q.split(/\s+/).every(function (word) {
    return word && full.indexOf(word) >= 0;
  });
}

function getCustomFieldOptions(field) {
  if (isCombinationField(field)) return getCombinationOptionsList(field);
  return normalizeCFOptions(field.options);
}

function getCustomFieldRenderType(field) {
  // Combination uses searchable single-select UI (matches production)
  if (isCombinationField(field)) return 'select';
  return field.field_type || 'text';
}

function buildCFSelectWrapInnerHtml(fid, ftype, opts, val, searchPlaceholder, isCombination) {
  var isMultiSel = ftype === 'multi_select';
  var selected = val ? String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var displayVal = selected.length ? esc(selected.join(', ')) : '';
  var filterPh = searchPlaceholder || (isCombination ? 'Search source e.g. Box…' : 'Search…');
  var comboClass = isCombination ? ' cf-combination-select' : '';
  return '<div class="cf-select-wrap' + comboClass + '" data-cf-id="' + fid + '" data-multi="' + (isMultiSel ? '1' : '0') + '"' + (isCombination ? ' data-combination="1"' : '') + '">' +
    '<div class="cf-select-trigger">' +
      '<input class="cf-sel-search" type="text" value="' + displayVal + '" placeholder="' + (isMultiSel ? 'Select options…' : '— Select —') + '" readonly autocomplete="off">' +
      (selected.length ? '<span class="cf-sel-clear" title="Clear">×</span>' : '') +
      '<span class="cf-sel-arrow">⌄</span>' +
    '</div>' +
    '<div class="cf-select-dropdown" style="display:none">' +
      '<div class="cf-sel-search-wrap">' +
        '<svg class="cf-sel-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input class="cf-sel-filter" type="text" placeholder="' + esc(filterPh) + '" autocomplete="off">' +
      '</div>' +
      '<div class="cf-sel-list">' +
      opts.map(function (o) {
        var sel = selected.indexOf(o) >= 0;
        var checkboxHtml = isMultiSel
          ? '<input type="checkbox" class="cf-sel-opt-checkbox" style="pointer-events:none;margin-right:8px" tabindex="-1"' + (sel ? ' checked' : '') + '>'
          : '';
        return '<div class="cf-sel-opt' + (sel ? ' cf-sel-opt-active' : '') + '" data-val="' + esc(o) + '">' + checkboxHtml + esc(o) + '</div>';
      }).join('') +
      '</div>' +
      (isCombination ? '<div class="cf-sel-empty" style="display:none">No combinations match your search</div>' : '') +
    '</div>' +
  '</div>';
}

function positionCFDropdown(wrapEl) {
  var dropdown = wrapEl.querySelector('.cf-select-dropdown');
  var trigger = wrapEl.querySelector('.cf-select-trigger');
  if (!dropdown || !trigger) return;
  if (!wrapEl.closest('#modal-issue') && !wrapEl.dataset.combination) return;
  var rect = trigger.getBoundingClientRect();
  var maxH = Math.min(320, window.innerHeight - rect.bottom - 16);
  if (maxH < 120) maxH = Math.min(320, rect.top - 16);
  dropdown.style.position = 'fixed';
  dropdown.style.left = Math.max(8, rect.left) + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.style.right = 'auto';
  dropdown.style.zIndex = '10050';
  dropdown.style.maxHeight = maxH + 'px';
  if (rect.bottom + maxH > window.innerHeight - 8 && rect.top > maxH + 8) {
    dropdown.style.top = Math.max(8, rect.top - maxH - 4) + 'px';
  } else {
    dropdown.style.top = (rect.bottom + 4) + 'px';
  }
}

function resetCFDropdownPosition(dropdown) {
  if (!dropdown) return;
  dropdown.style.position = '';
  dropdown.style.left = '';
  dropdown.style.top = '';
  dropdown.style.width = '';
  dropdown.style.right = '';
  dropdown.style.zIndex = '';
  dropdown.style.maxHeight = '';
}

function bindCFSelectWrap(el, config) {
  config = config || {};
  var isMulti = el.dataset.multi === '1';
  var isCombination = el.dataset.combination === '1';
  var selArr = Array.from(el.querySelectorAll('.cf-sel-opt-active')).map(function (o) { return o.dataset.val; });
  var trigger = el.querySelector('.cf-select-trigger');
  var dropdown = el.querySelector('.cf-select-dropdown');
  var searchInput = el.querySelector('.cf-sel-search');
  var filterInput = el.querySelector('.cf-sel-filter');

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(selArr.join(','), selArr);
  }

  function refreshTrigger() {
    searchInput.value = selArr.length ? selArr.join(', ') : '';
    searchInput.placeholder = isMulti ? 'Select options…' : '— Select —';
    var clearBtn = trigger.querySelector('.cf-sel-clear');
    if (selArr.length && !clearBtn) {
      var c = document.createElement('span');
      c.className = 'cf-sel-clear'; c.title = 'Clear'; c.textContent = '×';
      trigger.insertBefore(c, trigger.querySelector('.cf-sel-arrow'));
    } else if (!selArr.length && clearBtn) {
      clearBtn.remove();
    }
  }

  function refreshOpts(filter) {
    var visible = 0;
    el.querySelectorAll('.cf-sel-opt').forEach(function (opt) {
      var v = opt.dataset.val;
      var active = selArr.indexOf(v) >= 0;
      opt.classList.toggle('cf-sel-opt-active', active);
      var cb = opt.querySelector('.cf-sel-opt-checkbox');
      if (cb) cb.checked = active;
      var show = !filter || (isCombination
        ? matchCombinationSearch(v, filter)
        : v.toLowerCase().indexOf(filter.toLowerCase()) >= 0);
      opt.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var emptyEl = el.querySelector('.cf-sel-empty');
    if (emptyEl) emptyEl.style.display = (filter && visible === 0) ? 'block' : 'none';
  }

  function openDropdown() {
    qsa('.cf-select-dropdown').forEach(function (d) {
      if (d !== dropdown) {
        d.style.display = 'none';
        resetCFDropdownPosition(d);
      }
    });
    dropdown.style.display = 'block';
    positionCFDropdown(el);
    if (filterInput) {
      filterInput.value = '';
      refreshOpts('');
      setTimeout(function () { filterInput.focus(); }, 0);
    }
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    resetCFDropdownPosition(dropdown);
    if (filterInput) filterInput.value = '';
    refreshOpts('');
  }

  trigger.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (ev.target.classList.contains('cf-sel-clear')) {
      selArr = []; refreshTrigger(); refreshOpts(''); notify();
      return;
    }
    var isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  if (filterInput) {
    filterInput.addEventListener('input', function (ev) {
      ev.stopPropagation();
      refreshOpts(filterInput.value);
    });
    filterInput.addEventListener('click', function (ev) { ev.stopPropagation(); });
    filterInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeDropdown(); ev.preventDefault(); }
      if (ev.key === 'Enter') {
        var first = el.querySelector('.cf-sel-opt:not([style*="display: none"])') || el.querySelector('.cf-sel-opt');
        var vis = Array.from(el.querySelectorAll('.cf-sel-opt')).filter(function (o) { return o.style.display !== 'none'; });
        if (vis.length) {
          vis[0].click();
          ev.preventDefault();
        }
      }
    });
  }

  el.querySelectorAll('.cf-sel-opt').forEach(function (opt) {
    opt.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var v = opt.dataset.val;
      if (isMulti) {
        var idx = selArr.indexOf(v);
        if (idx >= 0) selArr.splice(idx, 1); else selArr.push(v);
      } else {
        selArr = [v];
        closeDropdown();
      }
      refreshTrigger(); refreshOpts(filterInput ? filterInput.value : '');
      notify();
    });
  });
}

function bindCreateModalCustomFields(container) {
  if (!container) return;
  container.querySelectorAll('.cf-select-wrap[data-cf-id]').forEach(function (el) {
    bindCFSelectWrap(el);
  });
}

function getCreateModalCustomFieldValues() {
  var cfs = {};
  var container = $('issueCustomFieldsContainer');
  if (!container) return cfs;
  container.querySelectorAll('[data-cf-id]').forEach(function (el) {
    var id = el.dataset.cfId;
    if (!id) return;
    if (el.classList.contains('cf-select-wrap')) {
      var sel = Array.from(el.querySelectorAll('.cf-sel-opt-active')).map(function (o) { return o.dataset.val; });
      if (sel.length) cfs[id] = sel.join(',');
    } else if (el.classList.contains('cf-field')) {
      if (el.tagName === 'SELECT' && el.multiple) {
        var mv = Array.from(el.selectedOptions).map(function (o) { return o.value; }).join(',');
        if (mv) cfs[id] = mv;
      } else if (el.type === 'checkbox') {
        // The input carries a literal value="true", so reading .value would
        // save "true" for an unchecked box — read .checked instead.
        if (el.checked) cfs[id] = 'true';
      } else if (el.value) cfs[id] = el.value;
    }
  });
  return cfs;
}

async function renderDrawerCustomFields(cfValues, issueId, spaceId) {
  var c = $('drawerCustomFields');
  if (!c) return;

  // Any space may own a Combination field now, so preload its options whenever
  // one is configured rather than only for Product_Team.
  if (spaceId && findCombinationFieldMeta(spaceId)) {
    await ensureCombinationFieldMeta(spaceId);
  }

  // Get ALL custom fields defined for this space
  var spaceFields = (S.data.custom_fields || []).filter(function(f) { return f.space_id == spaceId; });

  // Fallback: fetch from API if local cache doesn't have this space's fields
  if (!spaceFields.length && spaceId) {
    try {
      var fetched = await api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId), 'GET', null, { silent: true });
      if (fetched && fetched.length) {
        spaceFields = fetched;
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return f.space_id != spaceId; })
          .concat(fetched);
      }
    } catch(e) {}
  }

  if (!spaceFields.length) { c.innerHTML = ''; return; }

  // Build a lookup map of existing values: field_id → value
  // Merge: prefer live cfValues passed in, fallback to bulk-loaded S.data.issue_field_values
  var valueMap = {};
  var bulkVals = (S.data.issue_field_values || []).filter(function(v) { return v.issue_id == issueId; });
  bulkVals.forEach(function(v) { valueMap[v.field_id] = v.value; });
  (cfValues || []).forEach(function(v) { valueMap[v.field_id] = v.value; }); // live values override

  // Fields that are already rendered as built-in drawer fields — skip to avoid duplicates.
  // Also covers custom fields that collide with the built-in Story Points
  // column: without this, editing such a field silently writes to
  // issue_field_values instead of issues.story_points, which reports (Burn
  // Chart, Sprint Summary, etc.) never read — the edit looks like it saved
  // but the real story_points value never changes.
  var _builtinFields = ['team', 'product type', 'story points', 'story_points', 'storypoints', 'points', 'sp'];
  var html = '';
  spaceFields.forEach(function(field) {
    if (field.is_builtin) return;
    if (_builtinFields.indexOf((field.name || '').toLowerCase().trim()) !== -1) return;
    if (isCombinationField(field)) return;
    if (!customFieldShowsIn(field, 'drawer')) return;
    var fid = field.id;
    var fname = esc(field.name);
    var ftype = field.field_type || 'text';
    var val = valueMap[fid] !== undefined ? valueMap[fid] : '';
    var req = field.is_required ? ' <span style="color:var(--red);font-size:11px">*</span>' : '';
    var inputHtml = '';

    if (ftype === 'text') {
      inputHtml = '<input type="text" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '" placeholder="—">';
    } else if (ftype === 'textarea') {
      inputHtml = '<textarea class="input input-sm" data-cf-id="' + fid + '" rows="8" placeholder="—">' + esc(val) + '</textarea>';
    } else if (ftype === 'number') {
      inputHtml = '<input type="number" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '" placeholder="—">';
    } else if (ftype === 'date') {
      inputHtml = '<input type="date" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '">';
    } else if (ftype === 'checkbox') {
      inputHtml = '<input type="checkbox" data-cf-id="' + fid + '" ' + (val === 'true' ? 'checked' : '') + '>';
    } else if (ftype === 'select' || ftype === 'multi_select') {
      if (isCombinationField(field)) {
        var comboVal = val && typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(val) : val;
        inputHtml = buildCombinationComboboxHtml(fid, comboVal);
      } else {
        var mopts = getCustomFieldOptions(field);
        var renderType = getCustomFieldRenderType(field);
        inputHtml = buildCFSelectWrapInnerHtml(fid, renderType, mopts, val, 'Search…', false);
      }
    } else if (ftype === 'user') {
      var uopts = (S.data.users || [])
        .map(function(u) { return '<option value="' + u.id + '"' + (u.id == val ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');
      inputHtml = '<select class="input input-sm" data-cf-id="' + fid + '"><option value="">—</option>' + uopts + '</select>';
    }

    html += '<tr><td class="dfl">' + fname + req + '</td><td class="dfv">' + inputHtml + '</td></tr>';
  });

  c.innerHTML = html;

  // Bind save-on-change for all inputs
  c.querySelectorAll('[data-cf-id]').forEach(function(el) {
    var fieldId = el.dataset.cfId;
    var isSelectWrap = el.classList.contains('cf-select-wrap');
    var saveTimer = null;

    function saveValue(value) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        api('/api/issues/' + issueId + '/field-values/' + fieldId, 'PUT', { value: value })
          .catch(function() { toast('Failed to save field', 'error'); });
      }, 400);
    }

    if (isSelectWrap) {
      bindCFSelectWrap(el, {
        onChange: function (value) { saveValue(value); }
      });
    } else if (el.classList.contains('combo-box')) {
      bindCombinationCombobox(el, {
        onChange: function (value) { saveValue(value); }
      });
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', function() { saveValue(el.checked ? 'true' : 'false'); });
    } else {
      el.addEventListener('change', function() { saveValue(el.value); });
      el.addEventListener('input', function() { saveValue(el.value); });
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SPACE CRUD
// ═══════════════════════════════════════════════════════════
function canCreateSpace() {
  return isOrgAdminUser();
}

function getMySpaceRole(spaceId) {
  if (!spaceId) return null;
  var sm = (S.data.space_members || []).find(function(m) {
    return m.space_id === spaceId && m.user_id === S.currentUser;
  });
  return sm ? (sm.role || 'member') : null;
}

function isSpaceAdmin(spaceId) {
  if (!spaceId) return false;
  if (isOrgAdminUser()) return true;
  return normalizeSpaceRole(getMySpaceRole(spaceId)) === 'site_admin';
}

function isSpaceMemberOnly(spaceId) {
  if (!spaceId) return false;
  if (isOrgAdminUser()) return false;
  var role = getMySpaceRole(spaceId);
  return !!role && normalizeSpaceRole(role) === 'member';
}

// Space settings, reports, sprints, people — org admin or space admin (requires space)
function canManageSpace(spaceId) {
  return isSpaceAdmin(spaceId);
}

function canCreateSprint(spaceId) {
  return canManageSpace(spaceId);
}

function isSpaceAdminAnywhere() {
  if (isOrgAdminUser()) return true;
  return (S.data.space_members || []).some(function(m) {
    return m.user_id === S.currentUser && normalizeSpaceRole(m.role) === 'site_admin';
  });
}

function canViewReports() {
  return isOrgAdminUser() || isSpaceAdminAnywhere();
}

// Mirrors the backend's ACTION_MIN_ROLE — 'issue.delete' and 'issue.bulk' both
// need site_admin in the space. Org admins pass everywhere. Keep these in step
// with lib/permissions.js: a UI check that is stricter than the server hides a
// button the user is actually allowed to press.
function canDeleteIssue(spaceId) {
  return isSpaceAdmin(spaceId);
}
// Restore and permanent delete are org-admin only, by design: a space admin can
// put things in the bin but not empty it or pull things back out. The bin itself
// reads the server's `can_restore` flag rather than re-deriving that here, so the
// button set can never disagree with what the API will allow.
function canDeleteSpace() {
  return isOrgAdminUser();
}

function updateRoleBasedUI() {
  var createSprintBtn = $('createSprintBtn');
  if (createSprintBtn) {
    var showSprint = S.currentTab === 'backlog' && !!S.currentSpace && canCreateSprint(S.currentSpace);
    createSprintBtn.style.display = showSprint ? '' : 'none';
  }
}

function isSpaceOwner(spaceId) {
  return canManageSpace(spaceId);
}

function openSpaceModal(space) {
  // Members can only edit, not create
  if (!space && !canCreateSpace()) {
    toast('Only admins can create spaces.', 'error');
    return;
  }
  if (space && space.id) {
    $('spaceId').value = space.id;
    $('spaceName_input').value = space.name || '';
    $('spaceKey_input').value = space.key || '';
    $('spaceDesc').value = space.description || '';
    $('spaceIconInput').value = space.icon || '';
    $('spaceColor').value = space.color || '#2563eb';
    $('spaceType').value = space.space_type || 'scrum';
    $('spaceVisibility').value = space.visibility || 'private';
    $('spaceModalTitle').textContent = 'Edit Space';
  } else {
    $('spaceId').value = '';
    $('spaceName_input').value = '';
    $('spaceKey_input').value = '';
    $('spaceDesc').value = '';
    $('spaceIconInput').value = '';
    $('spaceColor').value = '#2563eb';
    $('spaceType').value = 'scrum';
    $('spaceVisibility').value = 'private';
    $('spaceModalTitle').textContent = 'Create Space';
  }
  updateVisibilityHint($('spaceVisibility').value);
  openModal('modal-space');
}
window.openSpaceModal = openSpaceModal;

window.updateVisibilityHint = function(val) {
  var el = $('visibilityHint');
  if (!el) return;
  var hints = {
    private: '🔒 Only users you explicitly add as members can see this space.',
    team: '👥 All members of your organization can view this space.',
    org: '🌐 Visible across the entire organization, including viewers and guests.'
  };
  el.textContent = hints[val] || '';
};

async function handleSpaceSubmit(e) {
  e.preventDefault();
  var id = $('spaceId').value;
  var spaceName = $('spaceName_input').value;
  var spaceKey = $('spaceKey_input').value.trim().toUpperCase();

  // Fail fast on a key that is visibly taken, so the user is told before the
  // round-trip. The server repeats this check and is the real gate — it also
  // sees ARCHIVED spaces, which /api/data filters out, so a clash this misses
  // still comes back as a 409 and lands in the popup below.
  var keyClash = (S.data.spaces || []).find(function (sp) {
    return sp.id !== id && String(sp.key || '').toUpperCase() === spaceKey;
  });
  if (keyClash) {
    popupAlert('Key already in use',
      'The key "' + spaceKey + '" belongs to the space "' + keyClash.name + '". Space keys must be unique — pick a different one.',
      'error');
    return;
  }

  var payload = {
    name: spaceName,
    key: spaceKey,
    description: $('spaceDesc').value,
    icon: $('spaceIconInput').value,
    color: $('spaceColor').value,
    space_type: $('spaceType').value,
    visibility: $('spaceVisibility').value,
    owner_id: S.currentUser
  };

  try {
    if (id) {
      await api('/api/spaces/' + id, 'PUT', payload);
      closeModal('modal-space');
      await refreshData();
      renderSidebar();
      if (S.currentSpace) { var sp = getSpace(S.currentSpace); if (sp) renderSpaceHeader(sp); }
      popupAlert('Space Updated', '"' + spaceName + '" has been updated successfully.', 'success');
    } else {
      var newSpace = await api('/api/spaces', 'POST', payload);
      closeModal('modal-space');
      await refreshData();
      renderSidebar();
      popupAlert('Space Created', '"' + spaceName + '" space has been created successfully.', 'success');
      if (newSpace && newSpace.id) navigateToSpace(newSpace.id, 'summary');
    }
  } catch (err) {
    popupAlert('Error', err.message || 'Could not save space. Please try again.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// SPRINT CRUD
// ═══════════════════════════════════════════════════════════
async function handleSprintSubmit(e) {
  e.preventDefault();
  var id = $('sprintIdInput').value;
  var payload = {
    space_id: $('sprintSpaceId').value || S.currentSpace,
    name: $('sprintNameInput').value,
    goal: $('sprintGoal').value,
    start_date: $('sprintStartDate').value || null,
    end_date: $('sprintEndDate').value || null,
    developer_ids: collectCheckedIds('sprintDeveloperList'),
    qa_ids: collectCheckedIds('sprintQaList'),
    public_holidays: Array.from(window._sprintHolidaySet || []).sort(),
    developer_leaves: Object.assign({}, window._sprintDeveloperLeaves || {})
  };

  if (id) {
    await api('/api/sprints/' + id, 'PUT', payload);
    toast('Sprint updated');
  } else {
    await api('/api/sprints', 'POST', payload);
    toast('Sprint created');
  }
  closeModal('modal-sprint');
  await refreshData();
  if (S.currentTab === 'backlog') renderBacklog();
  else if (S.currentTab === 'sprint') renderSprintBoard();
}

// ═══════════════════════════════════════════════════════════
// ISSUE CRUD
// ═══════════════════════════════════════════════════════════
function resetIssueForm() {
  $('issueId').value = '';
  $('issueSpaceId').value = S.currentSpace || '';
  $('issueParentId').value = '';
  // Populate space dropdown with current space selected
  if (window._populateIssueSpaceDropdown) window._populateIssueSpaceDropdown(S.currentSpace || '');
  $('issueTitleInput').value = '';
  $('issueType').value = 'task';
  $('issuePriority').value = 'medium';
  $('issuePoints').value = '';
  if ($('issueTeam')) $('issueTeam').value = '';
  if ($('issueProductType')) $('issueProductType').value = '';
  _issuePtComboSel = null;
  $('issueStartDate').value = fmtDateISO(new Date()); // default to today
  $('issueDueDate').value = '';
  var descEl = document.getElementById('issueDescContent'); if (descEl) descEl.innerHTML = '';
  if ($('issueAssigneeSearch')) $('issueAssigneeSearch').value = '';
  if ($('issueAssignee')) $('issueAssignee').value = '';
  if ($('issueReporterSearch')) $('issueReporterSearch').value = '';
  if ($('issueReporter')) $('issueReporter').value = '';
  if ($('assigneeDropdown')) $('assigneeDropdown').style.display = 'none';
  if ($('reporterDropdown')) $('reporterDropdown').style.display = 'none';
  _selectedFiles = [];
  _revokeAttachmentThumbUrls();
  _lastPasteFingerprint = '';
  _lastPasteTime = 0;
  _issuePasteBusy = false;
  _renderAttachmentFileList();
  var fi = $('issueAttachments');
  if (fi) fi.value = '';
  var fnLabel = $('attachmentFileNames');
  if (fnLabel) fnLabel.textContent = 'No files chosen';
  var cfContainer = $('issueCustomFieldsContainer');
  if (cfContainer) cfContainer.innerHTML = '';
  var comboContainer = $('issueCombinationField');
  if (comboContainer) comboContainer.innerHTML = '';
  var comboGroup = $('issueCombinationGroup');
  if (comboGroup) comboGroup.hidden = true;
}

function populateIssueFormSelects(opts) {
  opts = opts || {};
  var spaceId = $('issueSpaceId').value || S.currentSpace;
  var members = spaceId ? getSpaceMembers(spaceId) : (S.data.users || []);
  if (!members.length) members = S.data.users || [];
  var sprints = spaceId ? getIssueFormSprints(spaceId, opts) : [];

  initUserSearchDropdown('issueAssigneeSearch', 'issueAssignee', 'assigneeDropdown', members, null);
  initUserSearchDropdown('issueReporterSearch', 'issueReporter', 'reporterDropdown', members, S.currentUser);
  populateSprintSelect($('issueSprint'), sprints, opts.includeSprintId || null);
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  // Space first — required-field validation is per space, so it needs to be
  // resolved before anything else can be checked.
  // No spaces[0] fallback: it made the guard below unreachable, so submitting
  // with nothing selected quietly created the ticket in whichever space happened
  // to be first in the list.
  var spaceVal = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || '';
  if (spaceVal == null || spaceVal == '') {
    toast('Please select a Space — it is mandatory', 'error');
    var spaceSel = $('issueSpaceSelect');
    if (spaceSel) { spaceSel.focus(); }
    return;
  }
  // Enforces whatever is flagged Required in Settings → Custom Fields for this
  // space (built-in and custom alike), instead of hardcoding Title.
  if (!validateCreateRequiredFields(spaceVal)) return;
  var teamVal = $('issueTeam') ? $('issueTeam').value : '';
  var productVal = $('issueProductType') ? $('issueProductType').value : '';
  var startVal = $('issueStartDate').value;
  if (!_validateIssueAttachments()) return;
  var descEl = document.getElementById('issueDescContent');
  var rawDesc = getDescriptionHtmlForSave(descEl);
  if (rawDesc.length > ISSUE_MAX_DESC_CHARS) {
    toast('Description is too large — remove extra content or use attachments for files', 'error');
    return;
  }
  // Validate due date does not exceed sprint end date
  var dueVal = $('issueDueDate').value;
  if (dueVal) {
    var sprintId = $('issueSprint').value;
    if (sprintId) {
      var sprint = (S.data.sprints || []).find(function(sp){ return sp.id === sprintId; });
      if (sprint && sprint.end_date) {
        var sprintEnd = new Date(sprint.end_date.slice(0,10) + 'T00:00:00');
        var duePicked = new Date(dueVal + 'T00:00:00');
        if (duePicked > sprintEnd) {
          toast('Due date cannot exceed sprint end date (' + sprint.end_date.slice(0,10) + ')', 'error');
          $('issueDueDate').focus();
          return;
        }
      }
    }
  }
  var id = $('issueId').value;
  var parentId = $('issueParentId').value || null;
  // Already validated above as non-empty — reuse it rather than re-resolving with
  // a different fallback chain, which is how the two could disagree.
  var resolvedSpace = spaceVal;
  var ptPayload = getProductTypeSetsFieldValue();
  var payload = {
    space_id: resolvedSpace,
    title: $('issueTitleInput').value,
    type: $('issueType').value,
    priority: $('issuePriority').value,
    assignee_id: $('issueAssignee').value || null,
    reporter_id: $('issueReporter').value || S.currentUser || null,
    sprint_id: $('issueSprint').value || null,
    story_points: $('issuePoints').value ? parseInt($('issuePoints').value, 10) : null,
    team: $('issueTeam') ? ($('issueTeam').value || null) : null,
    product_type: ptPayload ? ptPayload.product_type : ($('issueProductType') ? ($('issueProductType').value || null) : null),
    start_date: $('issueStartDate').value || null,
    due_date:   $('issueDueDate').value   || null,
    description: rawDesc,
    original_estimate: $('issueEstimate') ? parseEstimate($('issueEstimate').value) : 0,
    status: 'To Do',
    _customFields: getCreateModalCustomFieldValues()
  };
  if (parentId) payload.parent_id = parentId;

  if (id) {
    delete payload.status;
    await api('/api/issues/' + id, 'PUT', payload);
    toast('Issue updated');
    closeModal('modal-issue');
    await refreshData();
    renderCurrentView();
  } else {
    var submitBtn = $('issueSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    try {
    var created = await api('/api/issues', 'POST', payload);
    // Save custom field values
    if (created && created.id) {
      // Save dynamic custom fields. A native <select multiple> element's
      // own .value only ever returns the FIRST selected option — reading
      // selectedOptions is required to capture every value chosen, matching
      // the comma-joined format the rest of the app already stores/parses.
      var cfFields = document.querySelectorAll('#issueCustomFieldsContainer .cf-field');
      var cfValues = getCreateModalCustomFieldValues();
      Object.keys(cfValues).forEach(function (cfId) {
        api('/api/issues/' + created.id + '/field-values/' + cfId, 'PUT', { value: cfValues[cfId] }).catch(function () {});
      });
      var comboVal = getCombinationFieldValue();
      if (comboVal && comboVal.fieldId) {
        api('/api/issues/' + created.id + '/field-values/' + comboVal.fieldId, 'PUT', { value: comboVal.value || '' }).catch(function () {});
      } else if (ptPayload && ptPayload.fieldId) {
        api('/api/issues/' + created.id + '/field-values/' + ptPayload.fieldId, 'PUT', { value: ptPayload.combination || '' }).catch(function () {});
      }
      cfFields.forEach(function (f) {
        if (cfValues[f.dataset.cfId]) return;
        var v = (f.tagName === 'SELECT' && f.multiple)
          ? Array.from(f.selectedOptions).map(function (o) { return o.value; }).join(',')
          : f.value;
        if (v && f.dataset.cfId) {
          api('/api/issues/' + created.id + '/field-values/' + f.dataset.cfId, 'PUT', { value: v }).catch(function () {});
        }
      });
      // team and product_type are saved directly via payload
    }
    // Upload any attached files
    if (created && created.id && _selectedFiles.length) {
      var fd = new FormData();
      for (var i = 0; i < _selectedFiles.length; i++) fd.append('files', _selectedFiles[i]);
      try {
        var uploadRes = await fetch('/api/issues/' + created.id + '/attachments', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
        if (!uploadRes.ok) {
          var uploadErr = 'Attachment upload failed';
          try { var ej = await uploadRes.json(); if (ej.error) uploadErr = ej.error; } catch (_) {}
          toast('Issue created but ' + uploadErr, 'warning');
        }
      } catch(e) { toast('Issue created but attachments failed to upload', 'warning'); }
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    } catch(e) { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save"; } toast("Failed to create issue: " + e.message, "error"); return; }
    closeModal('modal-issue');
    await refreshData();
    // Captured before anything below navigates: renderCurrentView() ->
    // navigateToSpace() unconditionally calls _exitIssuePage(), so if a ticket
    // was open when Create Issue was launched (it opens as an overlay on top
    // of whatever page is behind it), calling that would silently close it out
    // from under the user even before the auto-open-new-ticket behavior below
    // ever ran.
    var ticketWasOpen = !!S.drawerIssueId;
    var subtaskOfOpenTicket = parentId && S.drawerIssueId === parentId;
    if (subtaskOfOpenTicket) {
      var parentIssue = await api('/api/issues/' + parentId);
      renderDrawerSubtasks(parentIssue.subtasks || []);
    } else if (!ticketWasOpen) {
      renderCurrentView();
    }
    // else: some ticket is open that isn't this new one's parent -- leave it
    // on screen untouched; the toast below is the only feedback.
    if (created && created.id) {
      if (subtaskOfOpenTicket) {
        toast('Issue created');
      } else if (ticketWasOpen) {
        // Don't yank the user away from whatever they're reading. Offer a way
        // to jump to the new ticket instead of forcing it.
        var newKey = issueKeyStr(created) || created.id;
        toastWithButtons(newKey + ' created', [
          { label: 'Open', handler: function () { openIssuePage(created.id); } },
          { label: 'Copy link', handler: function () { copyIssueLinkByKey(newKey); }, dismissOnClick: false }
        ]);
      } else if (!parentId) {
        toast('Issue created — opening in new tab…');
        // Wait for custom fields to be saved before opening
        setTimeout(async function() {
          await new Promise(r => setTimeout(r, 500));
          var fresh = await api('/api/issues/' + created.id);
          openIssuePage(created.id);
        }, 300);
      } else {
        toast('Issue created');
      }
    } else {
      toast('Issue created');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// WORKLOG MODAL
// ═══════════════════════════════════════════════════════════
async function handleWorklogSubmit(e) {
  e.preventDefault();
  var hours = parseInt($('worklogHours').value, 10) || 0;
  var minutes = parseInt($('worklogMinutes').value, 10) || 0;
  var timeSpent = hours * 60 + minutes;
  if (timeSpent <= 0) { toast('Please enter time spent', 'error'); return; }

  var payload = {
    issue_id: $('worklogIssueId').value,
    user_id: S.currentUser,
    time_spent: timeSpent,
    work_date: $('worklogDate').value,
    description: $('worklogDesc').value,
    is_billable: $('worklogBillable').checked
  };

  await api('/api/worklogs', 'POST', payload);
  closeModal('modal-worklog');
  toast('Time logged successfully');

  if (S.drawerIssueId) {
    // Re-fetch fresh issue data (includes new worklog) then switch to Work log tab
    try {
      var fresh = await api('/api/issues/' + S.drawerIssueId);
      if (fresh) {
        _drawerIssueData = fresh;
        // Update time spent display
        var totalSpent = (fresh.worklogs || []).reduce(function(s,w){ return s+(w.time_spent||0); }, 0);
        if ($('drawerTimeSpent')) $('drawerTimeSpent').textContent = fmtMins(totalSpent);
        // Switch to Work log tab
        var wlTab = document.querySelector('[data-activity-tab="worklog"]');
        if (wlTab) {
          document.querySelectorAll('[data-activity-tab]').forEach(function(t){
            t.classList.toggle('active', t === wlTab);
          });
          var actBody = $('activitySectionBody');
          if (actBody) actBody.dataset.activeTab = 'worklog';
          _renderActivityTab('worklog', fresh);
        }
      }
    } catch(e) {}
    refreshData();
  }
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
async function loadNotifications() {
  if (!S.currentUser) return;
  try {
    var notifs = await api('/api/notifications');
    S.data.notifications = Array.isArray(notifs) ? notifs : [];
    renderNotifBadge();
  } catch (e) {
    // Notifications are non-critical
  }
}

// Map notification type → pref key
var _notifTypeMap = {
  'issue_assigned': 'issue_assigned',
  'status_changed': 'status_changed',
  'priority_changed': 'priority_changed',
  'comment_added':  'comment_added',
  'sprint_started': 'sprint_started',
  'sprint_completed': 'sprint_started',
  'mention': 'mention'
};

function _filterNotifsByPrefs(notifs) {
  return notifs.filter(function(n) {
    var prefKey = _notifTypeMap[n.type];
    if (!prefKey) return true; // unknown types always shown
    return _notifPrefEnabled(prefKey);
  });
}

function renderNotifBadge() {
  var notifs = _filterNotifsByPrefs(S.data.notifications || []);
  var unread = 0;
  for (var i = 0; i < notifs.length; i++) {
    if (!notifs[i].is_read) unread++;
  }
  var badge = $('notifBadge');
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.add('visible'); badge.removeAttribute('hidden');
  } else {
    badge.classList.remove('visible'); badge.setAttribute('hidden',''); badge.textContent = '';
  }
}

var _notifTypeIcon = {
  'issue_assigned': '👤',
  'status_changed': '🔄',
  'priority_changed': '⚡',
  'comment_added':  '💬',
  'sprint_started': '🚀',
  'sprint_completed': '✅',
  'mention': '@'
};

function parseNotifIssueLink(link) {
  if (!link) return null;
  var raw = String(link).trim();
  // Modern: /?issue=KEY or ?issue=KEY
  var paramMatch = raw.match(/(?:\?|&)issue=([^&]+)/i);
  if (paramMatch) {
    try { return decodeURIComponent(paramMatch[1]).trim(); } catch (_) { return paramMatch[1].trim(); }
  }
  // Legacy: /spaces/ENG/issues/ENG-8
  var legacyMatch = raw.match(/\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)/i);
  if (legacyMatch) return legacyMatch[1].toUpperCase();
  // Trailing issue key in path
  var tailMatch = raw.match(/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/);
  if (tailMatch) return tailMatch[1].toUpperCase();
  return null;
}

function extractIssueKeyFromNotifTitle(title) {
  if (!title) return null;
  var m = String(title).match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
  return m ? m[1].toUpperCase() : null;
}

function findCachedIssueByKey(issueKey) {
  if (!issueKey) return null;
  var upper = String(issueKey).toUpperCase();
  return (S.data && S.data.issues || []).find(function (i) {
    return (i.key && i.key.toUpperCase() === upper) || String(i.id) === String(issueKey);
  }) || null;
}

async function fetchAndCacheIssue(issueKey) {
  try {
    var token = getAuthToken();
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch('/api/issues/' + encodeURIComponent(issueKey), { headers: headers });
    if (!res.ok) return null;
    var fetched = await res.json();
    if (fetched && fetched.id) {
      S.data.issues = S.data.issues || [];
      var idx = S.data.issues.findIndex(function (i) { return i.id === fetched.id; });
      if (idx >= 0) S.data.issues[idx] = Object.assign(S.data.issues[idx], fetched);
      else S.data.issues.push(fetched);
      return fetched;
    }
  } catch (_) {}
  return null;
}

async function openIssueFromNotifLink(link, title) {
  var issueKey = parseNotifIssueLink(link) || extractIssueKeyFromNotifTitle(title);
  if (!issueKey) return false;
  var issue = findCachedIssueByKey(issueKey);
  if (issue) {
    openIssuePage(issue.id);
    return true;
  }
  var fetched = await fetchAndCacheIssue(issueKey);
  if (fetched) {
    openIssuePage(fetched.id);
    return true;
  }
  toast('Could not open linked issue', 'error');
  return false;
}

async function openNotifTarget(notif) {
  notif = notif || {};
  var link = notif.link || '';
  var type = notif.type || '';
  var spaceId = notif.space_id || '';

  if (parseNotifIssueLink(link) || extractIssueKeyFromNotifTitle(notif.title)) {
    return openIssueFromNotifLink(link, notif.title);
  }

  // Space board route: /space/ENG/board
  var spaceBoardMatch = link.match(/^\/space\/([^/]+)\/board\/?$/i);
  if (spaceBoardMatch) {
    var sp = getSpaceByKey(decodeURIComponent(spaceBoardMatch[1]));
    if (sp) {
      navigateToSpace(sp.id, 'board');
      return true;
    }
  }

  if ((type === 'sprint_started' || type === 'sprint_completed') && spaceId) {
    navigateToSpace(spaceId, 'board');
    return true;
  }

  if (spaceId) {
    navigateToSpace(spaceId, 'summary');
    return true;
  }

  toast('This notification has no linked destination', 'warning');
  return false;
}

function renderNotifPanel() {
  var notifs = _filterNotifsByPrefs(S.data.notifications || []);
  var unread = notifs.filter(function(n){ return !n.is_read; }).length;
  var badge = document.getElementById('notifCountBadge');
  if (badge) { if (unread > 0) { badge.textContent = unread; badge.removeAttribute('hidden'); } else { badge.setAttribute('hidden', ''); } }
  var listEl = $('notifList');
  if (!listEl) return;
  if (notifs.length === 0) {
    listEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;padding:40px 20px;color:var(--text3)"><div style="font-size:32px;margin-bottom:12px">&#128276;</div><div style="font-size:14px;font-weight:600;color:var(--text2)">All caught up!</div><div style="font-size:13px;margin-top:4px">No new notifications</div></div>';
    return;
  }
  var sorted = notifs.slice().sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });
  var tIcons = { comment_added:'&#128172;', issue_assigned:'&#128100;', status_changed:'&#128260;', priority_changed:'&#9889;', sprint_started:'&#128640;', sprint_completed:'&#9989;', issue_created:'&#128203;', mention:'@' };
  var tColors = { comment_added:'#0129AC', issue_assigned:'#7c3aed', status_changed:'#059669', priority_changed:'#f59e0b', sprint_started:'#d97706', sprint_completed:'#059669', issue_created:'#0129AC', mention:'#dc2626' };
  var html = '';
  var limit = Math.min(sorted.length, 50);
  for (var i = 0; i < limit; i++) {
    var n = sorted[i];
    var icon = tIcons[n.type] || '&#128276;';
    var color = tColors[n.type] || '#0129AC';
    var isU = !n.is_read;
    html += '<div class="notif-item' + (isU ? ' unread' : '') + '" data-notif-id="' + esc(n.id) + '" data-notif-link="' + esc(n.link || '') + '" data-notif-type="' + esc(n.type || '') + '" data-notif-space-id="' + esc(n.space_id || '') + '" data-notif-title="' + esc(n.title || '') + '">' +
      '<div class="notif-item-icon" style="background:' + color + '22">' + icon + '</div>' +
      '<div class="notif-item-body">' +
      '<div class="notif-item-title' + (isU ? ' bold' : '') + '">' + esc(n.title || 'Notification') + '</div>' +
      (n.body ? '<div class="notif-item-preview">' + esc(n.body) + '</div>' : '') +
      '<div class="notif-item-time">' + relativeTime(n.created_at) + '</div>' +
      '</div>' +
      (isU ? '<div class="notif-item-dot"></div>' : '') +
      '</div>';
  }
  listEl.innerHTML = html;
}

window._markNotifRead = async function (id, link, type, spaceId, title) {
  try {
    if (id) await api('/api/notifications/' + id + '/read', 'PUT');
  } catch (_) {}
  if (S.data && S.data.notifications) {
    S.data.notifications.forEach(function (n) {
      if (n.id === id) n.is_read = true;
    });
  }
  renderNotifBadge();
  renderNotifPanel();
  var panel = $('notifPanel');
  if (panel) panel.setAttribute('hidden', '');
  try {
    await openNotifTarget({ link: link, type: type, space_id: spaceId, title: title });
  } catch (_) {
    toast('Could not open notification', 'error');
  }
};

async function markAllRead() {
  await api('/api/notifications/read-all', 'PUT', {});
  if (S.data && S.data.notifications) {
    S.data.notifications.forEach(function (n) { n.is_read = true; });
  }
  renderNotifBadge();
  renderNotifPanel();
}

// ═══════════════════════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  var subitem = e.target.closest('.space-subitem');
  if (subitem) {
    e.stopPropagation();
    e.preventDefault();
    var tab = subitem.dataset.tab;
    var spaceId = subitem.dataset.spaceId;
    if (tab && spaceId) navigateToSpace(spaceId, tab);
  }
});

document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  initDescEditorImageTrays();
  init();

  // Sidebar global nav
  qsa('.nav-item[data-view]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (el.dataset.view === 'yourwork') navigateToYourWork('assigned');
      else navigateTo(el.dataset.view);
    });
  });

  // Sidebar space tabs
  qsa('.nav-item[data-tab]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (!S.currentSpace) return;
      renderTab(el.dataset.tab);
    });
  });

  // Sidebar toggle
  if ($('sidebarToggle')) $('sidebarToggle').addEventListener('click', function () {
    $('sidebar').classList.toggle('collapsed');
    // Toggling by hand inside Settings means the user owns the state from here
    // on — drop the remembered value so leaving Settings doesn't undo them.
    _sidebarStateBeforeSettings = null;
  });

  // Sidebar search (element may not exist if removed from HTML)
  if ($('sidebarSearch')) $('sidebarSearch').addEventListener('input', function () {
    var term = $('sidebarSearch').value.toLowerCase();
    qsa('.space-item').forEach(function (el) {
      el.style.display = el.textContent.toLowerCase().indexOf(term) >= 0 ? '' : 'none';
    });
  });

  // New space
  $('newSpaceBtn').addEventListener('click', function () { openSpaceModal(); });

  // Global create (button removed from sidebar — keep guard in case it's re-added)
  var _gcb = $('globalCreateBtn');
  if (_gcb) _gcb.addEventListener('click', function () {
    resetIssueForm();
    $('issueSpaceId').value = S.currentSpace || '';
    $('issueModalTitle').textContent = 'Create Issue';
    window._populateIssueSpaceDropdown && window._populateIssueSpaceDropdown(S.currentSpace);
    if (window._onIssueSpaceChange) window._onIssueSpaceChange(S.currentSpace || '');
    populateIssueFormSelects();
    openModal('modal-issue');
  });

  // Top bar create issue
  // Populate space dropdown in create issue modal
  window._populateIssueSpaceDropdown = function(selectedSpaceId) {
    var sel = $('issueSpaceSelect');
    if (!sel) return;
    var spaces = S.data && S.data.spaces || [];
    // Filter spaces based on user membership
    var mySpaces = spaces.filter(function(sp) {
      if (!S.data.space_members) return true;
      return S.data.space_members.some(function(m){ return m.space_id === sp.id && m.user_id === S.currentUser; })
        || (S.currentUserObj && (S.currentUserObj.role === 'owner' || S.currentUserObj.role === 'admin'));
    });
    sel.innerHTML = '<option value="">— Select a space —</option>' +
      mySpaces.map(function(sp) {
        return '<option value="' + sp.id + '"' + (sp.id === selectedSpaceId ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
      }).join('');
    if (selectedSpaceId) sel.value = selectedSpaceId;
  };
  // Standalone space-change handler — always defined, called from every create-issue entry point
  window._onIssueSpaceChange = function (spaceId, includeSprintId) {
    if ($('issueSpaceId')) $('issueSpaceId').value = spaceId || '';
    var sprintSel = $('issueSprint');
    if (sprintSel) {
      var sprints = getIssueFormSprints(spaceId, { includeSprintId: includeSprintId });
      populateSprintSelect(sprintSel, sprints, includeSprintId || null);
      if (!includeSprintId) applySprintDatesToIssueForm('');
    }
    // Team / Product Type options come from the newly-selected space's own
    // custom_fields.options, rebuilt every time the space changes.
    var issueTeamSel = $('issueTeam');
    if (issueTeamSel) {
      issueTeamSel.innerHTML = buildBuiltinSelectOptionsHtml('team', spaceId, issueTeamSel.value, '— None —');
    }
    var issueProductTypeSel = $('issueProductType');
    if (issueProductTypeSel) {
      issueProductTypeSel.innerHTML = buildBuiltinSelectOptionsHtml('product_type', spaceId, issueProductTypeSel.value, '— Select type —');
    }
    // Type / Priority are required — no blank placeholder option. A real prior
    // selection (editing an in-progress form across a space switch) is kept if
    // still valid; a fresh modal (no prior selection) defaults to task/medium
    // when offered, else the space's first configured option.
    function rebuildRequiredBuiltinSelect(sel, fieldKey, fallbackDefault) {
      if (!sel) return;
      var prior = sel.value;
      sel.innerHTML = buildBuiltinSelectOptionsHtml(fieldKey, spaceId, prior || null, null);
      if (prior && sel.querySelector('option[value="' + prior + '"]')) {
        sel.value = prior;
      } else if (sel.querySelector('option[value="' + fallbackDefault + '"]')) {
        sel.value = fallbackDefault;
      } else if (sel.options.length) {
        sel.selectedIndex = 0;
      }
    }
    rebuildRequiredBuiltinSelect($('issueType'), 'type', 'task');
    rebuildRequiredBuiltinSelect($('issuePriority'), 'priority', 'medium');
    // Render custom fields — always show ALL unique custom fields across all spaces
    var cfContainer = $('issueCustomFieldsContainer');
    if (!cfContainer) return;

    function renderCF(cfs) {
      var excluded = ['team', 'product type'];
      var unique = [];
      var seen = {};
      cfs.forEach(function (f) {
        var key = (f.name || '').toLowerCase().trim();
        if (f.is_builtin) return;
        if (excluded.indexOf(key) !== -1) return;
        if (isCombinationField(f)) return;
        if (!customFieldShowsIn(f, 'create')) return;
        if (seen[key]) return;
        seen[key] = true;
        unique.push(f);
      });
      cfContainer.innerHTML = unique.map(function (f) {
        var opts = getCustomFieldOptions(f);
        // Tagged .cf-req-star so markCreateRequiredLabels can clear and re-add it
        // when the issue type changes, without re-rendering (which would wipe input).
        var req = fieldRequiredForType(f, $('issueType') ? $('issueType').value : '')
          ? ' <span class="cf-req-star" style="color:var(--red)">*</span>' : '';
        var renderType = getCustomFieldRenderType(f);
        if (renderType === 'select' || renderType === 'multi_select') {
          var searchHint = isCombinationField(f) ? ' <span style="font-size:11px;color:var(--text3);font-weight:400">(searchable)</span>' : '';
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + searchHint + req + '</label>' +
            '<div class="cf-select-wrap-modal">' +
            buildCFSelectWrapInnerHtml(f.id, renderType, opts, '', isCombinationField(f) ? 'Search combinations…' : 'Search…', isCombinationField(f)) +
            '</div></div>';
        }
        if (f.field_type === 'text') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<input type="text" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '"></div>';
        }
        if (f.field_type === 'number') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<input type="number" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '"></div>';
        }
        if (f.field_type === 'textarea') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<textarea class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '" rows="3"></textarea></div>';
        }
        if (f.field_type === 'date') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<input type="date" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '"></div>';
        }
        if (f.field_type === 'checkbox') {
          return '<div class="form-group">' +
            '<label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
            '<input type="checkbox" class="cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '" value="true">' +
            esc(f.name) + req + '</label></div>';
        }
        if (f.field_type === 'user') {
          var userOpts = (S.data && S.data.users || []).filter(function (u) { return u.is_active !== false; });
          var userSelect = '<select class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '">' +
            '<option value="">— Select user —</option>' +
            userOpts.map(function (u) {
              return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>';
            }).join('') + '</select>';
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' + userSelect + '</div>';
        }
        return '';
      }).join('');
      bindCreateModalCustomFields(cfContainer);
    }

    function finishSpaceFieldRender(cfs) {
      if (cfs && cfs.length) renderCF(cfs);
      else if (cfContainer) cfContainer.innerHTML = '';
      renderIssueProductTypeSets(spaceId);
      applyBuiltinFieldVisibility(spaceId, $('modal-issue'), 'create');
      markCreateRequiredLabels(spaceId);
      // Required-ness can depend on the issue type, so the asterisks have to be
      // recomputed whenever Type changes — not just once when the form is built.
      // Only the stars are touched, never a re-render: re-rendering would discard
      // anything the user had already typed into the custom fields.
      var typeSel = $('issueType');
      if (typeSel && !typeSel._reqTypeBound) {
        typeSel._reqTypeBound = true;
        typeSel.addEventListener('change', function () {
          markCreateRequiredLabels(($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace);
        });
      }
    }

    var allCFs = S.data.custom_fields || [];
    var spaceCFs = spaceId ? allCFs.filter(function (f) { return f.space_id === spaceId; }) : [];
    if (spaceCFs.length) {
      finishSpaceFieldRender(spaceCFs);
    } else if (spaceId) {
      if (cfContainer) cfContainer.innerHTML = '';
      ensureSpaceFieldsLoaded(spaceId).then(function (data) {
        finishSpaceFieldRender(data);
      });
    } else {
      if (cfContainer) cfContainer.innerHTML = '';
      finishSpaceFieldRender([]);
    }
  };

  if ($('issueTeam')) {
    $('issueTeam').addEventListener('change', function () {
      var spaceId = ($('issueSpaceSelect') && $('issueSpaceSelect').value) || ($('issueSpaceId') && $('issueSpaceId').value) || '';
      renderIssueProductTypeSets(spaceId);
    });
  }

  window.openCreateIssueModal = function() {
    resetIssueForm();
    $('issueModalTitle').textContent = 'Create Issue';
    // Only ever pre-select the space you are actually in. This used to fall back
    // to Product_Team and then to spaces[0], so pressing + Create Issue from Home,
    // Assigned to me, Reports, Spaces, Work Log or Roadmap — every view where
    // navigateTo() sets S.currentSpace = null — silently pre-selected
    // Product_Team, and tickets landed in the wrong board. Leaving it blank makes
    // the Space picker an explicit choice instead of a hidden default.
    var spaceToUse = S.currentSpace || '';
    window._populateIssueSpaceDropdown && window._populateIssueSpaceDropdown(spaceToUse);
    // The picker lists only spaces you can create in. If spaceToUse isn't one of
    // them, `sel.value = spaceToUse` silently does nothing and the picker shows
    // "— Select a space —" while the hidden input still held that space — submit
    // reads the hidden input, so the ticket went to a space the picker never
    // offered. Take the effective value back off the picker so the two agree.
    var spaceSel = $('issueSpaceSelect');
    var effectiveSpace = spaceSel ? (spaceSel.value || '') : spaceToUse;
    $('issueSpaceId').value = effectiveSpace;
    window._onIssueSpaceChange && window._onIssueSpaceChange(effectiveSpace);
    populateIssueFormSelects();
    openModal('modal-issue');
  };

  $('createIssueBtn').addEventListener('click', window.openCreateIssueModal);

  if ($('issueSprint')) {
    $('issueSprint').addEventListener('change', function () {
      applySprintDatesToIssueForm(this.value || null);
    });
  }

  // Create sprint
  $('createSprintBtn').addEventListener('click', function () { window._openSprintModal(null); });

  // Notifications
  $('notifBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var panel = $('notifPanel');
    if (panel.hasAttribute('hidden')) {
      panel.removeAttribute('hidden');
      loadNotifications().then(function () {
        renderNotifPanel();
        renderNotifBadge();
      });
    } else {
      panel.setAttribute('hidden', '');
    }
  });
  $('markAllReadBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    markAllRead();
  });
  var notifListEl = $('notifList');
  if (notifListEl) {
    notifListEl.addEventListener('click', function (e) {
      var item = e.target.closest('.notif-item');
      if (!item) return;
      e.stopPropagation();
      e.preventDefault();
      window._markNotifRead(
        item.dataset.notifId,
        item.dataset.notifLink || '',
        item.dataset.notifType || '',
        item.dataset.notifSpaceId || '',
        item.dataset.notifTitle || ''
      );
    });
  }

  // Close notif panel on outside click
  document.addEventListener('click', function (e) {
    var panel = $('notifPanel');
    var btn = $('notifBtn');
    if (!panel || panel.hasAttribute('hidden')) return;
    if (panel.contains(e.target) || (btn && (e.target === btn || btn.contains(e.target)))) return;
    panel.setAttribute('hidden', '');
  });

  // Form submits
  $('spaceForm').addEventListener('submit', handleSpaceSubmit);
  $('sprintForm').addEventListener('submit', handleSprintSubmit);
  $('issueForm').addEventListener('submit', handleIssueSubmit);
  $('worklogForm').addEventListener('submit', handleWorklogSubmit);

  // Backlog search
  $('backlogSearch').addEventListener('input', function () {
    if (S.currentTab === 'backlog') renderBacklog();
  });

  // Backlog filter panel
  var _bfFilters = { status: [], priority: [], type: [], assignee: '' };
  var _bfOpen = false;

  $('backlogFilterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    _bfOpen = !_bfOpen;
    $('backlogFilterPanel').style.display = _bfOpen ? 'block' : 'none';
    if (_bfOpen) {
      // Populate assignee dropdown with space members
      var sel = $('bfAssignee');
      var spaceMembers = (S.data.space_members || []).filter(function(m) { return m.space_id === S.currentSpace; });
      var users = spaceMembers.map(function(m) { return findUser(m.user_id); }).filter(Boolean);
      sel.innerHTML = '<option value="">All</option>' + users.map(function(u) {
        return '<option value="' + u.id + '"' + (u.id === _bfFilters.assignee ? ' selected' : '') + '>' + esc(u.name) + '</option>';
      }).join('');
      sel.value = _bfFilters.assignee;
      // Restore checkbox states
      ['bfStatus', 'bfPriority', 'bfType'].forEach(function(panelId) {
        var key = panelId === 'bfStatus' ? 'status' : panelId === 'bfPriority' ? 'priority' : 'type';
        document.querySelectorAll('#' + panelId + ' input[type=checkbox]').forEach(function(cb) {
          cb.checked = _bfFilters[key].indexOf(cb.value) >= 0;
        });
      });
    }
  });

  document.addEventListener('click', function(e) {
    if (_bfOpen && !$('backlogFilterPanel').contains(e.target) && e.target !== $('backlogFilterBtn')) {
      _bfOpen = false;
      $('backlogFilterPanel').style.display = 'none';
    }
  });

  $('bfApplyBtn').addEventListener('click', function() {
    _bfFilters.status   = Array.from(document.querySelectorAll('#bfStatus input:checked')).map(function(c){ return c.value; });
    _bfFilters.priority = Array.from(document.querySelectorAll('#bfPriority input:checked')).map(function(c){ return c.value; });
    _bfFilters.type     = Array.from(document.querySelectorAll('#bfType input:checked')).map(function(c){ return c.value; });
    _bfFilters.assignee = $('bfAssignee').value;
    var count = _bfFilters.status.length + _bfFilters.priority.length + _bfFilters.type.length + (_bfFilters.assignee ? 1 : 0);
    var badge = $('backlogFilterCount');
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline'; } else { badge.style.display = 'none'; }
    _bfOpen = false;
    $('backlogFilterPanel').style.display = 'none';
    if (S.currentTab === 'backlog') renderBacklog();
  });

  $('bfClearBtn').addEventListener('click', function() {
    _bfFilters = { status: [], priority: [], type: [], assignee: '' };
    document.querySelectorAll('#backlogFilterPanel input[type=checkbox]').forEach(function(cb){ cb.checked = false; });
    $('bfAssignee').value = '';
    $('backlogFilterCount').style.display = 'none';
    _bfOpen = false;
    $('backlogFilterPanel').style.display = 'none';
    if (S.currentTab === 'backlog') renderBacklog();
  });

  window._getBacklogFilters = function() { return _bfFilters; };

  // All work search
  $('allWorkSearch').addEventListener('input', function () {
    if (S.currentTab === 'allwork') renderAllWork();
  });
  var ywSearchEl = $('ywSearch');
  if (ywSearchEl) {
    ywSearchEl.addEventListener('input', function () {
      if (S.currentView !== 'yourwork') return;
      if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
      else renderYourWorkContent(_ywCache);
    });
  }
  // Date range inputs for All Work
  // Map: [elementId, S.awFilters key, panelKey, fromKey, toKey]
  var dateInputMap = [
    ['awCreatedFrom',   'createdFrom',   'created',   'createdFrom',   'createdTo'],
    ['awCreatedTo',     'createdTo',     'created',   'createdFrom',   'createdTo'],
    ['awUpdatedFrom',   'updatedFrom',   'updated',   'updatedFrom',   'updatedTo'],
    ['awUpdatedTo',     'updatedTo',     'updated',   'updatedFrom',   'updatedTo'],
    ['awDueDateFrom',   'dueDateFrom',   'duedate',   'dueDateFrom',   'dueDateTo'],
    ['awDueDateTo',     'dueDateTo',     'duedate',   'dueDateFrom',   'dueDateTo'],
    ['awStartDateFrom', 'startDateFrom', 'startdate', 'startDateFrom', 'startDateTo'],
    ['awStartDateTo',   'startDateTo',   'startdate', 'startDateFrom', 'startDateTo'],
  ];
  dateInputMap.forEach(function(entry) {
    var elId = entry[0], filterKey = entry[1], panelKey = entry[2], fromKey = entry[3], toKey = entry[4];
    var el = $(elId);
    if (!el) return;
    el.addEventListener('change', function() {
      S.awFilters[filterKey] = el.value;
      _updateDateBadge(panelKey, fromKey, toKey);
      renderAllWork();
    });
  });

  // Close multi-select panels on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.aw-ms-wrap')) {
      document.querySelectorAll('.aw-ms-panel').forEach(function(p) { p.hidden = true; });
    }
    if (!e.target.closest('.yw-th-filter-wrap')) {
      document.querySelectorAll('.yw-filter-panel').forEach(function(p) { p.hidden = true; });
    }
  }, true);

  // Report selector
  $('reportSelector').addEventListener('change', function () {
    if (S.currentTab === 'reports') renderReportContent($('reportSelector').value);
  });

  // Activity tab switching (All / Comments / History / Work log)
  document.addEventListener('click', async function(e) {
    var btn = e.target.closest('[data-activity-tab]');
    if (!btn) return;
    document.querySelectorAll('[data-activity-tab]').forEach(function(t){
      t.classList.toggle('active', t === btn);
    });
    var tab = btn.dataset.activityTab;
    // Drive CSS-based comment box visibility via data attribute
    var body = $('activitySectionBody');
    if (body) body.dataset.activeTab = tab;
    // Always re-fetch fresh issue data so worklogs + history are current
    if (S.drawerIssueId) {
      try {
        var fresh = await api('/api/issues/' + S.drawerIssueId);
        if (fresh) { _drawerIssueData = fresh; }
      } catch(_) {}
    }
    _renderActivityTab(tab);
  });

  // Keyboard: Escape closes drawer then modals
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (S.drawerIssueId) { closeDrawer(); return; }
      qsa('.modal:not([hidden])').forEach(function (m) { closeModal(m.id); });
    }
  });

  // Drawer activity tab switching
  document.addEventListener('click', function (e) {
    if (e.target.matches('[data-activity-tab]')) {
      var tab = e.target.dataset.activityTab;
      qsa('[data-activity-tab]').forEach(function (t) {
        t.classList.toggle('active', t.dataset.activityTab === tab);
      });
    }
  });

  // Sidebar section collapse toggles - use event delegation
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.sidebar-collapse-toggle');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var section = btn.closest('.sidebar-section');
    var content = section && section.querySelector('.sidebar-section-content');
    if (content) {
      var collapsed = content.classList.toggle('collapsed');
      btn.textContent = collapsed ? '\u25B8' : '\u25BE';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  });
});

function openInviteUserModal() {
  var modal = $('modal-invite-user');
  if (!modal) return;
  $('inviteUserEmail').value = '';
  $('inviteUserRole').value = 'member';
  $('inviteLinkResult').setAttribute('hidden', '');
  $('inviteUserSubmitBtn').removeAttribute('hidden');
  openModal('modal-invite-user');
}
window.openInviteUserModal = openInviteUserModal;

function openResetPasswordModal(userId, userName) {
  $('resetPwUserId').value = userId;
  $('resetPwUserName').textContent = userName;
  $('resetPwNew').value = '';
  $('resetPwConfirm').value = '';
  openModal('modal-reset-pw');
}

// Invite user form submit
document.addEventListener('DOMContentLoaded', function () {
  var invForm = $('inviteUserForm');
  if (invForm) {
    invForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = $('inviteUserEmail').value.trim();
      var role = $('inviteUserRole').value;
      try {
        var r = await api('/api/auth/invite', 'POST', { email: email, role: role });
        $('inviteUserSubmitBtn').setAttribute('hidden', '');
        $('inviteLinkResult').removeAttribute('hidden');
        $('inviteLinkUrl').value = r.invite_url;
        popupAlert('Invite Created!', 'Share the invite link with the user. It expires in 7 days.', 'success');
      } catch (e) {}
    });
  }

  var resetForm = $('resetPwForm');
  if (resetForm) {
    resetForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var uid = $('resetPwUserId').value;
      var np = $('resetPwNew').value;
      var cp = $('resetPwConfirm').value;
      if (np !== cp) { toast('Passwords do not match', 'error'); return; }
      if (np.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
      try {
        await api('/api/users/' + uid + '/change-password', 'PUT', { new_password: np });
        closeModal('modal-reset-pw');
        popupAlert('Password Reset', 'Password has been updated successfully.', 'success');
      } catch (e) {}
    });
  }
});

// ═══════════════════════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════════════════════
var _adminSection = 'org-general';

async function renderAdminSettings(section) {
  _adminSection = section || _adminSection;
  var view = $('view-settings');
  if (!view) return;
  var me = S.currentUserObj || {};
  var isAdmin = me.role === 'admin' || me.role === 'owner';
  if (!isAdmin) {
    view.innerHTML = '<div style="padding:40px;text-align:center"><h2>Access Denied</h2><p style="color:var(--muted)">Only admins can access settings.</p></div>';
    return;
  }

  // Update active nav
  qsa('.admin-nav-item').forEach(function(a) {
    a.classList.toggle('active', a.dataset.section === _adminSection);
  });

  var content = $('adminSettingsContent');
  if (!content) return;
  content.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading...</div>';

  switch (_adminSection) {
    case 'org-general':    await renderAdminOrgGeneral(content); break;
    case 'org-security':   renderAdminSecurity(content); break;
    case 'org-notifications': renderAdminNotifications(content); break;
    case 'user-management': await renderAdminUsers(content); break;
    case 'roles-permissions': renderAdminRoles(content); break;
    case 'all-spaces':     await renderAdminSpaces(content); break;
    case 'global-custom-fields': await renderAdminCustomFields(content); break;
    case 'email-settings': await renderAdminEmailSettings(content); break;
    case 'audit-log':      await renderAdminAuditLog(content); break;
    case 'deleted-tickets': await renderDeletedTickets(content); break;
    default: content.innerHTML = '';
  }
}
window.renderAdminSettings = renderAdminSettings;

// Wire up nav clicks after DOM ready
document.addEventListener('click', function(e) {
  // Filter chip click — handle first before nav check
  var chip = e.target.closest('.um-filter-chip');
  if (chip) {
    e.stopPropagation();
    var filter = chip.getAttribute('data-filter');
    document.querySelectorAll('.um-filter-chip').forEach(function(c) {
      c.style.border = c.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
      c.style.opacity = c.getAttribute('data-filter') === filter ? '1' : '0.8';
    });
    document.querySelectorAll('tr[data-um-status]').forEach(function(row) {
      row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
    });
    document.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
      row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
    });
    return;
  }

  var item = e.target.closest('.admin-nav-item');
  if (!item || !item.dataset.section) return;
  renderAdminSettings(item.dataset.section);
  syncAppUrl();
});

// ── Org General ──────────────────────────────────────────
async function renderAdminOrgGeneral(el) {
  // Fetch fresh org data from DB
  var org = {};
  try { org = await api('/api/org') || {}; if (S.data) S.data.org = org; } catch(e) {}
  var users = (S.data && S.data.users) || [];
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });
  var issues = (S.data && S.data.issues) || [];
  var activeUsers = users.filter(function(u){ return u.is_active !== false; }).length;

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🏢 Organization Settings</h2>' +
    '<p>Manage your organization profile and workspace configuration.</p>' +
    '</div>' +

    '<div class="admin-stat-grid">' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + users.length + '</div><div class="admin-stat-label">Total Users</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + activeUsers + '</div><div class="admin-stat-label">Active Users</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + spaces.length + '</div><div class="admin-stat-label">Active Spaces</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + issues.length + '</div><div class="admin-stat-label">Total Issues</div></div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Organization Profile</h3>' +
    '<form id="orgEditForm">' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Organization Name</div><div class="admin-field-desc">Displayed across the workspace</div></div>' +
    '<input id="orgNameInput" class="input input-sm" style="width:220px" value="' + esc(org.name || '') + '">' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Slug</div><div class="admin-field-desc">URL identifier for the workspace</div></div>' +
    '<input id="orgSlugInput" class="input input-sm" style="width:220px" value="' + esc(org.slug || '') + '">' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Plan</div><div class="admin-field-desc">Current subscription tier</div></div>' +
    '<span class="badge" style="background:rgba(77,144,224,0.15);color:var(--accent);padding:5px 12px">Enterprise</span>' +
    '</div>' +
    '<div style="margin-top:16px">' +
    '<button type="submit" class="btn btn-primary btn-sm">Save Changes</button>' +
    '</div>' +
    '</form>' +
    '</div>';

  // Save org settings to DB
  var form = $('orgEditForm');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = $('orgNameInput').value.trim();
      var slug = $('orgSlugInput').value.trim();
      if (!name) { toast('Organization name is required', 'error'); return; }
      try {
        var updated = await api('/api/org', 'PUT', { name: name, slug: slug });
        if (S.data) S.data.org = updated;
        popupAlert('Settings Saved', 'Organization profile updated successfully.', 'success');
      } catch(e) {}
    });
  }
}

// ── Security ─────────────────────────────────────────────
function renderAdminSecurity(el) {
  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔒 Security</h2>' +
    '<p>Manage authentication, sessions, and access control settings.</p>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Authentication</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Password Hashing</div><div class="admin-field-desc">Algorithm used for password storage</div></div>' +
    '<code style="font-size:12px;background:var(--bg3);padding:3px 8px;border-radius:4px">scrypt (Node.js built-in)</code>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Session Duration</div><div class="admin-field-desc">How long login sessions remain valid</div></div>' +
    '<span style="font-size:13px;color:var(--text)">7 days</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Session Tokens</div><div class="admin-field-desc">Random 256-bit tokens stored in database</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Password Policy</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Minimum Length</div><div class="admin-field-desc">Minimum number of characters required</div></div>' +
    '<span style="font-size:13px;color:var(--text)">6 characters</span>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Access Control</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Invite-Only Registration</div><div class="admin-field-desc">New users can only join via admin invite</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Admin User Creation</div><div class="admin-field-desc">Only admins and owners can create users</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '</div>';
}

// ── Notifications ────────────────────────────────────────
// Load/save notification preferences from localStorage
function _getNotifPrefs() {
  try { return JSON.parse(localStorage.getItem('sb_notif_prefs') || '{}'); } catch { return {}; }
}
function _saveNotifPrefs(prefs) {
  localStorage.setItem('sb_notif_prefs', JSON.stringify(prefs));
}
function _notifPrefEnabled(type) {
  var prefs = _getNotifPrefs();
  return prefs[type] !== false; // default ON if not set
}

function renderAdminNotifications(el) {
  var prefs = _getNotifPrefs();
  var chk = function(key) { return prefs[key] !== false ? 'checked' : ''; };

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔔 Notifications</h2>' +
    '<p>Configure workspace-wide notification preferences.</p>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>In-App Notifications</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Issue Assigned</div><div class="admin-field-desc">Notify when an issue is assigned to a user</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefAssigned" ' + chk('issue_assigned') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Issue Status Changed</div><div class="admin-field-desc">Notify when issue status is updated</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefStatus" ' + chk('status_changed') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Comment Added</div><div class="admin-field-desc">Notify on new comments</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefComment" ' + chk('comment_added') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">@Mentions</div><div class="admin-field-desc">Notify when someone mentions you in a comment</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefMention" ' + chk('mention') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Priority Changed</div><div class="admin-field-desc">Notify assignee when issue priority is updated</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefPriority" ' + chk('priority_changed') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Sprint Started / Completed</div><div class="admin-field-desc">Notify on sprint lifecycle events</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefSprint" ' + chk('sprint_started') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Email Notifications</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">SMTP Server</div><div class="admin-field-desc">Email service not yet configured</div></div>' +
    '<span class="badge badge-muted">Not configured</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Invite Emails</div><div class="admin-field-desc">Send invite links via email (requires SMTP)</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" disabled><span class="toggle-slider"></span></label>' +
    '</div>' +
    '</div>';

  // Wire toggles to save prefs
  function wireToggle(elId, prefKey, linked) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.onchange = function() {
      var p = _getNotifPrefs();
      p[prefKey] = el.checked;
      if (linked) linked.forEach(function(k) { p[k] = el.checked; });
      _saveNotifPrefs(p);
      toast((el.checked ? 'Enabled: ' : 'Disabled: ') + el.closest('.admin-field-row').querySelector('.admin-field-label').textContent);
    };
  }
  wireToggle('notifPrefAssigned', 'issue_assigned');
  wireToggle('notifPrefStatus',   'status_changed');
  wireToggle('notifPrefComment',  'comment_added');
  wireToggle('notifPrefMention',  'mention');
  wireToggle('notifPrefPriority', 'priority_changed');
  wireToggle('notifPrefSprint',   'sprint_started', ['sprint_completed']);
}

// ── Users (Admin) ─────────────────────────────────────────
async function renderAdminUsers(el) {
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:18px;">
    <div style="position:relative;width:56px;height:56px;">
      <svg viewBox="0 0 56 56" style="width:56px;height:56px;animation:um-spin 1s linear infinite;">
        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" stroke-width="4"/>
        <circle cx="28" cy="28" r="22" fill="none" stroke="#0129AC" stroke-width="4" stroke-dasharray="80 60" stroke-linecap="round"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0129AC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
    </div>
    <div style="font-size:15px;font-weight:600;color:var(--text1)">Loading Users</div>
    <div style="font-size:13px;color:var(--text3)">Fetching team members&hellip;</div>
  </div>
  <style>@keyframes um-spin{to{transform:rotate(360deg)}}</style>`;
  // Refresh with timeout guard — don't block forever
  try {
    await Promise.race([
      refreshData(),
      new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('timeout')); }, 5000); })
    ]);
  } catch(e) { /* use cached S.data on timeout or error */ }
  var me = S.currentUserObj || {};
  var users = (S.data && S.data.users) || [];
  var invites = [];
  try { invites = await api('/api/auth/invitations'); } catch(e) { invites = []; }

  if (!users.length) {
    el.innerHTML = '<div class="admin-section-header"><h2>User Management</h2><p>Manage all users, roles and access.</p></div>' +
      '<div class="admin-card" style="padding:24px;text-align:center;color:var(--text3)">No users found. Try refreshing the page.</div>';
    return;
  }

  // Only show pending invites whose email isn't already a registered user
  var registeredEmails = users.map(function(u){ return u.email.toLowerCase(); });
  var pendingInvites = invites.filter(function(inv){
    return inv.status === 'pending' && !registeredEmails.includes(inv.email.toLowerCase());
  });

  var userRows = users.map(function(u) {
    var isActive = u.is_active !== false;
    var sb = isActive ? '<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px">Active</span>' : '<span style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px">Inactive</span>';
    var ll = u.last_login ? relativeTime(u.last_login) : 'Never';
    var av = '<div style="width:38px;height:38px;border-radius:50%;background:' + (u.color||'#0129AC') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:13px;flex-shrink:0">' + initials(u.name) + '</div>';
    var info = '<div><div style="font-weight:600;font-size:14px;color:var(--text)">' + esc(u.name) + '</div><div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(u.email) + '</div></div>';
    var orgRole = (u.role === 'owner' || u.role === 'admin') ? 'admin' : 'member';
    var rolesel = '<select class="input input-sm um-role-sel" data-uid="' + u.id + '" style="font-size:13px;height:30px;border-radius:6px;padding:0 8px;min-width:110px"' + (u.id===me.id?' disabled':'') + '>' +
      '<option value="admin"' + (orgRole === 'admin' ? ' selected' : '') + '>Admin</option>' +
      '<option value="member"' + (orgRole === 'member' ? ' selected' : '') + '>Member</option>' +
      '</select>';
    var toggleBtn = u.id!==me.id ? '<button class="btn btn-sm um-toggle-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" data-active="'+u.is_active+'" style="font-size:12px;padding:5px 12px;border-radius:6px;cursor:pointer;color:#fff;border:none;background:'+(isActive?'#ef4444':'#22c55e')+'">'+(isActive?'Deactivate':'Activate')+'</button>' : '';
    var pwdBtn = '<button class="btn btn-sm um-pwd-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" style="font-size:12px;padding:5px 12px;border-radius:6px;border:none;background:#0129AC;cursor:pointer;color:#fff">Reset PW</button>';
    var delBtn = u.id!==me.id ? '<button class="btn btn-sm um-delete-user-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" data-email="'+esc(u.email)+'" style="font-size:12px;padding:5px 12px;border-radius:6px;border:none;background:#dc2626;cursor:pointer;color:#fff">Delete</button>' : '';
    return '<tr data-um-status="' + (isActive ? 'active' : 'inactive') + '" style="border-bottom:1px solid var(--border)" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">' +
      '<td style="padding:14px 16px"><div style="display:flex;align-items:center;gap:12px">' + av + info + '</div></td>' +
      '<td style="padding:14px 16px">' + rolesel + '</td>' +
      '<td style="padding:14px 16px">' + sb + '</td>' +
      '<td style="padding:14px 16px;font-size:13px;color:var(--text2)">' + ll + '</td>' +
      '<td style="padding:14px 16px"><div style="display:flex;gap:6px;flex-wrap:wrap">' + toggleBtn + pwdBtn + delBtn + '</div></td></tr>';
  }).join('');

  var inviteRows = pendingInvites.map(function(inv) {
    var expiresStr = new Date(inv.expires_at) < new Date()
      ? '<span style="color:#ef4444;font-size:11px">Expired</span>'
      : '<span style="font-size:11px;color:var(--text3)">Expires ' + relativeTime(inv.expires_at) + '</span>';
    return '<tr data-um-invite="1" style="opacity:0.85">' +
      '<td><div style="display:flex;align-items:center;gap:10px">' +
      '<div class="user-avatar-sm" style="background:#64748b;font-size:10px">?</div>' +
      '<div><div style="font-weight:600;font-size:13px;color:var(--text2)">(Pending)</div>' +
      '<div style="font-size:11px;color:var(--text3)">' + esc(inv.email) + '</div></div></div></td>' +
      '<td><span style="font-size:12px;color:var(--text3)">' + cap(inv.role||'member') + '</span></td>' +
      '<td><span class="badge" style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44">✉️ Invited</span></td>' +
      '<td>' + expiresStr + '</td>' +
      '<td style="padding:8px 16px;white-space:nowrap">' +
      '<button class="btn btn-sm um-resend-invite-btn" data-invite-id="'+inv.id+'" data-email="'+esc(inv.email)+'" style="font-size:11px;padding:4px 10px;border:none;border-radius:3px;background:#f59e0b;cursor:pointer;color:#fff;margin-right:4px">↺ Resend</button>' +
      '<button class="btn btn-sm um-cancel-invite-btn" data-invite-id="'+inv.id+'" data-email="'+esc(inv.email)+'" style="font-size:11px;padding:4px 10px;border:none;border-radius:3px;background:#ef4444;cursor:pointer;color:#fff">✕ Delete</button>' +
      '</td>' +
      '</tr>';
  }).join('');

  var totalActive = users.filter(function(u){ return u.is_active!==false; }).length;

  // Define filter BEFORE setting innerHTML so onclick can find it immediately
  window._umFilter = function(filter) {
    document.querySelectorAll('.um-filter-chip').forEach(function(chip) {
      chip.style.border = chip.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
      chip.style.opacity = chip.getAttribute('data-filter') === filter ? '1' : '0.8';
    });
    document.querySelectorAll('tr[data-um-status]').forEach(function(row) {
      row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
    });
    document.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
      row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
    });
  };

  el.innerHTML =
    '<div style="padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:12px">' +
    '<h2 style="margin:0;font-size:22px;font-weight:700;color:var(--text)">User Management</h2>' +
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<input type="text" id="userSearchInput" placeholder="Search users..." oninput="window._filterUsers(this.value)" style="padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:13px;width:220px;outline:none">' +
    '<button onclick="openInviteUserModal()" style="background:#0129AC;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">+ Invite User</button>' +
    '</div>' +
    '</div>' +
    '<div id="umFilterBar" style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 20px">' +
    '<div class="um-filter-chip" data-filter="all" style="display:flex;align-items:center;gap:6px;background:var(--bg3);color:var(--text);font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid #0129AC">' + users.length + ' Registered</div>' +
    '<div class="um-filter-chip" data-filter="active" style="display:flex;align-items:center;gap:6px;background:#dcfce7;color:#166534;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + totalActive + ' Active</div>' +
    '<div class="um-filter-chip" data-filter="inactive" style="display:flex;align-items:center;gap:6px;background:#f1f5f9;color:#64748b;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + (users.length - totalActive) + ' Inactive</div>' +
    (pendingInvites.length ? '<div class="um-filter-chip" data-filter="pending" style="display:flex;align-items:center;gap:6px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + pendingInvites.length + ' Pending Invites</div>' : '') +
    '</div>' +
    '<div style="background:#fff;border:1px solid #dfe1e6;border-radius:8px;overflow-x:auto;box-shadow:0 1px 4px rgba(0,0,0,0.06);-webkit-overflow-scrolling:touch">' +
    '<table style="width:100%;border-collapse:collapse;table-layout:auto">' +
    '<thead><tr style="background:#f4f5f7;border-bottom:2px solid #dfe1e6">' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:220px">User</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:130px">Role</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:90px">Status</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:120px">Last Login</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:220px">Actions</th>' +
    '</tr></thead><tbody>' + userRows + inviteRows + '</tbody></table></div></div>';

  // Bind filter chips via addEventListener (avoids inline onclick quoting issues)
  el.querySelectorAll('.um-filter-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var filter = chip.getAttribute('data-filter');
      el.querySelectorAll('.um-filter-chip').forEach(function(c) {
        c.style.border = c.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
        c.style.opacity = c.getAttribute('data-filter') === filter ? '1' : '0.8';
      });
      el.querySelectorAll('tr[data-um-status]').forEach(function(row) {
        row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
      });
      el.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
        row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
      });
    });
  });

  qsa('.um-role-sel').forEach(function(sel) {
    sel.addEventListener('change', async function() {
      try {
        await api('/api/users/'+sel.dataset.uid, 'PUT', { role: sel.value });
        popupAlert('Role Updated', 'User role changed to ' + formatOrgRoleLabel(sel.value) + ' successfully.', 'success');
      } catch(e) {}
    });
  });
  qsa('.um-toggle-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var isActive = btn.dataset.active !== 'false';
      var name = btn.dataset.uname || 'User';
      var ok = await confirmDialog((isActive ? 'Deactivate' : 'Activate') + ' ' + name + '?');
      if (!ok) return;
      try {
        await api('/api/users/'+btn.dataset.uid, 'PUT', { is_active: !isActive });
        popupAlert(isActive ? 'User Deactivated' : 'User Activated',
          name + ' has been ' + (isActive ? 'deactivated' : 'activated') + '.', isActive ? 'warning' : 'success');
        renderAdminSettings('user-management');
      } catch(e) {}
    });
  });
  qsa('.um-pwd-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openResetPasswordModal(btn.dataset.uid, btn.dataset.uname); });
  });
  qsa('.um-delete-user-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var name = btn.dataset.uname || 'this user';
      var email = btn.dataset.email || '';
      var uid = btn.dataset.uid;
      var av = initials(name);
      // Rich delete confirmation popup
      var ok = await new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        overlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center;animation:popIn 0.2s ease">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px">🗑️</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Delete User</h2>' +
          '<div style="display:flex;align-items:center;gap:12px;background:#f8fafc;border-radius:10px;padding:12px 16px;margin:16px 0;text-align:left">' +
          '<div style="width:40px;height:40px;border-radius:50%;background:#0129AC;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0">' + av + '</div>' +
          '<div><div style="font-weight:600;font-size:14px;color:#1e293b">' + esc(name) + '</div><div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(email) + '</div></div>' +
          '</div>' +
          '<p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6">This will <strong style="color:#dc2626">permanently delete</strong> this user and all their data. This action <strong>cannot be undone</strong>.</p>' +
          '<div style="display:flex;gap:10px;justify-content:center">' +
          '<button id="_delCancelBtn" style="flex:1;padding:10px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;font-size:14px;font-weight:600;cursor:pointer">Cancel</button>' +
          '<button id="_delConfirmBtn" style="flex:1;padding:10px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Delete User</button>' +
          '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#_delCancelBtn').onclick = function() { document.body.removeChild(overlay); resolve(false); };
        overlay.querySelector('#_delConfirmBtn').onclick = function() { document.body.removeChild(overlay); resolve(true); };
        overlay.onclick = function(e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(false); } };
      });
      if (!ok) return;
      try {
        await api('/api/users/' + uid, 'DELETE');
        // Remove from local cache so stale data never re-appears on re-render
        if (S.data && S.data.users) S.data.users = S.data.users.filter(function(u){ return u.id !== uid; });
        // Remove row immediately from table
        var delBtn2 = document.querySelector('.um-delete-user-btn[data-uid="' + uid + '"]');
        if (delBtn2) { var delRow = delBtn2.closest('tr'); if (delRow) delRow.remove(); }
        // Rich success popup
        var successOverlay = document.createElement('div');
        successOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        successOverlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:36px 32px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center">' +
          '<div style="width:68px;height:68px;border-radius:50%;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">✅</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">User Deleted</h2>' +
          '<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1e293b">' + esc(name) + '</p>' +
          '<p style="margin:0 0 24px;font-size:13px;color:#64748b">This user has been permanently removed from the system.</p>' +
          '<button id="_delSuccessClose" style="padding:10px 32px;border:none;border-radius:8px;background:#0129AC;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Done</button>' +
          '</div>';
        document.body.appendChild(successOverlay);
        var closeSuccess = function() { if (document.body.contains(successOverlay)) document.body.removeChild(successOverlay); renderAdminSettings('user-management'); };
        successOverlay.querySelector('#_delSuccessClose').onclick = closeSuccess;
        successOverlay.onclick = function(e) { if (e.target === successOverlay) closeSuccess(); };
        setTimeout(closeSuccess, 3000);
      } catch(e) {
        var errOverlay = document.createElement('div');
        errOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        errOverlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:36px 32px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center">' +
          '<div style="width:68px;height:68px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">❌</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#dc2626">Delete Failed</h2>' +
          '<p style="margin:0 0 24px;font-size:13px;color:#64748b">' + esc(e.message || 'Could not delete user. Please try again.') + '</p>' +
          '<button id="_delErrClose" style="padding:10px 32px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Close</button>' +
          '</div>';
        document.body.appendChild(errOverlay);
        errOverlay.querySelector('#_delErrClose').onclick = function() { document.body.removeChild(errOverlay); };
        errOverlay.onclick = function(e) { if (e.target === errOverlay) document.body.removeChild(errOverlay); };
      }
    });
  });
  qsa('.um-resend-invite-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var email = btn.dataset.email;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        var data = await api('/api/auth/invitations/' + btn.dataset.inviteId + '/resend', 'POST');
        if (data.email_sent) {
          popupAlert('Invitation Resent', 'A new invitation email has been sent to ' + email + '.', 'success');
        } else {
          popupAlert('Invitation Resent', 'Invite link renewed for ' + email + '. Email not sent: ' + (data.email_reason || 'SMTP not configured') + '<br><small style="word-break:break-all">' + (data.invite_url||'') + '</small>', 'info');
        }
        renderAdminSettings('user-management');
      } catch(e) {
        popupAlert('Error', 'Could not resend invitation.', 'error');
        btn.disabled = false;
        btn.textContent = 'Resend';
      }
    });
  });
  qsa('.um-cancel-invite-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var email = btn.dataset.email;
      var ok = await confirmDialog('Cancel the invitation for ' + email + '?');
      if (!ok) return;
      try {
        await api('/api/auth/invitations/' + btn.dataset.inviteId, 'DELETE');
        popupAlert('Invitation Cancelled', 'The invitation to ' + email + ' has been cancelled.', 'warning');
        renderAdminSettings('user-management');
      } catch(e) {
        popupAlert('Error', 'Could not cancel invitation.', 'error');
      }
    });
  });
}

// ── Roles & Permissions ───────────────────────────────────
function renderAdminRoles(el) {
  var perms = [
    { action: 'Create Space',            orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Delete Space',            orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Assign Space Admin',      orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Manage Space Members',    orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Invite Org Users',        orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Manage Org User Roles',   orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Create / Edit Issue',     orgAdmin: true,  spaceAdmin: true,  member: true  },
    { action: 'Delete Issue',            orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Create / Manage Sprint',  orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'View Space Reports',      orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Space Settings',          orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Manage Custom Fields',    orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Add Comments & Log Work', orgAdmin: true,  spaceAdmin: true,  member: true  },
    { action: 'Org Admin Settings',      orgAdmin: true,  spaceAdmin: false, member: false },
  ];

  var rows = perms.map(function(p) {
    return '<tr>' +
      '<td style="font-size:13px">' + p.action + '</td>' +
      '<td class="' + (p.orgAdmin ? 'perm-check' : 'perm-cross') + '">' + (p.orgAdmin ? '✓' : '—') + '</td>' +
      '<td class="' + (p.spaceAdmin ? 'perm-check' : 'perm-cross') + '">' + (p.spaceAdmin ? '✓' : '—') + '</td>' +
      '<td class="' + (p.member ? 'perm-check' : 'perm-cross') + '">' + (p.member ? '✓' : '—') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🛡️ Roles &amp; Permissions</h2>' +
    '<p>Three-tier access: Org Admin, Space Admin (per space), and Member.</p>' +
    '</div>' +

    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    '<table class="perm-table"><thead><tr>' +
    '<th style="width:55%">Permission</th>' +
    '<th style="width:15%;text-align:center">Admin</th>' +
    '<th style="width:15%;text-align:center">Space Admin</th>' +
    '<th style="width:15%;text-align:center">Member</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '</div>' +

    '<div class="admin-card" style="margin-top:16px">' +
    '<h3>Role Descriptions</h3>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">🛡️ Admin</div><div class="admin-field-desc">Full organization control — create spaces, assign org admins and space admins, manage all users and settings.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">📁 Space Admin</div><div class="admin-field-desc">Manages assigned space(s): sprints, members (member role only), settings, reports, and custom fields. One user can be space admin on multiple spaces.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">👤 Member</div><div class="admin-field-desc">Works on issues in assigned spaces — create/edit tickets, comments, and work logs. No sprints, reports, or settings access.</div></div></div>' +
    '</div>';
}

// ── All Spaces ────────────────────────────────────────────
async function renderAdminSpaces(el) {
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });
  var members = (S.data && S.data.space_members) || [];
  var issues = (S.data && S.data.issues) || [];

  var rows = spaces.map(function(sp) {
    var mCount = members.filter(function(m){ return m.space_id===sp.id; }).length;
    var iCount = issues.filter(function(i){ return i.space_id===sp.id; }).length;
    return '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:10px">' +
      '<div style="width:30px;height:30px;border-radius:6px;background:' + (sp.color||'#6366f1') + ';display:flex;align-items:center;justify-content:center;font-size:14px">' + (sp.icon||'📦') + '</div>' +
      '<div><div style="font-weight:600;font-size:13px">' + esc(sp.name) + '</div>' +
      '<div style="font-size:11px;color:var(--text3)">' + esc(sp.key) + ' · ' + cap(sp.space_type||'scrum') + '</div></div></div></td>' +
      '<td style="font-size:13px">' + mCount + ' members</td>' +
      '<td style="font-size:13px">' + iCount + ' issues</td>' +
      '<td><span class="badge badge-muted">' + visLabel(sp.visibility) + '</span></td>' +
      '<td><button class="btn btn-sm btn-outline" onclick="navigateToSpace(\'' + sp.id + '\',\'space-settings\')">Settings</button></td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>📦 All Spaces</h2>' +
    '<p>Overview of all active spaces in the organization.</p>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<div style="font-size:13px;color:var(--text3)">' + spaces.length + ' active spaces</div>' +
    '<button class="btn btn-primary btn-sm" onclick="openSpaceModal()">+ New Space</button>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    '<table class="data-table"><thead><tr>' +
    '<th>Space</th><th>Members</th><th>Issues</th><th>Visibility</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── Global Custom Fields ──────────────────────────────────
async function renderAdminCustomFields(el) {
  var allCF = (S.data && S.data.custom_fields) || [];
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });

  var rows = allCF.map(function(cf) {
    var sp = spaces.find(function(s){ return s.id===cf.space_id; });
    return '<tr>' +
      '<td style="font-size:13px;font-weight:600">' + esc(cf.name) + '</td>' +
      '<td><span class="badge badge-muted">' + esc(cf.field_type) + '</span></td>' +
      '<td style="font-size:12px;color:var(--text3)">' + (sp ? sp.icon+' '+sp.name : '—') + '</td>' +
      '<td>' + (cf.is_required ? '<span class="badge badge-success">Required</span>' : '<span class="badge badge-muted">Optional</span>') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔧 Custom Fields</h2>' +
    '<p>All custom fields defined across spaces.</p>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    (rows ? '<table class="data-table"><thead><tr><th>Field Name</th><th>Type</th><th>Space</th><th>Required</th></tr></thead><tbody>' + rows + '</tbody></table>' :
    '<div style="padding:32px;text-align:center;color:var(--text3)">No custom fields defined yet. Add them from each Space → Settings → Custom Fields.</div>') +
    '</div>' +
    '<p style="font-size:12px;color:var(--text3);margin-top:12px">To add or edit custom fields, navigate to the specific space → Settings → Custom Fields tab.</p>';
}

// ── Email / SMTP Settings ─────────────────────────────────
var _smtpProviders = {
  gmail:    { label: 'Gmail',              host: 'smtp.gmail.com',          port: 587, note: 'Requires an App Password. Go to myaccount.google.com → Security → 2-Step Verification → App Passwords.' },
  o365:     { label: 'Outlook / Office 365', host: 'smtp.office365.com',    port: 587, note: 'Use your Microsoft account email and password. If MFA is enabled, create an App Password in your Microsoft account security settings.' },
  outlook:  { label: 'Hotmail / Outlook Personal', host: 'smtp-mail.outlook.com', port: 587, note: 'Use your Hotmail/Outlook email and password. If MFA is enabled, create an App Password in your Microsoft account.' },
  custom:   { label: 'Custom SMTP',        host: '',                         port: 587, note: 'Enter your mail server host and credentials manually.' }
};

async function renderAdminEmailSettings(el) {
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading...</div>';
  var cfg = {};
  try { cfg = await api('/api/admin/email-settings'); } catch(e) { cfg = {}; }

  // Detect current provider from host
  var currentProvider = 'custom';
  if ((cfg.smtp_host||'').includes('gmail'))        currentProvider = 'gmail';
  else if ((cfg.smtp_host||'').includes('office365')) currentProvider = 'o365';
  else if ((cfg.smtp_host||'').includes('outlook') || (cfg.smtp_host||'').includes('hotmail')) currentProvider = 'outlook';

  var providerBtns = Object.keys(_smtpProviders).map(function(k) {
    var active = k === currentProvider;
    return '<button class="btn btn-sm smtp-provider-btn ' + (active ? 'btn-primary' : 'btn-outline') + '" data-provider="'+k+'" style="flex:1">'+_smtpProviders[k].label+'</button>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>✉️ Email / SMTP</h2>' +
    '<p>Configure outbound email for invitations and all user notifications.</p>' +
    '</div>' +

    (cfg.env_active ? '<div class="admin-card" style="background:#f0fdf4;border:1px solid #86efac;margin-bottom:16px">' +
      '<p style="margin:0;color:#16a34a;font-weight:600">✅ Email active via .env — sending from <strong>' + esc(cfg.env_user||'') + '</strong></p>' +
      '<p style="margin:4px 0 0;font-size:12px;color:#15803d">Emails will be delivered. Save settings below to override.</p>' +
      '</div>' : '') +

    '<div class="admin-card">' +
    '<h3 style="margin-top:0">Select Email Provider</h3>' +
    '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">' + providerBtns + '</div>' +

    '<div id="smtpProviderNote" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;font-size:12px;color:#1d4ed8;margin-bottom:16px">' +
      _smtpProviders[currentProvider].note +
    '</div>' +

    '<div class="admin-field-row">' +
      '<label class="admin-field-label">SMTP Host</label>' +
      '<input id="smtpHost" class="input" placeholder="smtp.gmail.com" value="'+(cfg.smtp_host||_smtpProviders[currentProvider].host)+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Port</label>' +
      '<input id="smtpPort" class="input" type="number" placeholder="587" value="'+(cfg.smtp_port||587)+'" style="width:100px">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Email Address</label>' +
      '<input id="smtpUser" class="input" placeholder="your@email.com" value="'+(cfg.smtp_user||'')+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Password / App Password</label>' +
      '<input id="smtpPass" class="input" type="password" placeholder="Password or App Password" value="'+(cfg.smtp_pass||'')+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">From Name (optional)</label>' +
      '<input id="smtpFrom" class="input" placeholder="Neutara SprintBoard <your@email.com>" value="'+(cfg.smtp_from||'')+'">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-top:20px">' +
      '<button class="btn btn-primary" id="saveSmtpBtn">Save Settings</button>' +
      '<button class="btn btn-outline" id="testSmtpBtn">Send Test Email to Me</button>' +
    '</div>' +
    '</div>';

  // Provider selector
  qsa('.smtp-provider-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      qsa('.smtp-provider-btn').forEach(function(b){ b.className = b.className.replace('btn-primary','btn-outline'); });
      btn.className = btn.className.replace('btn-outline','btn-primary');
      var p = _smtpProviders[btn.dataset.provider];
      if (p.host) {
        qs('#smtpHost').value = p.host;
        qs('#smtpPort').value = p.port;
      }
      qs('#smtpProviderNote').textContent = p.note;
    });
  });

  qs('#saveSmtpBtn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api('/api/admin/email-settings', 'PUT', {
        smtp_host: qs('#smtpHost').value.trim(),
        smtp_port: qs('#smtpPort').value,
        smtp_user: qs('#smtpUser').value.trim(),
        smtp_pass: qs('#smtpPass').value,
        smtp_from: qs('#smtpFrom').value.trim()
      });
      popupAlert('Email Settings Saved', 'SMTP configuration saved. Click "Send Test Email" to verify.', 'success');
    } catch(e) { popupAlert('Error', 'Could not save settings.', 'error'); }
    btn.disabled = false; btn.textContent = 'Save Settings';
  });

  qs('#testSmtpBtn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      var r = await api('/api/admin/email-test', 'POST');
      if (r.sent) {
        popupAlert('Test Email Sent', 'Check your inbox — test email was delivered successfully!', 'success');
      } else {
        popupAlert('Test Failed', (r.reason || 'Could not send.') + ' Check your credentials and try again.', 'error');
      }
    } catch(e) { popupAlert('Error', 'Test email failed.', 'error'); }
    btn.disabled = false; btn.textContent = 'Send Test Email to Me';
  });
}

// ── Audit Log ─────────────────────────────────────────────
async function renderAdminAuditLog(el) {
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading audit log...</div>';
  var users = (S.data && S.data.users) || [];
  var issues = (S.data && S.data.issues) || [];

  // Fetch real issue_history from DB
  var history = [];
  try { history = await api('/api/admin/audit-log'); } catch(e) { history = []; }

  var fieldLabel = { title:'Title', status:'Status', priority:'Priority', assignee_id:'Assignee',
    reporter_id:'Reporter', sprint_id:'Sprint', labels:'Labels', story_points:'Story Points',
    start_date:'Start Date', due_date:'Due Date', description:'Description' };

  var rows = history.map(function(h) {
    var u = users.find(function(u){ return u.id===h.user_id; });
    var issue = issues.find(function(i){ return i.id===h.issue_id; });
    var fl = fieldLabel[h.field_name] || h.field_name;
    var action = 'Changed <strong>' + esc(fl) + '</strong>';
    if (h.old_value && h.new_value) action += ' from <span style="text-decoration:line-through;color:var(--text3)">' + esc(h.old_value) + '</span> → <strong>' + esc(h.new_value) + '</strong>';
    else if (h.new_value) action += ' to <strong>' + esc(h.new_value) + '</strong>';
    return '<tr>' +
      '<td style="font-size:12px;color:var(--text3);white-space:nowrap">' + fmtDateTime(h.created_at) + '</td>' +
      '<td><div style="display:flex;align-items:center;gap:8px">' +
      (u ? '<div class="user-avatar-sm" style="background:'+(u.color||'#6366f1')+';width:22px;height:22px;font-size:9px">'+initials(u.name)+'</div>' : '') +
      '<span style="font-size:12px">' + (u ? esc(u.name) : (h.user_name || 'Unknown')) + '</span></div></td>' +
      '<td style="font-size:12px">' + action + '</td>' +
      '<td style="font-size:12px">' +
      (issue ? '<a onclick="openIssuePage(\''+issue.id+'\')" style="color:var(--accent);cursor:pointer">['+esc(issue.key||'#')+'] '+esc(issue.title)+'</a>' : (h.issue_key ? '['+esc(h.issue_key)+']' : '—')) +
      '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>📋 Audit Log</h2>' +
    '<p>All field changes, status updates, and actions across the organization.</p>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    (rows ? '<table class="data-table"><thead><tr><th>Date & Time</th><th>User</th><th>Change</th><th>Issue</th></tr></thead><tbody>' + rows + '</tbody></table>' :
    '<div style="padding:32px;text-align:center;color:var(--text3)">No audit history yet. Changes to issues will appear here.</div>') +
    '</div>';
}

// ── Normalize pasted text in description editors ───────────
// Contenteditable fields paste the source page's full HTML by default (Word,
// Google Docs, browser pages all carry their own margins/empty paragraphs),
// which shows up here as large gaps between lines. Paste as plain text
// instead — line breaks are kept, but the source's own spacing is dropped.
// Every rich-text field in the app carries .jira-editor-body or .rte-content, so
// matching on the class covers the comment box too (it was missing from the old
// id list, so a Teams paste there went in as raw markup) and any field added later.
var PLAIN_PASTE_IDS = ['drawerDesc', 'drawerFixDesc', 'issueDescContent', 'drawerCommentInput'];
function isPlainTextPasteTarget(el) {
  if (!el) return false;
  if (PLAIN_PASTE_IDS.indexOf(el.id) !== -1) return true;
  return !!(el.classList &&
    (el.classList.contains('jira-editor-body') || el.classList.contains('rte-content')));
}
// Whitelist-based cleanup for pasted text/html -- keeps real formatting
// (bold/italic/headings/lists/links) but throws away everything that made the
// old plain-text-only paste necessary in the first place: Word/Google Docs'
// own inline styles/margins/font tags/classes, and any <script>/<style>/etc.
// Unknown or disallowed tags are unwrapped (their content kept, the tag
// dropped) rather than deleted outright, so nothing the user pasted vanishes.
var PASTE_ALLOWED_TAGS = {
  B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1,
  H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
  UL: 1, OL: 1, LI: 1, BR: 1, P: 1, A: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1
};
function sanitizeRichPasteHtml(rawHtml) {
  var source = document.createElement('div');
  source.innerHTML = rawHtml;
  source.querySelectorAll('script,style,meta,link,head,title,object,embed,iframe,img,svg').forEach(function (n) { n.remove(); });

  function clean(node) {
    var out = document.createDocumentFragment();
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) { out.appendChild(child.cloneNode()); return; }
      if (child.nodeType !== 1) return; // drop comments (incl. Word's <!--[if]-->) and the rest
      var tag = child.tagName;
      // DIV/SPAN/FONT and anything else not on the whitelist: unwrap, keeping
      // its text/children but dropping the wrapper and whatever inline
      // style/class/font it carried -- this is what used to cause the giant
      // gaps between pasted lines that the old plain-text-only paste was
      // written to avoid.
      if (!PASTE_ALLOWED_TAGS[tag]) { out.appendChild(clean(child)); return; }
      var el = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        var href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      el.appendChild(clean(child));
      out.appendChild(el);
    });
    return out;
  }

  var wrap = document.createElement('div');
  wrap.appendChild(clean(source));
  // Collapse the empty-paragraph runs Word/Docs use for spacing (an empty <p>
  // that survived cleaning contributes nothing but a blank line).
  wrap.querySelectorAll('p').forEach(function (p) {
    if (!p.textContent.trim() && !p.querySelector('br')) p.remove();
  });
  return wrap.innerHTML;
}

document.addEventListener('paste', function(e) {
  var active = document.activeElement;
  if (!isPlainTextPasteTarget(active)) return;
  var cd = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
  if (!cd) return;
  var items = cd.items || [];
  for (var i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) return; } // image handler above

  var htmlSource = cd.getData('text/html');
  if (htmlSource) {
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitizeRichPasteHtml(htmlSource));
    return;
  }

  // No text/html on the clipboard (plain-text copy, or a source that only
  // offers text/plain) -- keep line breaks as before, but no longer flatten
  // real formatting that WAS on the clipboard, since that case is now handled
  // above.
  var text = cd.getData('text/plain');
  if (text === '' || text == null) return;
  e.preventDefault();
  var html = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse runs of blank lines down to one
    .split('\n')
    .map(function(line) { return esc(line); })
    .join('<br>');
  document.execCommand('insertHTML', false, html);
});

window._openAttachmentPreviewFromDataUrl = function (dataUrl) {
  var lb = document.createElement('div');
  lb.className = 'image-lightbox';
  lb.innerHTML = '<button type="button" class="image-lightbox-close" aria-label="Close">×</button>' +
    '<img src="' + dataUrl + '" alt="Preview">';
  function closeLb() {
    document.removeEventListener('keydown', onKey);
    if (lb.parentNode) lb.parentNode.removeChild(lb);
  }
  function onKey(ev) { if (ev.key === 'Escape') closeLb(); }
  lb.querySelector('.image-lightbox-close').onclick = function (ev) { ev.stopPropagation(); closeLb(); };
  lb.querySelector('img').onclick = function (ev) { ev.stopPropagation(); };
  lb.onclick = closeLb;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(lb);
};

// The clickable issue-type badge lives in bindDrawerEdits() (search "_typeMenu").
// A second, duplicate document-level picker used to live here and rendered its own
// competing menu on the same click. Its save path called window._drawerAutoSave,
// which is never defined, so it fell through to fetch(PATCH /api/issues/:id) — a
// route the server does not have. fetch() does not reject on 404, so the .then()
// still fired "Type updated" while nothing was saved. Removed; the surviving
// picker saves through autoSave() -> PUT /api/issues/:id.

// ── All Work inline edit functions ─────────────────────────
// Which cell/button opened the current inline menu, so re-clicking it can
// toggle the menu shut. `_awMenuSeq` invalidates the pending outside-click
// registration below whenever the menu is torn down, so a timer left over
// from a closed menu can't close the next one that opens.
var _awMenuOwner = null;
var _awMenuDocHandler = null;
var _awMenuSeq = 0;

// Resolve the click to its owning cell so clicking anywhere in the same cell
// counts as the same trigger. Uses e.target rather than e.currentTarget
// because awInlineAssignee opens its menu after an async members fetch, by
// which point currentTarget has been cleared.
function _awMenuOwnerFor(e) {
  var t = e && e.target;
  if (!t) return null;
  return (t.closest && t.closest('td,button')) || t;
}

function _awRemoveMenu() {
  var m = document.getElementById('_awInlineMenu');
  if (m) m.remove();
  if (_awMenuDocHandler) {
    document.removeEventListener('click', _awMenuDocHandler);
    _awMenuDocHandler = null;
  }
  _awMenuOwner = null;
  _awMenuSeq++;
}

// Keep the menu inside the viewport: cap its height to the space available,
// flip it above the trigger when it won't fit below, and pull it back in
// horizontally. Without this, clicking a row near the bottom of the list
// pushed the last options off-screen where they couldn't be reached.
function _awPositionMenu(menu, anchorEl, clickX, clickY) {
  var GAP = 4, MARGIN = 8;
  var vw = window.innerWidth, vh = window.innerHeight;
  var rect = anchorEl && anchorEl.getBoundingClientRect
    ? anchorEl.getBoundingClientRect()
    : { top: clickY, bottom: clickY, left: clickX, right: clickX };

  var spaceBelow = vh - rect.bottom - GAP - MARGIN;
  var spaceAbove = rect.top - GAP - MARGIN;
  var flipUp = spaceBelow < 140 && spaceAbove > spaceBelow;

  menu.style.maxHeight = Math.max(120, Math.min(300, flipUp ? spaceAbove : spaceBelow)) + 'px';

  var h = menu.offsetHeight;
  menu.style.top = (flipUp
    ? Math.max(MARGIN, rect.top - GAP - h)
    : Math.min(rect.bottom + GAP, vh - MARGIN - h)) + 'px';

  var w = menu.offsetWidth;
  menu.style.left = Math.max(MARGIN, Math.min(rect.left, vw - MARGIN - w)) + 'px';
}

function _awShowMenu(e, items, onSelect) {
  var owner = _awMenuOwnerFor(e);
  // Second click on the same trigger closes instead of rebuilding. The
  // trigger stops propagation, so the outside-click handler never fires for
  // this click and can't do it for us.
  if (document.getElementById('_awInlineMenu') && _awMenuOwner && _awMenuOwner === owner) {
    _awRemoveMenu();
    return;
  }
  _awRemoveMenu();
  _awMenuOwner = owner;
  var mySeq = _awMenuSeq;
  var menu = document.createElement('div');
  menu.id = '_awInlineMenu';
  menu.style.cssText = 'position:fixed;top:-9999px;left:-9999px;background:#ffffff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 8px 16px rgba(9,30,66,0.25);z-index:9999;min-width:240px;padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:300px;overflow-y:auto;';
  items.forEach(function(item) {
    var div = document.createElement('div');
    div.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:14px;border-radius:0;display:flex;align-items:center;gap:4px;color:#172b4d;border-left:3px solid transparent;';
    div.innerHTML = item.html;
    div.onmouseover = function(){ this.style.background='#f4f5f7'; this.style.borderLeftColor='#0052cc'; };
    div.onmouseout = function(){ this.style.background=''; this.style.borderLeftColor='transparent'; };
    div.onclick = function(ev) { ev.stopPropagation(); _awRemoveMenu(); onSelect(item.value); };
    menu.appendChild(div);
  });
  document.body.appendChild(menu);
  _awPositionMenu(menu, owner, e.clientX, e.clientY);
  setTimeout(function() {
    if (mySeq !== _awMenuSeq) return; // this menu was already closed/replaced
    _awMenuDocHandler = function () { _awRemoveMenu(); };
    document.addEventListener('click', _awMenuDocHandler);
  }, 100);
}

function awInlineAssignee(e, issueId, current) {
  e.stopPropagation();
  function showAssigneeMenu(members) {
    members = members.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var items = [{ value: '', html: '<span style="font-size:14px;color:#172b4d;flex:1">Unassigned</span>' + (!current?'<span style="color:#0052cc;font-weight:700">&#10003;</span>':'') }].concat(
      members.map(function(m) {
        var check = String(m.id) === String(current) ? '<span style="color:#0052cc;font-weight:700">&#10003;</span>' : '';
        return { value: m.id, html: avatarHtml(m,24) + '<span style="font-size:14px;color:#172b4d;margin-left:8px;flex:1">' + esc(m.name) + '</span>' + check };
      })
    );
    _awShowMenu(e, items, function(val) {
      api('/api/issues/' + issueId, 'PUT', { assignee_id: val || null }).then(function() {
        refreshData().then(renderAllWork);
        toast('Assignee updated');
      });
    });
  }
  // Try S.data.users first
  var members = (window.S && S.data && S.data.users) || [];
  if (members.length) {
    showAssigneeMenu(members);
  } else {
    // Fetch directly from API
    api('/api/data').then(function(data) {
      if (data && data.users) {
        S.data = S.data || {};
        S.data.users = data.users;
        showAssigneeMenu(data.users);
      } else {
        showAssigneeMenu([]);
      }
    });
  }
}

// ── Jira-like status button ─────────────────────────────────
var STATUS_BTN_STYLES = {
  'To Do':      'background:#dfe1e6;color:#42526e',
  'In Progress':'background:#0052cc;color:#ffffff',
  'In Review':  'background:#ff991f;color:#ffffff',
  'Done':       'background:#00875a;color:#ffffff',
  'Blocked':    'background:#dc2626;color:#ffffff'
};

function updateStatusBtn(status) {
  var btn = document.getElementById('drawerStatusBtn');
  var lbl = document.getElementById('drawerStatusLabel');
  if (!btn || !lbl) return;
  lbl.textContent = status || 'To Do';
  var s = STATUS_BTN_STYLES[status] || STATUS_BTN_STYLES['To Do'];
  var parts = s.split(';');
  parts.forEach(function(p) {
    var kv = p.split(':');
    if (kv.length === 2) btn.style[kv[0].trim()] = kv[1].trim();
  });
}

function toggleStatusDropdown() {
  var statuses = ISSUE_STATUSES;
  var current = document.getElementById('drawerStatus').value;
  var btn = document.getElementById('drawerStatusBtn');
  var old = document.getElementById('_statusBtnMenu');
  if (old) { old.remove(); return; }
  var rect = btn.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.id = '_statusBtnMenu';
  menu.style.cssText = 'position:fixed;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px;background:#fff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 8px 16px rgba(9,30,66,0.25);z-index:9999;min-width:200px;padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
  statuses.forEach(function(s) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:14px;color:#172b4d;display:flex;align-items:center;justify-content:space-between;border-left:3px solid transparent;';
    item.innerHTML = '<span>' + s + '</span>' + (s === current ? '<span style="color:#0052cc;font-weight:700">✓</span>' : '');
    item.onmouseover = function(){ this.style.background='#f4f5f7'; this.style.borderLeftColor='#0052cc'; };
    item.onmouseout = function(){ this.style.background=''; this.style.borderLeftColor='transparent'; };
    item.onclick = function() {
      menu.remove();
      var sel = document.getElementById('drawerStatus');
      sel.value = s;
      sel.dispatchEvent(new Event('change'));
      // Paint from the select's value AFTER the change handler, not from `s`.
      // A blocked Done transition reverts sel.value inside the handler; passing
      // `s` here repainted the button "DONE" anyway, so the UI showed Done while
      // nothing was saved and a refresh snapped it back to the real status.
      updateStatusBtn(sel.value);
    };
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function h(ev) {
      if (!menu.contains(ev.target) && ev.target.id !== 'drawerStatusBtn') {
        menu.remove(); document.removeEventListener('click', h);
      }
    });
  }, 100);
}

function awInlineStatus(e, issueId, current) {
  e.stopPropagation();
  var statuses = ISSUE_STATUSES;
  var items = statuses.map(function(s) {
    var check = s === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: s, html: '<span style="font-size:14px;color:#172b4d;flex:1">' + s + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    if (val === 'Done') {
      var cached = (S.data.issues || []).find(function (iss) { return iss.id === issueId; });
      if (!canTransitionIssueToDone(cached || issueId, current)) return;
    }
    api('/api/issues/' + issueId, 'PUT', { status: val }).then(function (updated) {
      afterIssueFieldUpdate(issueId, {
        status: val,
        updated_at: (updated && updated.updated_at) || new Date().toISOString()
      });
      toast('Status updated');
    }).catch(function () { toast('Failed to update status', 'error'); });
  });
}

function awInlinePriority(e, issueId, current) {
  e.stopPropagation();
  // This issue's own space's configured Priority list, not the fixed 5 --
  // an admin-added priority value was previously unreachable from this menu.
  var _iss = (S.data.issues || []).find(function (x) { return x.id == issueId; });
  var priorities = getIssuePriorityOptionsForSpace(_iss ? _iss.space_id : S.currentSpace).map(function (o) { return o.v; });
  var items = priorities.map(function(p) {
    var check = p === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: p, html: '<span style="font-size:14px;color:#172b4d;flex:1;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">' + cap(p) + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    api('/api/issues/' + issueId, 'PUT', { priority: val }).then(function (updated) {
      afterIssueFieldUpdate(issueId, {
        priority: val,
        updated_at: (updated && updated.updated_at) || new Date().toISOString()
      });
      toast('Priority updated');
    }).catch(function () { toast('Failed to update priority', 'error'); });
  });
}

// ── Jira-style editor toolbar show/hide ─────────────────
var _jiraEditorPairs = [
  { body: 'drawerDesc',         toolbar: 'drawerDescToolbar' },
  { body: 'drawerFixDesc',      toolbar: 'drawerFixDescToolbar' },
  { body: 'drawerCommentInput', toolbar: 'drawerCommentToolbar' }
];

document.addEventListener('focusin', function(e) {
  _jiraEditorPairs.forEach(function(p) {
    if (e.target.id === p.body) {
      var tb = document.getElementById(p.toolbar);
      if (tb) tb.classList.add('active');
    }
  });
});

document.addEventListener('focusout', function(e) {
  _jiraEditorPairs.forEach(function(p) {
    if (e.target.id === p.body) {
      setTimeout(function() {
        var tb = document.getElementById(p.toolbar);
        var body = document.getElementById(p.body);
        if (tb && body && !tb.contains(document.activeElement) && document.activeElement !== body) {
          tb.classList.remove('active');
        }
      }, 150);
    }
  });
});

// Update toolbar button active states on selection change
document.addEventListener('selectionchange', function() {
  _jiraEditorPairs.forEach(function(p) {
    var tb = document.getElementById(p.toolbar);
    if (!tb || !tb.classList.contains('active')) return;
    tb.querySelectorAll('.jira-tb-btn[title]').forEach(function(btn) {
      var cmd = { 'Bold': 'bold', 'Italic': 'italic', 'Underline': 'underline', 'Strikethrough': 'strikeThrough' }[btn.title];
      if (cmd) {
        try { btn.classList.toggle('active-fmt', document.queryCommandState(cmd)); } catch(e) {}
      }
    });
  });
});

function richFormatBlock(tag, elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.focus();
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p') {
    document.execCommand('formatBlock', false, tag);
  }
}

function richIndent(elId, dir) {
  document.getElementById(elId) && document.getElementById(elId).focus();
  document.execCommand(dir === 'indent' ? 'indent' : 'outdent');
}

function richInsertLink(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var selectedText = sel && sel.toString() ? sel.toString() : '';
  var url = prompt('Enter URL:', 'https://');
  if (!url) return;
  if (selectedText) {
    document.execCommand('createLink', false, url);
  } else {
    var text = prompt('Link text:', url) || url;
    document.execCommand('insertHTML', false, '<a href="' + url + '" target="_blank">' + text + '</a>');
  }
}

function richInsertCode(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var text = sel && sel.toString() ? sel.toString() : 'code';
  document.execCommand('insertHTML', false, '<code>' + text + '</code>');
}

function richInsertCodeBlock(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var text = sel && sel.toString() ? sel.toString() : 'Enter code here';
  document.execCommand('insertHTML', false, '<pre>' + text + '</pre><p><br></p>');
}

function richInsertQuote(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  document.execCommand('formatBlock', false, 'blockquote');
}

function richInsertImage(elId) {
  var url = prompt('Enter image URL:');
  if (url) document.execCommand('insertImage', false, url);
}

// ── Copy issue link ─────────────────────────────────────
// Shared by the drawer's own copy-link button and the "created while another
// ticket was open" toast, which offers a copy-link action for the NEW ticket
// (a different key than whatever is currently open, so it can't just reuse
// copyDrawerLink's window._currentIssueKey).
function copyIssueLinkByKey(issueKey) {
  var url = window.location.origin + '/?issue=' + encodeURIComponent(issueKey);
  function fallbackCopy() {
    var el = document.createElement('input');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('Link copied!');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() { toast('Link copied!'); }).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}

function copyDrawerLink() {
  // Use current issue key saved when drawer opened
  var issueKey = window._currentIssueKey || (window.S && S.drawerIssueId);
  copyIssueLinkByKey(issueKey);
}

// history.back() only QUEUES a navigation -- it doesn't wait for the
// resulting popstate. Two back-trigger clicks fired before that popstate
// lands (a real, easy-to-hit case: click the drawer's "Back" button, see no
// instant visual change while the event settles, click it again) both
// call history.back(), and browsers do not coalesce them -- the second one
// consumes a SECOND history entry, skipping past the intended destination
// entirely. This guard makes a second back-trigger click a no-op until the
// first one's popstate has actually been handled.
function _goBackOnce() {
  if (window._backPending) return;
  window._backPending = true;
  window.history.back();
}

// ── Browser back button support ─────────────────────────
// _navigatingBack used to be set true only around the last one or two
// statements, with the reset scheduled via a trailing setTimeout(fn, 0) --
// if ANYTHING earlier in this handler threw (closing the drawer, resolving
// the target space/tab, etc.), that setTimeout line was never reached and
// the flag stayed stuck true forever. Every popstate after that (including
// the browser's own native Back button, which doesn't go through
// _goBackOnce at all) hit the early-return at the top and did nothing --
// exactly a "first click does nothing" symptom, until something else
// happened to flip the flag back. try/finally guarantees the reset runs no
// matter which line throws.
window.addEventListener('popstate', function () {
  window._backPending = false;
  if (window._navigatingBack) return;
  window._navigatingBack = true;
  try {
    var issueKey = new URLSearchParams(window.location.search).get('issue');

    if (!issueKey && (S.drawerIssueId || document.body.classList.contains('issue-page'))) {
      stopDrawerLiveSync();
      window._drawerPending = {};
      _closeIssueDrawer();
    }

    if (issueKey) {
      var issueByKey = (S.data && S.data.issues || []).find(function (i) { return i.key === issueKey || i.id === issueKey; });
      openIssuePage(issueByKey ? issueByKey.id : issueKey, { skipHistory: true });
    } else {
      applyRouteFromUrl({ replaceUrl: true });
    }
  } finally {
    setTimeout(function () { window._navigatingBack = false; }, 0);
  }
});

function goBackFromIssue() {
  stopDrawerLiveSync();
  window._drawerPending = {};
  if (window.history.length > 1) {
    _goBackOnce();
    return;
  }
  _closeIssueDrawer();
  var pView = S._prevView;
  var pYourWorkTab = S._prevYourWorkTab;
  var returnTab = S._prevTab || window._issueReturnTab || 'backlog';
  var returnSpace = S._prevSpace || window._issueReturnSpace || S.currentSpace;
  window._issueReturnTab = null;
  window._issueReturnSpace = null;
  if (returnSpace) {
    navigateToSpace(returnSpace, returnTab, { replaceUrl: true });
  } else if (pView === 'yourwork') {
    if (pYourWorkTab) S.yourWorkTab = pYourWorkTab;
    if (S._prevYwOpen) applyYourWorkOpenFilter();
    else clearYourWorkFilters();
    navigateTo('yourwork', { replaceUrl: true });
  } else {
    navigateTo('home', { replaceUrl: true });
  }
}

// Same destination-resolving logic as goBackFromIssue's fallback branch, but
// never calls window.history.back() / relies on popstate at all -- see the
// comment on this button's onclick wiring in openIssuePage.
function closeIssueFromAllWork() {
  stopDrawerLiveSync();
  window._drawerPending = {};
  _closeIssueDrawer();
  var returnSpace = S._prevSpace || window._issueReturnSpace || S.currentSpace;
  window._issueReturnTab = null;
  window._issueReturnSpace = null;
  if (returnSpace) {
    navigateToSpace(returnSpace, 'allwork', { replaceUrl: true });
  } else {
    navigateTo('home', { replaceUrl: true });
  }
}
window.closeIssueFromAllWork = closeIssueFromAllWork;

// Copy issue URL and number to clipboard
window._copyIssueUrl = function() {
  var issueKey = $('drawerKey') && $('drawerKey').textContent;
  if (!issueKey) return;
  var url = window.location.origin + '/?issue=' + encodeURIComponent(issueKey);
  navigator.clipboard.writeText(url).then(function() {
    toast('Copied: ' + issueKey);
  }).catch(function(err) {
    alert('Failed to copy');
  });
};


// Show/hide description toolbars on focus
(function() {
  function initDescToolbars() {
    var fields = [
      { field: 'drawerDesc', toolbar: 'drawerDescToolbar' },
      { field: 'drawerFixDesc', toolbar: 'drawerFixDescToolbar' }
    ];
    fields.forEach(function(item) {
      var el = document.getElementById(item.field); if(!el) return;
      var tb = document.getElementById(item.toolbar);
      el._tbInit = true;
      if(tb) tb.classList.remove('active');
      el.addEventListener('focus', function() { if(tb) tb.classList.add('active'); }); el.addEventListener('blur', function() { setTimeout(function(){ if(tb) tb.classList.remove('active'); }, 200); });
    });
  }
  var origOpen = window.openDrawer;
  window.openDrawer = function(id) {
    origOpen && origOpen(id);
    setTimeout(initDescToolbars, 500);
  };
  document.addEventListener('DOMContentLoaded', function() { setTimeout(initDescToolbars, 500); });
})();
// Auto-linkify URLs
(function(){
  // Only bare URLs sitting in plain text become links. Deliberately DOM-based:
  // the previous version ran a regex over el.innerHTML, which matched URLs inside
  // attribute values too — a pasted Teams/Outlook anchor carries
  // title="https://…", so it produced title="<a href="…">…</a>", the quote closed
  // the attribute early, and every remaining attribute (id, rel, class="fui-Link
  // ___1q1shib …") spilled out as visible text. Worse, it compounded: each blur
  // re-ran over the already-broken markup. Walking text nodes and building the
  // anchor with createElement/textContent makes that class of bug impossible —
  // a URL can never be re-parsed as markup.
  var URL_RE = /https?:\/\/[^\s<>"']+/g;

  function linkifyTextNodes(root) {
    var doc = root.ownerDocument || document;
    var pending = [];
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node.nodeValue || node.nodeValue.indexOf('http') === -1) continue;
      // Never touch text that is already inside a link — that is what created
      // nested <a> tags and the mangling that followed.
      var inAnchor = false;
      for (var p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (p.nodeName === 'A') { inAnchor = true; break; }
      }
      if (!inAnchor) pending.push(node);
    }

    var changed = false;
    pending.forEach(function (node) {
      var text = node.nodeValue;
      URL_RE.lastIndex = 0;
      var frag = doc.createDocumentFragment();
      var last = 0, m;
      while ((m = URL_RE.exec(text)) !== null) {
        var url = m[0];
        // Don't swallow punctuation that merely follows the URL in a sentence.
        var trimmed = url.replace(/[.,;:!?)\]}'"]+$/, '');
        var start = m.index;
        if (start > last) frag.appendChild(doc.createTextNode(text.slice(last, start)));
        var a = doc.createElement('a');
        a.href = trimmed;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'color:#0129AC;text-decoration:underline;cursor:pointer';
        a.textContent = trimmed;      // never parsed as HTML
        frag.appendChild(a);
        last = start + trimmed.length;
        URL_RE.lastIndex = last;
        changed = true;
      }
      if (!changed && last === 0) return;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return changed;
  }
  window._linkifyTextNodes = linkifyTextNodes;   // exported for tests

  function linkify(el,field){
    if(!el||el._lf)return;
    el._lf=true;
    el.addEventListener("blur",function(){
      if (linkifyTextNodes(el)) markDrawerDescDirty(el.id);
    });
  }
  function init(){
    linkify(document.getElementById("drawerDesc"),"description");
    linkify(document.getElementById("drawerFixDesc"),"fix_description");
  }
  var o=window.openDrawer;
  window.openDrawer=function(id){o&&o(id);setTimeout(init,700);};
  document.addEventListener("DOMContentLoaded",function(){setTimeout(init,700);});
})();

// Capture Team and Product Type
// ═══════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
(function() {
  var _gsTimer = null;
  var _gsActive = false;

  function gsInit() {
    var input = $('globalSearchInput');
    var drop = $('globalSearchDrop');
    if (!input || !drop) return;

    // Open on focus
    input.addEventListener('focus', function() {
      _gsActive = true;
      if (input.value.trim().length >= 1) gsSearch(input.value.trim());
      else gsShowRecent();
    });

    input.addEventListener('input', function() {
      clearTimeout(_gsTimer);
      var q = input.value.trim();
      if (!q) { gsShowRecent(); return; }
      _gsTimer = setTimeout(function() { gsSearch(q); }, 180);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { gsClose(); input.blur(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); gsFocusItem(0); }
    });

    // Keyboard shortcut: press / to focus search
    document.addEventListener('keydown', function(e) {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.activeElement.isContentEditable) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Close on outside click
    document.addEventListener('mousedown', function(e) {
      var wrap = $('globalSearchWrap');
      if (wrap && !wrap.contains(e.target)) gsClose();
    });
  }

  function gsClose() {
    var drop = $('globalSearchDrop');
    if (drop) drop.setAttribute('hidden', '');
    _gsActive = false;
  }

  function gsShowRecent() {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    var issues = getVisibleIssues()
      .slice().sort(function(a,b){ return new Date(b.updated_at)-new Date(a.updated_at); })
      .slice(0, 8);
    if (!issues.length) { drop.setAttribute('hidden',''); return; }
    drop.innerHTML = '<div class="gs-section-label">Recent Issues</div>' + issues.map(gsItemHtml).join('');
    drop.removeAttribute('hidden');
    gsBindItems();
  }

  function gsSearch(q) {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    var lower = q.toLowerCase();
    var issues = getVisibleIssues().filter(function(i) {
      return (issueKeyStr(i) || '').toLowerCase().indexOf(lower) !== -1 ||
             (i.title || '').toLowerCase().indexOf(lower) !== -1 ||
             (i.status || '').toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 12);
    if (!issues.length) {
      drop.innerHTML = '<div class="gs-empty">No issues found for "' + esc(q) + '"</div>';
      drop.removeAttribute('hidden');
      return;
    }
    drop.innerHTML = '<div class="gs-section-label">Issues</div>' + issues.map(function(i){ return gsItemHtml(i, q); }).join('');
    drop.removeAttribute('hidden');
    gsBindItems();
  }

  function gsItemHtml(issue) {
    var key = esc(issueKeyStr(issue));
    var title = esc(issue.title || '');
    var space = esc(issue.space_name || '');
    var statCol = STATUS_COLORS[issue.status] || '#6b7280';
    return '<div class="gs-item" data-issue-id="' + issue.id + '">' +
      '<span class="gs-item-key">' + key + '</span>' +
      '<span class="gs-item-title">' + title + '</span>' +
      '<span class="gs-item-meta" style="display:flex;align-items:center;gap:5px">' +
        '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + statCol + '"></span>' +
        space +
      '</span>' +
    '</div>';
  }

  function gsBindItems() {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    drop.querySelectorAll('.gs-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var id = el.dataset.issueId;
        var issue = (S.data && S.data.issues || []).find(function(i){ return String(i.id) === String(id); });
        gsClose();
        $('globalSearchInput').value = '';
        if (issue) openIssuePage(issue.id);
      });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') el.dispatchEvent(new MouseEvent('mousedown'));
        if (e.key === 'ArrowDown') { e.preventDefault(); var n = el.nextElementSibling; if (n && n.classList.contains('gs-item')) n.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); var p = el.previousElementSibling; if (p && p.classList.contains('gs-item')) p.focus(); else $('globalSearchInput').focus(); }
      });
      el.setAttribute('tabindex', '0');
    });
  }

  function gsFocusItem(idx) {
    var drop = $('globalSearchDrop');
    if (!drop || drop.hasAttribute('hidden')) return;
    var items = drop.querySelectorAll('.gs-item');
    if (items[idx]) items[idx].focus();
  }

  document.addEventListener('DOMContentLoaded', gsInit);
  setTimeout(function(){ gsInit(); }, 1200);
})();

// Delete bin. Org admin sees every space and is the only role that can Restore or
// Permanently delete. A space admin sees their own spaces' items read-only, so the
// action column is omitted entirely rather than shown-then-rejected.
// `opts.spaceId` renders the space-scoped view used by Space Settings → Deleted items.
async function renderDeletedTickets(el, opts) {
  opts = opts || {};
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading deleted items…</div>';
  var res;
  try {
    res = await api('/api/issues/deleted', 'GET', null, { silent: true });
  } catch (err) {
    // 403 here means "not an admin of any space" — show the reason, not a red error.
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:14px">' +
      esc(err.message || 'You do not have permission to view the deleted items bin.') + '</div>';
    return;
  }
  // Tolerate both the current {can_restore, items} shape and a bare array.
  var canRestore = Array.isArray(res) ? isOrgAdminUser() : !!(res && res.can_restore);
  var tickets = Array.isArray(res) ? res : ((res && res.items) || []);
  if (opts.spaceId) tickets = tickets.filter(function (t) { return t.space_id === opts.spaceId; });

  if (!tickets.length) {
    el.innerHTML = '<div style="padding:24px;color:var(--text3);text-align:center;font-size:14px">Nothing in the bin.</div>';
    return;
  }

  var TYPE_LABEL = { ticket: 'Ticket', sprint: 'Sprint', space: 'Space' };
  var TYPE_COLOR = { ticket: 'var(--accent)', sprint: '#8b5cf6', space: '#0891b2' };
  var counts = tickets.reduce(function (a, t) {
    var k = t.entity_type || 'ticket'; a[k] = (a[k] || 0) + 1; return a;
  }, {});
  var summary = Object.keys(counts).map(function (k) {
    return counts[k] + ' ' + (TYPE_LABEL[k] || k).toLowerCase() + (counts[k] === 1 ? '' : 's');
  }).join(' · ');

  var days = (res && res.retention_days) || binRetentionDays();
  // A bin row must ALWAYS have a name to show and to type. `label` is what the
  // current API sends; `key`/`name`/`title` cover an older or partial response so
  // the confirm dialog can never end up asking you to "type" an empty string.
  tickets.forEach(function (t) {
    t.entity_type = t.entity_type || 'ticket';
    t.label = t.label || t.key || t.name || t.title || t.id;
  });
  var byId = {};
  tickets.forEach(function (t) { byId[t.id] = t; });

  // "What exactly am I destroying?" — only non-zero facts, so the list stays short.
  function purgeDetails(t) {
    var out = [];
    if (t.entity_type === 'sprint') {
      out.push('Sprint record and its history are removed');
      out.push('Its tickets are already in the backlog and are NOT affected');
      return out;
    }
    if (t.title) out.push('Title: ' + t.title);
    if (t.space_name) out.push('Space: ' + t.space_name);
    if (t.status) out.push('Status when deleted: ' + t.status);
    if (t.assignee_name) out.push('Assignee: ' + t.assignee_name);
    if (t.comment_count) out.push(t.comment_count + ' comment' + (t.comment_count === 1 ? '' : 's') + ' will be destroyed');
    if (t.worklog_count) {
      out.push(t.worklog_count + ' work log' + (t.worklog_count === 1 ? '' : 's') +
        (t.logged_minutes ? ' (' + fmtMins(t.logged_minutes) + ' logged)' : '') + ' will be destroyed');
    }
    if (t.attachment_count) out.push(t.attachment_count + ' attachment' + (t.attachment_count === 1 ? '' : 's') + ' will be deleted from disk');
    if (t.subtask_count) out.push(t.subtask_count + ' subtask' + (t.subtask_count === 1 ? '' : 's') + ' will be detached (not deleted)');
    if (!t.comment_count && !t.worklog_count && !t.attachment_count) {
      out.push('No comments, work logs or attachments attached');
    }
    return out;
  }

  var html = '<div style="padding:0 0 16px">' +
    '<h3 style="margin:0 0 4px;font-size:16px">Deleted Items</h3>' +
    '<p style="color:var(--text3);font-size:13px;margin:0">' + (summary || '0 items') + ' in the bin · ' +
    'tickets and sprints are deleted permanently ' + days + ' days after they were binned' +
    (canRestore ? '' : ' · read-only — only an org admin can restore or permanently delete') + '</p></div>';

  // Bulk bar — org admin only, since it is a purge control.
  if (canRestore) {
    html += '<div class="bin-bulkbar">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="binSelectAll"> Select all' +
      '</label>' +
      '<span id="binSelCount" style="color:var(--text3)">None selected</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-outline" id="binBulkRestore" disabled>Restore selected</button>' +
      '<button class="btn btn-sm btn-outline text-danger" id="binBulkPurge" disabled>Delete forever</button>' +
    '</div>';
  }

  html += '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow-x:auto">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--bg3);color:var(--text2)">' +
    (canRestore ? '<th style="padding:10px 12px;width:28px"></th>' : '') +
    '<th style="padding:10px 12px;text-align:left">Type</th>' +
    '<th style="padding:10px 12px;text-align:left">Name</th>' +
    '<th style="padding:10px 12px;text-align:left">Details</th>' +
    '<th style="padding:10px 12px;text-align:left">Space</th>' +
    '<th style="padding:10px 12px;text-align:left">Deleted</th>' +
    '<th style="padding:10px 12px;text-align:left">By</th>' +
    '<th style="padding:10px 12px;text-align:left">Auto-deletes</th>' +
    (canRestore ? '<th style="padding:10px 12px;text-align:left">Actions</th>' : '') +
    '</tr></thead><tbody>';
  tickets.forEach(function (t) {
    var ty = t.entity_type || 'ticket';
    // Spaces are archived rather than tombstoned, so purging them is refused by
    // the API — don't offer a button that can only fail.
    var canPurge = canRestore && ty !== 'space';
    var dl = t.days_left;
    var expiry = ty === 'space'
      ? '<span style="color:var(--text3)">never</span>'
      : (dl == null ? '—'
        : dl <= 0 ? '<span class="bin-expiry-soon">any moment</span>'
        : dl <= 3 ? '<span class="bin-expiry-soon">in ' + dl + ' day' + (dl === 1 ? '' : 's') + '</span>'
        : 'in ' + dl + ' days');
    html += '<tr style="border-bottom:1px solid var(--border)">' +
      (canRestore
        ? '<td style="padding:10px 12px">' +
            '<input type="checkbox" class="bin-check" data-id="' + escAttr(t.id) + '"' +
            (canPurge ? '' : ' data-nopurge="1"') + '>' +
          '</td>'
        : '') +
      '<td style="padding:10px 12px"><span class="badge badge-muted">' + esc(TYPE_LABEL[ty] || ty) + '</span></td>' +
      '<td style="padding:10px 12px;font-weight:700;color:' + TYPE_COLOR[ty] + '">' + esc(t.label || '') + '</td>' +
      '<td style="padding:10px 12px">' + esc(t.title || '—') +
        (ty === 'sprint' && t.restorable_issues
          ? '<div style="color:var(--text3);font-size:12px;margin-top:2px">' +
            t.restorable_issues + ' ticket' + (t.restorable_issues === 1 ? '' : 's') + ' will come back with it</div>'
          : '') +
      '</td>' +
      '<td style="padding:10px 12px;color:var(--text3)">' + esc(t.space_name || '—') + '</td>' +
      '<td style="padding:10px 12px;color:var(--text3);font-size:12px">' + fmtDateTime(t.deleted_at) + '</td>' +
      '<td style="padding:10px 12px;color:var(--text3);font-size:12px">' + esc(t.deleted_by_name || '—') + '</td>' +
      '<td style="padding:10px 12px;font-size:12px">' + expiry + '</td>' +
      (canRestore
        ? '<td style="padding:10px 12px;white-space:nowrap">' +
            '<button class="btn btn-sm btn-outline bin-restore-btn" data-type="' + escAttr(ty) + '" data-id="' + escAttr(t.id) + '" data-key="' + escAttr(t.label || '') + '">Restore</button>' +
            (canPurge
              ? ' <button class="btn btn-sm btn-outline text-danger bin-purge-btn" data-type="' + escAttr(ty) + '" data-id="' + escAttr(t.id) + '" data-key="' + escAttr(t.label || '') + '">Delete forever</button>'
              : '') +
          '</td>'
        : '') +
      '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<p style="font-size:12px;color:var(--text3);margin-top:10px">' +
    'Restoring a sprint also brings back the tickets that went to the backlog with it — except any you have since moved into another sprint, which stay where you put them. ' +
    'Archived spaces can be restored but are never permanently deleted, by hand or automatically.' +
    (canRestore ? '' : ' To restore something, ask an org admin.') + '</p>';
  el.innerHTML = html;

  if (!canRestore) return;   // no handlers to bind for the read-only view

  // ── selection ────────────────────────────────────────────
  var checks = Array.prototype.slice.call(el.querySelectorAll('.bin-check'));
  var selAll = el.querySelector('#binSelectAll');
  var countEl = el.querySelector('#binSelCount');
  var bulkRestore = el.querySelector('#binBulkRestore');
  var bulkPurge = el.querySelector('#binBulkPurge');
  function selected() {
    return checks.filter(function (c) { return c.checked; }).map(function (c) { return byId[c.dataset.id]; }).filter(Boolean);
  }
  function syncSel() {
    var sel = selected();
    var purgeable = sel.filter(function (t) { return t.entity_type !== 'space'; });
    countEl.textContent = sel.length ? sel.length + ' selected' : 'None selected';
    bulkRestore.disabled = !sel.length;
    bulkPurge.disabled = !purgeable.length;
    // The purge button counts only what CAN be purged, so the number on the button
    // is the number of things that will actually be destroyed.
    bulkPurge.textContent = purgeable.length ? 'Delete forever (' + purgeable.length + ')' : 'Delete forever';
    selAll.checked = checks.length > 0 && sel.length === checks.length;
  }
  checks.forEach(function (c) { c.addEventListener('change', syncSel); });
  if (selAll) selAll.addEventListener('change', function () {
    checks.forEach(function (c) { c.checked = selAll.checked; });
    syncSel();
  });
  syncSel();

  // ── single restore ───────────────────────────────────────
  el.querySelectorAll('.bin-restore-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true; btn.textContent = 'Restoring…';
      try {
        var out = await api('/api/bin/' + btn.dataset.type + '/' + btn.dataset.id + '/restore', 'POST', null, { silent: true });
        var n = out && out.restored_issues;
        toast(btn.dataset.key + ' restored' + (n ? ' with ' + n + ' ticket' + (n === 1 ? '' : 's') : ''), 'success');
        await refreshData();
        renderDeletedTickets(el, opts);
      } catch (e) {
        toast(e.message || 'Failed to restore', 'error');
        btn.disabled = false; btn.textContent = 'Restore';
      }
    });
  });

  // ── single permanent delete ──────────────────────────────
  el.querySelectorAll('.bin-purge-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var item = byId[btn.dataset.id] || {};
      var key = item.label || btn.dataset.key || btn.dataset.id;
      var isSprint = btn.dataset.type === 'sprint';
      var ok = await typedConfirmDialog({
        title: 'Permanently delete ' + key + '?',
        intro: isSprint
          ? 'This destroys the sprint record for good.'
          : 'This destroys the ticket and everything attached to it:',
        details: purgeDetails(item),
        warn: 'This cannot be undone. There is no second bin.',
        phrase: key,
        phraseHint: isSprint ? 'To confirm, type the sprint name' : 'To confirm, type the ticket number',
        confirmLabel: 'Delete forever'
      });
      if (!ok) return;
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        await api('/api/bin/' + btn.dataset.type + '/' + btn.dataset.id, 'DELETE', null, { silent: true });
        toast(key + ' permanently deleted', 'success');
        await refreshData();
        renderDeletedTickets(el, opts);
      } catch (e) {
        toast(e.message || 'Failed to permanently delete item', 'error');
        btn.disabled = false; btn.textContent = 'Delete forever';
      }
    });
  });

  // ── bulk restore ─────────────────────────────────────────
  bulkRestore.addEventListener('click', async function () {
    var sel = selected();
    if (!sel.length) return;
    var ok = await confirmDialog('Restore ' + sel.length + ' item(s) from the bin?');
    if (!ok) return;
    bulkRestore.disabled = true;
    var done = 0, failed = 0;
    for (var i = 0; i < sel.length; i++) {
      try {
        await api('/api/bin/' + sel[i].entity_type + '/' + sel[i].id + '/restore', 'POST', null, { silent: true });
        done++;
      } catch (e) { failed++; }
    }
    await refreshData();
    toast(failed ? done + ' restored, ' + failed + ' failed' : done + ' item(s) restored', failed ? 'error' : 'success');
    renderDeletedTickets(el, opts);
  });

  // ── bulk permanent delete ────────────────────────────────
  bulkPurge.addEventListener('click', async function () {
    var sel = selected();
    var purgeable = sel.filter(function (t) { return t.entity_type !== 'space'; });
    if (!purgeable.length) return;
    var skippedSpaces = sel.length - purgeable.length;
    var single = purgeable.length === 1;
    var ok = await typedConfirmDialog({
      title: single
        ? 'Permanently delete ' + purgeable[0].label + '?'
        : 'Permanently delete ' + purgeable.length + ' items?',
      intro: single
        ? 'This destroys the item and everything attached to it:'
        : 'These ' + purgeable.length + ' items will be destroyed for good:',
      details: single
        ? purgeDetails(purgeable[0])
        : purgeable.slice(0, 10).map(function (t) {
            var extra = [];
            if (t.comment_count) extra.push(t.comment_count + ' comment' + (t.comment_count === 1 ? '' : 's'));
            if (t.worklog_count) extra.push(t.worklog_count + ' work log' + (t.worklog_count === 1 ? '' : 's'));
            if (t.attachment_count) extra.push(t.attachment_count + ' attachment' + (t.attachment_count === 1 ? '' : 's'));
            return (t.entity_type === 'sprint' ? 'Sprint ' : '') + t.label +
              (t.title ? ' — ' + t.title : '') + (extra.length ? ' (' + extra.join(', ') + ')' : '');
          })
          .concat(purgeable.length > 10 ? ['…and ' + (purgeable.length - 10) + ' more'] : [])
          .concat(skippedSpaces
            ? [skippedSpaces + ' archived space(s) in your selection will be SKIPPED — spaces cannot be permanently deleted']
            : []),
      warn: 'This cannot be undone. Comments, work logs, attachments and history are destroyed with each ticket.',
      phrase: single ? purgeable[0].label : 'delete all',
      phraseHint: single
        ? (purgeable[0].entity_type === 'sprint' ? 'To confirm, type the sprint name' : 'To confirm, type the ticket number')
        : 'To confirm, type',
      confirmLabel: single ? 'Delete forever' : 'Delete ' + purgeable.length + ' forever'
    });
    if (!ok) return;
    bulkPurge.disabled = true; bulkPurge.textContent = 'Deleting…';
    try {
      var out = await api('/api/bin/purge', 'POST', {
        items: purgeable.map(function (t) { return { type: t.entity_type, id: t.id }; })
      }, { silent: true });
      toast((out.purged || 0) + ' item(s) permanently deleted' +
        (out.skipped ? ', ' + out.skipped + ' already gone' : ''), 'success');
      await refreshData();
      renderDeletedTickets(el, opts);
    } catch (e) {
      toast(e.message || 'Failed to permanently delete items', 'error');
      syncSel();
    }
  });
}

window._filterUsers = function(query) {
  var q = (query||'').trim().toLowerCase();
  var tables = document.querySelectorAll('table');
  var found = false;
  tables.forEach(function(table) {
    var rows = table.querySelectorAll('tbody tr');
    if (rows.length === 0) return;
    rows.forEach(function(row) {
      var text = row.textContent.toLowerCase();
      var show = q === '' || text.includes(q);
      row.style.display = show ? '' : 'none';
      if (show) found = true;
    });
    // Show no results message
    var noRes = table.parentNode.querySelector('.user-no-results');
    if (q && !found) {
      if (!noRes) {
        noRes = document.createElement('div');
        noRes.className = 'user-no-results';
        noRes.style.cssText = 'padding:32px;text-align:center;color:var(--text3);font-size:14px';
        noRes.textContent = 'No users found for "' + query + '"';
        table.parentNode.appendChild(noRes);
      } else {
        noRes.style.display = '';
        noRes.textContent = 'No users found for "' + query + '"';
      }
    } else if (noRes) {
      noRes.style.display = 'none';
    }
  });
};

// ── Rich Text Editor helpers (Create Issue description) ──────
window.rteCmd = function(cmd) {
  var el = document.getElementById('issueDescContent');
  if (el) el.focus();
  document.execCommand(cmd, false, null);
};
window.rteLink = function() {
  var url = prompt('Enter URL:');
  if (url) {
    var el = document.getElementById('issueDescContent');
    if (el) el.focus();
    document.execCommand('createLink', false, url);
  }
};
