
// ═══════════════════════════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════════════
function findUser(id) {
  if (!id || !S.data) return null;
  var users = S.data.users || [];
  for (var i = 0; i < users.length; i++) {
    if (users[i].id == id) return users[i];
  }
  return null;
}

function getSpace(id) {
  if (!id || !S.data) return null;
  var spaces = S.data.spaces || [];
  for (var i = 0; i < spaces.length; i++) {
    if (spaces[i].id == id) return spaces[i];
  }
  return null;
}

function getSpaceMembers(spaceId) {
  if (!S.data) return [];
  var recs = (S.data.space_members || []).filter(function (m) { return m.space_id == spaceId; });
  return recs.map(function (m) { return findUser(m.user_id); }).filter(Boolean);
}

function getMyVisibleSpaceIds() {
  if (canCreateSpace()) {
    return (S.data.spaces || []).filter(function (s) { return !s.is_archived; }).map(function (s) { return s.id; });
  }
  return (S.data.space_members || [])
    .filter(function (m) { return m.user_id === S.currentUser; })
    .map(function (m) { return m.space_id; });
}

function isIssueInMySpaces(issue) {
  if (!issue || !issue.space_id) return false;
  if (canCreateSpace()) return true;
  return getMyVisibleSpaceIds().indexOf(issue.space_id) >= 0;
}

function getVisibleIssues() {
  var ids = getMyVisibleSpaceIds();
  if (canCreateSpace()) return S.data.issues || [];
  return (S.data.issues || []).filter(function (i) { return ids.indexOf(i.space_id) >= 0; });
}

function getSpaceIssues(spaceId) {
  if (!canCreateSpace()) {
    var mine = getMyVisibleSpaceIds();
    if (mine.indexOf(spaceId) < 0) return [];
  }
  return (S.data.issues || []).filter(function (i) { return i.space_id == spaceId; });
}

function getSpaceSprints(spaceId) {
  return (S.data.sprints || []).filter(function (sp) { return sp.space_id == spaceId; });
}

/** Non-completed sprints the user may assign when creating an issue.
 * Previously also required the current user to be on the sprint's
 * Developer/QA roster (or be a space/org admin) — per the permission
 * matrix, any space member who can create an issue can move it into any
 * open sprint, so a plain member not personally listed on that sprint's
 * roster still needs to see it here. The issue drawer's own sprint field
 * already worked this way (see its inline filter for why it deliberately
 * avoids this function) — this brings Create Issue in line with it. */
function getIssueFormSprints(spaceId, opts) {
  opts = opts || {};
  if (!spaceId) return [];
  var includeSprintId = opts.includeSprintId;
  return getSpaceSprints(spaceId).filter(function (sp) {
    if (includeSprintId && sp.id === includeSprintId) return true;
    return sp.status !== 'completed';
  });
}

/** Set create-issue start/due dates from the selected sprint. */
function applySprintDatesToIssueForm(sprintId) {
  var startEl = $('issueStartDate');
  var dueEl = $('issueDueDate');
  if (!startEl || !dueEl) return;
  if (!sprintId) {
    startEl.value = fmtDateISO(new Date());
    dueEl.value = '';
    return;
  }
  var sprint = (S.data.sprints || []).find(function (sp) { return sp.id === sprintId; });
  if (!sprint) return;
  if (sprint.start_date) startEl.value = fmtDateISO(sprint.start_date);
  if (sprint.end_date) dueEl.value = fmtDateISO(sprint.end_date);
}

function isIssueStarred(issueId) {
  return (S.data.issue_favorites || []).some(function (f) {
    return f.issue_id == issueId;
  });
}

function updateDrawerStarBtn(issueId) {
  var btn = $('drawerStarBtn');
  if (!btn) return;
  var starred = isIssueStarred(issueId);
  btn.textContent = starred ? '\u2605' : '\u2606';
  btn.classList.toggle('starred', starred);
  btn.title = starred ? 'Remove star' : 'Star issue';
}

async function toggleIssueFavorite(issueId) {
  if (!issueId) return;
  try {
    var res = await api('/api/issues/' + issueId + '/favorite', 'POST', {}, { silent: true });
    if (!S.data.issue_favorites) S.data.issue_favorites = [];
    S.data.issue_favorites = S.data.issue_favorites.filter(function (f) { return f.issue_id != issueId; });
    if (res && res.favorited) {
      S.data.issue_favorites.unshift({ issue_id: issueId, created_at: new Date().toISOString() });
      if (!(S.data.issues || []).some(function (i) { return i.id == issueId; })) {
        try {
          var iss = await api('/api/issues/' + issueId);
          S.data.issues = S.data.issues || [];
          S.data.issues.push(iss);
        } catch (_) {}
      }
    }
    updateDrawerStarBtn(issueId);
    renderSidebar();
    var starKey = cachedIssueKey(issueId) || 'Issue';
    toast(res && res.favorited ? starKey + ' starred' : starKey + ' unstarred');
  } catch (e) {
    toast((cachedIssueKey(issueId) || 'Issue') + ' star failed — ' + errorReason(e), 'error');
  }
}
window.toggleIssueFavorite = toggleIssueFavorite;

function isFavorited(spaceId) {
  return (S.data.space_favorites || []).some(function (f) { return f.user_id == S.currentUser && f.space_id == spaceId; });
}

function populateUserSelect(sel, members, selectedId) {
  var sorted = members.slice().sort(function(a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });
  var html = '<option value="">Unassigned</option>';
  for (var i = 0; i < sorted.length; i++) {
    var u = sorted[i];
    html += '<option value="' + u.id + '"' + (String(u.id) === String(selectedId) ? ' selected' : '') + '>' + esc(u.name) + '</option>';
  }
  sel.innerHTML = html;
  sel.size = 1;
  sel.style.overflowY = 'hidden';
  sel.style.height = '34px';
}

// Searchable user dropdown for Create Issue modal
function initUserSearchDropdown(searchInputId, hiddenInputId, dropdownId, members, selectedId) {
  var searchEl = $(searchInputId);
  var hiddenEl = $(hiddenInputId);
  var dropEl   = $(dropdownId);
  if (!searchEl || !hiddenEl || !dropEl) return;

  var sorted = members.slice().sort(function(a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });
  var allOptions = [{ id: '', name: 'Unassigned', color: '#6b7280' }].concat(sorted);
  searchEl._userSearchOptions = allOptions;

  // Set initial display value
  var preselected = selectedId ? allOptions.find(function(u){ return String(u.id) === String(selectedId); }) : null;
  hiddenEl.value = selectedId || '';
  searchEl.value = preselected ? preselected.name : '';

  function renderDropdown(filter) {
    var opts = searchEl._userSearchOptions || allOptions;
    var q = (filter || '').toLowerCase();
    var filtered = opts.filter(function(u){ return !q || u.name.toLowerCase().indexOf(q) >= 0; });
    if (!filtered.length) {
      dropEl.innerHTML = '<div class="user-search-none">No results</div>';
    } else {
      dropEl.innerHTML = filtered.map(function(u) {
        var initials = u.name ? u.name.split(' ').map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase() : '?';
        var bg = u.color || '#6b7280';
        return '<div class="user-search-option" data-id="' + esc(u.id) + '" data-name="' + escAttr(u.name) + '">' +
          '<span class="user-search-avatar" style="background:' + bg + '">' + initials + '</span>' +
          esc(u.name) + '</div>';
      }).join('');
    }
    dropEl.style.display = 'block';
    dropEl.querySelectorAll('.user-search-option').forEach(function(opt) {
      opt.addEventListener('mousedown', function(e) {
        e.preventDefault();
        hiddenEl.value = opt.dataset.id;
        searchEl.value = opt.dataset.name;
        dropEl.style.display = 'none';
      });
    });
  }

  if (searchEl._userSearchBound) return;
  searchEl._userSearchBound = true;

  searchEl.addEventListener('focus', function() { renderDropdown(searchEl.value); });
  searchEl.addEventListener('input', function() { renderDropdown(searchEl.value); });
  searchEl.addEventListener('blur', function() { setTimeout(function(){ dropEl.style.display = 'none'; }, 150); });
  searchEl.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { dropEl.style.display = 'none'; searchEl.blur(); }
  });

  if (!window._userSearchOutsideBound) {
    window._userSearchOutsideBound = true;
    document.addEventListener('click', function(e) {
      document.querySelectorAll('[data-user-search-input]').forEach(function(input) {
        var dropId = input.getAttribute('data-user-search-drop');
        var drop = dropId ? $(dropId) : null;
        if (drop && !input.contains(e.target) && !drop.contains(e.target)) drop.style.display = 'none';
      });
    });
  }
  searchEl.setAttribute('data-user-search-input', '1');
  searchEl.setAttribute('data-user-search-drop', dropdownId.charAt(0) === '#' ? dropdownId.slice(1) : dropdownId);
}

function populateSprintSelect(sel, sprints, selectedId) {
  var html = '<option value="">None</option>';
  for (var i = 0; i < sprints.length; i++) {
    var sp = sprints[i];
    html += '<option value="' + sp.id + '"' + (sp.id == selectedId ? ' selected' : '') + '>' + esc(sp.name) + ' (' + sp.status + ')</option>';
  }
  sel.innerHTML = html;
}
