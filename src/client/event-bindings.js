
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

// Comment images open full-size in a new tab. This used to be an inline
// onclick="window.open(this.src)" on the generated <img>, which meant the
// behaviour also depended on that attribute surviving in every STORED comment
// body that had been through the edit-and-save round trip — and the sanitiser
// strips event-handler attributes from stored bodies, correctly. Delegation
// restores the behaviour for both the generated and the legacy stored images
// without an inline handler and without an allowlist exception for onclick.
//
// Scoped to rendered comments, and skipped inside the edit box, where a click
// on an image is placing the caret rather than asking to view it.
document.addEventListener('click', function (e) {
  var img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.src) return;
  if (!img.closest('.drawer-comment-item')) return;
  if (img.closest('[contenteditable="true"]')) return;
  window.open(img.src, '_blank', 'noopener');
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
            '<input type="text" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '"></div>';
        }
        if (f.field_type === 'number') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<input type="number" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '"></div>';
        }
        if (f.field_type === 'textarea') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<textarea class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '" rows="3"></textarea></div>';
        }
        if (f.field_type === 'date') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + req + '</label>' +
            '<input type="date" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '"></div>';
        }
        if (f.field_type === 'checkbox') {
          return '<div class="form-group">' +
            '<label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
            '<input type="checkbox" class="cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '" value="true">' +
            esc(f.name) + req + '</label></div>';
        }
        if (f.field_type === 'user') {
          var userOpts = (S.data && S.data.users || []).filter(function (u) { return u.is_active !== false; });
          var userSelect = '<select class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + escAttr(f.name) + '">' +
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
        popupAlert('Invite created', 'Share the invite link with the user. It expires in 7 days.', 'success');
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
        popupAlert('Password reset', 'That user can now sign in with the new password.', 'success');
      } catch (e) {}
    });
  }
});
