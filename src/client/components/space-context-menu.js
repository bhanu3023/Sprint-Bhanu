
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
    // toast, not popupAlert: adding a member finishes in place on the page
    // the user is already looking at, exactly like removing one -- which was
    // already a toast. The two halves of the same event now match. popupAlert
    // is reserved for messages that must outlive a navigation or that tell the
    // user how to undo or continue (deleting a space, creating an invite).
    var addedUser = findUser(userId);
    toast((addedUser ? addedUser.name : 'That user') + ' added to this space');
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
  chip.innerHTML = '<img src="' + esc(fileApiUrl(url)) + '" alt="' + escAttr(alt || 'Screenshot') + '">' +
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
    toast('Screenshot upload failed — ' + errorReason(e), 'error');
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
    '<img src="' + url + '" alt="' + escAttr(file.name || 'Preview') + '">';
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
      html += '<div class="issue-attachment-thumb" title="' + escAttr(item.file.name) + '">' +
        '<img src="' + thumbUrl + '" alt="' + escAttr(item.file.name) + '" onclick="window._openAttachmentPreview(' + item.idx + ')">' +
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
        toast('File too large (max ' + fmtByteLimit(ISSUE_MAX_FILE_BYTES) + '): ' + (files[i].name || 'file'), 'error');
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
    // Captured NOW, not read in the .then below: files is the input's live
    // FileList and the handler resets e.target.value at the end, which empties
    // it -- so by the time the response lands, files.length is 0.
    var upNames = Array.prototype.map.call(files, function (f) { return f.name || 'file'; });
    toast(upNames.length === 1 ? 'Uploading ' + upNames[0] + '…' : 'Uploading ' + upNames.length + ' files…');
    fetch('/api/issues/' + S.drawerIssueId + '/attachments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getAuthToken() },
      body: fd
    }).then(async function(r) {
      var data; try { data = await r.json(); } catch (_) { data = {}; }
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      toast(upNames.length === 1 ? upNames[0] + ' uploaded' : upNames.length + ' attachments uploaded');
      var issue = await api('/api/issues/' + S.drawerIssueId);
      if (issue) renderDrawerAttachments(issue.attachments || []);
    }).catch(function(e) { toast('Upload failed — ' + errorReason(e, 'the upload failed'), 'error'); });
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
      toast('"' + name + '" updated');
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
      toast('"' + name + '" created');
    }
  } catch (e) { /* error shown by api() */ }
});
