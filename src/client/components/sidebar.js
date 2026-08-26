
// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════
function renderSidebar() {
  var isOrgAdmin = isOrgAdminUser();

  // Only org admins can create spaces
  var newSpaceBtn = $('newSpaceBtn');
  if (newSpaceBtn) newSpaceBtn.style.display = canCreateSpace() ? '' : 'none';

  // Global Reports — org admin or space admin on any space
  var showGlobalReports = canViewReports();
  var globalReportsEl = document.querySelector('[data-view="global-reports"]');
  if (globalReportsEl) globalReportsEl.style.display = showGlobalReports ? '' : 'none';

  // Work Log and Product Roadmap — org admin only
  var orgOnlyItems = document.querySelectorAll('[data-view="worklog-report"], [data-view="product-roadmap"]');
  orgOnlyItems.forEach(function(el) { el.style.display = isOrgAdmin ? '' : 'none'; });

  // Starred issues (tickets)
  var favIssueIds = (S.data.issue_favorites || []).map(function (f) { return f.issue_id; });
  var favIssues = favIssueIds.map(function (id) {
    return (S.data.issues || []).find(function (i) { return i.id == id; });
  }).filter(function (i) { return i && isIssueInMySpaces(i); });
  var favIssuesEl = $('favIssues');
  if (favIssuesEl) {
    favIssuesEl.innerHTML = favIssues.length
      ? favIssues.map(function (iss) {
          return '<a class="nav-item starred-issue-item" href="/?issue=' + encodeURIComponent(issueKeyStr(iss)) + '" data-issue-id="' + esc(iss.id) + '" title="' + escAttr(iss.title) + '">' +
            '<span class="nav-icon" style="color:#fbbf24">\u2605</span>' +
            '<span class="starred-issue-key">' + esc(issueKeyStr(iss)) + '</span>' +
            '<span class="starred-issue-title">' + esc(iss.title) + '</span>' +
          '</a>';
        }).join('')
      : '<p class="text-muted sidebar-empty">Star tickets from issue view</p>';
    qsa('.starred-issue-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openIssuePage(el.dataset.issueId);
      });
    });
    // Fetch any starred issues missing from local cache
    var missingFavIds = favIssueIds.filter(function (id) {
      return !(S.data.issues || []).some(function (i) { return i.id == id; });
    });
    if (missingFavIds.length) {
      Promise.all(missingFavIds.map(function (id) {
        return api('/api/issues/' + id).catch(function () { return null; });
      })).then(function (fetched) {
        var added = false;
        fetched.forEach(function (iss) {
          if (iss && iss.id) {
            S.data.issues = S.data.issues || [];
            if (!S.data.issues.some(function (i) { return i.id == iss.id; })) {
              S.data.issues.push(iss);
              added = true;
            }
          }
        });
        if (added) renderSidebar();
      });
    }
  }

  // All spaces — members only see spaces they are assigned to in DB
  var allSpaces = (S.data.spaces || []).filter(function (s) { return !s.is_archived; });
  var spaces = isOrgAdmin ? allSpaces : allSpaces.filter(function(s) {
    return (S.data.space_members || []).some(function(m) {
      return m.space_id === s.id && m.user_id === S.currentUser;
    });
  });
  $('spacesList').innerHTML = spaces.length
    ? spaces.map(spaceNavItem).join('')
    : '<p class="text-muted sidebar-empty">No spaces</p>';

  // Clicking a space in the sidebar is a pure expand/collapse toggle for its
  // Summary/Backlog/etc submenu -- it never navigates the main content area
  // by itself (that only happens when a submenu link itself is clicked, via
  // the .space-subitem delegate below). This is true from anywhere: Home,
  // All Work, another space, or an open ticket -- clicking a space just
  // shows or hides its own menu in place.
  //
  // An earlier version of this handler tried to distinguish "already viewing
  // this space" from "not viewing it" using S.currentSpace/currentView, which
  // is a different kind of state (what's rendered in the main pane) from
  // "is this space's submenu currently expanded in the sidebar" -- the two
  // drifted out of sync (e.g. opening a ticket doesn't touch S.currentSpace),
  // which is what caused the earlier "first click goes home" bug. Reading the
  // submenu's own DOM presence directly avoids that class of bug entirely.
  qsa('.space-item').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var spaceId = el.dataset.spaceId;
      var alreadyExpanded = !!(el.nextElementSibling && el.nextElementSibling.classList.contains('space-subnav'));
      if (alreadyExpanded) {
        collapseSpaceSubnav();
      } else {
        // Only show the real current tab as active in the submenu if we are
        // actually navigated into this space right now; otherwise nothing in
        // the list is marked active until a link in it is clicked.
        var activeTab = (String(S.currentSpace) === String(spaceId) && S.currentView === 'space') ? S.currentTab : null;
        mountSpaceSubnav(spaceId, activeTab);
      }
    });
  });

  // Bind 3-dot menu buttons on space items
  qsa('.space-item-menu-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var spaceId = btn.dataset.spaceMenuId;
      showSpaceContextMenu(btn, spaceId);
    });
  });

  updateRoleBasedUI();
}

function spaceNavItem(sp) {
  var active = S.currentSpace == sp.id ? ' active' : '';
  var canManage = canManageSpace(sp.id);
  var initLetter = sp.name ? sp.name.charAt(0).toUpperCase() : '?';
  var bgColor = sp.color || '#0129ac';
  var isActive = S.currentSpace != null && String(S.currentSpace) === String(sp.id);
  var subnav = isActive ? (
    '<div class="space-subnav">' + buildSpaceSubnavHtml(sp.id, S.currentTab || 'summary') + '</div>'
  ) : '';
  return '<div class="space-item-wrap">' +
    '<a class="nav-item space-item' + active + '" href="' + spacePath(sp.id, 'summary') + '" data-space-id="' + sp.id + '">' +
    '<span class="space-dot" style="background:transparent;"></span>' +
    '<span class="space-jira-icon" style="background:' + bgColor + ';width:20px;height:20px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;margin-right:6px;">' + initLetter + '</span>' +
    '<span class="space-item-name">' + esc(sp.name) + '</span>' +
    (canManage ? '<button class="btn-icon space-item-menu-btn" data-space-menu-id="' + sp.id + '" title="More options">\u22EF</button>' : '') +
    '</a>' +
    subnav +
    '</div>';
}
