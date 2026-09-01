
// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
// Captured once, at parse time, before anything could have changed it --
// the one correct value to restore the tab title to on leaving a ticket,
// without hardcoding a second copy of index.html's own <title> text that
// could silently drift out of sync with it.
var DEFAULT_PAGE_TITLE = document.title;

function _closeIssueDrawer() {
  document.body.classList.remove('issue-page');
  var drawer = $('issueDrawer');
  if (drawer) drawer.setAttribute('hidden', '');
  S.drawerIssueId = null;
  window._currentIssueKey = null;
  // openDrawer sets the tab title to the ticket's own key/title on open, but
  // nothing ever set it back on close -- so leaving a ticket for a list/board
  // view (Back, the close button, closeIssueFromAllWork) left that ticket's
  // title showing in the tab, and in browser history, for every page visited
  // afterward until another ticket happened to be opened.
  document.title = DEFAULT_PAGE_TITLE;
}

function _exitIssuePage() {
  _closeIssueDrawer();
}

var YOUR_WORK_TAB_LABELS = {
  assigned: 'Assigned to Me',
  reported: 'Reported by Me',
  recent: 'Recently Viewed'
};

var SPACE_TAB_TO_SLUG = {
  summary: 'summary',
  backlog: 'backlog',
  sprint: 'sprint',
  reports: 'reports',
  mbr: 'mbr',
  allwork: 'all-work',
  calendar: 'calendar',
  'space-settings': 'settings'
};
var SPACE_SLUG_TO_TAB = {
  summary: 'summary',
  backlog: 'backlog',
  sprint: 'sprint',
  reports: 'reports',
  mbr: 'mbr',
  'all-work': 'allwork',
  calendar: 'calendar',
  settings: 'space-settings'
};

var SPACE_SUBNAV_ITEMS = [
  { t: 'summary', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>', l: 'Summary' },
  { t: 'backlog', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>', l: 'Backlog & Sprints' },
  { t: 'sprint', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', l: 'Active Sprint' },
  { t: 'allwork', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>', l: 'All Work' },
  { t: 'calendar', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', l: 'Calendar' },
  { t: 'reports', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>', l: 'Reports', spaceAdminOnly: true },
  { t: 'mbr', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>', l: 'MBR', spaceAdminOnly: true },
  { t: 'space-settings', i: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', l: 'Settings', spaceAdminOnly: true }
];

function getSpaceByKey(key) {
  if (!key || !S.data) return null;
  var upper = String(key).toUpperCase();
  return (S.data.spaces || []).find(function (s) {
    return s.key === upper || s.id === key;
  }) || null;
}

// Space Settings' own sub-tabs (General/People/Custom Fields/Deleted Items/
// Reports) previously shared one URL no matter which was open — this gives
// each its own path segment, same pattern as SPACE_TAB_TO_SLUG above.
var SETTINGS_TAB_TO_SLUG = {
  general: '', people: 'people', customfields: 'custom-fields',
  deleted: 'deleted', reports: 'reports'
};
var SETTINGS_SLUG_TO_TAB = {
  '': 'general', people: 'people', 'custom-fields': 'customfields',
  deleted: 'deleted', reports: 'reports'
};
// Same gap, same fix, for MBR's own sub-tabs (Overview/Comparison Trends/Achievements).
var MBR_TAB_TO_SLUG = { overview: '', comparison: 'comparison', achievements: 'achievements' };
var MBR_SLUG_TO_TAB = { '': 'overview', comparison: 'comparison', achievements: 'achievements' };

function spacePath(spaceId, tab, subTab) {
  var sp = getSpace(spaceId) || getSpaceByKey(spaceId);
  if (!sp || !sp.key) return '/';
  tab = tab || 'summary';
  var slug = SPACE_TAB_TO_SLUG[tab] || 'summary';
  if (slug === 'summary') return '/space/' + encodeURIComponent(sp.key);
  var base = '/space/' + encodeURIComponent(sp.key) + '/' + slug;
  if (tab === 'space-settings') {
    var subSlug = SETTINGS_TAB_TO_SLUG[subTab || _settingsActiveTab];
    if (subSlug) base += '/' + subSlug;
  } else if (tab === 'mbr') {
    var mSlug = MBR_TAB_TO_SLUG[subTab || _mbrActiveTab];
    if (mSlug) base += '/' + mSlug;
  }
  return base;
}

function yourWorkPath(tab, opts) {
  opts = opts || {};
  if (opts.open) return '/my-work/open';
  tab = tab || 'assigned';
  return tab === 'assigned' ? '/my-work' : '/my-work/' + tab;
}

// Org Admin Settings' left-nav sections previously all shared /settings no
// matter which was open — same gap as Space Settings/MBR above. Slugs match
// the section keys themselves (already kebab-case) so there's no separate
// naming to keep in sync; org-general is the default (empty slug).
var ADMIN_SECTIONS_WITH_URL = [
  'org-general', 'org-security', 'org-notifications', 'user-management',
  'roles-permissions', 'all-spaces', 'global-custom-fields', 'email-settings',
  'audit-log', 'deleted-tickets'
];

function appPathForView(view, extras) {
  extras = extras || {};
  if (view === 'yourwork') return yourWorkPath(extras.yourWorkTab || S.yourWorkTab);
  if (view === 'space' && extras.spaceId) return spacePath(extras.spaceId, extras.tab || S.currentTab);
  if (view === 'spaces') return '/spaces';
  if (view === 'global-reports') return '/reports';
  if (view === 'worklog-report') return '/work-log';
  if (view === 'product-roadmap') return '/roadmap';
  if (view === 'settings') {
    var section = extras.section || _adminSection;
    return (section && section !== 'org-general') ? '/settings/' + section : '/settings';
  }
  return '/';
}

function collapseSpaceSubnav() {
  qsa('.space-subnav').forEach(function (s) { s.remove(); });
  qsa('.space-item').forEach(function (s) { s.classList.remove('active'); });
}

function buildSpaceSubnavHtml(spaceId, tab) {
  var showAdminItems = canManageSpace(spaceId);
  return SPACE_SUBNAV_ITEMS.filter(function (x) {
    return !x.spaceAdminOnly || showAdminItems;
  }).map(function (x) {
    var href = spacePath(spaceId, x.t);
    return '<a class="nav-item space-subitem' + (x.t === tab ? ' active' : '') + '" href="' + href + '" data-tab="' + x.t + '" data-space-id="' + spaceId + '"><span class="nav-icon">' + x.i + '</span> ' + x.l + '</a>';
  }).join('');
}

function mountSpaceSubnav(spaceId, tab) {
  collapseSpaceSubnav();
  qsa('.space-item').forEach(function (el) {
    var isSel = String(el.dataset.spaceId) === String(spaceId);
    el.classList.toggle('active', isSel);
    if (isSel) {
      var sub = document.createElement('div');
      sub.className = 'space-subnav';
      sub.innerHTML = buildSpaceSubnavHtml(spaceId, tab);
      el.parentNode.insertBefore(sub, el.nextSibling);
    }
  });
}

function parseAppRoute() {
  var path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  var issueKey = new URLSearchParams(window.location.search).get('issue');
  if (issueKey) return { view: 'issue', issueKey: issueKey };
  var spaceMatch = path.match(/^\/space\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/i);
  if (spaceMatch) {
    var spaceTab = SPACE_SLUG_TO_TAB[spaceMatch[2]] || 'summary';
    var route = {
      view: 'space',
      spaceKey: decodeURIComponent(spaceMatch[1]),
      tab: spaceTab
    };
    // Third segment only means something under /settings/<sub-tab> or
    // /mbr/<sub-tab> — a stray extra segment anywhere else (or an unrecognized
    // sub-tab slug) falls back to the default sub-tab rather than a broken route.
    if (spaceTab === 'space-settings' && spaceMatch[3] != null) {
      route.settingsSubTab = SETTINGS_SLUG_TO_TAB[spaceMatch[3]] || 'general';
    } else if (spaceTab === 'mbr' && spaceMatch[3] != null) {
      route.mbrSubTab = MBR_SLUG_TO_TAB[spaceMatch[3]] || 'overview';
    }
    return route;
  }
  if (path === '/my-work/open') return { view: 'yourwork', yourWorkTab: 'assigned', openOnly: true };
  if (path === '/my-work' || path === '/my-work/assigned') return { view: 'yourwork', yourWorkTab: 'assigned' };
  if (path === '/my-work/reported') return { view: 'yourwork', yourWorkTab: 'reported' };
  if (path === '/my-work/recent') return { view: 'yourwork', yourWorkTab: 'recent' };
  if (path === '/spaces') return { view: 'spaces' };
  if (path === '/reports') return { view: 'global-reports' };
  if (path === '/work-log') return { view: 'worklog-report' };
  if (path === '/roadmap') return { view: 'product-roadmap' };
  if (path === '/settings') return { view: 'settings' };
  var settingsMatch = path.match(/^\/settings\/([^/]+)$/i);
  if (settingsMatch && ADMIN_SECTIONS_WITH_URL.indexOf(settingsMatch[1]) >= 0) {
    return { view: 'settings', adminSection: settingsMatch[1] };
  }
  return { view: 'home' };
}

function syncAppUrl(opts) {
  opts = opts || {};
  var path = '/';
  if (S.currentView === 'yourwork') {
    path = yourWorkPath(S.yourWorkTab, {
      open: S.ywExcludeDone && S.yourWorkTab === 'assigned'
    });
  } else if (S.currentView === 'space' && S.currentSpace) path = spacePath(S.currentSpace, S.currentTab);
  else path = appPathForView(S.currentView);
  if (window.location.pathname === path && !window.location.search) return;
  var fn = opts.replace ? 'replaceState' : 'pushState';
  window.history[fn]({
    view: S.currentView,
    spaceId: S.currentSpace,
    tab: S.currentTab,
    yourWorkTab: S.yourWorkTab
  }, '', path);
}

function applyRouteFromUrl(opts) {
  opts = opts || {};
  var route = parseAppRoute();
  if (route.view === 'issue') return false;
  if (route.view === 'yourwork') {
    S.yourWorkTab = route.yourWorkTab || 'assigned';
    if (route.openOnly) applyYourWorkOpenFilter();
    else clearYourWorkFilters();
    navigateTo('yourwork', { skipUrlUpdate: true, replaceUrl: opts.replaceUrl });
    return true;
  }
  if (route.view === 'space') {
    var sp = getSpaceByKey(route.spaceKey);
    if (sp) {
      navigateToSpace(sp.id, route.tab || 'summary', {
        skipUrlUpdate: true, replaceUrl: opts.replaceUrl,
        settingsSubTab: route.settingsSubTab, mbrSubTab: route.mbrSubTab
      });
      return true;
    }
  }
  if (route.view !== 'home') {
    navigateTo(route.view, { skipUrlUpdate: true, replaceUrl: opts.replaceUrl, adminSection: route.adminSection });
    return true;
  }
  navigateTo('home', { skipUrlUpdate: true, replaceUrl: opts.replaceUrl });
  return true;
}

function saveNavState() {
  try {
    localStorage.setItem('sb-last-nav', JSON.stringify({
      view: S.currentView,
      spaceId: S.currentSpace,
      tab: S.currentTab,
      yourWorkTab: S.yourWorkTab
    }));
  } catch (_) {}
}

// The admin console is a wide two-pane layout, so the nav sidebar is collapsed
// while it's open to give it room. The state the sidebar was in beforehand is
// remembered and put back on the way out, rather than leaving it collapsed
// everywhere else. Null means "nothing to restore" — either we aren't in
// settings, or the user toggled it themselves while there and owns it now.
var _sidebarStateBeforeSettings = null;

function collapseSidebarForSettings() {
  var sb = $('sidebar');
  if (!sb) return;
  if (_sidebarStateBeforeSettings === null) {
    _sidebarStateBeforeSettings = sb.classList.contains('collapsed');
  }
  sb.classList.add('collapsed');
}

function restoreSidebarAfterSettings() {
  var sb = $('sidebar');
  if (!sb || _sidebarStateBeforeSettings === null) return;
  sb.classList.toggle('collapsed', _sidebarStateBeforeSettings);
  _sidebarStateBeforeSettings = null;
}

function navigateTo(view, opts) {
  opts = opts || {};
  if (typeof window._gsReset === 'function') window._gsReset();
  document.body.classList.remove('settings-active');
  if (view !== 'settings') restoreSidebarAfterSettings();
  if (view === 'global-reports' && !canViewReports()) {
    toast('Only admins and space admins can access Reports', 'error');
    return;
  }
  _exitIssuePage();
  S.currentView = view;
  S.currentSpace = null;
  S.currentTab = null;
  saveNavState();
  collapseSpaceSubnav();

  qsa('.view').forEach(function (v) { v.setAttribute('hidden', ''); });
  $('spaceHeader').setAttribute('hidden', '');
  $('spaceNav').setAttribute('hidden', '');

  var target = $('view-' + view);
  if (target) target.removeAttribute('hidden');

  var label = view === 'yourwork'
    ? 'Assigned to me / ' + (S.ywExcludeDone && S.yourWorkTab === 'assigned'
      ? 'Open Issues'
      : (YOUR_WORK_TAB_LABELS[S.yourWorkTab] || 'Assigned to Me'))
    : view === 'global-reports' ? 'Reports' : view === 'worklog-report' ? 'Work Log' : view === 'product-roadmap' ? 'Product Roadmap' : view === 'spaces' ? 'Spaces' : cap(view);
  updateBreadcrumb([{ label: label }]);

  if (!opts.skipUrlUpdate) syncAppUrl({ replace: opts.replaceUrl });

  qsa('.nav-item[data-view]').forEach(function (el) {
    el.classList.toggle('active', el.dataset.view === view);
  });
  qsa('.nav-item[data-tab]').forEach(function (el) { el.classList.remove('active'); });

  if (view === 'home') renderHome();
  else if (view === 'yourwork') renderYourWork();
  else if (view === 'spaces') renderSpacesView();
  else if (view === 'worklog-report') renderWorklogReport();
  else if (view === 'product-roadmap') renderProductRoadmap();
  else if (view === 'settings') { document.body.classList.add('settings-active'); collapseSidebarForSettings(); renderAdminSettings(opts.adminSection || 'org-general'); }
  else if (view === 'global-reports') renderGlobalReports();
}

function renderGlobalReports() {
  var sel = $('globalReportSpace');
  if (!sel) return;
  // Populate space selector
  var spaces = S.data.spaces || [];
  sel.innerHTML = spaces.map(function(sp) {
    return '<option value="' + sp.id + '">' + esc(sp.name) + '</option>';
  }).join('');

  window._loadGlobalReport = async function() {
    var spaceId = ($('globalReportSpace') || {}).value;
    var type = ($('globalReportType') || {}).value || 'burndown';
    var c = $('globalReportContent');
    if (!c || !spaceId) return;
    c.innerHTML = '<p class="text-muted">Loading\u2026</p>';
    var prevSpace = S.currentSpace;
    S.currentSpace = spaceId;
    try {
      if (type === 'burndown') {
        var sprints = await api('/api/sprints?space_id=' + spaceId);
        var target = sprints.find(function(sp){ return sp.status === 'active'; }) || sprints[sprints.length - 1];
        if (!target) { c.innerHTML = '<p class="placeholder-text">No sprints found for this space.</p>'; S.currentSpace = prevSpace; return; }
        var d = await api('/api/reports/sprint/' + target.id);
        renderBurndownReport(c, d, sprints);
      } else if (type === 'velocity') {
        var d2 = await api('/api/reports/velocity?space_id=' + spaceId);
        renderVelocityReport(c, d2);
      } else if (type === 'cumulative') {
        var d3 = await api('/api/reports/status?space_id=' + spaceId);
        renderCumulativeReport(c, d3);
      } else if (type === 'control') {
        var ctrlSprints = await api('/api/sprints?space_id=' + spaceId);
        var ctrlTarget = ctrlSprints.find(function(sp){ return sp.status === 'active'; }) || ctrlSprints[ctrlSprints.length - 1];
        if (!ctrlTarget) { c.innerHTML = '<p class="placeholder-text">No sprints found for this space.</p>'; S.currentSpace = prevSpace; return; }
        var d4 = await api('/api/reports/control-chart/' + ctrlTarget.id);
        renderControlChart(c, d4);
      }
    } catch(e) {
      c.innerHTML = '<p class="text-muted">Failed to load: ' + esc(e.message) + '</p>';
    } finally {
      S.currentSpace = prevSpace;
    }
  };

  window._loadGlobalReport();
}

function navigateToSpace(spaceId, tab, opts) {
  opts = opts || {};
  if (typeof window._gsReset === 'function') window._gsReset();
  // Clicking a space is the other way out of the admin console — it doesn't go
  // through navigateTo(), so the sidebar has to be put back here too.
  document.body.classList.remove('settings-active');
  restoreSidebarAfterSettings();
  _exitIssuePage();
  tab = tab || 'summary';
  if (spaceId !== S.currentSpace) {
    S.awFilters = { type:[], status:[], priority:[], assignee:[], sprint:[],
      createdFrom:'', createdTo:'', updatedFrom:'', updatedTo:'',
      dueDateFrom:'', dueDateTo:'', startDateFrom:'', startDateTo:'' };
  }
  S.currentSpace = spaceId;
  S.currentView = 'space';
  S.currentTab = tab;

  var space = getSpace(S.currentSpace);
  if (!space) { toast('Space not found', 'error'); return; }

  qsa('.view').forEach(function (v) { v.setAttribute('hidden', ''); });
  $('spaceHeader').removeAttribute('hidden');
  renderSpaceHeader(space);

  updateBreadcrumb([
    { label: 'Home', action: function () { navigateTo('home'); } },
    { label: space.name, action: function () { navigateToSpace(spaceId, 'summary'); } },
    { label: cap(tab) }
  ]);

  qsa('.nav-item[data-view]').forEach(function (el) { el.classList.remove('active'); });
  mountSpaceSubnav(spaceId, tab);
  saveNavState();

  if (tab === 'space-settings' && opts.settingsSubTab) _settingsActiveTab = opts.settingsSubTab;
  if (tab === 'mbr' && opts.mbrSubTab) _mbrActiveTab = opts.mbrSubTab;
  if (!opts.skipUrlUpdate) syncAppUrl({ replace: opts.replaceUrl });

  renderTab(tab, { skipUrlUpdate: true });
}
window.navigateToSpace = navigateToSpace;

function renderTab(tab, opts) {
  opts = opts || {};
  if (!canManageSpace(S.currentSpace) && (tab === 'reports' || tab === 'mbr' || tab === 'space-settings')) {
    toast('Only admins and space admins can access this section', 'error');
    return;
  }
  _exitIssuePage();
  S.currentTab = tab;
  saveNavState();
  qsa('.view').forEach(function (v) { v.setAttribute('hidden', ''); });
  qsa('.nav-item[data-tab]').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === tab); });
  qsa('.space-subitem').forEach(function (el) {
    el.classList.toggle('active', el.dataset.tab === tab && el.dataset.spaceId == S.currentSpace);
  });

  var target = $('view-' + tab);
  if (target) target.removeAttribute('hidden');

  var space = getSpace(S.currentSpace);
  if (space) {
    updateBreadcrumb([
      { label: 'Home', action: function () { navigateTo('home'); } },
      { label: space.name, action: function () { navigateToSpace(S.currentSpace, 'summary'); } },
      { label: cap(tab) }
    ]);
  }

  if (!opts.skipUrlUpdate && S.currentView === 'space' && S.currentSpace) {
    syncAppUrl({ replace: false });
  }

  switch (tab) {
    case 'summary': (async function() {
      var spaceAtStart = S.currentSpace;
      await ensureSpaceDataFresh();
      // Landing here right after clicking a space (summary is the default
      // tab) used to render getSpaceIssues() off whatever S.data already
      // held -- empty or another space's data on a cold nav -- showing every
      // stat card as 0 even though the space has plenty of issues in
      // production. Every OTHER stat card's own tab (allwork) already
      // guards this same way; summary just never did.
      if (S.currentTab === 'summary' && S.currentSpace === spaceAtStart) renderSummary();
    })(); break;
    case 'backlog': renderBacklog(); break;
    case 'sprint': renderSprintBoard(); break;
    case 'reports': renderReports(); break;
    case 'mbr': renderMBR(); break;
    case 'allwork': (async function() {
      await ensureSpaceDataFresh();
      await _initAwMultiSelects();
      // Restores whatever was last saved for THIS space -- safe to do on every
      // entry into the tab, not just the first: _awSaveFilterState() runs on
      // every filter change (inside renderAllWork itself), so localStorage is
      // always already current and this never clobbers an unsaved edit.
      _awLoadFilterState();
      renderAllWork();
    })(); break;
    case 'calendar': renderCalendar(); break;
    case 'space-settings': renderSpaceSettings(); break;
  }
  updateRoleBasedUI();
}

function updateBreadcrumb(items) {
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.action && i < items.length - 1) {
      html += '<a class="breadcrumb-link" data-bc-idx="' + i + '">' + esc(item.label) + '</a><span class="breadcrumb-sep"> / </span>';
    } else {
      html += '<span class="breadcrumb-current">' + esc(item.label) + '</span>';
    }
  }
  $('breadcrumb').innerHTML = html;
  for (var j = 0; j < items.length; j++) {
    if (items[j].action) {
      var el = qs('[data-bc-idx="' + j + '"]');
      if (el) el.addEventListener('click', items[j].action);
    }
  }
}

function renderCurrentView() {
  if (S.currentSpace) {
    navigateToSpace(S.currentSpace, S.currentTab || 'summary');
  } else {
    navigateTo(S.currentView || 'home');
  }
}

async function refreshData() {
  var url = '/api/data';
  if (S.currentSpace) url += '?space_id=' + S.currentSpace;
  var data = await api(url);
  S.data = data;
}

// Skip the full refetch if data was loaded within the last 30s for this same
// space -- shared by every space tab that needs to render off a guaranteed-
// current S.data rather than whatever the previous space/tab left behind.
async function ensureSpaceDataFresh() {
  var now = Date.now();
  if (!S._dataLoadedAt || (now - S._dataLoadedAt) > 30000 || S._dataLoadedSpace !== S.currentSpace) {
    await refreshData();
    S._dataLoadedAt = now;
    S._dataLoadedSpace = S.currentSpace;
  }
}

// refreshData() scopes custom_fields to S.currentSpace like everything else
// it loads, which is fine normally — but a bulk action that touches every
// board (apply-to-all / create-for-all) needs the FULL cross-board list
// afterward, or every other board's cached fields silently go stale/empty
// until a full page reload.
async function refreshAllCustomFields() {
  try {
    var all = await api('/api/custom-fields');
    if (Array.isArray(all)) S.data.custom_fields = all;
  } catch (e) {}
}

async function refreshAfterIssueChange() {
  await refreshData();
  if (S.currentSpace && S.currentTab) renderTab(S.currentTab);
}
