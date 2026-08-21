
// ═══════════════════════════════════════════════════════════
// RECENTLY VIEWED ISSUES (per user, localStorage)
// ═══════════════════════════════════════════════════════════
var RECENT_VIEWED_KEY = 'sb-recent-viewed';
var RECENT_VIEWED_24H_MS = 24 * 60 * 60 * 1000;
var RECENT_VIEWED_RETAIN_MS = 90 * 24 * 60 * 60 * 1000;

function getRecentViewedRawList() {
  try { return JSON.parse(localStorage.getItem(RECENT_VIEWED_KEY) || '[]'); } catch (_) { return []; }
}

function trackRecentIssueView(issue) {
  if (!issue || !issue.id) return;
  var list = getRecentViewedRawList();
  list = list.filter(function (x) { return x.id !== issue.id; });
  var space = issue.space_id ? getSpace(issue.space_id) : null;
  var snap = {
    id: issue.id,
    key: issue.key,
    title: issue.title,
    type: issue.type,
    status: issue.status,
    priority: issue.priority,
    space_id: issue.space_id,
    space_name: issue.space_name || (space && space.name) || '',
    project_key: issue.project_key || (space && space.key) || '',
    assignee_id: issue.assignee_id,
    updated_at: issue.updated_at,
    viewedAt: new Date().toISOString()
  };
  list.unshift(snap);
  var cutoff = Date.now() - RECENT_VIEWED_RETAIN_MS;
  list = list.filter(function (x) {
    return x.viewedAt && new Date(x.viewedAt).getTime() >= cutoff;
  });
  localStorage.setItem(RECENT_VIEWED_KEY, JSON.stringify(list));
  if (S.data && S.data.issues) {
    var idx = S.data.issues.findIndex(function (i) { return i.id === issue.id; });
    if (idx >= 0) {
      S.data.issues[idx] = Object.assign({}, S.data.issues[idx], {
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        type: issue.type,
        updated_at: issue.updated_at
      });
    }
  }
  refreshRecentViewedUI();
}

function mergeRecentViewedEntry(entry) {
  var cached = (S.data && S.data.issues || []).find(function (i) { return i.id === entry.id; });
  if (cached) {
    return Object.assign({}, entry, cached, {
      viewedAt: entry.viewedAt,
      space_name: entry.space_name || cached.space_name || (getSpace(cached.space_id) || {}).name || '',
      project_key: entry.project_key || cached.project_key || (getSpace(cached.space_id) || {}).key || ''
    });
  }
  return entry;
}

function getRecentlyViewedIssues(withinMs) {
  var list = getRecentViewedRawList();
  if (withinMs) {
    var since = Date.now() - withinMs;
    list = list.filter(function (x) {
      return x.viewedAt && new Date(x.viewedAt).getTime() >= since;
    });
  }
  list.sort(function (a, b) {
    return new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0);
  });
  return list.map(mergeRecentViewedEntry).filter(function (i) { return isIssueInMySpaces(i); });
}

async function enrichRecentlyViewedIssues() {
  var list = getRecentViewedRawList();
  if (!list.length) return [];
  var changed = false;
  var enriched = [];
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    var cached = (S.data && S.data.issues || []).find(function (iss) { return iss.id === entry.id; });
    if (cached) {
      enriched.push(mergeRecentViewedEntry(entry));
      continue;
    }
    try {
      var issue = await api('/api/issues/' + entry.id);
      var merged = Object.assign({}, issue, { viewedAt: entry.viewedAt });
      entry.title = issue.title;
      entry.status = issue.status;
      entry.priority = issue.priority;
      entry.type = issue.type;
      entry.key = issue.key;
      entry.space_id = issue.space_id;
      entry.space_name = issue.space_name || entry.space_name || '';
      entry.project_key = issue.project_key || entry.project_key || '';
      entry.updated_at = issue.updated_at;
      list[i] = entry;
      changed = true;
      enriched.push(merged);
    } catch (_) {
      list[i] = null;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(RECENT_VIEWED_KEY, JSON.stringify(list.filter(Boolean)));
  }
  enriched.sort(function (a, b) {
    return new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0);
  });
  return enriched;
}

function getRecentlyViewedCount24h() {
  return getRecentlyViewedIssues(RECENT_VIEWED_24H_MS).length;
}

function refreshRecentViewedUI() {
  if (S.currentView === 'yourwork' && S.yourWorkTab === 'recent') {
    renderRecentlyViewedContent();
  }
  if (S.currentView === 'home') {
    renderHomeRecentSection();
  }
}

function clearYourWorkFilters() {
  S.ywExcludeDone = false;
  S.ywFilters = { key: [], type: [], status: [], priority: [], space: [] };
  var srch = $('ywSearch');
  if (srch) srch.value = '';
}

function applyYourWorkOpenFilter() {
  S.ywExcludeDone = true;
  S.ywFilters = { key: [], type: [], status: [], priority: [], space: [] };
  var srch = $('ywSearch');
  if (srch) srch.value = '';
}

function patchIssueInCache(issueId, updates) {
  if (!updates) return;
  (S.data.issues || []).forEach(function (i) {
    if (i.id == issueId) Object.assign(i, updates);
  });
  if (!_ywCache) return;
  ['assigned', 'reported'].forEach(function (key) {
    (_ywCache[key] || []).forEach(function (i) {
      if (i.id == issueId) Object.assign(i, updates);
    });
  });
}

function refreshHomeMyIssuesPanel() {
  if (S.currentView !== 'home') return;
  var myIssues = (S.data.issues || []).filter(function (i) {
    return i.assignee_id == S.currentUser && i.status !== 'Done';
  });
  var badge = $('myIssuesBadge');
  if (badge) {
    badge.textContent = myIssues.length;
    badge.className = 'db-panel-badge' + (myIssues.length ? ' show' : '');
  }
  var panel = $('myIssues');
  if (!panel) return;
  if (!myIssues.length) {
    panel.innerHTML = '<div class="db-issue-empty">' +
      '<svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/></svg>' +
      'No issues assigned to you</div>';
    return;
  }
  var html = '';
  myIssues.slice(0, 8).forEach(function (issue) {
    html += '<div class="db-issue-row" onclick="openIssuePage(\'' + issue.id + '\')">' +
      '<span class="db-issue-row-key">' + esc(issueKeyStr(issue)) + '</span>' +
      '<span class="db-issue-row-title">' + esc(issue.title) + '</span>' +
      statusBadge(issue.status, true) + priorityBadge(issue.priority, true) + '</div>';
  });
  panel.innerHTML = html;
}

function refreshDashboardIssueStats() {
  api('/api/my-issues').then(function (data) {
    _ywCache = data;
    // Recompute every tile from the freshly cached assigned set. Without this
    // they would keep whatever the pre-cache fallback produced.
    var list = getMyDashboardIssues();
    var totalEl = $('dbMyIssuesStat');
    if (totalEl) totalEl.textContent = list.length;
    [['dbOpenIssuesStat', 'open'], ['dbActiveIssuesStat', 'active'],
     ['dbBlockedIssuesStat', 'blocked'], ['dbClosedIssuesStat', 'closed']]
      .forEach(function (pair) {
        var el = $(pair[0]);
        if (el) el.textContent = countMyIssuesByStatusGroup(list, pair[1]);
      });
    _updateYourWorkTabBadges(data);
  }).catch(function () {});
}

function refreshYourWorkViews() {
  if (S.currentView === 'yourwork') {
    if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
    else renderYourWorkContent(_ywCache);
  }
}

function afterIssueFieldUpdate(issueId, updates) {
  patchIssueInCache(issueId, updates);
  refreshYourWorkViews();
  if (S.currentView === 'space' && S.currentTab === 'allwork') {
    refreshData().then(renderAllWork);
  }
  if (S.drawerIssueId == issueId && updates.status && $('drawerStatus')) {
    $('drawerStatus').value = updates.status;
    var lbl = $('drawerStatusLabel');
    if (lbl) lbl.textContent = updates.status;
  }
  if (S.drawerIssueId == issueId && updates.priority && $('drawerPriority')) {
    $('drawerPriority').value = updates.priority;
  }
  refreshDashboardIssueStats();
  refreshHomeMyIssuesPanel();
}

function navigateToYourWork(tab, opts) {
  opts = opts || {};
  tab = tab || 'assigned';
  if (['assigned', 'reported', 'recent'].indexOf(tab) === -1) tab = 'assigned';
  if (!opts.preserveOpenFilter) clearYourWorkFilters();
  S.yourWorkTab = tab;
  navigateTo('yourwork');
}
function navigateToYourWorkRecent() {
  navigateToYourWork('recent');
}
function navigateToYourWorkOpen() {
  applyYourWorkOpenFilter();
  S.yourWorkTab = 'assigned';
  navigateTo('yourwork');
}

// Open the ticket list behind a dashboard tile: My Work → Assigned to Me,
// filtered to exactly the statuses that tile counted, so the list that appears
// has the same length as the number that was clicked.
// The tiles used to point at navigateToYourWork('assigned'), which clears all
// filters and showed every assigned ticket regardless of which tile was
// clicked, and at navigateToYourWorkOpen(), which filters "not Done" (To Do +
// In Progress + In Review + Blocked) rather than the tile's "To Do".
function navigateToMyWorkStatus(group) {
  var statuses = DASH_STATUS_GROUPS[group] || [];
  clearYourWorkFilters();          // also clears ywExcludeDone, which would otherwise hide Closed
  S.ywFilters.status = statuses.slice();
  S.yourWorkTab = 'assigned';
  navigateTo('yourwork');
}
window.navigateToMyWorkStatus = navigateToMyWorkStatus;
window.navigateToYourWork = navigateToYourWork;
window.navigateToYourWorkRecent = navigateToYourWorkRecent;
window.navigateToYourWorkOpen = navigateToYourWorkOpen;
