
// ═══════════════════════════════════════════════════════════
// BACKLOG TAB
// ═══════════════════════════════════════════════════════════
function renderBacklog() {
  var sprints = getSpaceSprints(S.currentSpace);
  var allSpaceIssues = getSpaceIssues(S.currentSpace);
  var canManageSprints = canCreateSprint(S.currentSpace);
  var statFilter = window._activeStatFilter || null;
  var issues = allSpaceIssues;
  if (statFilter) {
    var now2 = new Date();
    if (statFilter === 'overdue') {
      issues = allSpaceIssues.filter(function(i) { return i.due_date && new Date(i.due_date) < now2 && i.status !== 'Done'; });
    } else if (statFilter !== 'all') {
      issues = allSpaceIssues.filter(function(i) { return i.status === statFilter; });
    }
    window._activeStatFilter = null;
  }
  var searchTerm = ($('backlogSearch').value || '').toLowerCase();
  var _bf = window._getBacklogFilters ? window._getBacklogFilters() : { status:[], priority:[], type:[], assignee:'' };
  function applyBacklogFilters(list) {
    return list.filter(function(iss) {
      if (_bf.status.length   && _bf.status.indexOf(iss.status)     < 0) return false;
      if (_bf.priority.length && _bf.priority.indexOf(iss.priority) < 0) return false;
      if (_bf.type.length     && _bf.type.indexOf(iss.type)         < 0) return false;
      if (_bf.assignee        && iss.assignee_id !== _bf.assignee)       return false;
      return true;
    });
  }
  issues = applyBacklogFilters(issues);

  // One sprint lane. Extracted from the render loop so the page's section order
  // can be composed explicitly below instead of falling out of a status sort.
  function sprintLaneHtml(sp) {
    var html = '';
    var sprintIssues = issues.filter(function (iss) { return iss.sprint_id == sp.id; });
    if (searchTerm) {
      sprintIssues = sprintIssues.filter(function (iss) {
        return iss.title.toLowerCase().indexOf(searchTerm) >= 0 || issueKeyStr(iss).toLowerCase().indexOf(searchTerm) >= 0;
      });
    }
    // Sort by created_at descending (newest first like Jira)
    sprintIssues = sprintIssues.slice().sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    var points = sprintIssues.reduce(function (sum, iss) { return sum + (iss.story_points || 0); }, 0);
    var collapsed = sp.status === 'completed';

    // Header reads as title, then dimmed meta, then actions — instead of one
    // flat run of inline text. Meta items get real dividers so "4 issues" and
    // "29 pts" no longer run together.
    var dateRange = (sp.start_date || sp.end_date)
      ? '<span class="lane-meta-item">' +
          '<svg class="lane-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
          (sp.start_date ? fmtDateShort(sp.start_date) : '?') + ' – ' + (sp.end_date ? fmtDateShort(sp.end_date) : '?') +
        '</span>'
      : '';

    html += '<div class="backlog-lane" data-sprint-id="' + sp.id + '">' +
      '<div class="backlog-lane-header" onclick="window._toggleBacklogLane(this)">' +
      '<div class="lane-header-left">' +
      '<span class="lane-toggle' + (collapsed ? ' is-collapsed' : '') + '" aria-hidden="true">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</span>' +
      '<span class="lane-title">' + esc(sp.name) + '</span>' +
      sprintStatusBadge(sp.status) +
      '<span class="lane-meta">' +
        dateRange +
        '<span class="lane-meta-item">' + sprintIssues.length + (sprintIssues.length === 1 ? ' issue' : ' issues') + '</span>' +
        '<span class="lane-meta-item">' + points + ' pts</span>' +
      '</span>' +
      '</div>' +
      '<div class="lane-header-actions">';

    if (sp.status === 'planning' && canManageSprints) {
      html += '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();window._startSprint(\'' + sp.id + '\')">Start Sprint</button>';
    }
    if (sp.status === 'active' && canManageSprints) {
      html += '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._completeSprint(\'' + sp.id + '\')">Complete</button>';
    }
    if (canManageSprints) {
      html += '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._openSprintModal(\'' + sp.id + '\')">Edit</button>' +
        '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._deleteSprint(\'' + sp.id + '\')">Delete</button>';
    }
    // A completed sprint is closed history: its velocity is frozen at completion
    // and the Spillover / Scope Change / Sprint Summary reports read its live
    // membership, so adding tickets afterwards silently disagrees with the
    // recorded numbers. Completed lanes therefore accept no drops and offer no
    // "Add issue". Active and planning lanes are unchanged.
    var isClosedLane = sp.status === 'completed';
    html += '</div></div>' +
      '<div class="backlog-lane-body' + (collapsed ? ' collapsed' : '') + '" data-sprint-drop="' + sp.id + '"' +
      (isClosedLane ? ' data-lane-closed="true"' :
        ' ondragover="event.preventDefault();event.currentTarget.classList.add(\'drag-over\')"' +
        ' ondragleave="window._laneDragLeave(event)"' +
        ' ondrop="window._dropToSprint(event,\'' + sp.id + '\')"') + '>';

    for (var bi = 0; bi < sprintIssues.length; bi++) {
      html += backlogRow(sprintIssues[bi]);
    }
    if (!isClosedLane) {
      html += '<div class="backlog-add-row"><button type="button" class="backlog-add-btn" onclick="window._addIssueToSprint(\'' + sp.id + '\')">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        'Add issue</button></div>';
    }
    html += '</div></div>';
    return html;
  }

  // Page order: active sprint(s), then planning, then Backlog, then completed
  // last. Backlog sits above completed because it's worked with daily — you
  // drag from it into the next sprint — whereas completed sprints are history
  // and were pushing the backlog further down the page with every sprint.
  function lanesFor(status) {
    var list = sprints.filter(function (sp) { return sp.status === status; });
    if (status === 'completed') {
      // Most-recently-completed first (sprint 3, sprint 2, sprint 1, ...) rather
      // than the planning-order position, which would show the OLDEST completed
      // sprint on top — the opposite of what you want once a sprint is history.
      // completed_at is the real completion moment (set by completeSprint, not
      // touched by the sweeper's read of end_date); end_date/created_at are
      // just fallbacks for a sprint completed before that column existed.
      var completionTime = function (sp) {
        return new Date(sp.completed_at || sp.end_date || sp.created_at || 0).getTime();
      };
      list.sort(function (a, b) { return completionTime(b) - completionTime(a); });
    } else {
      list.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    }
    return list.map(sprintLaneHtml).join('');
  }
  // Any sprint with an unexpected status still renders, just above the backlog,
  // rather than silently disappearing from the page.
  var KNOWN_SPRINT_STATUSES = ['active', 'planning', 'completed'];
  var strayLanes = sprints
    .filter(function (sp) { return KNOWN_SPRINT_STATUSES.indexOf(sp.status) < 0; })
    .map(sprintLaneHtml).join('');

  var html = lanesFor('active') + lanesFor('planning') + strayLanes;

  // Backlog (no sprint)
  var backlogIssues = issues.filter(function (iss) { return !iss.sprint_id; });
  if (searchTerm) {
    backlogIssues = backlogIssues.filter(function (iss) {
      return iss.title.toLowerCase().indexOf(searchTerm) >= 0 || issueKeyStr(iss).toLowerCase().indexOf(searchTerm) >= 0;
    });
  }
  // Backlog shows a points total too, so its header matches the sprint lanes.
  var backlogPoints = backlogIssues.reduce(function (sum, iss) { return sum + (iss.story_points || 0); }, 0);

  html += '<div class="backlog-lane">' +
    '<div class="backlog-lane-header" onclick="window._toggleBacklogLane(this)">' +
    '<div class="lane-header-left">' +
    '<span class="lane-toggle" aria-hidden="true">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</span>' +
    '<span class="lane-title">Backlog</span>' +
    '<span class="lane-meta">' +
      '<span class="lane-meta-item">' + backlogIssues.length + (backlogIssues.length === 1 ? ' issue' : ' issues') + '</span>' +
      '<span class="lane-meta-item">' + backlogPoints + ' pts</span>' +
    '</span>' +
    '</div></div>' +
    '<div class="backlog-lane-body" data-sprint-drop="null" ' +
    'ondragover="event.preventDefault();event.currentTarget.classList.add(\'drag-over\')" ' +
    'ondragleave="window._laneDragLeave(event)" ' +
    'ondrop="window._dropToSprint(event,null)">';

  for (var bk = 0; bk < backlogIssues.length; bk++) {
    html += backlogRow(backlogIssues[bk]);
  }
  html += '<div class="backlog-add-row"><button type="button" class="backlog-add-btn" onclick="window._addIssueToSprint(null)">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    'Add issue</button></div>';
  html += '</div></div>';

  // Completed sprints go last, below the backlog (collapsed by default).
  html += lanesFor('completed');

  $('backlogContent').innerHTML = html;
}

function backlogRow(iss) {
  var assignee = findUser(iss.assignee_id);
  var isSubtask = iss.type === 'subtask';
  var parentInfo = '';
  if (isSubtask && iss.parent_id) {
    var parent = S.data.issues.find(function(i){ return i.id === iss.parent_id; });
    if (parent) parentInfo = '<span class="subtask-parent-ref" title="Subtask of ' + esc(parent.key) + '">' + esc(parent.key) + ' &rsaquo;</span> ';
  }
  // .backlog-row is a CSS grid, so every row must emit the SAME number of cells
  // in the SAME order or the columns stop lining up. That means: the parent
  // reference lives inside the title cell rather than being its own cell, and
  // story points render an empty cell when unset instead of being skipped.
  return '<div class="backlog-row' + (isSubtask ? ' backlog-row-subtask' : '') + '" draggable="true" data-issue-id="' + iss.id + '" ' +
    'ondragstart="event.dataTransfer.setData(\'text/plain\',\'' + iss.id + '\')" ' +
    'onclick="openIssuePage(\'' + iss.id + '\')">' +
    '<span class="bl-cell bl-type">' + typeIcon(iss.type) + '</span>' +
    '<span class="bl-cell issue-key bl-key">' + esc(issueKeyStr(iss)) + '</span>' +
    '<span class="bl-cell bl-title" title="' + escAttr(iss.title) + '">' + parentInfo + esc(iss.title) + '</span>' +
    '<span class="bl-cell bl-priority">' + priorityBadge(iss.priority, true) + '</span>' +
    '<span class="bl-cell bl-status">' + statusBadge(iss.status, true) + '</span>' +
    '<span class="bl-cell bl-points">' + (iss.story_points != null ? '<span class="badge badge-points">' + iss.story_points + '</span>' : '') + '</span>' +
    '<span class="bl-cell bl-assignee">' + avatarHtml(assignee, 24) + '</span>' +
    '</div>';
}

// Backlog global handlers
window._toggleBacklogLane = function (header) {
  var scrollEl = document.querySelector('.main-content') || document.documentElement;
  var scrollTop = scrollEl.scrollTop || window.scrollY;
  var body = header.nextElementSibling;
  body.classList.toggle('collapsed');
  // Rotate the chevron rather than swapping a glyph, so it animates.
  var toggle = header.querySelector('.lane-toggle');
  if (toggle) toggle.classList.toggle('is-collapsed', body.classList.contains('collapsed'));
  // Restore scroll position so page doesn't jump
  requestAnimationFrame(function() {
    if (scrollEl === document.documentElement) window.scrollTo(0, scrollTop);
    else scrollEl.scrollTop = scrollTop;
  });
};

// Drag-leave: only remove highlight when cursor truly leaves the lane (not into a child)
window._laneDragLeave = function(event) {
  var lane = event.currentTarget;
  if (!lane.contains(event.relatedTarget)) {
    lane.classList.remove('drag-over');
  }
};

window._dropToSprint = async function (event, sprintId) {
  event.preventDefault();
  // Walk up to find the lane body in case drop fired on a child element
  var lane = event.target.closest('[data-sprint-drop]') || event.currentTarget;
  lane.classList.remove('drag-over');
  var issueId = event.dataTransfer.getData('text/plain');
  if (!issueId) return;
  var targetSprintId = lane.getAttribute('data-sprint-drop');
  if (targetSprintId === 'null') targetSprintId = null;
  // Dropped back into the lane it already belongs to — nothing actually
  // changed, so skip the API call and the "Issue moved" toast entirely.
  var draggedIssue = (S.data.issues || []).find(function (i) { return i.id === issueId; });
  if (draggedIssue && String(draggedIssue.sprint_id || '') === String(targetSprintId || '')) {
    return;
  }
  // Belt-and-braces: completed lanes render without drop handlers, but guard here
  // too so no other path can drop a ticket into closed sprint history.
  if (isSprintClosed(targetSprintId)) {
    toast('That sprint is completed — move the issue to an active or planning sprint instead.', 'error');
    return;
  }
  try {
    await api('/api/issues/' + issueId + '/move', 'PUT', { sprint_id: targetSprintId, position: 0 }, { silent: true });
    await refreshData();
    renderBacklog();
    toast(issueSprintMoveText(cachedIssueKey(issueId) || 'Issue', targetSprintId));
  } catch(e) {
    toast((cachedIssueKey(issueId) || 'Issue') + ' move failed — ' + errorReason(e), 'error');
  }
};

// True when the id names a sprint that has been completed. Unknown ids and
// null (the backlog) are NOT closed, so backlog drops keep working.
function isSprintClosed(sprintId) {
  if (!sprintId) return false;
  var sp = (S.data.sprints || []).find(function (s) { return s.id === sprintId; });
  return !!sp && sp.status === 'completed';
}

window._addIssueToSprint = function (sprintId) {
  if (isSprintClosed(sprintId)) {
    toast('That sprint is completed — pick an active or planning sprint instead.', 'error');
    return;
  }
  resetIssueForm();
  $('issueSpaceId').value = S.currentSpace;
  $('issueModalTitle').textContent = 'Create Issue';
  populateIssueFormSelects({ includeSprintId: sprintId });
  if (window._onIssueSpaceChange) window._onIssueSpaceChange(S.currentSpace || '', sprintId);
  if (sprintId) {
    $('issueSprint').value = sprintId;
    applySprintDatesToIssueForm(sprintId);
  }
  openModal('modal-issue');
};

window._startSprint = async function (id) {
  await api('/api/sprints/' + id + '/start', 'POST');
  await refreshData();
  renderBacklog();
  toast('Sprint started');
};

window._completeSprint = async function (id) {
  var ok = await confirmDialog('Complete this sprint? Incomplete issues will move to the backlog.');
  if (!ok) return;
  await api('/api/sprints/' + id + '/complete', 'POST');
  await refreshData();
  renderBacklog();
  toast('Sprint completed');
  if (typeof window._openAchievementsModal === 'function') window._openAchievementsModal(id);
};

window._deleteSprint = async function (id) {
  var sp = (S.data.sprints || []).find(function (s) { return s.id === id; }) || {};
  if (!canManageSpace(sp.space_id || S.currentSpace)) {
    toast('Only a space admin can delete sprints. Ask a space admin or an org admin.', 'error');
    return;
  }
  var live = (S.data.issues || []).filter(function (i) { return i.sprint_id === id; }).length;
  var name = sp.name || 'this sprint';
  var ok = await typedConfirmDialog({
    title: 'Delete sprint "' + name + '"?',
    intro: live
      ? 'Its ' + live + ' ticket' + (live === 1 ? '' : 's') + ' move to the backlog. Nothing is deleted with the sprint — ' +
        'and if the sprint is restored they come back with it.'
      : 'This sprint has no tickets in it.',
    note: softDeleteNote(),
    phrase: name,
    phraseHint: 'To confirm, type the sprint name',
    confirmLabel: 'Delete sprint'
  });
  if (!ok) return;
  try {
    await api('/api/sprints/' + id, 'DELETE', null, { silent: true });
    await refreshData();
    renderBacklog();
    toast('Sprint "' + name + '" moved to Deleted Items', 'success');
  } catch (e) {
    toast(e.message || 'Failed to delete sprint', 'error');
  }
};

// Renders a scrollable checkbox list of a space's members into `containerId`,
// pre-checking any ids already in `selectedIds`. `onChangeJs`, if given, is
// raw JS wired to each checkbox's onchange (e.g. to refresh a dependent list
// like per-developer leave inputs whenever the developer selection changes).
function renderMemberCheckboxList(containerId, spaceId, selectedIds, onChangeJs) {
  var el = $(containerId);
  if (!el) return;
  var members = getSpaceMembers(spaceId);
  var selSet = {};
  (selectedIds || []).forEach(function (id) { selSet[id] = true; });
  el.innerHTML = members.length
    ? members.map(function (u) {
        // The global input{width:100%} reset stretches a bare checkbox to
        // fill the flex row, shoving the name off to the far right — same
        // fix as the custom-field multi-select checkboxes: force it back to
        // a normal checkbox size and stop it growing as a flex item.
        return '<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;font-size:13px;color:var(--text)">' +
          '<input type="checkbox" class="cf-sel-opt-checkbox" value="' + esc(u.id) + '"' + (selSet[u.id] ? ' checked' : '') +
          (onChangeJs ? ' onchange="' + esc(onChangeJs) + '"' : '') + '>' +
          '<span>' + esc(u.name) + '</span></label>';
      }).join('')
    : '<div style="font-size:12px;color:var(--text3);padding:4px 2px">No members in this board yet</div>';
}

// Reads back the checked user ids from a checkbox list rendered above.
function collectCheckedIds(containerId) {
  var el = $(containerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(function (cb) { return cb.value; });
}

// Per-developer leave-day inputs — one row per currently-checked Developer,
// each with its own number input. Selections live in
// window._sprintDeveloperLeaves ({userId: days}) for the modal's lifetime;
// _openSprintModal seeds it from the sprint being edited (or empty for a
// new one). Only Developers get a leave input (QA isn't part of the
// capacity formula), and unchecking a developer drops their leave entry.
function renderDeveloperLeavesList() {
  var el = $('sprintDeveloperLeaves');
  if (!el) return;
  var checkedIds = collectCheckedIds('sprintDeveloperList');
  var leaves = window._sprintDeveloperLeaves || (window._sprintDeveloperLeaves = {});
  Object.keys(leaves).forEach(function (id) { if (checkedIds.indexOf(id) === -1) delete leaves[id]; });
  if (!checkedIds.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:4px 2px">Select developers above to set their leave days</div>';
    return;
  }
  var members = getSpaceMembers($('sprintSpaceId').value || S.currentSpace);
  el.innerHTML = checkedIds.map(function (id) {
    var u = members.find(function (m) { return m.id === id; });
    var name = u ? u.name : id;
    var val = leaves[id] || 0;
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 2px">' +
      '<span style="flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</span>' +
      '<input type="number" min="0" step="1" class="input" style="width:70px" value="' + val + '" data-dev-id="' + esc(id) + '" onchange="window._setDevLeave(this)">' +
      '</div>';
  }).join('');
}

window._setDevLeave = function (input) {
  var leaves = window._sprintDeveloperLeaves || (window._sprintDeveloperLeaves = {});
  var val = parseInt(input.value, 10) || 0;
  if (val > 0) leaves[input.dataset.devId] = val;
  else delete leaves[input.dataset.devId];
};

// Public Holidays calendar for the sprint's date range — only days inside
// [start, end] are clickable (to mark/unmark as a holiday); everything
// outside that range renders disabled/greyed and can't be selected.
// Selections live in window._sprintHolidaySet (a Set of 'YYYY-MM-DD'
// strings) for the lifetime of the modal; _openSprintModal seeds it from
// the sprint being edited (or empty for a new one).
function renderSprintPublicHolidaysCalendar() {
  var el = $('sprintPublicHolidays');
  if (!el) return;
  var startVal = $('sprintStartDate').value;
  var endVal = $('sprintEndDate').value;
  if (!startVal || !endVal) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);border:1px dashed var(--border);border-radius:6px;padding:14px;text-align:center">Select a start and end date to pick public holidays</div>';
    return;
  }
  var start = new Date(startVal + 'T00:00:00');
  var end = new Date(endVal + 'T00:00:00');
  if (end < start) {
    el.innerHTML = '<div style="font-size:12px;color:#dc2626;border:1px dashed #dc262666;border-radius:6px;padding:14px;text-align:center">End date is before start date</div>';
    return;
  }
  // A date the range no longer covers can't stay marked as a holiday.
  var holidaySet = window._sprintHolidaySet || (window._sprintHolidaySet = new Set());
  Array.from(holidaySet).forEach(function (ds) {
    var d = new Date(ds + 'T00:00:00');
    if (d < start || d > end) holidaySet.delete(ds);
  });

  function toISO(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  var weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  var months = [];
  var mCursor = new Date(start.getFullYear(), start.getMonth(), 1);
  var mEnd = new Date(end.getFullYear(), end.getMonth(), 1);
  while (mCursor <= mEnd) {
    months.push(new Date(mCursor));
    mCursor.setMonth(mCursor.getMonth() + 1);
  }
  var html = months.map(function (m) {
    var year = m.getFullYear(), month = m.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthName = m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var grid = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:10px;color:var(--text3);margin-bottom:4px">' +
      weekdays.map(function (w) { return '<div style="text-align:center;font-weight:700">' + w + '</div>'; }).join('') +
      '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
    for (var b = 0; b < firstDay; b++) grid += '<div></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var thisDay = new Date(year, month, d);
      var inRange = thisDay >= start && thisDay <= end;
      var dateStr = toISO(year, month, d);
      var isHoliday = holidaySet.has(dateStr);
      if (inRange) {
        grid += '<div onclick="window._toggleSprintHoliday(\'' + dateStr + '\')" title="' +
          (isHoliday ? 'Public holiday — click to remove' : 'Click to mark as a public holiday') +
          '" style="cursor:pointer;text-align:center;padding:4px 0;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:' +
          (isHoliday ? '#dc2626' : 'var(--accent)') + '">' + d + '</div>';
      } else {
        grid += '<div style="text-align:center;padding:4px 0;border-radius:4px;font-size:11px;color:var(--text3);opacity:.4;pointer-events:none">' + d + '</div>';
      }
    }
    grid += '</div>';
    return '<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px">' + monthName + '</div>' + grid + '</div>';
  }).join('');
  var legend = '<div style="display:flex;gap:14px;font-size:11px;color:var(--text2);margin-top:8px">' +
    '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:var(--accent);display:inline-block"></span>Sprint day</span>' +
    '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#dc2626;display:inline-block"></span>Public holiday</span>' +
    '</div>';
  el.innerHTML = '<div style="border:1px solid var(--border);border-radius:8px;padding:12px">' + html + legend + '</div>';
}

window._toggleSprintHoliday = function (dateStr) {
  var holidaySet = window._sprintHolidaySet || (window._sprintHolidaySet = new Set());
  if (holidaySet.has(dateStr)) holidaySet.delete(dateStr);
  else holidaySet.add(dateStr);
  renderSprintPublicHolidaysCalendar();
};

window._openSprintModal = function (id) {
  var spaceId = id
    ? ((S.data.sprints || []).find(function (s) { return s.id == id; }) || {}).space_id
    : S.currentSpace;
  if (!canCreateSprint(spaceId)) {
    toast('Only admins and space admins can manage sprints', 'error');
    return;
  }
  if (id) {
    var sp = (S.data.sprints || []).find(function (s) { return s.id == id; });
    if (!sp) return;
    $('sprintIdInput').value = sp.id;
    $('sprintSpaceId').value = sp.space_id;
    $('sprintNameInput').value = sp.name;
    $('sprintGoal').value = sp.goal || '';
    $('sprintStartDate').value = fmtDateISO(sp.start_date);
    $('sprintEndDate').value = fmtDateISO(sp.end_date);
    $('sprintModalTitle').textContent = 'Edit Sprint';
    window._sprintDeveloperLeaves = Object.assign({}, sp.developer_leaves || {});
    renderMemberCheckboxList('sprintDeveloperList', sp.space_id, sp.developer_ids, 'renderDeveloperLeavesList()');
    renderMemberCheckboxList('sprintQaList', sp.space_id, sp.qa_ids);
    window._sprintHolidaySet = new Set(sp.public_holidays || []);
  } else {
    $('sprintIdInput').value = '';
    $('sprintSpaceId').value = S.currentSpace;
    $('sprintNameInput').value = '';
    $('sprintGoal').value = '';
    $('sprintStartDate').value = '';
    $('sprintEndDate').value = '';
    $('sprintModalTitle').textContent = 'Create Sprint';
    window._sprintDeveloperLeaves = {};
    renderMemberCheckboxList('sprintDeveloperList', S.currentSpace, [], 'renderDeveloperLeavesList()');
    renderMemberCheckboxList('sprintQaList', S.currentSpace, []);
    window._sprintHolidaySet = new Set();
  }
  renderDeveloperLeavesList();
  renderSprintPublicHolidaysCalendar();
  $('sprintStartDate').onchange = renderSprintPublicHolidaysCalendar;
  $('sprintEndDate').onchange = renderSprintPublicHolidaysCalendar;
  openModal('modal-sprint');
};
