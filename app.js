
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
