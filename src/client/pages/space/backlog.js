
// ═══════════════════════════════════════════════════════════
// BACKLOG TAB
// ═══════════════════════════════════════════════════════════

// The numeric suffix of an issue key ("PTM-42" -> 42), used to order every
// lane (Backlog, each Sprint, Done-without-a-sprint) by ticket number instead
// of created_at -- the two aren't always the same thing once bulk-import or a
// restored ticket is in the mix, and ticket number is what's actually asked
// for here. Falls back to -1 (sorts last) for a row with no parseable
// number at all, rather than throwing or silently using NaN comparisons.
function issueKeyNumber(iss) {
  var key = issueKeyStr(iss);
  var m = /-(\d+)$/.exec(String(key || ''));
  return m ? parseInt(m[1], 10) : -1;
}
function issueKeyNumberDesc(a, b) {
  return issueKeyNumber(b) - issueKeyNumber(a);
}

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
    sprintIssues = sprintIssues.slice().sort(issueKeyNumberDesc);
    var points = sprintIssues.reduce(function (sum, iss) { return sum + (iss.story_points || 0); }, 0);
    var collapsed = sp.status === 'completed';

    // Multi-select is offered on active and planning lanes only -- a
    // completed sprint is closed history (see isClosedLane below) with
    // nowhere sensible to bulk-move ITS tickets from. Pruned the same way
    // the Backlog lane's own selection is, so an id that moved/left this
    // sprint since it was checked can't silently "stay selected".
    var laneKey = (sp.status === 'active' || sp.status === 'planning') ? sp.id : null;
    if (laneKey) _blPruneLaneState(laneKey, sprintIssues.map(function (iss) { return iss.id; }));
    var laneToolbarInner = laneKey ? _blLaneToolbarHtml(laneKey, sp.status, sp.id) : null;

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
      '<div class="lane-header-actions' + (laneToolbarInner ? ' bl-select-toolbar' : '') + '"' +
      (laneToolbarInner ? ' onclick="event.stopPropagation()"' : '') + '>';

    if (laneToolbarInner) {
      // While actively selecting, the sprint-management buttons (Start/
      // Complete/Edit/Delete) step aside for the move toolbar rather than
      // cluttering the header alongside it -- Delete in particular has no
      // business being one accidental click away from a bulk-select flow.
      html += laneToolbarInner;
    } else {
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
      html += backlogRow(sprintIssues[bi], laneKey);
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

  // Backlog (no sprint). Done issues that never touched a sprint are split
  // OUT of this list -- an issue created straight into the backlog and marked
  // Done without ever being planned into a sprint used to sit here mixed in
  // with real candidates for the next sprint, so dragging a batch of backlog
  // items into a new sprint could silently pick up already-finished work.
  // They get their own lane below instead of just vanishing: the ticket still
  // needs to be findable, just not offered as sprint-planning material.
  var backlogIssues = issues.filter(function (iss) { return !iss.sprint_id && iss.status !== 'Done'; });
  var doneNoSprintIssues = issues.filter(function (iss) { return !iss.sprint_id && iss.status === 'Done'; });
  if (searchTerm) {
    var matchesSearch = function (iss) {
      return iss.title.toLowerCase().indexOf(searchTerm) >= 0 || issueKeyStr(iss).toLowerCase().indexOf(searchTerm) >= 0;
    };
    backlogIssues = backlogIssues.filter(matchesSearch);
    doneNoSprintIssues = doneNoSprintIssues.filter(matchesSearch);
  }
  backlogIssues = backlogIssues.slice().sort(issueKeyNumberDesc);
  doneNoSprintIssues = doneNoSprintIssues.slice().sort(issueKeyNumberDesc);
  // Backlog shows a points total too, so its header matches the sprint lanes.
  var backlogPoints = backlogIssues.reduce(function (sum, iss) { return sum + (iss.story_points || 0); }, 0);

  // Multi-select for the Backlog lane, same laneKey-based system the active/
  // planning lanes above use ('backlog' is the literal laneKey here since
  // there's no real sprint id for it) -- Done/completed lanes still don't
  // offer bulk-move, there's nowhere meaningful to send an already-finished
  // or already-historical ticket. Pruned the same way those lanes are.
  _blPruneLaneState('backlog', backlogIssues.map(function (iss) { return iss.id; }));
  var blToolbarInner = _blLaneToolbarHtml('backlog', 'backlog', null);
  var blToolbarHtml = blToolbarInner
    ? '<div class="lane-header-actions bl-select-toolbar" onclick="event.stopPropagation()">' + blToolbarInner + '</div>'
    : '';

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
    '</div>' + blToolbarHtml + '</div>' +
    '<div class="backlog-lane-body" data-sprint-drop="null" ' +
    'ondragover="event.preventDefault();event.currentTarget.classList.add(\'drag-over\')" ' +
    'ondragleave="window._laneDragLeave(event)" ' +
    'ondrop="window._dropToSprint(event,null)">';

  for (var bk = 0; bk < backlogIssues.length; bk++) {
    html += backlogRow(backlogIssues[bk], 'backlog');
  }
  html += '<div class="backlog-add-row"><button type="button" class="backlog-add-btn" onclick="window._addIssueToSprint(null)">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    'Add issue</button></div>';
  html += '</div></div>';

  // Done, but never assigned to any sprint. Same treatment as a completed
  // sprint lane -- collapsed by default, no drop target, no "Add issue" -- it
  // is a place to FIND these tickets, not a pool to plan the next sprint from.
  // Cards stay draggable (backlogRow doesn't change), so deliberately dragging
  // one into a real sprint for record-keeping still works; the lane itself
  // just doesn't accept drops the way the live Backlog lane does.
  if (doneNoSprintIssues.length) {
    var doneNoSprintPoints = doneNoSprintIssues.reduce(function (sum, iss) { return sum + (iss.story_points || 0); }, 0);
    html += '<div class="backlog-lane">' +
      '<div class="backlog-lane-header" onclick="window._toggleBacklogLane(this)">' +
      '<div class="lane-header-left">' +
      '<span class="lane-toggle is-collapsed" aria-hidden="true">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</span>' +
      '<span class="lane-title">Done (Not in a Sprint)</span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#00875a;background:rgba(0,135,90,0.1);padding:2px 8px;border-radius:10px">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:#00875a;display:inline-block"></span>Completed outside sprint planning</span>' +
      '<span class="lane-meta">' +
        '<span class="lane-meta-item">' + doneNoSprintIssues.length + (doneNoSprintIssues.length === 1 ? ' issue' : ' issues') + '</span>' +
        '<span class="lane-meta-item">' + doneNoSprintPoints + ' pts</span>' +
      '</span>' +
      '</div></div>' +
      '<div class="backlog-lane-body collapsed" data-lane-closed="true">';
    for (var dn = 0; dn < doneNoSprintIssues.length; dn++) {
      html += backlogRow(doneNoSprintIssues[dn]);
    }
    html += '</div></div>';
  }

  // Completed sprints go last, below the backlog (collapsed by default).
  html += lanesFor('completed');

  $('backlogContent').innerHTML = html;
}

// `laneKey` identifies which lane this row belongs to for multi-select
// purposes -- the real sprint id for an active/planning lane, the literal
// string 'backlog' for the ungrouped Backlog lane, or falsy (undefined/null)
// for a Done-lane or completed-sprint row, which never gets a checkbox at
// all: a completed sprint's tickets are closed history, and a Done-without-
// a-sprint ticket has nowhere meaningful for "move to sprint" to send it.
// Selection state is kept PER LANE (window._blSelect[laneKey]) so checking
// tickets in one sprint's lane doesn't bleed into another's.
function backlogRow(iss, laneKey) {
  var assignee = findUser(iss.assignee_id);
  var isSubtask = iss.type === 'subtask';
  var parentInfo = '';
  if (isSubtask && iss.parent_id) {
    var parent = S.data.issues.find(function(i){ return i.id === iss.parent_id; });
    if (parent) parentInfo = '<span class="subtask-parent-ref" title="Subtask of ' + esc(parent.key) + '">' + esc(parent.key) + ' &rsaquo;</span> ';
  }
  var selectable = !!laneKey;
  var laneState = selectable ? _blLaneState(laneKey) : null;
  var blSelectMode = !!(laneState && laneState.mode);
  var isChecked = !!(laneState && laneState.ids[iss.id]);
  // Double-click enters select mode (and checks the double-clicked row);
  // once in select mode, a plain click anywhere on the row toggles its own
  // checkbox instead of opening the issue -- opening the issue is only the
  // click behaviour OUTSIDE select mode. Both handlers are no-ops for a
  // non-selectable row (Done/completed lanes keep their original single click).
  var rowClickJs = selectable
    ? 'window._blRowClick(event,\'' + laneKey + '\',\'' + iss.id + '\')'
    : 'openIssuePage(\'' + iss.id + '\')';
  var rowDblClickJs = selectable ? ' ondblclick="window._blEnterSelectMode(event,\'' + laneKey + '\',\'' + iss.id + '\')"' : '';
  var checkboxHtml = selectable
    ? '<input type="checkbox" class="bl-row-checkbox" onclick="event.stopPropagation()" ' +
      'onchange="window._blCheckboxChange(\'' + laneKey + '\',\'' + iss.id + '\',this)"' + (isChecked ? ' checked' : '') + '>'
    : '';
  // .backlog-row is a CSS grid, so every row must emit the SAME number of cells
  // in the SAME order or the columns stop lining up. That means: the parent
  // reference lives inside the title cell rather than being its own cell, and
  // story points render an empty cell when unset instead of being skipped.
  // The checkbox is deliberately NOT one of those grid cells -- it's an
  // absolutely-positioned overlay in the row's own left padding (see
  // .bl-row-checkbox in styles.css), so adding/removing it never touches the
  // 7-column grid every lane's rows already have to agree on.
  return '<div class="backlog-row' + (isSubtask ? ' backlog-row-subtask' : '') +
    (selectable ? ' bl-selectable' : '') + (blSelectMode ? ' bl-select-mode' : '') + (isChecked ? ' bl-row-selected' : '') +
    '" draggable="true" data-issue-id="' + iss.id + '" ' +
    'ondragstart="event.dataTransfer.setData(\'text/plain\',\'' + iss.id + '\')"' + rowDblClickJs + ' ' +
    'onclick="' + rowClickJs + '">' +
    checkboxHtml +
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

// ── Backlog/Active/Planning multi-select + bulk move ─────────────────────
// Moving tickets one at a time by drag is slow once there are more than a
// handful to move. Double-clicking a row in the Backlog lane, the Active
// Sprint lane, or any Planning Sprint lane turns on checkboxes for every row
// in THAT lane (each lane keeps its own independent selection -- see
// _blLaneState) so several can be picked at once, then "Move to Backlog" /
// "Move to Active Sprint" / "Move to Sprint Planning" beside that lane's own
// header move all of them in one go -- whichever of the three doesn't match
// the lane they're already in. Available to every space member, same as
// dragging a single card already is -- server-side `issue.move` is
// member-tier (see .claude/rules/permission-matrix.md), and this reuses that
// exact per-issue endpoint rather than inventing a stricter bulk permission.
// Completed sprints and the Done-without-a-sprint lane get none of this --
// see backlogRow's own comment on `laneKey`.

// laneKey -> { mode: bool, ids: {issueId: true} }. 'backlog' is the literal
// key for the ungrouped Backlog lane; every other lane uses its real sprint id.
function _blLaneState(laneKey) {
  if (!window._blSelect) window._blSelect = {};
  return window._blSelect[laneKey] || (window._blSelect[laneKey] = { mode: false, ids: {} });
}

// Drops any selected id that isn't in `validIds` any more (moved out of this
// lane, deleted, filtered out) -- run once per lane on every render so a
// stale checked id can't silently "select" something the user can no longer
// see in that lane.
function _blPruneLaneState(laneKey, validIds) {
  if (!window._blSelect || !window._blSelect[laneKey]) return;
  var state = window._blSelect[laneKey];
  var idSet = {};
  validIds.forEach(function (id) { idSet[id] = true; });
  Object.keys(state.ids).forEach(function (id) { if (!idSet[id]) delete state.ids[id]; });
}

window._blEnterSelectMode = function (event, laneKey, issueId) {
  if (event) event.preventDefault();
  // A real double-click always fires TWO 'click' events before 'dblclick' --
  // without this, _blRowClick's very first click already called
  // openIssuePage and navigated away before this handler ever got a chance
  // to turn select mode on, which is exactly why double-click looked like it
  // "just opens the ticket": the click beat the dblclick to it every time.
  if (window._blPendingOpenTimer) {
    clearTimeout(window._blPendingOpenTimer);
    window._blPendingOpenTimer = null;
  }
  var state = _blLaneState(laneKey);
  state.mode = true;
  state.ids[issueId] = true;
  renderBacklog();
};

window._blRowClick = function (event, laneKey, issueId) {
  var state = _blLaneState(laneKey);
  if (state.mode) {
    if (state.ids[issueId]) delete state.ids[issueId];
    else state.ids[issueId] = true;
    renderBacklog();
    return;
  }
  // Not in select mode yet, so this click might be the first half of a
  // double-click rather than a real single click -- the browser has no way
  // to know which until the dblclick timeout expires. Delay the navigation
  // just long enough for a following dblclick (see _blEnterSelectMode above)
  // to cancel it; a genuine single click still opens the ticket, just ~1
  // frame-cycle later than before, which reads as instant.
  if (window._blPendingOpenTimer) clearTimeout(window._blPendingOpenTimer);
  window._blPendingOpenTimer = setTimeout(function () {
    window._blPendingOpenTimer = null;
    openIssuePage(issueId);
  }, 280);
};

window._blCheckboxChange = function (laneKey, issueId, cb) {
  var state = _blLaneState(laneKey);
  if (cb.checked) state.ids[issueId] = true;
  else delete state.ids[issueId];
  renderBacklog();
};

window._blExitSelectMode = function (laneKey) {
  var state = _blLaneState(laneKey);
  state.mode = false;
  state.ids = {};
  renderBacklog();
};

// Builds the "N selected / Move to ... / Cancel" markup for one lane's
// header, or null when that lane isn't currently in select mode (the caller
// then falls back to its normal header buttons). `kind` is 'backlog',
// 'active' or 'planning' -- whichever this lane itself already is, so its
// own kind is never offered as a move target. `ownSprintId` (null for the
// Backlog lane) excludes a planning lane from offering itself as a "Sprint
// Planning" target when it's the only one.
function _blLaneToolbarHtml(laneKey, kind, ownSprintId) {
  var state = _blLaneState(laneKey);
  if (!state.mode) return null;
  var count = Object.keys(state.ids).length;
  function moveBtn(label, targetKind, cls) {
    return '<button type="button" class="btn btn-sm ' + cls + '" ' + (count ? '' : 'disabled') +
      ' onclick="window._blMoveSelected(\'' + targetKind + '\',\'' + laneKey + '\',event)">' + esc(label) + '</button>';
  }
  var btns = '';
  if (kind !== 'backlog') btns += moveBtn('Move to Backlog', 'backlog', 'btn-outline');
  if (kind !== 'active') {
    var hasActive = getSpaceSprints(S.currentSpace).some(function (sp) { return sp.status === 'active'; });
    if (hasActive) btns += moveBtn('Move to Active Sprint', 'active', 'btn-primary');
  }
  var otherPlanning = getSpaceSprints(S.currentSpace).filter(function (sp) {
    return sp.status === 'planning' && sp.id !== ownSprintId;
  });
  if (otherPlanning.length) btns += moveBtn('Move to Sprint Planning', 'planning', 'btn-outline');
  return '<span class="bl-select-count">' + count + ' selected</span>' + btns +
    '<button type="button" class="btn btn-sm btn-outline bl-select-cancel" onclick="window._blExitSelectMode(\'' + laneKey + '\')">Cancel</button>';
}

// kind: 'backlog' always resolves to the single synthetic "no sprint" target;
// 'active' finds the space's one active sprint directly (sprint-lifecycle.md
// guarantees at most one per space, and it's never this lane's own kind since
// _blLaneToolbarHtml doesn't offer it there); 'planning' moves straight into
// the only OTHER planning sprint if there's exactly one, or opens a small
// picker if there's more than one -- there's no single obvious target to
// guess between.
window._blMoveSelected = function (kind, laneKey, event) {
  var state = _blLaneState(laneKey);
  var ids = Object.keys(state.ids);
  if (!ids.length) return;
  if (kind === 'backlog') {
    _blPerformMove(ids, { id: null, name: 'the Backlog' }, laneKey);
    return;
  }
  var ownSprintId = laneKey === 'backlog' ? null : laneKey;
  var sprints = getSpaceSprints(S.currentSpace).filter(function (sp) {
    return sp.status === kind && sp.id !== ownSprintId;
  });
  if (!sprints.length) {
    toast('No ' + kind + ' sprint in this space to move into.', 'error');
    return;
  }
  if (kind === 'active' || sprints.length === 1) {
    _blPerformMove(ids, sprints[0], laneKey);
    return;
  }
  _blShowPlanningPicker(sprints, ids, event, laneKey);
};

function _blPerformMove(ids, sprint, laneKey) {
  Promise.all(ids.map(function (id) {
    return api('/api/issues/' + id + '/move', 'PUT', { sprint_id: sprint.id, position: 0 }, { silent: true })
      .then(function () { return { id: id, ok: true }; })
      .catch(function (e) { return { id: id, ok: false, err: e }; });
  })).then(function (results) {
    var okCount = results.filter(function (r) { return r.ok; }).length;
    var failed = results.filter(function (r) { return !r.ok; });
    var state = _blLaneState(laneKey);
    state.mode = false;
    state.ids = {};
    return refreshData().then(function () {
      renderBacklog();
      if (okCount) {
        toast(okCount + (okCount === 1 ? ' issue' : ' issues') + ' moved to ' + sprint.name);
      }
      if (failed.length) {
        toast(failed.length + (failed.length === 1 ? ' issue' : ' issues') + ' failed to move — ' + errorReason(failed[0].err), 'error');
      }
    });
  });
}

// Reuses the same trigger/panel visual language as the MBR/Your Work header
// filters (yw-filter-trigger, yw-filter-panel, yw-filter-opt) so a small
// "pick one of several" popup looks like an existing pattern rather than a
// one-off. Anchored to the "Move to Sprint Planning" button that was just
// clicked, found via the live click event.
function _blShowPlanningPicker(sprints, ids, event, laneKey) {
  var existing = document.getElementById('blPlanningPicker');
  if (existing) existing.remove();
  var btn = event && event.target && event.target.closest ? event.target.closest('button') : null;
  if (!btn) return;
  var panel = document.createElement('div');
  panel.id = 'blPlanningPicker';
  panel.className = 'yw-filter-panel bl-planning-picker';
  panel.innerHTML = sprints.map(function (sp) {
    return '<div class="yw-filter-opt" onclick="window._blPickPlanningSprint(\'' + sp.id + '\')">' + esc(sp.name) + '</div>';
  }).join('');
  panel.style.position = 'fixed';
  var rect = btn.getBoundingClientRect();
  panel.style.top = (rect.bottom + 4) + 'px';
  panel.style.left = rect.left + 'px';
  document.body.appendChild(panel);
  window._blPlanningPickerIds = ids;
  window._blPlanningPickerSprints = sprints;
  window._blPlanningPickerLaneKey = laneKey;
  setTimeout(function () {
    document.addEventListener('click', _blDismissPlanningPicker, { once: true });
  }, 0);
}

function _blDismissPlanningPicker() {
  var el = document.getElementById('blPlanningPicker');
  if (el) el.remove();
}

window._blPickPlanningSprint = function (sprintId) {
  _blDismissPlanningPicker();
  var sprint = (window._blPlanningPickerSprints || []).find(function (s) { return s.id === sprintId; });
  var ids = window._blPlanningPickerIds || [];
  var laneKey = window._blPlanningPickerLaneKey;
  if (sprint && ids.length) _blPerformMove(ids, sprint, laneKey);
};

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
  // /start returns the started sprint row, so its name is already in hand.
  var started;
  try {
    started = await api('/api/sprints/' + id + '/start', 'POST', null, { silent: true });
  } catch (e) {
    toast((sprintName(id) || 'Sprint') + ' could not be started — ' + errorReason(e), 'error');
    return;
  }
  await refreshData();
  renderBacklog();
  toast(((started && started.name) || sprintName(id) || 'Sprint') + ' started');
};

window._completeSprint = async function (id) {
  var ok = await confirmDialog('Complete this sprint? Incomplete issues will move to the backlog.');
  if (!ok) return;
  // /complete returns the completed sprint row, including the velocity it just
  // froze -- so the points total is in hand without computing anything.
  var done;
  try {
    done = await api('/api/sprints/' + id + '/complete', 'POST', null, { silent: true });
  } catch (e) {
    toast((sprintName(id) || 'Sprint') + ' could not be completed — ' + errorReason(e), 'error');
    return;
  }
  await refreshData();
  renderBacklog();
  var label = (done && done.name) || sprintName(id) || 'Sprint';
  var pts = done && done.velocity != null ? Number(done.velocity) : null;
  toast(pts != null
    ? label + ' completed — ' + pts + ' story point' + (pts === 1 ? '' : 's')
    : label + ' completed');
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
    toast('"' + name + '" delete failed — ' + errorReason(e), 'error');
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
