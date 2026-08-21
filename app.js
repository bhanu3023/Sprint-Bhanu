
// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════
async function init() {
  // Capture token from Microsoft OAuth redirect (?token=...)
  var _urlToken = new URLSearchParams(window.location.search).get('token');
  if (_urlToken) {
    localStorage.setItem('sb-token', _urlToken);
    localStorage.removeItem('sb-user');
    history.replaceState({}, '', window.location.pathname);
  }

  // Check auth
  var token = localStorage.getItem('sb-token');
  var storedUser = null;
  try { storedUser = JSON.parse(localStorage.getItem('sb-user') || 'null'); } catch (_) {}
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  try {
    $('loadingMsg').textContent = 'Loading workspace data\u2026';
    // Verify token still valid
    var me = null;
    try { me = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).then(function(r) { return r.ok ? r.json() : null; }); }
    catch (_) {}
    if (!me) { localStorage.removeItem('sb-token'); localStorage.removeItem('sb-user');
      var _ri = new URLSearchParams(window.location.search).get('issue');
      if (_ri) localStorage.setItem('sb-return-issue', _ri);
      window.location.href = '/login.html'; return; }

    S.currentUser = me.id;
    S.currentUserObj = me;
    // First point the app knows who this is — tie the recording to them.
    if (typeof identifyHotjarUser === 'function') identifyHotjarUser(me);
    localStorage.setItem('sb-user', JSON.stringify(me));
    // Apply DB-stored theme preference
    applyTheme('light', false);

    var data = await api('/api/data');
    S.data = data;

    // Update sidebar user footer
    renderUserFooter(me);
    renderTopbarProfile(me);

    renderSidebar();
    // navigateTo home handled below after issue param check
    loadNotifications();

    $('loadingOverlay').setAttribute('hidden', '');
    $('app').removeAttribute('hidden');

    // If opened via issue link (?issue=ID), show as full-page Jira-style view
    // Check for return issue after login
    var _returnIssue = localStorage.getItem('sb-return-issue');
    if (_returnIssue) {
      localStorage.removeItem('sb-return-issue');
      if (!new URLSearchParams(window.location.search).get('issue')) {
        window.history.replaceState({}, '', '/?issue=' + encodeURIComponent(_returnIssue));
      }
    }
    var issueParam = new URLSearchParams(window.location.search).get('issue');
    if (!issueParam) {
      var restoredNav = applyRouteFromUrl({ replaceUrl: true });
      if (!restoredNav) {
        try {
          var savedNav = JSON.parse(localStorage.getItem('sb-last-nav') || 'null');
          if (savedNav) {
            if (savedNav.yourWorkTab) S.yourWorkTab = savedNav.yourWorkTab;
            if (savedNav.view === 'space' && savedNav.spaceId && getSpace(savedNav.spaceId)) {
              var wantTab = savedNav.tab || 'summary';
              if ((wantTab === 'reports' || wantTab === 'space-settings') && !canManageSpace(savedNav.spaceId)) {
                wantTab = 'summary';
              }
              navigateToSpace(savedNav.spaceId, wantTab, { replaceUrl: true });
              restoredNav = true;
            } else if (['home','yourwork','spaces','worklog-report','product-roadmap','settings','global-reports'].indexOf(savedNav.view) !== -1) {
              if (savedNav.view === 'global-reports' && !canViewReports()) {
                navigateTo('home', { replaceUrl: true });
              } else if ((savedNav.view === 'worklog-report' || savedNav.view === 'product-roadmap') && !isOrgAdminUser()) {
                navigateTo('home', { replaceUrl: true });
              } else {
                navigateTo(savedNav.view, { replaceUrl: true });
              }
              restoredNav = true;
            }
          }
        } catch (_) {}
      }
      if (!restoredNav) navigateTo('home', { replaceUrl: true });
    }
    if (issueParam) {
      // Resolve key to UUID (e.g. BRT-76 -> UUID)
      // First try local data
      var issueByKey = (S.data && S.data.issues || []).find(function(i){ return i.key === issueParam || i.id === issueParam; });
      if (issueByKey) {
        issueParam = issueByKey.id;
      } else {
        // Fetch from API by key
        try {
          var keyIssue = await api('/api/issues?key=' + encodeURIComponent(issueParam));
          if (keyIssue && keyIssue.id) issueParam = keyIssue.id;
        } catch(e) {}
      }
      // If issueParam still looks like a key, fetch UUID first
      if (issueParam && /^[A-Z]+-\d+$/.test(issueParam)) {
        try {
          var ki = await api('/api/issues?key=' + encodeURIComponent(issueParam));
          if (ki && ki.id) issueParam = ki.id;
        } catch(e) {}
      }
      document.body.classList.add('issue-page');
      $('app').removeAttribute('hidden');
      // Uncollapse sidebar so it's always visible on issue pages
      var sb = $('sidebar');
      if (sb) sb.classList.remove('collapsed');
      setTimeout(async function() {
        // Fetch issue first to get its space, then highlight correct space in sidebar
        try {
          var iss = await api('/api/issues/' + issueParam);
          if (iss && iss.space_id) {
            // Set sidebar state without triggering _exitIssuePage
            // Save prev before overwriting (in case not already saved)
            if (S._prevTab === undefined || S._prevTab === null) S._prevTab = S.currentTab;
            if (S._prevView === undefined || S._prevView === null) S._prevView = S.currentView;
            if (S._prevSpace === undefined || S._prevSpace === null) S._prevSpace = S.currentSpace;
            S.currentSpace = iss.space_id;
            S.currentView = 'space';
            // &from=<tab-slug> (set by openIssuePage when the ticket was
            // originally opened) survives a hard refresh; without it there was
            // no way to recover which tab this was opened from, so it always
            // fell back to Backlog even for a ticket opened from All Work.
            var fromSlug = new URLSearchParams(window.location.search).get('from');
            var bootTab = SPACE_SLUG_TO_TAB[fromSlug] || 'backlog';
            S.currentTab = bootTab;
            var space = getSpace(iss.space_id);
            if (space) {
              // mountSpaceSubnav (not just toggling .active) so the sidebar's
              // Summary/Backlog/Active Sprint/etc submenu actually exists in the
              // DOM. Without it, S.currentSpace/currentView already claimed
              // "in this space" while the subnav was never inserted, so the
              // next real click on this space item saw "already there" and
              // toggled it CLOSED (navigateTo('home')) instead of opening it —
              // the reported "needs a second click to open" bug.
              mountSpaceSubnav(iss.space_id, bootTab);
              qsa('.nav-item[data-tab]').forEach(function(el) {
                el.classList.toggle('active', el.dataset.tab === bootTab);
              });
            }
          }
        } catch(_) {}
        // openIssuePage normally wires this button's onclick -- this boot path
        // calls openDrawer directly (the URL is already the deep link, nothing
        // to push), so it has to be wired here too or the button is dead.
        var bootBackBtn = $('drawerBackBtn');
        if (bootBackBtn) {
          if (S.currentTab === 'allwork') {
            bootBackBtn.onclick = function () { closeIssueFromAllWork(); };
          } else {
            bootBackBtn.onclick = function () { goBackFromIssue(); };
          }
        }
        openDrawer(issueParam);
        setTimeout(function() {
          var key = $('drawerKey') && $('drawerKey').textContent;
          var title = getDrawerTitleValue();
          if (key || title) document.title = (key ? key + ' · ' : '') + (title || 'Issue') + ' — SprintBoard';
        }, 400);
      }, 100);
    }
  } catch (e) {
    $('loadingOverlay').setAttribute('hidden', '');
    $('errorMsg').textContent = e.message || 'Failed to load data';
    $('errorOverlay').removeAttribute('hidden');
  }
}

function renderTopbarProfile(user) {
  if (!user) return;
  var color = user.color || '#0129AC';
  var isAdmin = user.role === 'admin' || user.role === 'owner';

  // Avatar button
  var btn = $('topbarProfileBtn');
  var av1 = $('topbarProfileAvatar');
  var av2 = $('topbarProfileAv2');
  var nameEl = $('topbarProfileName');
  var emailEl = $('topbarProfileEmail');
  if (!btn) return;

  if (user.avatar_url) {
    btn.innerHTML = '<img src="' + esc(user.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    if (av2) av2.innerHTML = '<img src="' + esc(user.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  } else {
    var ini = initials(user.name);
    btn.style.background = color;
    btn.style.color = '#fff';
    btn.innerHTML = '<span style="font-size:13px;font-weight:700">' + ini + '</span>';
    if (av2) { av2.textContent = ini; av2.style.background = color; }
  }
  if (nameEl) nameEl.textContent = user.name;
  if (emailEl) emailEl.textContent = user.email || '';

  // Hide Admin Settings if not admin/owner
  var adminBtn = $('topbarAdminSettingsBtn');
  if (adminBtn) adminBtn.style.display = isAdmin ? '' : 'none';

  // Toggle dropdown (onclick replaced each render — no stack)
  btn.onclick = function(e) {
    e.stopPropagation();
    var menu = $('topbarProfileMenu');
    if (menu) menu.hidden = !menu.hidden;
  };

  if (!window._topbarProfileOutsideBound) {
    window._topbarProfileOutsideBound = true;
    document.addEventListener('click', function(e) {
      var menu = $('topbarProfileMenu');
      var wrap = $('topbarProfileWrap');
      if (menu && !menu.hidden && wrap && !wrap.contains(e.target)) menu.hidden = true;
    });
  }

  window._topbarProfileAction = function(action) {
    var menu = $('topbarProfileMenu');
    if (menu) menu.hidden = true;
    if (action === 'settings') navigateTo('settings');
    else if (action === 'profile') openProfileSettingsModal();
    else if (action === 'logout') doLogout();
  };
}

function formatOrgRoleLabel(role) {
  var r = (role || 'member').toLowerCase();
  if (r === 'owner' || r === 'admin') return 'Admin';
  return 'Member';
}

function normalizeSpaceRole(role) {
  if (!role) return 'member';
  var r = String(role).toLowerCase();
  if (r === 'site_admin' || r === 'manager' || r === 'owner' || r === 'admin') return 'site_admin';
  return 'member';
}

function formatSpaceRoleLabel(role) {
  return normalizeSpaceRole(role) === 'site_admin' ? 'Space Admin' : 'Member';
}

function isOrgAdminUser(user) {
  user = user || S.currentUserObj || {};
  var r = (user.role || 'member').toLowerCase();
  return r === 'owner' || r === 'admin';
}

function orgRoleBadgeHtml(role, opts) {
  opts = opts || {};
  var r = (role || 'member').toLowerCase();
  var label = formatOrgRoleLabel(r);
  var isAdmin = r === 'owner' || r === 'admin';
  var style = 'font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 10px;border-radius:20px;display:inline-block';
  if (opts.compact) style += ';font-size:9px;padding:2px 8px';
  if (opts.dark) {
    if (isAdmin) style += ';background:rgba(219,234,254,0.18);color:#93c5fd;border:1px solid rgba(147,197,253,0.35)';
    else style += ';background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.2)';
  } else if (isAdmin) style += ';background:#dbeafe;color:#1e40af;border:1px solid #93c5fd';
  else style += ';background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe';
  return '<span style="' + style + '" title="Organization role">' + esc(label) + '</span>';
}

function spaceRoleBadgeHtml(role) {
  if (!role) return '';
  var label = formatSpaceRoleLabel(role);
  var isAdmin = normalizeSpaceRole(role) === 'site_admin';
  var style = 'font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 10px;border-radius:20px;display:inline-block;';
  style += isAdmin
    ? 'background:#ecfdf5;color:#047857;border:1px solid #6ee7b7'
    : 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1';
  return '<span style="' + style + '" title="Space role in current space">' + esc(label) + '</span>';
}

function openProfileSettingsModal() {
  var user = S.currentUserObj || {};
  var nameParts = (user.name || '').split(' ');
  var firstName = nameParts[0] || '';
  var lastName = nameParts.slice(1).join(' ') || '';
  var color = user.color || '#0129AC';
  var spaceRole = S.currentSpace ? getMySpaceRole(S.currentSpace) : null;
  var currentSpace = S.currentSpace && (S.data.spaces || []).find(function (s) { return s.id === S.currentSpace; });
  var av = user.avatar_url
    ? '<img src="' + esc(user.avatar_url) + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover">'
    : '<div style="width:64px;height:64px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff">' + initials(user.name) + '</div>';

  var overlay = document.createElement('div');
  overlay.id = '_profileSettingsOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.2);overflow:hidden">' +
      // Header
      '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">' +
        '<div>' +
          '<div style="font-size:17px;font-weight:700;color:#0f172a">Profile Settings</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:2px">Update your personal information</div>' +
        '</div>' +
        '<button id="_profileModalClose" style="width:30px;height:30px;border:none;background:#f1f5f9;border-radius:8px;cursor:pointer;font-size:16px;color:#64748b;display:flex;align-items:center;justify-content:center">&times;</button>' +
      '</div>' +
      // Avatar
      '<div style="padding:24px 24px 0;display:flex;align-items:center;gap:16px">' +
        '<div>' + av + '</div>' +
        '<div>' +
          '<div style="font-size:14px;font-weight:600;color:#0f172a">' + esc(user.name || '') + '</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(user.email || '') + '</div>' +
          '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
            orgRoleBadgeHtml(user.role) +
            (spaceRole ? spaceRoleBadgeHtml(spaceRole) : '') +
            (currentSpace ? '<span style="font-size:10px;color:#94a3b8">· ' + esc(currentSpace.name) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      // Form
      '<div style="padding:20px 24px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div>' +
            '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">First Name</label>' +
            '<input id="_profFirstName" value="' + esc(firstName) + '" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'#0129AC\'" onblur="this.style.borderColor=\'#e2e8f0\'">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Last Name</label>' +
            '<input id="_profLastName" value="' + esc(lastName) + '" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'#0129AC\'" onblur="this.style.borderColor=\'#e2e8f0\'">' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:20px">' +
          '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Email Address</label>' +
          '<div style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;background:#f8fafc;box-sizing:border-box;cursor:default;user-select:all">' + esc(user.email || '') + '</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:5px">Email is managed by your organization and cannot be changed here.</div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button id="_profileCancelBtn" style="padding:9px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>' +
          '<button id="_profileSaveBtn" style="padding:9px 24px;border:none;border-radius:8px;background:#0129AC;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Save Changes</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  var close = function() { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_profileModalClose').onclick = close;
  overlay.querySelector('#_profileCancelBtn').onclick = close;
  overlay.onclick = function(e) { if (e.target === overlay) close(); };

  overlay.querySelector('#_profileSaveBtn').onclick = async function() {
    var fn = overlay.querySelector('#_profFirstName').value.trim();
    var ln = overlay.querySelector('#_profLastName').value.trim();
    var fullName = (fn + ' ' + ln).trim();
    if (!fullName) { toast('Name is required', 'error'); return; }
    var saveBtn = overlay.querySelector('#_profileSaveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      var updated = await api('/api/users/' + user.id, 'PUT', { name: fullName });
      // Update local state
      if (S.currentUserObj) { S.currentUserObj.name = updated.name; }
      if (S.data && S.data.users) {
        var idx = S.data.users.findIndex(function(u){ return u.id === user.id; });
        if (idx !== -1) { S.data.users[idx].name = updated.name; }
      }
      renderTopbarProfile(S.currentUserObj);
      close();
      toast('Profile updated successfully', 'success');
    } catch(e) {
      toast('Failed to save: ' + (e.message || 'Unknown error'), 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
    }
  };
}

function renderUserFooter(user) {
  var footer = $('sidebarUserFooter');
  if (!footer || !user) return;
  var isAdmin = user.role === 'admin' || user.role === 'owner';
  var color = user.color || '#6366f1';
  var av = user.avatar_url
    ? '<img src="' + esc(user.avatar_url) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.2)" />'
    : '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;border:2px solid rgba(255,255,255,0.2);flex-shrink:0">' + initials(user.name) + '</div>';
  var roleBadge = orgRoleBadgeHtml(user.role, { compact: true, dark: true });
  footer.innerHTML =
    '<div style="border-top:1px solid rgba(255,255,255,0.08);padding:10px 12px 8px;display:flex;align-items:center;gap:10px;min-width:0">' +
      av +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3">' + esc(user.name) + '</div>' +
        '<div style="margin-top:3px">' + roleBadge + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:2px;flex-shrink:0">' +
        (isAdmin ? '<button onclick="navigateTo(\'settings\')" title="Admin Settings" style="width:30px;height:30px;border:none;background:rgba(255,255,255,0.08);border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);transition:background .15s" onmouseover="this.style.background=\'rgba(255,255,255,0.18)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.08)\'">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
        '</button>' : '') +
        '<button onclick="doLogout()" title="Logout" style="width:30px;height:30px;border:none;background:rgba(255,255,255,0.08);border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);transition:background .15s" onmouseover="this.style.background=\'rgba(220,38,38,0.35)\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'rgba(255,255,255,0.08)\';this.style.color=\'rgba(255,255,255,0.7)\'">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
}

async function doLogout() {
  try { await api('/api/auth/logout', 'POST'); } catch (_) {}
  localStorage.removeItem('sb-token');
  localStorage.removeItem('sb-user');
  // Redirect to Microsoft logout so it remembers the account for next login
  var user = null;
  try { user = JSON.parse(localStorage.getItem('sb-user') || 'null'); } catch(_) {}
  window.location.href = '/login.html';
}
window.doLogout = doLogout;

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function _closeIssueDrawer() {
  document.body.classList.remove('issue-page');
  var drawer = $('issueDrawer');
  if (drawer) drawer.setAttribute('hidden', '');
  S.drawerIssueId = null;
  window._currentIssueKey = null;
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
    case 'summary': renderSummary(); break;
    case 'backlog': renderBacklog(); break;
    case 'sprint': renderSprintBoard(); break;
    case 'reports': renderReports(); break;
    case 'mbr': renderMBR(); break;
    case 'allwork': (async function() {
      // Skip full refresh if data was loaded within last 30s for this space
      var now = Date.now();
      if (!S._dataLoadedAt || (now - S._dataLoadedAt) > 30000 || S._dataLoadedSpace !== S.currentSpace) {
        await refreshData();
        S._dataLoadedAt = now;
        S._dataLoadedSpace = S.currentSpace;
      }
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
          return '<a class="nav-item starred-issue-item" href="/?issue=' + encodeURIComponent(issueKeyStr(iss)) + '" data-issue-id="' + esc(iss.id) + '" title="' + esc(iss.title) + '">' +
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

// ═══════════════════════════════════════════════════════════
// SPACE HEADER
// ═══════════════════════════════════════════════════════════
function renderSpaceHeader(space) {
  $('spaceIcon').textContent = space.icon || '\uD83D\uDCC1';
  $('spaceName').textContent = space.name;
  $('spaceKey').textContent = space.key;
}

function countAssignedPlusReported(data) {
  if (!data) return 0;
  var ids = {};
  (data.assigned || []).forEach(function (i) { ids[i.id] = true; });
  (data.reported || []).forEach(function (i) { ids[i.id] = true; });
  return Object.keys(ids).length;
}

function countOpenAssignedIssues(data) {
  if (!data) return 0;
  return (data.assigned || []).filter(function (i) { return i.status !== 'Done'; }).length;
}

function getOpenAssignedCountLocal() {
  return getVisibleIssues().filter(function (i) {
    return i.assignee_id == S.currentUser && i.status !== 'Done';
  }).length;
}

function getMyIssueCountFromLocalData() {
  var ids = {};
  getVisibleIssues().forEach(function (i) {
    if (i.assignee_id == S.currentUser || i.reporter_id == S.currentUser) ids[i.id] = true;
  });
  return Object.keys(ids).length;
}

// Tickets ASSIGNED to me — the set every dashboard tile from Total Tickets
// through Closed Tickets is measured against. Reported-by-me is deliberately
// excluded: these tiles describe the user's own workload, and mixing in tickets
// they merely raised for someone else inflated the totals.
// Prefers the /api/my-issues cache, falling back to the locally loaded issues
// before it arrives. Returned as a list so the status tiles break down exactly
// the same set and therefore always sum to Total.
function getMyDashboardIssues() {
  if (_ywCache) return (_ywCache.assigned || []).slice();
  return getVisibleIssues().filter(function (i) { return i.assignee_id == S.currentUser; });
}

// Status groups for the dashboard tiles. "Active" is deliberately both
// In Progress and In Review — work that has been picked up but isn't finished.
var DASH_STATUS_GROUPS = {
  open:    ['To Do'],
  active:  ['In Progress', 'In Review'],
  blocked: ['Blocked'],
  closed:  ['Done']
};

function countMyIssuesByStatusGroup(list, group) {
  var wanted = DASH_STATUS_GROUPS[group] || [];
  return (list || []).filter(function (i) { return wanted.indexOf(i.status) >= 0; }).length;
}

function formatDashboardActivity(row) {
  if (!row) return 'updated an issue';
  if (row.activity_type === 'created' || row.field_name === 'created') return 'created';
  var field = row.field_name || '';
  if (field === 'status') return 'changed status to ' + (row.new_value || '');
  if (field === 'priority') return 'changed priority to ' + (row.new_value || '');
  if (field === 'assignee_id') return 'changed assignee';
  if (field === 'title') return 'updated title';
  if (field === 'description' || field === 'fix_description') return 'updated description';
  if (field === 'sprint_id') return 'moved sprint';
  if (field) return 'updated ' + field.replace(/_/g, ' ');
  return 'updated an issue';
}

// ═══════════════════════════════════════════════════════════
// HOME VIEW — LUXURY
// ═══════════════════════════════════════════════════════════
function renderHome() {
  var allSpaces = (S.data.spaces || []).filter(function (s) { return !s.is_archived; });
  var spaces = canCreateSpace() ? allSpaces : allSpaces.filter(function(s) {
    return (S.data.space_members || []).some(function(m) {
      return m.space_id === s.id && m.user_id === S.currentUser;
    });
  });
  var allIssues = getVisibleIssues();
  // One list drives Total Tickets and all four status tiles, so they reconcile.
  var myDashIssues = getMyDashboardIssues();
  var myIssues = allIssues.filter(function (i) { return i.assignee_id == S.currentUser && i.status !== 'Done'; });
  var recentlyViewed24h = getRecentlyViewedIssues(RECENT_VIEWED_24H_MS);

  // Hero greeting
  var hour = new Date().getHours();
  var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  var me = S.currentUserObj;
  var firstName = me && me.name ? me.name.split(' ')[0] : 'there';
  var greetEl = $('dbGreeting'); if (greetEl) greetEl.textContent = 'Hello,';
  var fullName = me && me.name ? me.name : 'there';
  var nameEl = $('dbUserName'); if (nameEl) nameEl.textContent = fullName;
  var heroAv = $('dbHeroAvatar');
  if (heroAv && me) {
    if (me.avatar_url) {
      heroAv.innerHTML = '<img src="' + esc(me.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else {
      heroAv.style.background = me.color || 'rgba(255,255,255,0.18)';
      heroAv.textContent = initials(me.name);
    }
  }

  // Stat cards
  function dbStat(label, value, color, rgb, svgPath, onclick, valueId) {
    var click = onclick ? ' onclick="' + onclick + '" style="--db-stat-color:' + color + ';--db-stat-rgb:' + rgb + ';cursor:pointer"' : ' style="--db-stat-color:' + color + ';--db-stat-rgb:' + rgb + '"';
    var valAttr = valueId ? ' id="' + valueId + '"' : '';
    return '<div class="db-stat"' + click + '>' +
      '<div class="db-stat-icon"><svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">' + svgPath + '</svg></div>' +
      '<div class="db-stat-body"><div class="db-stat-value"' + valAttr + '>' + value + '</div><div class="db-stat-label">' + label + '</div></div>' +
      '</div>';
  }
  $('homeStats').innerHTML =
    dbStat('Spaces', spaces.length, '#0129ac', '23,79,150',
      '<path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>',
      'navigateTo(\'spaces\')') +
    dbStat('Total Tickets', myDashIssues.length, '#6366f1', '99,102,241',
      '<path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zM3 5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8zm0 2.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5z"/>',
      'navigateToYourWork(\'assigned\')', 'dbMyIssuesStat') +
    // Status breakdown of the same set Total Tickets counts, so the four add up
    // to it: To Do / In Progress+In Review / Blocked / Done.
    dbStat('Open Issues', countMyIssuesByStatusGroup(myDashIssues, 'open'), '#f59e0b', '245,158,11',
      '<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>',
      'navigateToMyWorkStatus(\'open\')', 'dbOpenIssuesStat') +
    dbStat('Active Tickets', countMyIssuesByStatusGroup(myDashIssues, 'active'), '#0052cc', '0,82,204',
      '<path d="M8 3.5a.5.5 0 0 1 .5.5v4l3 1.8a.5.5 0 0 1-.5.86l-3.25-1.95A.5.5 0 0 1 7.5 8.3V4a.5.5 0 0 1 .5-.5z"/><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zm0-1A7 7 0 1 0 8 1a7 7 0 0 0 0 14z"/>',
      'navigateToMyWorkStatus(\'active\')', 'dbActiveIssuesStat') +
    dbStat('Blocked Tickets', countMyIssuesByStatusGroup(myDashIssues, 'blocked'), '#dc2626', '220,38,38',
      '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM3.3 4.02 11.98 12.7A7 7 0 0 1 3.3 4.02zm1.42-.71a7 7 0 0 1 8.68 8.68L4.72 3.3z"/>',
      'navigateToMyWorkStatus(\'blocked\')', 'dbBlockedIssuesStat') +
    dbStat('Closed Tickets', countMyIssuesByStatusGroup(myDashIssues, 'closed'), '#10b981', '16,185,129',
      '<path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l1.094 1.093 3.473-4.425z"/><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16zm0-1A7 7 0 1 0 8 1a7 7 0 0 0 0 14z"/>',
      'navigateToMyWorkStatus(\'closed\')', 'dbClosedIssuesStat') +
    dbStat('Recently Viewed', recentlyViewed24h.length, '#8b5cf6', '139,92,246',
      '<path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>',
      'navigateToYourWorkRecent()');

  // My Issues
  var badge = $('myIssuesBadge');
  if (badge) { badge.textContent = myIssues.length; badge.className = 'db-panel-badge' + (myIssues.length ? ' show' : ''); }
  var myHtml = '';
  if (myIssues.length) {
    var toShow = myIssues.slice(0, 8);
    for (var i = 0; i < toShow.length; i++) {
      var issue = toShow[i];
      myHtml += '<div class="db-issue-row" onclick="openIssuePage(\'' + issue.id + '\')">' +
        '<span class="db-issue-row-key">' + esc(issueKeyStr(issue)) + '</span>' +
        '<span class="db-issue-row-title">' + esc(issue.title) + '</span>' +
        statusBadge(issue.status, true) +
        priorityBadge(issue.priority, true) +
        '</div>';
    }
  } else {
    myHtml = '<div class="db-issue-empty">' +
      '<svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/></svg>' +
      'No issues assigned to you</div>';
  }
  $('myIssues').innerHTML = myHtml;

  renderHomeRecentSection();

  api('/api/my-issues', 'GET', null, { silent: true }).then(function (data) {
    _ywCache = data;
    if (S.currentView !== 'home') return;
    // Same refresh as refreshDashboardIssueStats: recompute every tile from the
    // now-cached assigned set rather than leaving them on fallback numbers.
    var fresh = getMyDashboardIssues();
    var el = $('dbMyIssuesStat');
    if (el) el.textContent = fresh.length;
    [['dbOpenIssuesStat', 'open'], ['dbActiveIssuesStat', 'active'],
     ['dbBlockedIssuesStat', 'blocked'], ['dbClosedIssuesStat', 'closed']]
      .forEach(function (pair) {
        var tile = $(pair[0]);
        if (tile) tile.textContent = countMyIssuesByStatusGroup(fresh, pair[1]);
      });
  }).catch(function () {});
}

function renderHomeRecentSection() {
  var el = $('recentActivity');
  if (!el) return;
  el.innerHTML = '<div class="db-issue-empty">Loading team activity…</div>';
  api('/api/dashboard/activity?hours=24&limit=30', 'GET', null, { silent: true }).then(function (rows) {
    if (S.currentView !== 'home') return;
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="db-issue-empty">No activity in your spaces in the last 24 hours</div>';
      return;
    }
    var actHtml = '';
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var user = { name: row.user_name, color: row.user_color, id: row.user_id };
      var actionText = formatDashboardActivity(row);
      var who = (row.user_id && row.user_id === S.currentUser) ? 'You' : (row.user_name || 'Someone');
      actHtml += '<div class="db-act-row" onclick="openIssuePage(\'' + row.issue_id + '\')">' +
        avatarHtml(user, 30) +
        '<div class="db-act-body">' +
        '<div class="db-act-title"><strong>' + esc(who) + '</strong> ' + esc(actionText) +
        ' · <span class="db-act-key">' + esc(row.issue_key || '') + '</span> ' + esc(row.issue_title || '') + '</div>' +
        '<div class="db-act-time">' + relativeTime(row.created_at) +
        (row.space_name ? ' · ' + esc(row.space_name) : '') + '</div>' +
        '</div></div>';
    }
    el.innerHTML = actHtml;
  }).catch(function () {
    if (el && S.currentView === 'home') {
      el.innerHTML = '<div class="db-issue-empty">Team activity unavailable — refresh after restarting the server</div>';
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SPACES VIEW
// ═══════════════════════════════════════════════════════════
var _spacesViewQuery = '';

function renderSpacesView() {
  var allSpaces = (S.data.spaces || []).filter(function(s) { return !s.is_archived; });
  var isOwnerOrAdmin = canCreateSpace();
  var spaces = isOwnerOrAdmin ? allSpaces : allSpaces.filter(function(s) {
    return (S.data.space_members || []).some(function(m) {
      return m.space_id === s.id && m.user_id === S.currentUser;
    });
  });

  var countEl = $('spacesViewCount');
  if (countEl) countEl.textContent = spaces.length;

  // Wire create button to existing new-space flow
  var createBtn = $('spacesViewCreateBtn');
  if (createBtn) {
    createBtn.onclick = function() {
      var nb = $('newSpaceBtn'); if (nb) nb.click();
    };
    createBtn.style.display = isOwnerOrAdmin ? '' : 'none';
  }

  // Search filter
  window._filterSpacesView = function(q) {
    _spacesViewQuery = (q || '').toLowerCase();
    _drawSpacesGrid(spaces);
  };

  _drawSpacesGrid(spaces);
}

function _drawSpacesGrid(spaces) {
  var grid = $('spacesViewGrid');
  if (!grid) return;
  var q = _spacesViewQuery;
  var filtered = q ? spaces.filter(function(s) {
    return (s.name || '').toLowerCase().indexOf(q) !== -1 ||
           (s.key  || '').toLowerCase().indexOf(q) !== -1;
  }) : spaces;

  if (!filtered.length) {
    grid.innerHTML = '<p class="text-muted" style="font-size:14px;padding:32px 0">No spaces found.</p>';
    return;
  }
  var html = '';
  filtered.forEach(function(sp) {
    var color = sp.color || '#0129ac';
    var mems = getSpaceMembers(sp.id);
    var issCount = getSpaceIssues(sp.id).length;
    html += '<div class="db-space-card" style="--db-sc-color:' + color + '" onclick="navigateToSpace(\'' + sp.id + '\')">' +
      '<div class="db-sc-head">' +
      '<div class="db-sc-avatar" style="background:' + color + '">' + (sp.name ? sp.name.charAt(0).toUpperCase() : '?') + '</div>' +
      '<div class="db-sc-info"><div class="db-sc-name">' + esc(sp.name) + '</div><div class="db-sc-key">' + esc(sp.key) + '</div></div>' +
      '</div>' +
      '<div class="db-sc-desc">' + esc(sp.description || 'No description') + '</div>' +
      '<div class="db-sc-footer"><div class="db-sc-meta">' +
      '<span class="db-sc-stat"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/></svg> ' + mems.length + ' member' + (mems.length !== 1 ? 's' : '') + '</span>' +
      '<span class="db-sc-stat"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13z"/></svg> ' + issCount + ' issue' + (issCount !== 1 ? 's' : '') + '</span>' +
      '</div></div>' +
      '</div>';
  });
  grid.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// YOUR WORK VIEW
// ═══════════════════════════════════════════════════════════
var _ywCache = null; // { assigned, reported, recent }

var YW_FILTER_DEFS = {
  // status is a true fixed workflow (issue-state-machine.md) -- type/priority
  // are NOT: they're per-space configurable (migration 016), and Your Work
  // spans every space the user belongs to, so there's no single space to read
  // an option list from. Same "distinct values actually on tickets" approach
  // used for the All Work filters — see _ywGetTypeOrPriorityOpts below.
  status: {
    opts: [
      { v: 'To Do', l: 'To Do' }, { v: 'In Progress', l: 'In Progress' },
      { v: 'In Review', l: 'In Review' }, { v: 'Done', l: 'Done' }, { v: 'Blocked', l: 'Blocked' }
    ]
  }
};

function _ywGetTypeOrPriorityOpts(key, issues) {
  var seen = {};
  var opts = [];
  (issues || []).forEach(function (iss) {
    var v = iss[key];
    if (!v || seen[v]) return;
    seen[v] = true;
    opts.push({ v: v, l: cap(v) });
  });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

function _ywGetSpaceOpts(issues) {
  var seen = {};
  var opts = [];
  (issues || []).forEach(function (iss) {
    var id = iss.space_id;
    if (!id || seen[id]) return;
    seen[id] = true;
    opts.push({ v: id, l: iss.space_name || id });
  });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

// The project-key prefix of an issue key ("ENG-13" → "ENG"). Prefers the
// project_key the API joins in; falls back to trimming the trailing -N off the
// key itself for rows that don't carry it (e.g. locally-enriched
// recently-viewed entries).
function _ywIssueKeyPrefix(iss) {
  if (iss && iss.project_key) return String(iss.project_key).toUpperCase();
  var k = String(issueKeyStr(iss) || '');
  var m = k.match(/^(.+)-\d+$/);
  return (m ? m[1] : k).toUpperCase();
}

// Every space the user belongs to gets an option, whether or not they
// currently have a ticket in it — a member of 3 spaces with tickets in only 2
// still sees all 3 keys. Prefixes found on the issues themselves are unioned
// in afterwards so a visible row can never end up unfilterable (e.g. an
// admin assigned a ticket in a space they aren't a member of).
function _ywGetKeyOpts(issues) {
  var seen = {};
  var opts = [];
  var add = function (prefix, label) {
    if (!prefix || seen[prefix]) return;
    seen[prefix] = true;
    opts.push({ v: prefix, l: label || prefix });
  };
  getMyVisibleSpaceIds().forEach(function (sid) {
    var sp = getSpace(sid);
    if (!sp || sp.is_archived || !sp.key) return;
    add(String(sp.key).toUpperCase(), String(sp.key).toUpperCase());
  });
  (issues || []).forEach(function (iss) { add(_ywIssueKeyPrefix(iss)); });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

function _ywGetFilterOpts(key, issues) {
  if (key === 'space') return _ywGetSpaceOpts(issues);
  if (key === 'key') return _ywGetKeyOpts(issues);
  if (key === 'type' || key === 'priority') return _ywGetTypeOrPriorityOpts(key, issues);
  return (YW_FILTER_DEFS[key] && YW_FILTER_DEFS[key].opts) || [];
}

function _ywApplyFilters(issues) {
  var f = S.ywFilters || {};
  var search = ($('ywSearch') && $('ywSearch').value || '').toLowerCase().trim();
  var out = (issues || []).slice();
  if (search) {
    out = out.filter(function (i) {
      return (i.title || '').toLowerCase().indexOf(search) >= 0 ||
        String(issueKeyStr(i) || '').toLowerCase().indexOf(search) >= 0;
    });
  }
  if (f.key && f.key.length) {
    out = out.filter(function (i) { return f.key.indexOf(_ywIssueKeyPrefix(i)) >= 0; });
  }
  if (f.type && f.type.length) {
    out = out.filter(function (i) { return f.type.indexOf(i.type) >= 0; });
  }
  if (f.status && f.status.length) {
    out = out.filter(function (i) { return f.status.indexOf(i.status) >= 0; });
  }
  if (f.priority && f.priority.length) {
    out = out.filter(function (i) { return f.priority.indexOf(i.priority) >= 0; });
  }
  if (f.space && f.space.length) {
    out = out.filter(function (i) { return f.space.indexOf(i.space_id) >= 0; });
  }
  if (S.ywExcludeDone) {
    out = out.filter(function (i) { return i.status !== 'Done'; });
  }
  return out;
}

function _ywAnyFilterActive() {
  var f = S.ywFilters || {};
  return !!(
    S.ywExcludeDone ||
    ($('ywSearch') && $('ywSearch').value.trim()) ||
    (f.key && f.key.length) ||
    (f.type && f.type.length) || (f.status && f.status.length) ||
    (f.priority && f.priority.length) || (f.space && f.space.length)
  );
}

function _ywBuildFilterTh(key, label, issues) {
  var sel = (S.ywFilters[key] || []);
  var active = sel.length > 0 || (key === 'status' && S.ywExcludeDone);
  var opts = _ywGetFilterOpts(key, issues);
  var panel = opts.map(function (o) {
    var chk = sel.indexOf(o.v) >= 0 ? ' checked' : '';
    return '<label class="yw-filter-opt"><input type="checkbox" value="' + esc(String(o.v)) + '"' + chk +
      ' onchange="window._ywFilterCheck(\'' + key + '\',this)"> ' + esc(o.l) + '</label>';
  }).join('');
  if (!panel) panel = '<div class="yw-filter-opt" style="color:var(--text3);cursor:default">No options</div>';
  return '<th class="yw-th-filter">' +
    '<div class="yw-th-filter-wrap">' +
      '<span>' + esc(label) + '</span>' +
      '<button type="button" class="yw-filter-trigger' + (active ? ' active' : '') + '" onclick="window._ywToggleFilter(\'' + key + '\',event)" aria-label="Filter ' + esc(label) + '">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>' +
      '<div class="yw-filter-panel" id="yw-filter-' + key + '" hidden onclick="event.stopPropagation()">' + panel + '</div>' +
    '</div></th>';
}

window._ywToggleFilter = function (key, ev) {
  if (ev) ev.stopPropagation();
  var panel = $('yw-filter-' + key);
  if (!panel) return;
  var open = panel.hidden;
  document.querySelectorAll('.yw-filter-panel').forEach(function (p) { p.hidden = true; });
  panel.hidden = !open;
};

window._ywFilterCheck = function (key, cb) {
  var arr = S.ywFilters[key] || (S.ywFilters[key] = []);
  if (cb.checked) { if (arr.indexOf(cb.value) < 0) arr.push(cb.value); }
  else { var idx = arr.indexOf(cb.value); if (idx >= 0) arr.splice(idx, 1); }
  if (key === 'status') S.ywExcludeDone = false;
  var btn = document.querySelector('#yw-filter-' + key)?.closest('.yw-th-filter-wrap')?.querySelector('.yw-filter-trigger');
  if (btn) btn.classList.toggle('active', arr.length > 0 || (key === 'status' && S.ywExcludeDone));
  if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
  else renderYourWorkContent(_ywCache);
  if (S.currentView === 'yourwork' && S.yourWorkTab === 'assigned') syncAppUrl({ replace: true });
};

function _renderYourWorkTable(issues, rawIssues, lastColLabel) {
  lastColLabel = lastColLabel || 'Updated';
  if (lastColLabel === 'Viewed') {
    issues.sort(function (a, b) { return new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0); });
  } else {
    issues.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
  }
  var toolbarHtml = _ywAnyFilterActive()
    ? '<div class="yw-table-toolbar">' +
        '<button type="button" class="btn btn-outline btn-sm yw-clear-all-btn" onclick="window._ywClearFilters()">&#10005; Clear all</button>' +
      '</div>'
    : '';
  var html = '<div class="yw-table-wrap">' + toolbarHtml +
    '<table class="yw-table"><thead><tr>' +
    _ywBuildFilterTh('key', 'Key', rawIssues) +
    '<th>Title</th>' +
    _ywBuildFilterTh('type', 'Type', rawIssues) +
    _ywBuildFilterTh('status', 'Status', rawIssues) +
    _ywBuildFilterTh('priority', 'Priority', rawIssues) +
    _ywBuildFilterTh('space', 'Space', rawIssues) +
    '<th>' + esc(lastColLabel) + '</th>' +
    '</tr></thead><tbody>';
  if (!issues.length) {
    html += '<tr><td colspan="7" class="yw-empty-row">' +
      'No issues match your filters. ' +
      '<button type="button" class="btn btn-link btn-sm" onclick="window._ywClearFilters()">Clear filters</button>' +
      '</td></tr>';
  } else {
    for (var i = 0; i < issues.length; i++) {
      var iss = issues[i];
      var iid = iss.id;
      var timeVal = lastColLabel === 'Viewed' ? (iss.viewedAt || iss.updated_at) : iss.updated_at;
      html += '<tr onclick="openIssuePage(\'' + iid + '\')">' +
        '<td class="yw-key">' + esc(issueKeyStr(iss)) + '</td>' +
        '<td class="yw-title-cell">' + esc(iss.title) + '</td>' +
        '<td><span class="type-cell">' + typeIcon(iss.type) + '<span class="type-cell-label">' + cap(iss.type || '') + '</span></span></td>' +
        '<td onclick="event.stopPropagation();awInlineStatus(event,\'' + iid + '\',\'' + (iss.status||'') + '\')" style="cursor:pointer">' + statusBadge(iss.status) + '</td>' +
        '<td onclick="event.stopPropagation();awInlinePriority(event,\'' + iid + '\',\'' + (iss.priority||'') + '\')" style="cursor:pointer">' + priorityBadge(iss.priority) + '</td>' +
        '<td class="yw-space-cell">' + esc(iss.space_name || '') + '</td>' +
        '<td class="yw-time-cell">' + relativeTime(timeVal) + '</td></tr>';
    }
  }
  html += '</tbody></table></div>';
  return html;
}

function _updateYourWorkTabBadges(data) {
  if (!data) return;
  qsa('[data-yw-count]').forEach(function (el) {
    var key = el.dataset.ywCount;
    var n = key === 'assigned' ? (data.assigned || []).length
      : key === 'reported' ? (data.reported || []).length
      : 0;
    if (n > 0) {
      el.textContent = n;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  });
}

function renderYourWork() {
  if (!S.yourWorkTab) S.yourWorkTab = 'assigned';
  var tabs = qsa('.yw-tab');
  tabs.forEach(function (t) {
    var tab = t.dataset.yourworkTab;
    t.classList.toggle('active', tab === S.yourWorkTab);
    if (t.tagName === 'A' && tab) t.setAttribute('href', yourWorkPath(tab));
    t.onclick = function (e) {
      e.preventDefault();
      navigateToYourWork(t.dataset.yourworkTab);
    };
  });
  var staleRecentBadge = document.querySelector('.yw-tab[data-yourwork-tab="recent"] .yw-tab-badge');
  if (staleRecentBadge) staleRecentBadge.remove();
  $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
  if (S.yourWorkTab === 'recent') {
    if (_ywCache) _updateYourWorkTabBadges(_ywCache);
    renderYourWorkContent(_ywCache);
    return;
  }
  if (_ywCache) {
    _updateYourWorkTabBadges(_ywCache);
    renderYourWorkContent(_ywCache);
  }
  api('/api/my-issues').then(function (data) {
    _ywCache = data;
    _updateYourWorkTabBadges(data);
    renderYourWorkContent(data);
  }).catch(function (e) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>' +
      '<h3>Could not load issues</h3><p>Please refresh the page or restart the server.</p></div>';
  });
}

function renderYourWorkContent(data) {
  if (S.yourWorkTab === 'recent') {
    renderRecentlyViewedContent();
    return;
  }
  if (!data) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
    return;
  }
  var rawIssues;
  if (S.yourWorkTab === 'assigned') rawIssues = (data.assigned || []).slice();
  else if (S.yourWorkTab === 'reported') rawIssues = (data.reported || []).slice();
  else rawIssues = [];
  var issues = _ywApplyFilters(rawIssues);

  if (!rawIssues.length) {
    var emptyMsg = S.yourWorkTab === 'assigned'
      ? ['No issues assigned to you', 'Issues assigned to you will appear here.']
      : S.yourWorkTab === 'reported'
      ? ['No issues reported by you', 'Issues you create will appear here.']
      : ['No recent activity', 'Recently updated issues will appear here.'];
    $('yourWorkContent').innerHTML =
      '<div class="yw-empty">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>' +
      '<h3>' + emptyMsg[0] + '</h3><p>' + emptyMsg[1] + '</p></div>';
    return;
  }

  if (!issues.length) {
    $('yourWorkContent').innerHTML = _renderYourWorkTable([], rawIssues, 'Updated');
    return;
  }

  $('yourWorkContent').innerHTML = _renderYourWorkTable(issues, rawIssues, 'Updated');
}

function renderRecentlyViewedContent() {
  var container = $('yourWorkContent');
  if (!container) return;
  container.innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
  enrichRecentlyViewedIssues().then(function (rawIssues) {
    var issues = _ywApplyFilters(rawIssues);
    if (!rawIssues.length) {
      container.innerHTML =
        '<div class="yw-empty">' +
        '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>' +
        '<h3>No recently viewed issues</h3><p>Open any ticket from a space you belong to — it will appear here.</p></div>';
      return;
    }
    container.innerHTML = _renderYourWorkTable(issues, rawIssues, 'Viewed');
  });
}

window._ywClearFilters = function () {
  clearYourWorkFilters();
  if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
  else renderYourWorkContent(_ywCache);
  if (S.currentView === 'yourwork' && S.yourWorkTab === 'assigned') syncAppUrl({ replace: true });
};

// ═══════════════════════════════════════════════════════════
// WORK LOG REPORT
// ═══════════════════════════════════════════════════════════
var _wlrData = [];      // cached fetched rows
var _wlrGroup = 'user'; // active group-by

// selected filter state for worklog report
var _wlrSelSpaces = [];   // array of space IDs
var _wlrSelUsers  = [];   // array of user IDs

function _wlrBuildPanel(type) {
  var panel = $(type === 'space' ? 'wlrSpacePanel' : 'wlrUserPanel');
  if (!panel) return;
  var items = type === 'space'
    ? (S.data.spaces || []).filter(function(s){ return !s.is_archived; }).map(function(s){ return { id: s.id, label: s.name }; })
    : (S.data.users  || []).map(function(u){ return { id: u.id, label: u.name }; });
  var sel   = type === 'space' ? _wlrSelSpaces : _wlrSelUsers;
  var html  = '';
  if (type === 'user') {
    var meChk = sel.indexOf('__me__') >= 0 ? 'checked' : '';
    html += '<label class="aw-ms-option"><input type="checkbox" value="__me__" ' + meChk + ' onchange="window._wlrCheck(\'user\',this)"> My Logs Only</label>';
    html += '<div style="border-top:1px solid var(--border);margin:4px 0"></div>';
  }
  items.forEach(function(item) {
    var chk = sel.indexOf(item.id) >= 0 ? 'checked' : '';
    html += '<label class="aw-ms-option"><input type="checkbox" value="' + item.id + '" ' + chk + ' onchange="window._wlrCheck(\'' + type + '\',this)"> ' + esc(item.label) + '</label>';
  });
  panel.innerHTML = html;
}

function _wlrUpdateBadge(type) {
  var sel   = type === 'space' ? _wlrSelSpaces : _wlrSelUsers;
  var btn   = $(type === 'space' ? 'wlrSpaceBtn'  : 'wlrUserBtn');
  var badge = $(type === 'space' ? 'wlrSpaceCount' : 'wlrUserCount');
  var n = sel.length;
  if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  if (btn) btn.classList.toggle('active', n > 0);
  // Update button label prefix
  if (btn) {
    var labelText = type === 'space'
      ? (n === 0 ? 'All Spaces' : n === 1 ? ((S.data.spaces||[]).find(function(s){return s.id===sel[0];})||{name:sel[0]}).name : n + ' Spaces')
      : (n === 0 ? 'All Users'  : n === 1 ? ((S.data.users||[]).find(function(u){return u.id===sel[0];})||{name:sel[0]}).name  : n + ' Users');
    // Replace first text node
    var nodes = btn.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) { nodes[i].textContent = labelText + ' '; break; }
    }
  }
}

window._wlrCheck = function(type, cb) {
  var arr = type === 'space' ? _wlrSelSpaces : _wlrSelUsers;
  // "My Logs Only" is exclusive — uncheck all individual users if checked
  if (type === 'user' && cb.value === '__me__') {
    if (cb.checked) {
      _wlrSelUsers = ['__me__'];
      // uncheck all other boxes in the panel
      document.querySelectorAll('#wlrUserPanel input[type=checkbox]').forEach(function(el){
        if (el.value !== '__me__') el.checked = false;
      });
    } else {
      _wlrSelUsers = [];
    }
  } else {
    // If individual user selected, remove "__me__" from selection
    if (type === 'user') {
      var meIdx = _wlrSelUsers.indexOf('__me__');
      if (meIdx >= 0) {
        _wlrSelUsers.splice(meIdx, 1);
        var meBox = document.querySelector('#wlrUserPanel input[value="__me__"]');
        if (meBox) meBox.checked = false;
      }
    }
    var arr2 = type === 'space' ? _wlrSelSpaces : _wlrSelUsers;
    if (cb.checked) { if (arr2.indexOf(cb.value) < 0) arr2.push(cb.value); }
    else { var idx = arr2.indexOf(cb.value); if (idx >= 0) arr2.splice(idx, 1); }
  }
  _wlrUpdateBadge(type);
};

window._wlrToggle = function(type) {
  var panel = $(type === 'space' ? 'wlrSpacePanel' : 'wlrUserPanel');
  if (!panel) return;
  var isHidden = panel.hidden;
  // close all wlr panels first
  ['wlrSpacePanel','wlrUserPanel'].forEach(function(id){ var p=$(id); if(p) p.hidden=true; });
  if (isHidden) { _wlrBuildPanel(type); panel.hidden = false; }
};

// Close advanced filter dropdowns + wlr panels on outside click
document.addEventListener('click', function(e) {
  // Close adv filter multi-drops
  if (!e.target.closest('.aw-adv-val-wrap')) {
    document.querySelectorAll('.aw-adv-multi-drop').forEach(function(d){ d.style.display = 'none'; });
  }
  // Close "+ Add filters" drop
  if (!e.target.closest('#awAddFilterBtn') && !e.target.closest('#awAddDrop')) {
    var addDrop = $('awAddDrop'); if (addDrop) addDrop.style.display = 'none';
  }
  // Close column picker
  if (!e.target.closest('#awColBtn') && !e.target.closest('#awColDrop')) {
    var colDrop = $('awColDrop'); if (colDrop) colDrop.style.display = 'none';
  }
  if (!e.target.closest('.aw-ms-wrap') && !e.target.closest('#wlrSpacePanel') && !e.target.closest('#wlrUserPanel')) {
    ['wlrSpacePanel','wlrUserPanel'].forEach(function(id){ var p=$(id); if(p) p.hidden=true; });
  }
});

function renderWorklogReport() {
  // Default date range: current month (only set once)
  var wlrFrom = $('wlrFrom'), wlrTo = $('wlrTo');
  if (wlrFrom && !wlrFrom.value) {
    var now = new Date();
    wlrFrom.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
    var lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    wlrTo.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(lastDay).padStart(2,'0');
  }
  // Bind group-by buttons
  document.querySelectorAll('.wlr-gb-btn').forEach(function(btn) {
    btn.onclick = function() {
      _wlrGroup = btn.dataset.wlrGroup;
      document.querySelectorAll('.wlr-gb-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
      _wlrRender();
    };
  });
  // Bind filter controls
  window._wlrApply = function() { _wlrFetch(); };
  window._wlrClear = function() {
    var now = new Date();
    _wlrSelSpaces = []; _wlrSelUsers = [];
    _wlrUpdateBadge('space'); _wlrUpdateBadge('user');
    if ($('wlrBillable')) $('wlrBillable').value = '';
    if ($('wlrFrom')) $('wlrFrom').value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
    var lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    if ($('wlrTo')) $('wlrTo').value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(lastDay).padStart(2,'0');
    _wlrFetch();
  };
  _wlrFetch();
}

// ═══════════════════════════════════════════════════════════
//  PRODUCT ROADMAP  (DB-backed via /api/roadmap)
// ═══════════════════════════════════════════════════════════
var _prmView = 'timeline';   // 'timeline' | 'list' | 'board'
var _prmData = [];           // roadmap_items from DB
var _prmZoom = 'quarter';    // 'quarter' | 'month' | 'week'
var _prmNavAnchor = null;    // Date anchor for current view window (null = auto-today)

window._prmSetView = function(v) {
  _prmView = v;
  document.querySelectorAll('.prm-vt-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.prmView === v); });
  _prmRender();
};

function _prmGetAnchor() {
  if (_prmNavAnchor) return new Date(_prmNavAnchor.getTime());
  var today = new Date(); today.setHours(0,0,0,0);
  if (_prmZoom === 'quarter') return new Date(today.getFullYear(), 0, 1);
  if (_prmZoom === 'month')   return new Date(today.getFullYear(), today.getMonth() < 6 ? 0 : 6, 1);
  // week: align to 7-day blocks from Jan 1 of current year
  var jan1 = new Date(today.getFullYear(), 0, 1);
  var daysSinceJan1 = Math.floor((today - jan1) / 86400000);
  var weekBlock = Math.floor(daysSinceJan1 / 7);
  return new Date(jan1.getTime() + weekBlock * 7 * 86400000);
}

window._prmSetZoom = function(z) {
  _prmZoom = z;
  _prmNavAnchor = null; // reset to auto (today context)
  var sel = $('prmZoomSelect');
  if (sel && sel.value !== z) sel.value = z;
  _prmRender();
};

window._prmNavPrev = function() {
  _prmNavAnchor = _prmGetAnchor();
  if (_prmZoom === 'quarter') {
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear() - 1, 0, 1);
  } else if (_prmZoom === 'month') {
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear(), _prmNavAnchor.getMonth() - 6, 1);
  } else {
    // Week view: move back 1 month
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear(), _prmNavAnchor.getMonth() - 1, 1);
  }
  _prmRender();
};

window._prmNavNext = function() {
  _prmNavAnchor = _prmGetAnchor();
  if (_prmZoom === 'quarter') {
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear() + 1, 0, 1);
  } else if (_prmZoom === 'month') {
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear(), _prmNavAnchor.getMonth() + 6, 1);
  } else {
    // Week view: move forward 1 month
    _prmNavAnchor = new Date(_prmNavAnchor.getFullYear(), _prmNavAnchor.getMonth() + 1, 1);
  }
  _prmRender();
};

async function renderProductRoadmap() {
  var content = $('prmContent');
  if (content) content.innerHTML = '<p class="text-muted" style="padding:24px">Loading…</p>';
  // Populate space filter
  var spSel = $('prmFilterSpace');
  if (spSel) {
    var spaces = S.data.spaces || [];
    spSel.innerHTML = '<option value="">All Spaces</option>' +
      spaces.map(function(sp){ return '<option value="' + sp.id + '">' + esc(sp.name) + '</option>'; }).join('');
  }
  await _prmLoad();
}

// Load roadmap items from DB
window._prmLoad = async function() {
  var content = $('prmContent');
  if (content) content.innerHTML = '<p class="text-muted" style="padding:24px">Loading…</p>';
  try {
    var params = [];
    var spaceFilter = ($('prmFilterSpace') || {}).value || '';
    if (spaceFilter) params.push('space_id=' + encodeURIComponent(spaceFilter));
    var raw = await fetch('/api/roadmap' + (params.length ? '?' + params.join('&') : ''), {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('sb-token') || '') }
    });
    if (!raw.ok) {
      var errBody; try { errBody = await raw.json(); } catch(_) { errBody = {}; }
      throw new Error(errBody.error || ('HTTP ' + raw.status));
    }
    _prmData = await raw.json();
    // Load group/category colors from DB
    try {
      var colorsRes = await fetch('/api/roadmap/colors', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('sb-token') || '') } });
      if (colorsRes.ok) {
        var dbColors = await colorsRes.json();
        // Merge DB colors into localStorage cache for fast re-renders
        var lcColors = JSON.parse(localStorage.getItem('prm_gc_colors') || '{}');
        Object.assign(lcColors, dbColors);
        localStorage.setItem('prm_gc_colors', JSON.stringify(lcColors));
      }
    } catch(_) {}
    _prmPopulateYears();
    _prmRender();
  } catch(e) {
    console.error('[Roadmap] load error:', e);
    if (content) content.innerHTML =
      '<div style="padding:24px">' +
      '<p class="text-muted" style="margin-bottom:8px">⚠ Failed to load roadmap data.</p>' +
      '<p style="font-size:11px;color:var(--danger,#e74c3c);font-family:monospace">' + esc(e.message||String(e)) + '</p>' +
      '<p style="font-size:11px;color:var(--text3);margin-top:8px">Try restarting the server so the DB migration runs, then refresh.</p>' +
      '<button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="window._prmLoad()">↺ Retry</button>' +
      '</div>';
  }
};

function _prmPopulateYears() {
  var sel = $('prmFilterYear');
  if (!sel) return;
  var thisYear = new Date().getFullYear();
  // Collect years from data + always include current year ± 2
  var ySet = {};
  _prmData.forEach(function(r) {
    if (r.start_date) ySet[new Date(r.start_date).getFullYear()] = 1;
    if (r.end_date)   ySet[new Date(r.end_date).getFullYear()]   = 1;
  });
  for (var y = thisYear - 5; y <= thisYear + 10; y++) ySet[y] = 1;
  var years = Object.keys(ySet).map(Number).sort();
  var prev = sel.value;
  sel.innerHTML = '<option value="">All Years</option>' +
    years.map(function(y) {
      return '<option value="' + y + '">' + y + '</option>';
    }).join('');
  if (prev && ySet[prev]) sel.value = prev; // restore previous selection
}

window._prmRender = function() {
  var content = $('prmContent');
  if (!content) return;

  // Apply client-side filters
  var fStatus   = ($('prmFilterStatus')   || {}).value || '';
  var fPriority = ($('prmFilterPriority') || {}).value || '';
  var items = _prmData.filter(function(r) {
    if (fStatus   && r.status   !== fStatus)   return false;
    if (fPriority && r.priority !== fPriority) return false;
    return true;
  });

  // Update nav label to reflect current anchor (month+year for week view, year otherwise)
  var navLbl = $('prmNavLabel');
  if (navLbl) {
    var _anc = _prmGetAnchor();
    var _MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    navLbl.textContent = _prmZoom === 'week'
      ? _MN[_anc.getMonth()] + ' ' + _anc.getFullYear()
      : _anc.getFullYear();
  }

  if (!items.length) {
    content.innerHTML = '<div class="prm-empty"><p class="text-muted">No roadmap items found.</p>' +
      '<button class="btn btn-primary btn-sm" onclick="window._prmOpenModal()">＋ Add First Item</button></div>';
    return;
  }

  var groupBy = ($('prmGroupBy') || {}).value || 'status';

  if      (_prmView === 'list')     content.innerHTML = _prmListView(items, groupBy);
  else if (_prmView === 'board')    content.innerHTML = _prmBoardView(items);
  else                              content.innerHTML = _prmTimelineView(items, groupBy, _prmZoom);
};

// ── Helpers ──
function _prmStatusColor(status) {
  var m = { planned:'#95a5a6', 'in_progress':'var(--accent)', completed:'var(--success)', on_hold:'#e67e22' };
  return m[status] || '#95a5a6';
}
function _prmStatusLabel(s) {
  return { planned:'Planned', in_progress:'In Progress', completed:'Completed', on_hold:'On Hold' }[s] || s || '—';
}
function _prmPriorityBadge(p) {
  var c = { critical:'#e74c3c', high:'#e67e22', medium:'#3498db', low:'#95a5a6' };
  return p ? '<span class="prm-badge" style="background:' + (c[p]||'#95a5a6') + '">' + esc(p) + '</span>' : '';
}
function _prmGroup(items, groupBy) {
  var groups = {}, order = [];
  items.forEach(function(r) {
    var key = groupBy === 'space'    ? (r.space_name || 'No Space')
            : groupBy === 'priority' ? (r.priority   || 'No Priority')
            : groupBy === 'assigned' ? (r.assigned_name || 'Unassigned')
            : _prmStatusLabel(r.status);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  });
  order.sort();
  return { groups: groups, order: order };
}

// ── List View ──
function _prmListView(items, groupBy) {
  var g = _prmGroup(items, groupBy);
  var html = '<div class="prm-list">';
  g.order.forEach(function(gKey) {
    var rows = g.groups[gKey];
    html += '<div class="prm-list-group">' +
      '<div class="prm-list-group-hdr">▸ ' + esc(gKey) + ' <span class="prm-list-count">' + rows.length + ' items</span></div>' +
      '<table class="prm-list-table"><thead><tr>' +
        '<th>Title</th><th>Status</th><th>Priority</th><th>Space</th><th>Linked Issue</th>' +
        '<th>Start Date</th><th>End Date</th><th>Assignee</th><th></th>' +
      '</tr></thead><tbody>';
    rows.forEach(function(r) {
      html += '<tr class="prm-list-row">' +
        '<td class="prm-item-title" onclick="window._prmOpenModal(\'' + r.id + '\')">' +
          '<span class="prm-color-dot" style="background:' + esc(r.color||'#4d90e0') + '"></span>' + esc(r.title) + '</td>' +
        '<td><span class="prm-status-chip" style="background:' + _prmStatusColor(r.status) + '">' + esc(_prmStatusLabel(r.status)) + '</span></td>' +
        '<td>' + _prmPriorityBadge(r.priority) + '</td>' +
        '<td class="text-muted">' + esc(r.space_name||'—') + '</td>' +
        '<td>' + (r.issue_key ? '<span class="prm-issue-key" onclick="openIssuePage(\'' + r.issue_id + '\')">' + esc(r.issue_key) + '</span>' : '<span class="text-muted">—</span>') + '</td>' +
        '<td class="text-muted">' + esc(r.start_date ? r.start_date.slice(0,10) : '—') + '</td>' +
        '<td class="text-muted">' + esc(r.end_date   ? r.end_date.slice(0,10)   : '—') + '</td>' +
        '<td class="text-muted">' + esc(r.assigned_name||'—') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-icon prm-edit-btn" onclick="window._prmOpenModal(\'' + r.id + '\')" title="Edit">✏</button>' +
          '<button class="btn-icon prm-del-btn"  onclick="window._prmDelete(\'' + r.id + '\')" title="Delete">🗑</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  });
  return html + '</div>';
}

// ── Board (Kanban) View ──
function _prmBoardView(items) {
  var cols = [
    { key:'planned',     label:'Planned',     icon:'', accent:'#607D8B' },
    { key:'in_progress', label:'In Progress', icon:'', accent:'#2196F3' },
    { key:'on_hold',     label:'On Hold',     icon:'', accent:'#FF9800' },
    { key:'completed',   label:'Completed',   icon:'', accent:'#4CAF50' }
  ];
  var html = '<div class="prm-board">';
  cols.forEach(function(col) {
    var colItems = items.filter(function(r){ return (r.status||'planned') === col.key; });
    html += '<div class="prm-board-col">' +
      '<div class="prm-board-col-hdr" style="border-top:3px solid ' + col.accent + ';background:' + col.accent + '14">' +
        '<span style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:15px">' + col.icon + '</span>' +
          '<span style="font-size:12px;font-weight:700;color:var(--text)">' + esc(col.label) + '</span>' +
        '</span>' +
        '<span class="prm-board-col-count" style="background:' + col.accent + '">' + colItems.length + '</span>' +
      '</div><div class="prm-board-col-body">';
    if (!colItems.length) {
      html += '<div class="prm-board-empty">No items</div>';
    }
    colItems.forEach(function(r) {
      var initials = (r.assigned_name || '').split(' ').map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase() || '?';
      html += '<div class="prm-board-card" onclick="window._prmOpenModal(\'' + r.id + '\')">' +
        '<div class="prm-bc-color-bar" style="background:' + esc(r.color||col.accent) + '"></div>' +
        '<div class="prm-bc-body">' +
          '<div class="prm-bc-title">' + esc(r.title) + '</div>' +
          (r.description ? '<div class="prm-bc-desc">' + esc(r.description.slice(0,100)) + '</div>' : '') +
          '<div class="prm-bc-footer">' +
            _prmPriorityBadge(r.priority) +
            (r.space_name ? '<span class="prm-bc-space">' + esc(r.space_name) + '</span>' : '') +
            (r.assigned_name
              ? '<span class="prm-bc-avatar" title="' + esc(r.assigned_name) + '">' + esc(initials) + '</span>'
              : '') +
          '</div>' +
          (r.start_date || r.end_date
            ? '<div class="prm-bc-dates">📅 ' + esc((r.start_date||'—').slice(0,10)) + ' → ' + esc((r.end_date||'—').slice(0,10)) + '</div>'
            : '') +
        '</div></div>';
    });
    html += '</div>' +
      '<button class="prm-board-add" onclick="window._prmOpenModal(null,\'' + col.key + '\')">＋ Add item</button>' +
      '</div>';
  });
  return html + '</div>';
}

// ── Timeline (Gantt) View — Swim-lane style ──
function _prmTimelineView(items, groupBy, zoom) {
  var today = new Date(); today.setHours(0,0,0,0);
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var anchor = _prmGetAnchor();

  // ── Build columns array based on zoom mode ──
  var columns = []; // each: { start, end, label, year, month, isWeek? }

  if (zoom === 'week') {
    // 12 weekly columns of 7 days each starting from anchor
    for (var wi = 0; wi < 12; wi++) {
      var wStart = new Date(anchor.getTime() + wi * 7 * 86400000);
      var wEnd   = new Date(wStart.getTime() + 7 * 86400000);
      var wS = MONTH_NAMES[wStart.getMonth()] + ' ' + wStart.getDate();
      var wE = (wStart.getMonth() !== new Date(wEnd.getTime() - 1).getMonth()
                ? MONTH_NAMES[new Date(wEnd.getTime()-1).getMonth()] + ' ' : '') +
               new Date(wEnd.getTime() - 1).getDate();
      columns.push({ start: wStart, end: wEnd, label: wS + '\u2013' + wE,
                     year: wStart.getFullYear(), month: wStart.getMonth(), isWeek: true });
    }
  } else if (zoom === 'month') {
    // 6 monthly columns starting from anchor
    for (var mi = 0; mi < 6; mi++) {
      var mStart = new Date(anchor.getFullYear(), anchor.getMonth() + mi, 1);
      var mEnd   = new Date(anchor.getFullYear(), anchor.getMonth() + mi + 1, 1);
      columns.push({ start: mStart, end: mEnd, label: MONTH_NAMES[mStart.getMonth()],
                     year: mStart.getFullYear(), month: mStart.getMonth() });
    }
  } else {
    // Quarter view: 12 monthly columns for the full anchor year
    var yr = anchor.getFullYear();
    for (var qi = 0; qi < 12; qi++) {
      var qmStart = new Date(yr, qi, 1);
      var qmEnd   = new Date(yr, qi + 1, 1);
      columns.push({ start: qmStart, end: qmEnd, label: MONTH_NAMES[qi],
                     year: yr, month: qi });
    }
  }

  if (!columns.length) return '<p class="text-muted placeholder-text">No timeline data.</p>';

  // ── Build header groupings from columns ──
  // Row 1: Year spans
  var yearSpans = [], yearSpanMap = {};
  columns.forEach(function(c) {
    var yk = c.year;
    if (!yearSpanMap[yk]) { yearSpanMap[yk] = 0; yearSpans.push(yk); }
    yearSpanMap[yk]++;
  });

  // Row 2 (middle): Quarter spans (for quarter/month) OR Month spans (for week)
  var midSpans = [], midSpanMap = {};
  if (zoom === 'week') {
    // Group columns by month name
    columns.forEach(function(c) {
      var mk = c.year + '-' + c.month;
      if (!midSpanMap[mk]) { midSpanMap[mk] = { label: MONTH_NAMES[c.month], count: 0 }; midSpans.push(mk); }
      midSpanMap[mk].count++;
    });
  } else {
    // Group columns by quarter
    columns.forEach(function(c) {
      var q = Math.floor(c.month / 3) + 1;
      var qk = c.year + '-Q' + q;
      if (!midSpanMap[qk]) { midSpanMap[qk] = { label: 'Q' + q, count: 0, active: false }; midSpans.push(qk); }
      midSpanMap[qk].count++;
      var todayQ = today.getFullYear() + '-Q' + (Math.floor(today.getMonth() / 3) + 1);
      if (qk === todayQ) midSpanMap[qk].active = true;
    });
  }

  // Load persisted group/category colors from localStorage
  var _gcColors = JSON.parse(localStorage.getItem('prm_gc_colors') || '{}');

  // Build group_name → { color, catNames[], catMap{} }
  var GROUP_COLORS = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#F44336','#00BCD4','#795548','#607D8B'];
  var groupNames = [], groupMap = {};
  items.forEach(function(r) {
    var gn = (r.group_name || 'General').trim();
    var cn = (r.category   || 'Items').trim();
    if (!groupMap[gn]) {
      var autoColor = GROUP_COLORS[groupNames.length % GROUP_COLORS.length];
      groupMap[gn] = { catNames: [], catMap: {}, color: _gcColors['g:' + gn] || autoColor };
      groupNames.push(gn);
    }
    var gd = groupMap[gn];
    if (!gd.catMap[cn]) { gd.catMap[cn] = []; gd.catNames.push(cn); }
    gd.catMap[cn].push(r);
  });

  if (!groupNames.length) {
    return '<div class="prm-empty"><p class="text-muted">No roadmap items to display.</p>' +
      '<button class="btn btn-primary btn-sm" onclick="window._prmOpenModal()">＋ Add First Item</button></div>';
  }

  var html = '<div class="prm-swimlane-wrap"><div class="prm-sl-scroll">';
  html += '<table class="prm-sl-table" cellspacing="0" cellpadding="0"><thead>';

  // Row 1: Year headers — corner spans rows 1 & 2
  html += '<tr class="prm-sl-yr-row"><th class="prm-sl-corner-top" colspan="2" rowspan="2"></th>';
  yearSpans.forEach(function(y) {
    html += '<th class="prm-sl-year-th" colspan="' + yearSpanMap[y] + '">' + y + '</th>';
  });
  html += '</tr>';

  // Row 2: Quarter headers (for quarter/month) or Month headers (for week)
  html += '<tr class="prm-sl-qtr-row">';
  midSpans.forEach(function(mk) {
    var ms = midSpanMap[mk];
    var activeClass = ms.active ? ' prm-sl-q-active' : '';
    html += '<th class="prm-sl-hdr-q' + activeClass + '" colspan="' + ms.count + '">' + ms.label + '</th>';
  });
  html += '</tr>';

  // Row 3: Column label headers (months or week ranges)
  html += '<tr class="prm-sl-mo-row"><th class="prm-sl-hdr-group">Group</th><th class="prm-sl-hdr-cat">Category</th>';
  columns.forEach(function(c) {
    var isCur = !c.isWeek
      ? (today.getFullYear() === c.year && today.getMonth() === c.month)
      : (today >= c.start && today < c.end);
    html += '<th class="prm-sl-hdr-mo' + (isCur ? ' prm-sl-mo-active' : '') + '">' + c.label + '</th>';
  });
  html += '</tr></thead><tbody>';

  // Body rows
  groupNames.forEach(function(gn) {
    var gd = groupMap[gn];
    var gc = gd.color;

    gd.catNames.forEach(function(cn, ci) {
      var catItems = gd.catMap[cn];
      var laneH = Math.max(40, catItems.length * 30 + 10);

      html += '<tr class="prm-sl-body-row">';

      // Group cell — rowspan across all categories in this group
      if (ci === 0) {
        html += '<td class="prm-sl-group-td" rowspan="' + gd.catNames.length + '" ' +
          'style="border-left:4px solid ' + gc + ';background:' + gc + '1a" ' +
          'title="Click to change group color" onclick="event.stopPropagation();window._prmPickColor(\'g:' + esc(gn) + '\',\'' + gc + '\',event)">' +
          '<span class="prm-sl-group-txt">' + esc(gn.toUpperCase()) + '</span>' +
          '<span class="prm-sl-color-hint">🎨</span></td>';
      }

      // Category label cell — same style as group (border-left + bg tint, full height)
      var catColorKey = 'c:' + gn + ':' + cn;
      var catColor = _gcColors[catColorKey] || gc;
      html += '<td class="prm-sl-cat-td" ' +
        'style="border-left:4px solid ' + catColor + ';background:' + catColor + '1a">' +
        '<div class="prm-sl-cat-inner" style="height:' + laneH + 'px">' +
        '<div class="prm-sl-cat-label" ' +
          'style="cursor:pointer" ' +
          'onclick="event.stopPropagation();window._prmPickColor(\'' + esc(catColorKey) + '\',\'' + catColor + '\',event)" ' +
          'title="Click to change category color">' +
          esc(cn) +
          '<span class="prm-sl-color-hint">🎨</span>' +
        '</div>' +
        catItems.map(function(r) {
          return '<div class="prm-sl-item-dot" onclick="window._prmOpenModal(\'' + r.id + '\')" title="' + esc(r.title) + '">' +
            '<span class="prm-sl-dot-icon">✏</span>' +
          '</div>';
        }).join('') +
        '</div>' +
      '</td>';

      // Single spanning timeline cell — bars sized by total timeline width
      var totalStart = columns[0].start;
      var totalEnd   = columns[columns.length - 1].end;
      var totalMs    = totalEnd - totalStart;

      html += '<td class="prm-sl-tl-all" colspan="' + columns.length + '" style="height:' + laneH + 'px">';

      // Current period highlight
      columns.forEach(function(c) {
        var isCurCol = c.isWeek
          ? (today >= c.start && today < c.end)
          : (today.getFullYear() === c.year && today.getMonth() === c.month);
        if (isCurCol) {
          var ml = ((c.start - totalStart) / totalMs) * 100;
          var mw = ((c.end - c.start) / totalMs) * 100;
          html += '<div class="prm-sl-cur-mo-bg" style="left:' + ml.toFixed(3) + '%;width:' + mw.toFixed(3) + '%"></div>';
        }
      });

      // Column divider lines
      columns.forEach(function(c, ci) {
        if (ci === 0) return;
        var dp = ((c.start - totalStart) / totalMs) * 100;
        html += '<div class="prm-sl-mo-div" style="left:' + dp.toFixed(3) + '%"></div>';
      });

      // Today marker
      if (today >= totalStart && today < totalEnd) {
        var tp = ((today - totalStart) / totalMs) * 100;
        html += '<div class="prm-sl-today" style="left:' + tp.toFixed(3) + '%"></div>';
      }

      // Item bars — positioned across full timeline width
      catItems.forEach(function(r, ri) {
        var sd = r.start_date ? new Date(r.start_date) : null;
        var ed = r.end_date   ? new Date(r.end_date)   : null;
        if (!sd && !ed) return;
        var rStart = sd || ed, rEnd = ed || sd;
        rStart.setHours(0,0,0,0); rEnd.setHours(23,59,59,999);
        if (rEnd <= totalStart || rStart >= totalEnd) return;

        var cStart = rStart < totalStart ? totalStart : rStart;
        var cEnd   = rEnd   > totalEnd   ? totalEnd   : rEnd;
        var lp = ((cStart - totalStart) / totalMs) * 100;
        var wp = Math.max(((cEnd - cStart) / totalMs) * 100, 0.4);
        var bc = r.color || _prmStatusColor(r.status);
        var topPx = ri * 30 + 4;

        var tipData = encodeURIComponent(JSON.stringify({
          title: r.title, status: r.status, priority: r.priority,
          desc: r.description, sd: (r.start_date||'').slice(0,10), ed: (r.end_date||'').slice(0,10),
          who: r.assigned_name
        }));

        if (r.milestone) {
          html += '<div class="prm-sl-milestone" style="left:' + lp.toFixed(3) + '%;top:' + topPx + 'px;color:' + bc + '" ' +
            'onclick="event.stopPropagation();window._prmOpenModal(\'' + r.id + '\')" ' +
            'onmouseenter="window._prmShowTip(\'' + tipData + '\',event)" onmouseleave="window._prmHideTip()">◆</div>';
        } else {
          // Bar: left% and width% are both relative to the timeline cell (totalMs span) — no wrapper offset error
          html += '<div class="prm-sl-bar" ' +
            'style="position:absolute;left:' + lp.toFixed(3) + '%;top:' + topPx + 'px;width:' + wp.toFixed(3) + '%;background:' + bc + '" ' +
            'onclick="event.stopPropagation();window._prmOpenModal(\'' + r.id + '\')" ' +
            'onmouseenter="window._prmShowTip(\'' + tipData + '\',event)" onmouseleave="window._prmHideTip()">' +
            '</div>' +
            // Label: starts right after the bar end, also % of timeline cell
            '<span class="prm-sl-bar-ext-lbl" ' +
            'style="position:absolute;left:calc(' + lp.toFixed(3) + '% + ' + wp.toFixed(3) + '% + 4px);top:' + (topPx + 2) + 'px">' +
            esc(r.title) + '</span>';
        }
      });

      html += '</td>';

      html += '</tr>';
    });
  });

  html += '</tbody></table></div></div>';
  return html;
}

// ── Create / Edit Modal ──
window._prmOpenModal = function(id, defaultStatus) {
  var existing = id ? _prmData.find(function(r){ return r.id === id; }) : null;
  var spaces = S.data.spaces || [];
  var members = [];
  (spaces).forEach(function(sp) {
    if (sp.members) members = members.concat(sp.members);
  });
  // unique users
  var usersMap = {};
  (S.data.users || []).forEach(function(u){ usersMap[u.id] = u; });

  var title = existing ? 'Edit Roadmap Item' : 'New Roadmap Item';
  var v = existing || { status: defaultStatus || 'planned', priority: 'medium', color: '#4d90e0' };

  var spaceOptions = '<option value="">— No Space —</option>' +
    spaces.map(function(sp){ return '<option value="' + sp.id + '"' + (v.space_id == sp.id ? ' selected' : '') + '>' + esc(sp.name) + '</option>'; }).join('');

  var userOptions = '<option value="">— Unassigned —</option>' +
    Object.values(usersMap).map(function(u){ return '<option value="' + u.id + '"' + (v.assigned_to == u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');

  var html = '<div class="modal-overlay" id="prmModalOverlay" onclick="if(event.target===this)window._prmCloseModal()">' +
    '<div class="modal-box" style="max-width:520px">' +
    '<div class="modal-header"><h3>' + title + '</h3><button class="btn-icon" onclick="window._prmCloseModal()">✕</button></div>' +
    '<div class="modal-body" style="display:grid;gap:14px">' +
      '<div><label class="form-label">Title *</label><input id="prmFTitle" class="input" value="' + esc(v.title||'') + '" placeholder="Roadmap item title"></div>' +
      '<div><label class="form-label">Description</label><textarea id="prmFDesc" class="input" rows="8" placeholder="Optional description">' + esc(v.description||'') + '</textarea></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Status</label><select id="prmFStatus" class="input">' +
          ['planned','in_progress','on_hold','completed'].map(function(s){ return '<option value="' + s + '"' + (v.status===s?' selected':'') + '>' + _prmStatusLabel(s) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label class="form-label">Priority</label><select id="prmFPriority" class="input">' +
          ['low','medium','high','critical'].map(function(p){ return '<option value="' + p + '"' + (v.priority===p?' selected':'') + '>' + esc(p.charAt(0).toUpperCase()+p.slice(1)) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Start Date</label><input id="prmFStart" type="date" class="input" value="' + esc(v.start_date ? v.start_date.slice(0,10) : '') + '"></div>' +
        '<div><label class="form-label">End Date</label><input id="prmFEnd" type="date" class="input" value="' + esc(v.end_date ? v.end_date.slice(0,10) : '') + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Space</label><select id="prmFSpace" class="input">' + spaceOptions + '</select></div>' +
        '<div><label class="form-label">Assignee</label><select id="prmFAssigned" class="input">' + userOptions + '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Group Name</label><input id="prmFGroup" class="input" value="' + esc(v.group_name||'') + '" placeholder="e.g. Sales, Product"></div>' +
        '<div><label class="form-label">Category</label><input id="prmFCat" class="input" value="' + esc(v.category||'') + '" placeholder="e.g. Strategy, Dev"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Color</label><input id="prmFColor" type="color" class="input" value="' + esc(v.color||'#4d90e0') + '" style="height:36px;padding:2px 6px"></div>' +
        '<div><label class="form-label">Linked Issue Key (optional)</label><input id="prmFIssueKey" class="input" value="' + esc(v.issue_key||'') + '" placeholder="e.g. ENG-5"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<input id="prmFMilestone" type="checkbox"' + (v.milestone ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer">' +
        '<label for="prmFMilestone" class="form-label" style="margin:0;cursor:pointer">◆ Mark as Milestone (shown as diamond on timeline)</label>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      (existing ? '<button class="btn btn-danger btn-sm" onclick="window._prmDelete(\'' + id + '\')">🗑 Delete</button><span style="flex:1"></span>' : '<span style="flex:1"></span>') +
      '<button class="btn btn-secondary btn-sm" onclick="window._prmCloseModal()">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" onclick="window._prmSave(\'' + (id||'') + '\')">💾 Save</button>' +
    '</div></div></div>';

  var el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el.firstChild);
};

window._prmCloseModal = function() {
  var m = $('prmModalOverlay'); if (m) m.remove();
};

window._prmSave = async function(id) {
  var title = ($('prmFTitle')||{}).value || '';
  if (!title.trim()) { toast('Title is required', 'error'); return; }

  // Resolve issue_id from issue_key if provided
  var issueKey = ($('prmFIssueKey')||{}).value.trim();
  var issueId = null;
  if (issueKey) {
    // Search in all issues
    var allIssues = [];
    (S.data.spaces||[]).forEach(function(sp){ allIssues = allIssues.concat((sp.issues||[])); });
    var found = allIssues.find(function(i){ return (i.issue_key||'').toLowerCase() === issueKey.toLowerCase(); });
    if (found) issueId = found.id;
  }

  var payload = {
    title:       title.trim(),
    description: ($('prmFDesc')||{}).value || '',
    status:      ($('prmFStatus')||{}).value || 'planned',
    priority:    ($('prmFPriority')||{}).value || 'medium',
    start_date:  ($('prmFStart')||{}).value || null,
    end_date:    ($('prmFEnd')||{}).value   || null,
    space_id:    ($('prmFSpace')||{}).value || null,
    assigned_to: ($('prmFAssigned')||{}).value || null,
    color:       ($('prmFColor')||{}).value || '#4d90e0',
    issue_id:    issueId,
    group_name:  ($('prmFGroup')||{}).value.trim() || 'General',
    category:    ($('prmFCat')||{}).value.trim()   || 'Items',
    milestone:   !!($('prmFMilestone')||{}).checked
  };

  try {
    if (id) {
      await api('/api/roadmap/' + id, 'PUT', payload);
      toast('Roadmap item updated');
    } else {
      await api('/api/roadmap', 'POST', payload);
      toast('Roadmap item created');
    }
    window._prmCloseModal();
    await window._prmLoad();
  } catch(e) {
    toast('Failed to save: ' + (e.message||e), 'error');
  }
};

// ── Fullscreen Toggle ──
window._prmToggleFullscreen = function() {
  var view = document.getElementById('view-product-roadmap');
  var btn  = document.getElementById('prmFullscreenBtn');
  var isFs = view.classList.toggle('prm-fullscreen');
  btn.textContent = isFs ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
  // ESC to exit
  if (isFs) {
    document.addEventListener('keydown', function _escFs(e) {
      if (e.key === 'Escape') { view.classList.remove('prm-fullscreen'); btn.textContent = '⛶ Fullscreen'; document.removeEventListener('keydown', _escFs); }
    });
  }
};

// ── Bar Hover Tooltip ──
(function() {
  var tip = null;
  function ensureTip() {
    if (!tip) { tip = document.createElement('div'); tip.id = 'prm-bar-tip'; tip.className = 'prm-bar-tip'; document.body.appendChild(tip); }
    return tip;
  }
  window._prmShowTip = function(data, evt) {
    var d = JSON.parse(decodeURIComponent(data));
    var t = ensureTip();
    var statusColors = { planned:'#607D8B', in_progress:'#2196F3', on_hold:'#FF9800', completed:'#4CAF50' };
    var sc = statusColors[d.status] || '#607D8B';
    var priorityIcon = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢', lowest:'⚪' };
    t.innerHTML =
      '<div class="prm-tip-title">' + _esc(d.title) + '</div>' +
      '<div class="prm-tip-row">' +
        '<span class="prm-tip-chip" style="background:' + sc + '">' + (d.status||'—').replace(/_/g,' ') + '</span>' +
        (d.priority ? '<span class="prm-tip-pri">' + (priorityIcon[d.priority]||'') + ' ' + _esc(d.priority) + '</span>' : '') +
      '</div>' +
      (d.desc ? '<div class="prm-tip-desc">' + _esc(d.desc) + '</div>' : '') +
      '<div class="prm-tip-dates">📅 ' + (d.sd||'—') + ' &rarr; ' + (d.ed||'—') + '</div>' +
      (d.who ? '<div class="prm-tip-who">👤 ' + _esc(d.who) + '</div>' : '') +
      '<div class="prm-tip-hint">✏ Click to edit</div>' +
      '<div class="prm-tip-arrow"></div>';
    t.style.display = 'block';
    t.style.removeProperty('left');
    t.style.removeProperty('top');
    // Position above the bar element, centered
    var el = evt.currentTarget;
    var rect = el.getBoundingClientRect();
    var tw = 280;
    var th = t.offsetHeight || 160;
    var x = rect.left + rect.width / 2 - tw / 2;
    var y = rect.top - th - 12;
    if (x < 8) x = 8;
    if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
    // If no space above, show below
    var below = y < 8;
    if (below) y = rect.bottom + 12;
    t.style.left = x + 'px';
    t.style.top  = y + 'px';
    t.querySelector('.prm-tip-arrow').className = 'prm-tip-arrow ' + (below ? 'prm-tip-arrow-up' : 'prm-tip-arrow-dn');
  };
  window._prmMoveTip = function() {}; // tooltip is now anchored, not cursor-following
  window._prmHideTip = function() { if (tip) tip.style.display = 'none'; };
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
})();

// ── Group / Category Color Picker ──
var PRM_PALETTE = [
  '#F44336','#E91E63','#9C27B0','#673AB7','#3F51B5','#2196F3','#03A9F4','#00BCD4',
  '#009688','#4CAF50','#8BC34A','#CDDC39','#FFC107','#FF9800','#FF5722','#795548',
  '#607D8B','#9E9E9E','#37474F','#1B5E20'
];

window._prmPickColor = function(key, currentColor, evt) {
  // Remove any existing picker
  var old = document.getElementById('prm-color-picker-popup');
  if (old) { old.remove(); if (old.dataset.key === key) return; }

  var pop = document.createElement('div');
  pop.id = 'prm-color-picker-popup';
  pop.dataset.key = key;
  pop.className = 'prm-color-popup';
  pop.innerHTML =
    '<div class="prm-color-popup-title">Pick Color</div>' +
    '<div class="prm-color-swatches">' +
      PRM_PALETTE.map(function(c) {
        return '<span class="prm-color-sw' + (c === currentColor ? ' active' : '') + '" ' +
          'style="background:' + c + '" ' +
          'onclick="window._prmApplyColor(\'' + key + '\',\'' + c + '\')" title="' + c + '"></span>';
      }).join('') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-top:8px">' +
      '<label style="font-size:11px;color:var(--text2)">Custom:</label>' +
      '<input type="color" id="prm-custom-color" value="' + (currentColor||'#4d90e0') + '" style="width:36px;height:24px;border:none;padding:0;cursor:pointer">' +
      '<button class="btn btn-primary btn-sm" style="font-size:11px;padding:2px 8px" ' +
        'onclick="window._prmApplyColor(\'' + key + '\',document.getElementById(\'prm-custom-color\').value)">Apply</button>' +
    '</div>';

  // Position near click
  var rect = evt.target.getBoundingClientRect();
  pop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  pop.style.left = (rect.left  + window.scrollX)     + 'px';
  document.body.appendChild(pop);

  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function _closePop(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', _closePop); }
    });
  }, 0);
};

window._prmApplyColor = function(key, color) {
  // Save to localStorage immediately for instant UI update
  var stored = JSON.parse(localStorage.getItem('prm_gc_colors') || '{}');
  stored[key] = color;
  localStorage.setItem('prm_gc_colors', JSON.stringify(stored));
  var pop = document.getElementById('prm-color-picker-popup');
  if (pop) pop.remove();
  _prmRender();
  // Persist to DB in background
  api('/api/roadmap/colors', 'POST', { color_key: key, color: color }).catch(function() {});
};

window._prmDelete = async function(id) {
  if (!confirm('Delete this roadmap item?')) return;
  window._prmCloseModal();
  try {
    await api('/api/roadmap/' + id, 'DELETE');
    toast('Deleted');
    await window._prmLoad();
  } catch(e) { toast('Delete failed', 'error'); }
};

// ═══════════════════════════════════════════════════════════
async function _wlrFetch() {
  var content = $('wlrContent');
  if (content) content.innerHTML = '<p class="text-muted" style="padding:24px">Loading…</p>';

  var from = $('wlrFrom') ? $('wlrFrom').value : '';
  var to   = $('wlrTo')   ? $('wlrTo').value   : '';

  // Resolve user IDs — handle "__me__" token
  var resolvedUsers = _wlrSelUsers.map(function(id){ return id === '__me__' ? S.currentUser : id; });

  // Fetch: if multiple spaces or users, fetch without server filter and apply client-side
  // If single space/user, pass to server for efficiency
  var params = [];
  if (_wlrSelSpaces.length === 1) params.push('space_id=' + encodeURIComponent(_wlrSelSpaces[0]));
  if (resolvedUsers.length === 1)  params.push('user_id='  + encodeURIComponent(resolvedUsers[0]));
  if (from) params.push('from=' + encodeURIComponent(from));
  if (to)   params.push('to='   + encodeURIComponent(to));

  try {
    var rows = await api('/api/worklogs' + (params.length ? '?' + params.join('&') : ''));
    // Client-side multi-space filter (when >1 selected)
    if (_wlrSelSpaces.length > 1) rows = rows.filter(function(r){ return _wlrSelSpaces.indexOf(r.space_id) >= 0; });
    // Client-side multi-user filter (when >1 selected)
    if (resolvedUsers.length > 1) rows = rows.filter(function(r){ return resolvedUsers.indexOf(r.user_id) >= 0; });
    // Client-side billable filter
    var billable = $('wlrBillable') ? $('wlrBillable').value : '';
    if (billable === '1') rows = rows.filter(function(r){ return r.is_billable; });
    if (billable === '0') rows = rows.filter(function(r){ return !r.is_billable; });
    _wlrData = rows || [];
    _wlrRender();
  } catch(e) {
    if (content) content.innerHTML = '<p class="text-muted" style="padding:24px">Failed to load worklogs.</p>';
  }
}

function _wlrRender() {
  var rows = _wlrData;
  var summary = $('wlrSummary');
  var content = $('wlrContent');
  if (!summary || !content) return;

  // ── Summary cards ──
  var totalMins = rows.reduce(function(s,r){ return s + (r.time_spent||0); }, 0);
  var billMins  = rows.filter(function(r){ return r.is_billable; }).reduce(function(s,r){ return s+(r.time_spent||0); }, 0);
  var uniqueTickets = (function(){ var s={}; rows.forEach(function(r){s[r.issue_id]=1;}); return Object.keys(s).length; })();
  var uniqueUsers   = (function(){ var s={}; rows.forEach(function(r){s[r.user_id]=1;}); return Object.keys(s).length; })();

  summary.innerHTML =
    _wlrCard('', 'Total Logged', _wlrFmt(totalMins), '#2563eb') +
    _wlrCard('', 'Billable',     _wlrFmt(billMins),  '#16a34a') +
    _wlrCard('', 'Tickets',      uniqueTickets,      '#7c3aed') +
    _wlrCard('', 'Contributors', uniqueUsers,        '#ea580c');

  if (!rows.length) {
    content.innerHTML = '<p class="text-muted placeholder-text">No work logs found for the selected filters.</p>';
    return;
  }

  // Show/hide Field List button
  var flBtn = $('wlrFieldListBtn');
  if (flBtn) { if (_wlrGroup === 'pivot') flBtn.removeAttribute('hidden'); else { flBtn.setAttribute('hidden',''); window._wlrClosePivotPanel(); } }

  // ── Grouped table ──
  if (_wlrGroup === 'pivot') {
    content.innerHTML = _wlrDynamicPivot(rows);
    return;
  }
  if (_wlrGroup === 'timesheet') {
    content.innerHTML = _wlrTimesheetTable(rows);
    return;
  }
  if (_wlrGroup === 'none') {
    content.innerHTML = _wlrFlatTable(rows);
    return;
  }

  var groups = {};
  var groupKey = _wlrGroup;
  rows.forEach(function(r) {
    var key = groupKey === 'user'  ? (r.user_id)
            : groupKey === 'space' ? (r.space_id || 'unknown')
            : (r.work_date ? r.work_date.slice(0,10) : '—');
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  var html = '';
  Object.keys(groups).sort().forEach(function(key) {
    var grpRows = groups[key];
    var grpMins = grpRows.reduce(function(s,r){return s+(r.time_spent||0);}, 0);
    var grpTickets = (function(){ var s={}; grpRows.forEach(function(r){s[r.issue_id]=1;}); return Object.keys(s).length; })();

    var label;
    if (groupKey === 'user') {
      var u = findUser(key); label = u ? u.name : (grpRows[0].user_name || key);
    } else if (groupKey === 'space') {
      var sp = getSpace(key); label = sp ? sp.name : key;
    } else {
      label = key;
    }

    html += '<div class="wlr-group">' +
      '<div class="wlr-group-header" onclick="this.parentElement.classList.toggle(\'collapsed\')">' +
        '<span class="wlr-group-title">' + esc(label) + '</span>' +
        '<span class="wlr-group-meta">' + grpTickets + ' ticket' + (grpTickets!==1?'s':'') + ' &nbsp;·&nbsp; ' + _wlrFmt(grpMins) + '</span>' +
        '<span class="wlr-group-arrow">▾</span>' +
      '</div>' +
      '<div class="wlr-group-body">' + _wlrFlatTable(grpRows) + '</div>' +
    '</div>';
  });
  content.innerHTML = html;
}

function _wlrFlatTable(rows) {
  var html = '<table class="data-table wlr-table"><thead><tr>' +
    '<th>Date</th><th>Assignee</th><th>Space</th><th>Ticket</th><th>Title</th>' +
    '<th>Time</th><th>Description</th><th>Billable</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var u  = findUser(r.user_id);
    var sp = getSpace(r.space_id);
    var userName  = u  ? u.name  : (r.user_name  || '—');
    var spaceName = sp ? sp.name : '—';
    html += '<tr>' +
      '<td class="text-muted" style="white-space:nowrap">' + esc(r.work_date ? r.work_date.slice(0,10) : '—') + '</td>' +
      '<td>' + esc(userName) + '</td>' +
      '<td>' + esc(spaceName) + '</td>' +
      '<td class="issue-key" style="cursor:pointer" onclick="openIssuePage(\'' + r.issue_id + '\')">' + esc(r.issue_key || '—') + '</td>' +
      '<td><span style="color:var(--accent);cursor:pointer;font-weight:500" onclick="openIssuePage(\'' + r.issue_id + '\')">' + esc(r.issue_title || '—') + '</span></td>' +
      '<td style="white-space:nowrap;font-weight:600;color:var(--accent)">' + _wlrFmt(r.time_spent||0) + '</td>' +
      '<td class="text-muted">' + esc(r.description || '—') + '</td>' +
      '<td style="text-align:center">' + (r.is_billable ? '<span style="color:var(--success);font-weight:600">✓</span>' : '<span style="color:var(--text3)">—</span>') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// ── Pivot helpers ──────────────────────────────────────────
function _wlrBucketDate(dateStr, mode) {
  if (!dateStr) return '';
  if (mode === 'day') return dateStr.slice(0, 10);
  if (mode === 'month') return dateStr.slice(0, 7);
  var d = new Date(dateStr + 'T00:00:00');
  var day = d.getDay();
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function _wlrBucketLabel(bucket, mode) {
  if (mode === 'day') {
    var d = new Date(bucket + 'T00:00:00');
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
  }
  if (mode === 'month') {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var parts = bucket.split('-');
    return months[parseInt(parts[1],10)-1] + ' ' + parts[0];
  }
  var d2 = new Date(bucket + 'T00:00:00');
  var end = new Date(d2); end.setDate(end.getDate() + 6);
  return String(d2.getDate()).padStart(2,'0') + '/' + String(d2.getMonth()+1).padStart(2,'0')
    + '–' + String(end.getDate()).padStart(2,'0') + '/' + String(end.getMonth()+1).padStart(2,'0');
}

function _wlrHeatColor(mins, maxMins) {
  if (!mins || !maxMins) return '';
  var ratio = Math.min(mins / maxMins, 1);
  var opacity = 0.10 + ratio * 0.70;
  return 'background:rgba(77,144,224,' + opacity.toFixed(2) + ');color:' + (ratio > 0.55 ? '#fff' : 'var(--text)') + ';';
}

// ═══════════════════════════════════════════════════════════
// DYNAMIC PIVOT (Jira Worklog Pro-style)
// ═══════════════════════════════════════════════════════════
var WLR_PIVOT_FIELDS_DEFAULT = [
  { key: 'work_date',   label: 'Date',              type: 'dimension' },
  { key: 'user_name',   label: 'User',              type: 'dimension' },
  { key: 'space_name',  label: 'Space',             type: 'dimension' },
  { key: 'issue_key',   label: 'Issue Key',         type: 'dimension' },
  { key: 'issue_title', label: 'Issue Title',       type: 'dimension' },
  { key: 'description', label: 'Description',       type: 'dimension' },
  { key: 'is_billable', label: 'Billable',          type: 'dimension' },
  { key: 'time_spent',  label: 'Sum of Time (h)',   type: 'measure'   },
  { key: 'count',       label: 'Count of Worklogs', type: 'measure'   }
];
var WLR_PIVOT_FIELDS = WLR_PIVOT_FIELDS_DEFAULT.slice();

var _wlrPivotConfig = {
  rows:    ['user_name', 'issue_key'],
  cols:    [],               // no date columns by default; drag 'Date' here to expand
  values:  ['time_spent'],
  filters: []
};

// Collapsed user-row nodes: nodeId → true/false
var _wlrCollapsed = {};

window._wlrToggleCollapse = function(nodeId) {
  _wlrCollapsed[nodeId] = !_wlrCollapsed[nodeId];
  var c = $('wlrContent'); if (c) c.innerHTML = _wlrDynamicPivot(_wlrData);
};

// Derived helpers — Values zone is the single source of truth
function _wlrPivotShowTime(cfg)  { return cfg.values.indexOf('time_spent') >= 0; }
function _wlrPivotShowCount(cfg) { return cfg.values.indexOf('count')      >= 0; }

function _wlrGetFieldVal(row, key) {
  if (key === 'user_name')   { var u = findUser(row.user_id); return u ? u.name : (row.user_name || '?'); }
  if (key === 'space_name')  { var sp = getSpace(row.space_id); return sp ? sp.name : '—'; }
  if (key === 'issue_key')   return row.issue_key   || '—';
  if (key === 'issue_title') return row.issue_title || '—';
  if (key === 'work_date')   return row.work_date   ? row.work_date.slice(0,10) : '—';
  if (key === 'is_billable') return row.is_billable ? 'Billable' : 'Non-billable';
  if (key === 'description') return row.description || '—';
  if (key === 'time_spent')  return row.time_spent  || 0;
  return '—';
}

function _wlrRefreshZone(zone) {
  var bodyId = { rows:'wlrZoneRowsBody', cols:'wlrZoneColsBody', values:'wlrZoneValuesBody', filters:'wlrZoneFiltersBody' }[zone];
  var el = $(bodyId);
  if (!el) return;
  var items = _wlrPivotConfig[zone];
  if (!items || !items.length) {
    el.innerHTML = '<div class="wlr-zone-placeholder">Drop ' + zone + ' here</div>';
    return;
  }
  el.innerHTML = items.map(function(key) {
    var f = WLR_PIVOT_FIELDS.find(function(f){ return f.key === key; });
    var prefix = zone === 'values' ? (key === 'time_spent' ? 'Σ ' : key === 'count' ? '# ' : 'Σ ') : '';
    var label = prefix + (f ? f.label : key);
    return '<div class="wlr-zone-chip" draggable="true" data-field="' + key + '" data-zone="' + zone + '"' +
      ' ondragstart="window._wlrDragStart(event,\'' + key + '\')">' +
      '<span class="wlr-zone-chip-label">' + esc(label) + '</span>' +
      '<span class="wlr-zone-chip-arrow"> ▾</span>' +
      '<span class="wlr-zone-chip-remove" onclick="window._wlrRemoveFromZone(\'' + zone + '\',\'' + key + '\')">×</span>' +
    '</div>';
  }).join('');
}

function _wlrRenderPivotPanel() {
  var fl = $('wlrPivotFieldList');
  if (!fl) return;
  var allUsed = _wlrPivotConfig.rows.concat(_wlrPivotConfig.cols, _wlrPivotConfig.values, _wlrPivotConfig.filters);
  fl.innerHTML = WLR_PIVOT_FIELDS.map(function(f) {
    var used = allUsed.indexOf(f.key) >= 0;
    return '<div class="wlr-pp-field-item" draggable="true" data-field="' + f.key + '" data-ftype="' + f.type + '"' +
      ' ondragstart="window._wlrDragStart(event,\'' + f.key + '\')">' +
      '<span class="wlr-pp-drag-handle">≡</span>' +
      '<input type="checkbox"' + (used ? ' checked' : '') + ' onchange="window._wlrFieldCheck(\'' + f.key + '\',\'' + f.type + '\',this.checked)">' +
      '<span class="wlr-pp-field-label' + (used ? ' wlr-pp-field-used' : '') + '">' + esc(f.label) + '</span>' +
    '</div>';
  }).join('');
  ['rows','cols','values','filters'].forEach(function(z){ _wlrRefreshZone(z); });
}

var _wlrDragKey = null;
window._wlrDragStart = function(e, key) {
  _wlrDragKey = key;
  e.dataTransfer.setData('text/plain', key);
  e.dataTransfer.effectAllowed = 'move';
};
window._wlrDragOver = function(e) {
  e.preventDefault();
  e.currentTarget.classList.add('wlr-zone-dragover');
};
window._wlrDragLeave = function(e) {
  e.currentTarget.classList.remove('wlr-zone-dragover');
};
window._wlrDrop = function(e, zone) {
  e.preventDefault();
  e.currentTarget.classList.remove('wlr-zone-dragover');
  var key = e.dataTransfer.getData('text/plain') || _wlrDragKey;
  if (!key) return;
  var f = WLR_PIVOT_FIELDS.find(function(f){ return f.key === key; });
  if (!f) return;
  // Enforce: measures only go to values; dimensions don't go to values
  if (zone === 'values' && f.type !== 'measure') zone = 'rows';
  if (zone !== 'values' && f.type === 'measure') zone = 'values';
  // Remove from all zones
  ['rows','cols','values','filters'].forEach(function(z) {
    _wlrPivotConfig[z] = _wlrPivotConfig[z].filter(function(k){ return k !== key; });
  });
  if (_wlrPivotConfig[zone].indexOf(key) < 0) _wlrPivotConfig[zone].push(key);
  var defer = $('wlrDeferUpdate') && $('wlrDeferUpdate').checked;
  if (!defer) { _wlrRenderPivotPanel(); var c = $('wlrContent'); if (c) c.innerHTML = _wlrDynamicPivot(_wlrData); }
  else _wlrRenderPivotPanel();
};
window._wlrRemoveFromZone = function(zone, key) {
  _wlrPivotConfig[zone] = _wlrPivotConfig[zone].filter(function(k){ return k !== key; });
  var defer = $('wlrDeferUpdate') && $('wlrDeferUpdate').checked;
  if (!defer) { _wlrRenderPivotPanel(); var c = $('wlrContent'); if (c) c.innerHTML = _wlrDynamicPivot(_wlrData); }
  else _wlrRenderPivotPanel();
};
window._wlrFieldCheck = function(key, ftype, checked) {
  ['rows','cols','values','filters'].forEach(function(z) {
    _wlrPivotConfig[z] = _wlrPivotConfig[z].filter(function(k){ return k !== key; });
  });
  if (checked) {
    var zone = ftype === 'measure' ? 'values' : 'rows';
    if (_wlrPivotConfig[zone].indexOf(key) < 0) _wlrPivotConfig[zone].push(key);
  }
  var defer = $('wlrDeferUpdate') && $('wlrDeferUpdate').checked;
  if (!defer) { _wlrRenderPivotPanel(); var c = $('wlrContent'); if (c) c.innerHTML = _wlrDynamicPivot(_wlrData); }
  else _wlrRenderPivotPanel();
};
window._wlrApplyPivot = function() {
  _wlrRenderPivotPanel();
  var c = $('wlrContent'); if (c) c.innerHTML = _wlrDynamicPivot(_wlrData);
};
window._wlrSortFields = function(order) {
  if (order === 'asc')  WLR_PIVOT_FIELDS = WLR_PIVOT_FIELDS_DEFAULT.slice().sort(function(a,b){ return a.label.localeCompare(b.label); });
  else if (order === 'desc') WLR_PIVOT_FIELDS = WLR_PIVOT_FIELDS_DEFAULT.slice().sort(function(a,b){ return b.label.localeCompare(a.label); });
  else WLR_PIVOT_FIELDS = WLR_PIVOT_FIELDS_DEFAULT.slice();
  _wlrRenderPivotPanel();
};
window._wlrOpenPivotPanel = function() {
  var p = $('wlrPivotPanel'); if (p) { p.removeAttribute('hidden'); _wlrRenderPivotPanel(); }
};
window._wlrClosePivotPanel = function() {
  var p = $('wlrPivotPanel'); if (p) p.setAttribute('hidden', '');
};

function _wlrDynamicPivot(data) {
  var cfg = _wlrPivotConfig;
  if (!data || !data.length) return '<p class="text-muted placeholder-text">No work logs found for the selected filters.</p>';
  var rowFields = cfg.rows;
  var colField  = cfg.cols[0] || null;
  var noColMode = !colField;  // flat tree mode — no date/column expansion

  // ── Column values (matrix mode) ──
  var colValues = [];
  if (!noColMode) {
    var colSet = {};
    data.forEach(function(r){ colSet[_wlrGetFieldVal(r, colField)] = true; });
    colValues = Object.keys(colSet).sort();
    if (!colValues.length) colValues = [];
  }

  // ── What to show: driven by Values zone ──
  var showTime  = _wlrPivotShowTime(cfg);
  var showCount = _wlrPivotShowCount(cfg);

  // ── Aggregation helpers ──
  function subset(rows, colVal) {
    if (noColMode || !colVal) return rows;
    return rows.filter(function(r){ return _wlrGetFieldVal(r, colField) === colVal; });
  }
  function aggTime(rows, colVal)  { return subset(rows, colVal).reduce(function(s,r){ return s+(r.time_spent||0); }, 0); }
  function aggCount(rows, colVal) { return subset(rows, colVal).length; }
  function agg(rows, colVal)      { return showCount && !showTime ? aggCount(rows,colVal) : aggTime(rows,colVal); }

  // Format cell value: flat-tree mode → decimal hours; matrix mode → Xh Ym with heat-map
  function fmtCell(rows, colVal) {
    var t = aggTime(rows, colVal), n = aggCount(rows, colVal);
    if (noColMode) {
      if (showTime && showCount) return (t||n) ? (t/60).toFixed(2) + '<br><span style="font-size:10px;opacity:.75">' + n + ' log' + (n!==1?'s':'') + '</span>' : null;
      if (showTime)  return t ? (t/60).toFixed(2) : null;
      if (showCount) return n ? String(n) : null;
      return null;
    }
    if (showTime && showCount) {
      if (!t && !n) return null;
      return (t ? _wlrFmt(t) : '0h') + '<br><span style="font-size:10px;opacity:.75">' + n + ' log' + (n!==1?'s':'') + '</span>';
    }
    if (showTime)  return t ? _wlrFmt(t) : null;
    if (showCount) return n ? String(n)  : null;
    return null;
  }

  // Format row total (right-side Total col, matrix mode only)
  function fmtRowTotal(rows) {
    var t = rows.reduce(function(s,r){ return s+(r.time_spent||0); }, 0), n = rows.length;
    if (showTime && showCount) return _wlrFmt(t) + '<br><span style="font-size:10px;opacity:.75">' + n + ' logs</span>';
    if (showCount) return String(n);
    return _wlrFmt(t);
  }

  // ── Build row tree ──
  function buildTree(rows, fields) {
    if (!fields.length) return null;
    var key = fields[0], rest = fields.slice(1);
    var groupMap = {}, order = [];
    rows.forEach(function(r) {
      var v = _wlrGetFieldVal(r, key);
      if (!groupMap[v]) { groupMap[v] = []; order.push(v); }
      groupMap[v].push(r);
    });
    order.sort();
    return order.map(function(v) {
      return { label: v, field: key, rows: groupMap[v], children: rest.length ? buildTree(groupMap[v], rest) : null };
    });
  }
  var tree = rowFields.length ? buildTree(data, rowFields) : null;

  // ── Max cell for heat-map (matrix mode only) ──
  var maxCell = 0;
  if (!noColMode) {
    function scanMax(nodes) {
      if (!nodes) return;
      nodes.forEach(function(node) {
        colValues.forEach(function(c){ var v = agg(node.rows, c); if (v > maxCell) maxCell = v; });
        scanMax(node.children);
      });
    }
    if (tree) scanMax(tree); else colValues.forEach(function(c){ var v = agg(data, c); if (v > maxCell) maxCell = v; });
  }

  // ── Info bar: Values zone is the source of truth ──
  var valDesc = cfg.values.map(function(k) {
    var f = WLR_PIVOT_FIELDS.find(function(f){ return f.key === k; });
    return (k === 'time_spent' ? 'Σ ' : k === 'count' ? '# ' : '') + (f ? f.label : k);
  }).join(' · ');
  var metricBar = cfg.values.length
    ? '<div class="wlr-pivot-info-bar">Values: <strong>' + esc(valDesc) + '</strong><span class="wlr-pivot-info-hint"> — open Field List to add/remove measures</span></div>'
    : '<div class="wlr-pivot-info-bar wlr-pivot-info-warn">⚠ No values selected — drag a measure (Σ) into the Values zone via Field List</div>';

  // ── Column label (date formatting) ──
  function colLabel(val) {
    if (!colField || colField !== 'work_date') return esc(val);
    var d = new Date(val + 'T00:00:00');
    if (isNaN(d.getTime())) return esc(val);
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
  }

  // ── Single value column header (flat-tree mode) ──
  var singleColHdr = (showTime && showCount) ? 'Total'
                   : showCount ? 'Count of Worklogs'
                   : 'Total Sum of Time (hours)';

  var rowDepth = rowFields.length || 1;
  // In no-column mode: collapse all row fields into 1 label column (issues indented inside)
  var effectiveRowCols = noColMode ? 1 : rowDepth;
  var html = metricBar + '<div class="wlr-pivot-wrap"><table class="wlr-pivot-table"><thead><tr>';

  // Row-field header columns
  if (noColMode) {
    // Single label column — first row field label (e.g. "User")
    var firstF = rowFields.length ? WLR_PIVOT_FIELDS.find(function(f){ return f.key === rowFields[0]; }) : null;
    html += '<th class="wlr-pivot-th wlr-pivot-label-col">' + esc(firstF ? firstF.label : 'Item') + '</th>';
  } else if (rowFields.length) {
    rowFields.forEach(function(rk) {
      var f = WLR_PIVOT_FIELDS.find(function(f){ return f.key === rk; });
      html += '<th class="wlr-pivot-th wlr-pivot-label-col">' + esc(f ? f.label : rk) + '</th>';
    });
  } else {
    html += '<th class="wlr-pivot-th wlr-pivot-label-col"> </th>';
  }

  if (noColMode) {
    html += '<th class="wlr-pivot-th wlr-pivot-total-col" style="text-align:right">' + esc(singleColHdr) + '</th>';
  } else {
    colValues.forEach(function(c){ html += '<th class="wlr-pivot-th wlr-pivot-date-col">' + colLabel(c) + '</th>'; });
    html += '<th class="wlr-pivot-th wlr-pivot-total-col">Total</th>';
  }
  html += '</tr></thead><tbody>';

  // ── Render tree rows ──
  function renderTree(nodes, depth) {
    nodes.forEach(function(node) {
      var nodeId = node.field + ':' + node.label;
      var safeId = nodeId.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      var isTop = depth === 0;
      var hasChildren = !!(node.children && node.children.length);
      var collapsed = !!_wlrCollapsed[nodeId];

      html += '<tr class="' + (isTop ? 'wlr-pivot-user-row' : 'wlr-pivot-issue-row') + '">';

      // Indent spacer cells for child rows in matrix mode
      if (!noColMode) {
        for (var d = 0; d < depth; d++) {
          html += '<td class="wlr-pivot-td wlr-pivot-label-col" style="background:var(--bg2);border-right:none;min-width:12px;padding:0"></td>';
        }
      }

      // Label cell
      var span = noColMode ? 1 : (rowDepth - depth);
      var lbl;
      if (node.field === 'issue_key') {
        var ir = node.rows[0];
        var indentPx = noColMode ? (depth * 20) : 0;
        lbl = (noColMode ? '<span style="display:inline-block;width:' + indentPx + 'px"></span>' : '') +
              '<span class="wlr-pivot-issue-key" onclick="openIssuePage(\'' + (ir ? ir.issue_id : '') + '\')">' + esc(node.label) + '</span>';
        if (ir && ir.issue_title) lbl += ' <span class="wlr-pivot-issue-title">' + esc(ir.issue_title) + '</span>';
      } else if (noColMode && isTop && hasChildren) {
        // Collapsible top-level row in flat mode
        var arrow = collapsed ? '›' : '∨';
        lbl = '<span class="wlr-pivot-collapse-btn" onclick="window._wlrToggleCollapse(\'' + safeId + '\')">' + arrow + '</span> ' + esc(node.label);
      } else if (noColMode && !isTop) {
        // Generic indented sub-row
        lbl = '<span style="display:inline-block;width:' + (depth * 20) + 'px"></span>' + esc(node.label);
      } else {
        lbl = esc(node.label);
      }

      html += '<td class="wlr-pivot-td wlr-pivot-label-col ' + (isTop ? 'wlr-pivot-user-label' : 'wlr-pivot-issue-label') + '"' +
              (span > 1 ? ' colspan="' + span + '"' : '') + '>' + lbl + '</td>';

      if (noColMode) {
        // Single value cell
        var disp = fmtCell(node.rows, null);
        html += '<td class="wlr-pivot-td wlr-pivot-total-cell' + ((showTime && showCount)?' wlr-pivot-cell-both':'') + '" style="text-align:right">' +
                (disp || '<span class="wlr-pivot-empty">—</span>') + '</td>';
      } else {
        // Per-column cells + row total
        colValues.forEach(function(c) {
          var v = agg(node.rows, c);
          var disp = fmtCell(node.rows, c);
          html += '<td class="wlr-pivot-td wlr-pivot-cell' + ((showTime && showCount)?' wlr-pivot-cell-both':'') + '" style="' + _wlrHeatColor(v, maxCell) + '">' +
                  (disp ? disp : '<span class="wlr-pivot-empty">—</span>') + '</td>';
        });
        html += '<td class="wlr-pivot-td wlr-pivot-total-cell' + ((showTime && showCount)?' wlr-pivot-cell-both':'') + '">' + fmtRowTotal(node.rows) + '</td>';
      }
      html += '</tr>';

      if (node.children && !(noColMode && collapsed)) renderTree(node.children, depth + 1);
    });
  }

  if (tree) {
    renderTree(tree, 0);
  } else {
    // No row fields configured — show grand total only
    html += '<tr class="wlr-pivot-user-row"><td class="wlr-pivot-td wlr-pivot-label-col wlr-pivot-user-label"' +
            (effectiveRowCols > 1 ? ' colspan="' + effectiveRowCols + '"' : '') + '>Grand Total</td>';
    if (noColMode) {
      var gtd = fmtCell(data, null);
      html += '<td class="wlr-pivot-td wlr-pivot-total-cell" style="text-align:right">' + (gtd||'—') + '</td>';
    } else {
      colValues.forEach(function(c) {
        var v = agg(data,c); var disp = fmtCell(data,c);
        html += '<td class="wlr-pivot-td wlr-pivot-cell' + ((showTime && showCount)?' wlr-pivot-cell-both':'') + '" style="' + _wlrHeatColor(v, maxCell) + '">' + (disp||'<span class="wlr-pivot-empty">—</span>') + '</td>';
      });
      html += '<td class="wlr-pivot-td wlr-pivot-total-cell">' + fmtRowTotal(data) + '</td>';
    }
    html += '</tr>';
  }

  // ── Grand total footer row ──
  var grandTotal = data.reduce(function(s,r){ return s+(r.time_spent||0); }, 0);
  html += '</tbody><tfoot><tr class="wlr-pivot-footer-row">';
  for (var i = 0; i < effectiveRowCols; i++) {
    html += '<td class="wlr-pivot-td wlr-pivot-label-col wlr-pivot-footer-label">' + (i===0 ? 'Grand total' : '') + '</td>';
  }
  if (noColMode) {
    var gtf = fmtCell(data, null);
    html += '<td class="wlr-pivot-td wlr-pivot-total-cell wlr-pivot-grand-total" style="text-align:right">' + (gtf||'—') + '</td>';
  } else {
    colValues.forEach(function(c) {
      var v = agg(data,c); var disp = fmtCell(data,c);
      html += '<td class="wlr-pivot-td wlr-pivot-cell wlr-pivot-footer-cell' + ((showTime && showCount)?' wlr-pivot-cell-both':'') + '">' + (disp||'<span class="wlr-pivot-empty">—</span>') + '</td>';
    });
    var gtFootDisp = (showTime && showCount) ? _wlrFmt(grandTotal) + '<br><span style="font-size:10px;opacity:.75">' + data.length + ' logs</span>'
      : showCount ? String(data.length) : _wlrFmt(grandTotal);
    html += '<td class="wlr-pivot-td wlr-pivot-total-cell wlr-pivot-grand-total">' + gtFootDisp + '</td>';
  }
  html += '</tr></tfoot></table></div>';
  return html;
}

// ── Timesheet: flat Excel-style raw data table ────────────
var _wlrSheetSort = { col: 'work_date', dir: 1 };

window._wlrSheetSortBy = function(col) {
  if (_wlrSheetSort.col === col) _wlrSheetSort.dir *= -1;
  else { _wlrSheetSort.col = col; _wlrSheetSort.dir = 1; }
  var c = $('wlrContent'); if (c) c.innerHTML = _wlrTimesheetTable(_wlrData);
};

function _wlrTimesheetTable(rows) {
  if (!rows || !rows.length) return '<p class="text-muted placeholder-text">No work logs found for the selected filters.</p>';

  // ── Section 1: User × Date matrix ──
  var matrixSection = '<div class="wlr-ts-section-hdr"><span class="wlr-ts-section-title">📊 Summary Matrix — User × Date</span></div>' + _wlrPivotTable(rows);

  // ── Section divider ──
  var divider = '<div class="wlr-ts-divider">' +
    '<span class="wlr-ts-divider-label">📋 All Log Entries</span>' +
  '</div>';
  var matrixHtml = matrixSection;

  // ── Section 2: flat table follows below ──

  var sorted = rows.slice().sort(function(a, b) {
    var col = _wlrSheetSort.col, dir = _wlrSheetSort.dir;
    var av = col === 'time_spent' ? (a.time_spent||0) : (col === 'is_billable' ? (a.is_billable?1:0)
          : col === 'user_name' ? _wlrGetFieldVal(a,'user_name')
          : col === 'space_name' ? _wlrGetFieldVal(a,'space_name')
          : (a[col] || ''));
    var bv = col === 'time_spent' ? (b.time_spent||0) : (col === 'is_billable' ? (b.is_billable?1:0)
          : col === 'user_name' ? _wlrGetFieldVal(b,'user_name')
          : col === 'space_name' ? _wlrGetFieldVal(b,'space_name')
          : (b[col] || ''));
    if (av < bv) return -dir; if (av > bv) return dir; return 0;
  });

  function sortTh(col, label) {
    var arrow = _wlrSheetSort.col === col ? (_wlrSheetSort.dir > 0 ? ' ▲' : ' ▼') : ' ⇅';
    return '<th class="wlr-sheet-th" onclick="window._wlrSheetSortBy(\'' + col + '\')" style="cursor:pointer">' + label + '<span style="color:var(--text3);font-size:10px">' + arrow + '</span></th>';
  }

  var totalMins = sorted.reduce(function(s,r){ return s+(r.time_spent||0); }, 0);
  var totalCount = sorted.length;
  var billableMins = sorted.filter(function(r){ return r.is_billable; }).reduce(function(s,r){ return s+(r.time_spent||0); }, 0);

  var html = '<div class="wlr-sheet-summary">' +
    '<span class="wlr-sheet-stat"><strong>' + totalCount + '</strong> entries</span>' +
    '<span class="wlr-sheet-sep">·</span>' +
    '<span class="wlr-sheet-stat">Total: <strong>' + _wlrFmt(totalMins) + '</strong> (' + (totalMins/60).toFixed(1) + 'h)</span>' +
    '<span class="wlr-sheet-sep">·</span>' +
    '<span class="wlr-sheet-stat">Billable: <strong>' + _wlrFmt(billableMins) + '</strong></span>' +
  '</div>';

  html += '<div class="wlr-sheet-wrap"><table class="wlr-sheet-table"><thead><tr>' +
    '<th class="wlr-sheet-th wlr-sheet-num">#</th>' +
    sortTh('work_date', 'Date') +
    sortTh('user_name', 'User') +
    sortTh('space_name', 'Space') +
    sortTh('issue_key', 'Issue Key') +
    '<th class="wlr-sheet-th">Issue Title</th>' +
    sortTh('time_spent', 'Time (h)') +
    '<th class="wlr-sheet-th">Time (m)</th>' +
    '<th class="wlr-sheet-th">Description</th>' +
    sortTh('is_billable', 'Billable') +
    '<th class="wlr-sheet-th" style="width:64px"></th>' +
    '</tr></thead><tbody>';

  sorted.forEach(function(r, i) {
    var u  = findUser(r.user_id);
    var sp = getSpace(r.space_id);
    var mins = r.time_spent || 0;
    var canEdit = r.user_id === S.currentUser || (S.currentUserObj && (S.currentUserObj.role === 'admin' || S.currentUserObj.role === 'owner'));
    html += '<tr class="wlr-sheet-row">' +
      '<td class="wlr-sheet-td wlr-sheet-num text-muted">' + (i+1) + '</td>' +
      '<td class="wlr-sheet-td">' + esc(r.work_date ? r.work_date.slice(0,10) : '—') + '</td>' +
      '<td class="wlr-sheet-td"><strong>' + esc(u ? u.name : (r.user_name||'—')) + '</strong></td>' +
      '<td class="wlr-sheet-td text-muted">' + esc(sp ? sp.name : '—') + '</td>' +
      '<td class="wlr-sheet-td"><span class="wlr-pivot-issue-key" style="cursor:pointer" onclick="openIssuePage(\'' + r.issue_id + '\')">' + esc(r.issue_key||'—') + '</span></td>' +
      '<td class="wlr-sheet-td">' + esc(r.issue_title||'—') + '</td>' +
      '<td class="wlr-sheet-td wlr-sheet-num" style="font-weight:600;color:var(--accent)">' + (mins/60).toFixed(2) + '</td>' +
      '<td class="wlr-sheet-td wlr-sheet-num">' + mins + '</td>' +
      '<td class="wlr-sheet-td text-muted">' + esc(r.description||'—') + '</td>' +
      '<td class="wlr-sheet-td wlr-sheet-num">' + (r.is_billable ? '<span style="color:var(--success);font-weight:700">✓</span>' : '<span style="color:var(--text3)">—</span>') + '</td>' +
      '<td class="wlr-sheet-td" style="white-space:nowrap">' +
        (canEdit ? '<button class="btn-icon" title="Edit" onclick="window._wlrEditWorklog(\'' + r.id + '\')">✏️</button>' : '') +
        (canEdit ? '<button class="btn-icon" title="Delete" onclick="window._wlrDeleteWorklog(\'' + r.id + '\',\'' + r.issue_id + '\')" style="opacity:.5">🗑</button>' : '') +
      '</td>' +
    '</tr>';
  });

  // Totals row
  html += '<tr class="wlr-sheet-total">' +
    '<td colspan="6" style="text-align:right;font-weight:700;color:var(--text2)">TOTAL (' + totalCount + ' entries)</td>' +
    '<td class="wlr-sheet-num" style="font-weight:700;color:var(--accent)">' + (totalMins/60).toFixed(2) + '</td>' +
    '<td class="wlr-sheet-num" style="font-weight:700">' + totalMins + '</td>' +
    '<td colspan="3"></td>' +
  '</tr>';

  html += '</tbody></table></div>';
  return matrixHtml + divider + html;
}

// ── Worklog Edit Modal ──
window._wlrEditWorklog = function(id) {
  var r = _wlrData.find(function(x){ return x.id === id; });
  if (!r) return;
  var html = '<div class="modal-overlay" id="wlrEditOverlay" onclick="if(event.target===this)document.getElementById(\'wlrEditOverlay\').remove()">' +
    '<div class="modal-box" style="max-width:420px">' +
    '<div class="modal-header"><h3>Edit Work Log</h3><button class="btn-icon" onclick="document.getElementById(\'wlrEditOverlay\').remove()">✕</button></div>' +
    '<div class="modal-body" style="display:grid;gap:14px">' +
      '<div><label class="form-label">Issue</label><p style="font-size:13px;margin:0;color:var(--text2)">' + esc(r.issue_key) + ' — ' + esc(r.issue_title||'') + '</p></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label class="form-label">Time Spent (minutes)</label><input id="wlrEditTime" class="input" type="number" min="1" value="' + (r.time_spent||0) + '"></div>' +
        '<div><label class="form-label">Date</label><input id="wlrEditDate" class="input" type="date" value="' + esc(r.work_date ? r.work_date.slice(0,10) : '') + '"></div>' +
      '</div>' +
      '<div><label class="form-label">Description</label><textarea id="wlrEditDesc" class="input" rows="8">' + esc(r.description||'') + '</textarea></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><input id="wlrEditBillable" type="checkbox"' + (r.is_billable ? ' checked' : '') + ' style="width:16px;height:16px"><label for="wlrEditBillable" class="form-label" style="margin:0">Billable</label></div>' +
    '</div>' +
    '<div class="modal-footer"><span style="flex:1"></span>' +
      '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'wlrEditOverlay\').remove()">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" onclick="window._wlrSaveWorklog(\'' + id + '\')">💾 Save</button>' +
    '</div></div></div>';
  var el = document.createElement('div'); el.innerHTML = html;
  document.body.appendChild(el.firstChild);
};

window._wlrSaveWorklog = async function(id) {
  var payload = {
    time_spent:  parseInt($('wlrEditTime').value, 10) || 0,
    work_date:   $('wlrEditDate').value || null,
    description: $('wlrEditDesc').value || null,
    is_billable: $('wlrEditBillable').checked
  };
  try {
    await api('/api/worklogs/' + id, 'PUT', payload);
    var ov = $('wlrEditOverlay'); if (ov) ov.remove();
    toast('Work log updated');
    await _wlrFetch();
  } catch(e) { toast('Failed to save: ' + (e.message||e), 'error'); }
};

window._wlrDeleteWorklog = async function(id, issueId) {
  if (!confirm('Delete this work log entry? This cannot be undone.')) return;
  try {
    await api('/api/worklogs/' + id, 'DELETE');
    toast('Work log deleted');
    await _wlrFetch();
  } catch(e) { toast('Delete failed: ' + (e.message||e), 'error'); }
};

// ── Old fixed Pivot (reused by Timesheet for matrix section) ──
function _wlrPivotTable(rows) {
  if (!rows || !rows.length) return '<p class="text-muted placeholder-text">No work logs found for the selected filters.</p>';

  var allDates = rows.map(function(r){ return r.work_date ? r.work_date.slice(0,10) : null; }).filter(Boolean).sort();
  if (!allDates.length) return '<p class="text-muted placeholder-text">No work logs found for the selected filters.</p>';
  var daySpan = Math.round((new Date(allDates[allDates.length-1]) - new Date(allDates[0])) / 86400000) + 1;
  var mode = daySpan <= 31 ? 'day' : daySpan <= 210 ? 'week' : 'month';

  var pivotData = {}, bucketSet = {};
  rows.forEach(function(r) {
    var uid = r.user_id;
    var bucket = _wlrBucketDate(r.work_date || '', mode);
    if (!bucket) return;
    bucketSet[bucket] = true;
    if (!pivotData[uid]) {
      var u = findUser(uid);
      pivotData[uid] = { userName: u ? u.name : (r.user_name || uid), totalMins: 0, byDate: {}, issues: {} };
    }
    var ud = pivotData[uid];
    ud.totalMins += (r.time_spent || 0);
    ud.byDate[bucket] = (ud.byDate[bucket] || 0) + (r.time_spent || 0);
    var iid = r.issue_id;
    if (!ud.issues[iid]) {
      ud.issues[iid] = { issueKey: r.issue_key || '—', issueTitle: r.issue_title || '—', issueId: iid, totalMins: 0, byDate: {} };
    }
    var id = ud.issues[iid];
    id.totalMins += (r.time_spent || 0);
    id.byDate[bucket] = (id.byDate[bucket] || 0) + (r.time_spent || 0);
  });

  var buckets = Object.keys(bucketSet).sort();

  var colTotals = {}, grandTotal = 0;
  buckets.forEach(function(b){ colTotals[b] = 0; });
  Object.keys(pivotData).forEach(function(uid) {
    buckets.forEach(function(b){ colTotals[b] += (pivotData[uid].byDate[b] || 0); });
    grandTotal += pivotData[uid].totalMins;
  });

  var maxCell = 0;
  Object.keys(pivotData).forEach(function(uid) {
    var ud = pivotData[uid];
    buckets.forEach(function(b){ if ((ud.byDate[b]||0) > maxCell) maxCell = ud.byDate[b]||0; });
    Object.keys(ud.issues).forEach(function(iid) {
      buckets.forEach(function(b){ if ((ud.issues[iid].byDate[b]||0) > maxCell) maxCell = ud.issues[iid].byDate[b]||0; });
    });
  });

  var userIds = Object.keys(pivotData).sort(function(a,b){ return pivotData[a].userName.localeCompare(pivotData[b].userName); });

  var html = '<div class="wlr-pivot-wrap"><table class="wlr-pivot-table"><thead><tr>';
  html += '<th class="wlr-pivot-th wlr-pivot-label-col">User / Issue</th>';
  buckets.forEach(function(b){ html += '<th class="wlr-pivot-th wlr-pivot-date-col">' + esc(_wlrBucketLabel(b, mode)) + '</th>'; });
  html += '<th class="wlr-pivot-th wlr-pivot-total-col">Total</th></tr></thead><tbody>';

  userIds.forEach(function(uid) {
    var ud = pivotData[uid];
    html += '<tr class="wlr-pivot-user-row"><td class="wlr-pivot-td wlr-pivot-label-col wlr-pivot-user-label">' + esc(ud.userName) + '</td>';
    buckets.forEach(function(b) {
      var v = ud.byDate[b] || 0;
      html += '<td class="wlr-pivot-td wlr-pivot-cell" style="' + _wlrHeatColor(v, maxCell) + '">' + (v ? _wlrFmt(v) : '<span class="wlr-pivot-empty">—</span>') + '</td>';
    });
    html += '<td class="wlr-pivot-td wlr-pivot-total-cell">' + _wlrFmt(ud.totalMins) + '</td></tr>';

    Object.keys(ud.issues).sort(function(a,b){ return ud.issues[a].issueKey.localeCompare(ud.issues[b].issueKey); }).forEach(function(iid) {
      var id = ud.issues[iid];
      html += '<tr class="wlr-pivot-issue-row"><td class="wlr-pivot-td wlr-pivot-label-col wlr-pivot-issue-label">'
        + '<span class="wlr-pivot-issue-key" onclick="openIssuePage(\'' + id.issueId + '\')">' + esc(id.issueKey) + '</span>'
        + ' <span class="wlr-pivot-issue-title">' + esc(id.issueTitle) + '</span></td>';
      buckets.forEach(function(b) {
        var v = id.byDate[b] || 0;
        html += '<td class="wlr-pivot-td wlr-pivot-cell" style="' + _wlrHeatColor(v, maxCell) + '">' + (v ? _wlrFmt(v) : '<span class="wlr-pivot-empty">—</span>') + '</td>';
      });
      html += '<td class="wlr-pivot-td wlr-pivot-total-cell">' + _wlrFmt(id.totalMins) + '</td></tr>';
    });
  });

  html += '</tbody><tfoot><tr class="wlr-pivot-footer-row"><td class="wlr-pivot-td wlr-pivot-label-col wlr-pivot-footer-label">TOTAL</td>';
  buckets.forEach(function(b) {
    var v = colTotals[b] || 0;
    html += '<td class="wlr-pivot-td wlr-pivot-cell wlr-pivot-footer-cell">' + (v ? _wlrFmt(v) : '<span class="wlr-pivot-empty">—</span>') + '</td>';
  });
  html += '<td class="wlr-pivot-td wlr-pivot-total-cell wlr-pivot-grand-total">' + _wlrFmt(grandTotal) + '</td></tr></tfoot></table></div>';

  return html;
}

function _wlrFmt(mins) {
  if (!mins) return '0h';
  var h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
}

function _wlrCard(icon, label, value, color) {
  return '<div class="wlr-card" style="border-top:3px solid ' + color + '">' +
    '<div class="wlr-card-icon">' + icon + '</div>' +
    '<div class="wlr-card-body">' +
      '<div class="wlr-card-value">' + value + '</div>' +
      '<div class="wlr-card-label">' + label + '</div>' +
    '</div></div>';
}

window._wlrExportCSV = function() {
  if (!_wlrData.length) { toast('No data to export', 'error'); return; }
  var rows = [['Date','User','Space','Ticket','Title','Time (mins)','Time (h:m)','Description','Billable']];
  _wlrData.forEach(function(r) {
    var u = findUser(r.user_id), sp = getSpace(r.space_id);
    rows.push([
      r.work_date ? r.work_date.slice(0,10) : '',
      u ? u.name : (r.user_name||''),
      sp ? sp.name : '',
      r.issue_key||'',
      r.issue_title||'',
      r.time_spent||0,
      _wlrFmt(r.time_spent||0),
      r.description||'',
      r.is_billable ? 'Yes' : 'No'
    ]);
  });
  var csv = rows.map(function(row){ return row.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], {type:'text/csv'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'worklog-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
};

// ═══════════════════════════════════════════════════════════
// SUMMARY TAB
// ═══════════════════════════════════════════════════════════
function renderSummary() {
  var issues = getSpaceIssues(S.currentSpace);
  var total = issues.length;
  var todo = 0, inProg = 0, inRev = 0, done = 0, overdue = 0;
  var now = new Date();
  for (var i = 0; i < issues.length; i++) {
    var iss = issues[i];
    if (iss.status === 'To Do') todo++;
    else if (iss.status === 'In Progress') inProg++;
    else if (iss.status === 'In Review') inRev++;
    else if (iss.status === 'Done') done++;
    if (iss.due_date && new Date(iss.due_date) < now && iss.status !== 'Done') overdue++;
  }

  $('summaryStats').innerHTML =
    statCard('Total Issues', total, '#0129ac', 'all') +
    statCard('To Do', todo, STATUS_COLORS['To Do'], 'To Do') +
    statCard('In Progress', inProg, STATUS_COLORS['In Progress'], 'In Progress') +
    statCard('Done', done, STATUS_COLORS['Done'], 'Done') +
    statCard('Overdue', overdue, '#dc2626', 'overdue');

  // Widgets
  var sprints = getSpaceSprints(S.currentSpace);
  var activeSprint = null;
  for (var s = 0; s < sprints.length; s++) {
    if (sprints[s].status === 'active') { activeSprint = sprints[s]; break; }
  }
  var recentIssues = issues.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 5);
  var unassigned = issues.filter(function (iss) { return !iss.assignee_id; });

  var widgets = '';

  // Sprint progress widget
  if (activeSprint) {
    var spIssues = issues.filter(function (iss) { return iss.sprint_id == activeSprint.id; });
    var spDone = spIssues.filter(function (iss) { return iss.status === 'Done'; }).length;
    var spTotal = spIssues.length;
    var pct = spTotal ? Math.round((spDone / spTotal) * 100) : 0;
    widgets += '<div class="widget-card">' +
      '<h4 class="widget-title">Sprint Progress: ' + esc(activeSprint.name) + '</h4>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<p class="text-muted">' + spDone + ' / ' + spTotal + ' issues done (' + pct + '%)</p></div>';
  }

  // Recent issues widget
  widgets += '<div class="widget-card"><h4 class="widget-title">Recently Updated</h4>';
  for (var r = 0; r < recentIssues.length; r++) {
    var ri = recentIssues[r];
    widgets += '<div class="widget-list-item" onclick="openIssuePage(\'' + ri.id + '\')">' +
      '<span class="issue-key">' + esc(issueKeyStr(ri)) + '</span> ' +
      '<span>' + esc(ri.title) + '</span> ' +
      '<span class="text-muted">' + relativeTime(ri.updated_at) + '</span></div>';
  }
  widgets += '</div>';

  // Unassigned widget
  widgets += '<div class="widget-card"><h4 class="widget-title">Unassigned Issues (' + unassigned.length + ')</h4>';
  var unShow = unassigned.slice(0, 5);
  for (var u = 0; u < unShow.length; u++) {
    widgets += '<div class="widget-list-item" onclick="openIssuePage(\'' + unShow[u].id + '\')">' +
      '<span class="issue-key">' + esc(issueKeyStr(unShow[u])) + '</span> ' +
      '<span>' + esc(unShow[u].title) + '</span></div>';
  }
  if (!unassigned.length) widgets += '<p class="text-muted">All issues assigned</p>';
  widgets += '</div>';

  $('summaryWidgets').innerHTML = widgets;

  // Charts
  var statusGroups = [
    { label: 'To Do', count: todo, color: STATUS_COLORS['To Do'] },
    { label: 'In Progress', count: inProg, color: STATUS_COLORS['In Progress'] },
    { label: 'In Review', count: inRev, color: STATUS_COLORS['In Review'] },
    { label: 'Done', count: done, color: STATUS_COLORS['Done'] }
  ];
  // Space's own configured priority list, not the fixed 5 -- an admin-added
  // priority value's issues used to be silently excluded from this chart.
  var prioGroups = getIssuePriorityOptionsForSpace(S.currentSpace).map(function (o) {
    return {
      label: o.l,
      count: issues.filter(function (iss) { return iss.priority === o.v; }).length,
      color: PRIORITY_COLORS[o.v] || fallbackAccentColor(o.v)
    };
  });

  $('summaryCharts').innerHTML =
    '<div class="chart-card"><h4 class="chart-title">Status Distribution</h4>' + barChart(statusGroups, total) + '</div>' +
    '<div class="chart-card"><h4 class="chart-title">Priority Distribution</h4>' + barChart(prioGroups, total) + '</div>';
}

;


// ═══════════════════════════════════════════════════════════
// TIMELINE TAB
// ═══════════════════════════════════════════════════════════
function barChart(groups, total) {
  var max = 0;
  for (var i = 0; i < groups.length; i++) { if (groups[i].count > max) max = groups[i].count; }
  if (max === 0) max = 1;
  var H = 150;
  var bars = groups.map(function(g) {
    var px = g.count > 0 ? Math.max(Math.round((g.count/max)*H), 4) : 0;
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0">' +
      '<span style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:4px">' + g.count + '</span>' +
      '<div style="width:70%;height:' + px + 'px;background:' + g.color + ';border-radius:5px 5px 0 0"></div>' +
      '<div style="width:70%;height:2px;background:var(--border)"></div>' +
      '<span style="font-size:10px;color:var(--text3);margin-top:5px;text-align:center;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis">' + g.label + '</span>' +
    '</div>';
  }).join('');
  var legend = groups.map(function(g) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)">' +
      '<span style="width:9px;height:9px;border-radius:2px;background:' + g.color + ';flex-shrink:0;display:inline-block"></span>' +
      g.label + ' &middot; ' + g.count + '</span>';
  }).join('');
  return '<div style="display:flex;align-items:flex-end;gap:8px;height:' + (H+50) + 'px">' + bars + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' + legend + '</div>';
}
function renderTimeline() {
  var issues = getSpaceIssues(S.currentSpace).filter(function (i) { return i.start_date && i.due_date; });
  if (!issues.length) {
    $('timelineContainer').innerHTML = '<p class="placeholder-text">No issues with date ranges to display on timeline.</p>';
    return;
  }

  var allDates = [];
  for (var i = 0; i < issues.length; i++) {
    allDates.push(new Date(issues[i].start_date).getTime());
    allDates.push(new Date(issues[i].due_date).getTime());
  }
  var minDate = new Date(Math.min.apply(null, allDates));
  var maxDate = new Date(Math.max.apply(null, allDates));
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);
  var totalDays = Math.ceil((maxDate - minDate) / 86400000);

  // Week headers
  var weeks = [];
  var wd = new Date(minDate);
  wd.setDate(wd.getDate() - wd.getDay());
  while (wd <= maxDate) {
    weeks.push(new Date(wd));
    wd.setDate(wd.getDate() + 7);
  }

  var dayWidth = 24;
  var totalWidth = totalDays * dayWidth;

  var html = '<div class="timeline-chart" style="min-width:' + (totalWidth + 250) + 'px">';

  // Header
  html += '<div class="timeline-header-row"><div class="timeline-label-col">Issue</div>' +
    '<div class="timeline-dates-col" style="width:' + totalWidth + 'px">';
  for (var w = 0; w < weeks.length; w++) {
    var offset = Math.ceil((weeks[w] - minDate) / 86400000) * dayWidth;
    html += '<span class="timeline-week-label" style="left:' + offset + 'px">' + fmtDateShort(weeks[w]) + '</span>';
  }
  html += '</div></div>';

  // Rows
  for (var j = 0; j < issues.length; j++) {
    var iss = issues[j];
    var start = new Date(iss.start_date);
    var end = new Date(iss.due_date);
    var leftDays = Math.max(0, Math.ceil((start - minDate) / 86400000));
    var duration = Math.max(1, Math.ceil((end - start) / 86400000));
    var left = leftDays * dayWidth;
    var width = duration * dayWidth;
    var color = STATUS_COLORS[iss.status] || '#6b7280';

    html += '<div class="timeline-row">' +
      '<div class="timeline-label-col" onclick="openIssuePage(\'' + iss.id + '\')" style="cursor:pointer">' +
      '<span class="issue-key">' + esc(issueKeyStr(iss)) + '</span> ' +
      '<span class="timeline-issue-title">' + esc(iss.title) + '</span></div>' +
      '<div class="timeline-dates-col" style="width:' + totalWidth + 'px">' +
      '<div class="timeline-bar" style="left:' + left + 'px;width:' + width + 'px;background:' + color + '" title="' + esc(iss.title) + '"></div>' +
      '</div></div>';
  }

  html += '</div>';
  $('timelineContainer').innerHTML = html;
}

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
    toast('That sprint is completed — move the ticket to an active or planning sprint instead.', 'error');
    return;
  }
  try {
    await api('/api/issues/' + issueId + '/move', 'PUT', { sprint_id: targetSprintId, position: 0 });
    await refreshData();
    renderBacklog();
    toast('Issue moved');
  } catch(e) {
    toast('Failed to move issue — is the server running?', 'error');
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

// ═══════════════════════════════════════════════════════════
// ACTIVE SPRINT (BOARD) TAB
// ═══════════════════════════════════════════════════════════
function renderSprintBoard() {
  var sprints = getSpaceSprints(S.currentSpace);
  var activeSprints = sprints.filter(function(sp) { return sp.status === 'active'; });

  if (!activeSprints.length) {
    $('sprintHeader').innerHTML = '';
    $('sprintBoard').innerHTML = '<p class="placeholder-text">No active sprint. Go to Backlog to start a sprint.</p>';
    return;
  }

  $('sprintHeader').innerHTML = '';
  var allBoardHtml = '';
  var statuses = ISSUE_STATUSES;

  for (var si = 0; si < activeSprints.length; si++) {
    var activeSprint = activeSprints[si];
    var issues = getSpaceIssues(S.currentSpace).filter(function (i) { return i.sprint_id == activeSprint.id; });
    var doneCount = issues.filter(function (i) { return i.status === 'Done'; }).length;
    var pct = issues.length ? Math.round((doneCount / issues.length) * 100) : 0;
    var totalPoints = issues.reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);
    var donePoints = issues.filter(function (i) { return i.status === 'Done'; }).reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);

    allBoardHtml += '<div class="multi-sprint-section">' +
      '<div class="sprint-info">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
      '<h3 style="margin:0">' + esc(activeSprint.name) + '</h3>' +
      '<button class="btn btn-sm btn-secondary" onclick="window._completeSprint(\'' + activeSprint.id + '\')">Complete Sprint</button>' +
      '</div>' +
      (activeSprint.goal ? '<p class="sprint-goal">' + esc(activeSprint.goal) + '</p>' : '') +
      '<div class="sprint-stats-row">' +
      '<span>\ud83d\udcc5 ' + fmtDateShort(activeSprint.start_date) + ' \u2014 ' + fmtDateShort(activeSprint.end_date) + '</span>' +
      '<span>\ud83c\udfaf ' + doneCount + '/' + issues.length + ' issues</span>' +
      '<span>\u2b50 ' + donePoints + '/' + totalPoints + ' pts</span>' +
      '<span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--text2)">' + pct + '%</span>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="board-cols">';

    for (var c = 0; c < statuses.length; c++) {
      var status = statuses[c];
      var colIssues = issues.filter(function (i) { return i.status === status; });
      allBoardHtml += '<div class="board-col" data-status="' + status + '" data-sprint-id="' + activeSprint.id + '" ' +
        'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
        'ondragleave="this.classList.remove(\'drag-over\')" ' +
        'ondrop="window._dropToStatus(event,\'' + status + '\')">' +
        '<div class="board-col-header"><span>' + status + '</span>' +
        '<span class="col-count">' + colIssues.length + '</span></div>' +
        '<div class="board-col-body">';
      for (var ci = 0; ci < colIssues.length; ci++) {
        allBoardHtml += boardCard(colIssues[ci]);
      }
      allBoardHtml += '</div></div>';
    }
    allBoardHtml += '</div></div>';
  }
  $('sprintBoard').innerHTML = allBoardHtml;
}

function boardCard(iss) {
  var assignee = findUser(iss.assignee_id);
  var isSubtask = iss.type === 'subtask';
  var parentTag = '';
  if (isSubtask && iss.parent_id) {
    var parent = S.data.issues.find(function(i){ return i.id === iss.parent_id; });
    if (parent) parentTag = '<span class="subtask-parent-ref" style="font-size:10px;margin-left:4px">' + esc(parent.key) + '</span>';
  }
  return '<div class="board-card' + (isSubtask ? ' board-card-subtask' : '') + '" draggable="true" data-issue-id="' + iss.id + '" ' +
    'ondragstart="event.dataTransfer.setData(\'text/plain\',\'' + iss.id + '\')" ' +
    'onclick="openIssuePage(\'' + iss.id + '\')">' +
    '<div class="board-card-header"><span class="issue-type-icon" style="font-size:12px">' + typeIcon(iss.type) + '</span> <span class="issue-key">' + esc(issueKeyStr(iss)) + '</span>' + parentTag +
    (iss.story_points != null ? '<span class="badge badge-points" style="margin-left:auto">' + iss.story_points + '</span>' : '') +
    '</div>' +
    '<div class="board-card-title">' + esc(iss.title) + '</div>' +
    '<div class="board-card-footer">' + priorityBadge(iss.priority) + avatarHtml(assignee, 24) + '</div></div>';
}

window._dropToStatus = async function (event, status) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  var issueId = event.dataTransfer.getData('text/plain');
  if (!issueId) return;
  if (status === 'Done') {
    var cached = (S.data.issues || []).find(function (iss) { return iss.id === issueId; });
    if (!canTransitionIssueToDone(cached || issueId)) return;
  }
  await api('/api/issues/' + issueId, 'PUT', { status: status });
  await refreshData();
  renderSprintBoard();
  toast('Issue moved to ' + status);
};

// ═══════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════
function renderCalendar() {
  var date = S.calendarDate;
  var year = date.getFullYear();
  var month = date.getMonth();
  var monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  $('calendarHeader').textContent = monthName;
  $('calendarPrev').onclick = function () { S.calendarDate = new Date(year, month - 1, 1); renderCalendar(); };
  $('calendarNext').onclick = function () { S.calendarDate = new Date(year, month + 1, 1); renderCalendar(); };

  qsa('[data-calendar-view]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.calendarView === S.calendarView);
    btn.onclick = function () { S.calendarView = btn.dataset.calendarView; renderCalendar(); };
  });

  var issues = getSpaceIssues(S.currentSpace);
  var firstDay = new Date(year, month, 1);
  var lastDay = new Date(year, month + 1, 0);
  var startPad = firstDay.getDay();
  var totalDays = lastDay.getDate();
  var todayStr = fmtDateISO(new Date());

  var weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var html = '<div class="calendar-weekdays">';
  for (var w = 0; w < weekdays.length; w++) {
    html += '<div class="calendar-weekday">' + weekdays[w] + '</div>';
  }
  html += '</div><div class="calendar-days">';

  for (var p = 0; p < startPad; p++) {
    html += '<div class="calendar-day calendar-day-empty"></div>';
  }

  for (var d = 1; d <= totalDays; d++) {
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var isToday = dateStr === todayStr;
    var dayIssues = issues.filter(function (i) { return fmtDateISO(i.due_date) === dateStr; });

    html += '<div class="calendar-day' + (isToday ? ' calendar-today' : '') + '">' +
      '<div class="calendar-day-num">' + d + '</div><div class="calendar-day-issues">';

    var showCount = Math.min(dayIssues.length, 3);
    for (var di = 0; di < showCount; di++) {
      var ci = dayIssues[di];
      html += '<div class="calendar-issue" onclick="openIssuePage(\'' + ci.id + '\')" style="border-left:3px solid ' + (STATUS_COLORS[ci.status] || '#6b7280') + '">' +
        '<span class="calendar-issue-key">' + esc(issueKeyStr(ci)) + '</span></div>';
    }
    if (dayIssues.length > 3) {
      html += '<span class="text-muted">+' + (dayIssues.length - 3) + ' more</span>';
    }
    html += '</div></div>';
  }

  var totalCells = startPad + totalDays;
  var remainder = totalCells % 7;
  if (remainder > 0) {
    for (var rr = 0; rr < 7 - remainder; rr++) {
      html += '<div class="calendar-day calendar-day-empty"></div>';
    }
  }
  html += '</div>';
  $('calendarGrid').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════════════
function renderReports() {
  var sel = $('reportSelector');
  sel.onchange = function () { renderReportContent(sel.value, window._lastSelectedSprintId); };
  renderReportContent(sel.value);
}

async function renderReportContent(type, selectedSprintId) {
  var c = $('reportContent');
  c.innerHTML = '<p class="text-muted">Loading report…</p>';
  try {
    var allSprints = getSpaceSprints(S.currentSpace);
    var activeSprint = (selectedSprintId && allSprints.find(function(sp){ return sp.id === selectedSprintId; }))
      || allSprints.find(function(sp){ return sp.status === 'active'; })
      || allSprints[allSprints.length - 1];
    if (activeSprint) window._lastSelectedSprintId = activeSprint.id;
    // Only reports actually scoped to one sprint get a Sprint picker. Velocity
    // Trend and Cumulative Flow are cross-sprint/space-wide — their data
    // queries never look at activeSprint, so showing a "Sprint:" dropdown
    // there looked interactive but silently did nothing when changed. Control
    // Chart WAS in that category too, but now queries per-sprint data.
    var sprintTypes = ['sprint-summary','story-summary','burndown','team-workload','bug-summary','epic-progress','scope-change','blocked-items','spillover','control'];
    var sprintSelectorHtml = (sprintTypes.indexOf(type) >= 0 && allSprints && allSprints.length > 0)
      ? '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text2);margin-right:8px">Sprint:</label>' +
        '<select class="input input-sm" onchange="window._globalRptSprintChange(this.value,\'' + type + '\')">' +
        allSprints.map(function(sp) {
          return '<option value="' + sp.id + '"' + (activeSprint && sp.id === activeSprint.id ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
        }).join('') + '</select></div>'
      : '';
    if (sprintTypes.indexOf(type) >= 0 && !activeSprint) { c.innerHTML = '<p class="placeholder-text">No sprints found.</p>'; return; }
    if (type === 'sprint-summary') {
      var dSS = await api('/api/reports/sprint/' + activeSprint.id);
      renderSprintSummaryReport(c, dSS, allSprints, sprintSelectorHtml);
    } else if (type === 'story-summary') {
      renderStorySummaryReport(c, activeSprint, allSprints, sprintSelectorHtml);
    } else if (type === 'burndown') {
      var data = await api('/api/reports/burndown/' + activeSprint.id);
      renderBurndownReport(c, data, allSprints, sprintSelectorHtml);
    } else if (type === 'velocity') {
      var data2 = await api('/api/reports/velocity?space_id=' + S.currentSpace);
      renderVelocityReport(c, data2, allSprints, sprintSelectorHtml);
    } else if (type === 'team-workload') {
      var dTW = await api('/api/reports/team-workload/' + activeSprint.id);
      renderTeamWorkloadReport(c, dTW, activeSprint, allSprints, sprintSelectorHtml);
    } else if (type === 'bug-summary') {
      var dBS = await api('/api/reports/bugs/' + activeSprint.id);
      renderBugSummaryReport(c, dBS, activeSprint, allSprints, sprintSelectorHtml);
    } else if (type === 'epic-progress') {
      renderEpicProgressReport(c, activeSprint, allSprints, sprintSelectorHtml);
    } else if (type === 'scope-change') {
      var dSC = await api('/api/reports/scope-change/' + activeSprint.id);
      renderScopeChangeReport(c, dSC, allSprints, sprintSelectorHtml);
    } else if (type === 'blocked-items') {
      renderBlockedItemsReport(c, activeSprint, allSprints, sprintSelectorHtml);
    } else if (type === 'spillover') {
      var dSP = await api('/api/reports/spillover/' + activeSprint.id);
      renderSpilloverReport(c, dSP, allSprints, sprintSelectorHtml);
    } else if (type === 'cumulative') {
      var data3 = await api('/api/reports/status?space_id=' + S.currentSpace);
      renderCumulativeReport(c, data3, allSprints, sprintSelectorHtml);
    } else if (type === 'control') {
      var data4 = await api('/api/reports/control-chart/' + activeSprint.id);
      renderControlChart(c, data4, allSprints, sprintSelectorHtml);
    }
    window._globalRptSprintChange = async function(sprintId, rtype) {
      window._lastSelectedSprintId = sprintId;
      var cont = $('reportContent') || c;
      cont.innerHTML = '<p class="text-muted">Loading…</p>';
      var selSprint = allSprints.find(function(sp){ return sp.id === sprintId; });
      try {
        var newSel = '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text2);margin-right:8px">Sprint:</label>' +
          '<select class="input input-sm" onchange="window._globalRptSprintChange(this.value,\'' + rtype + '\')">' +
          allSprints.map(function(sp) {
            return '<option value="' + sp.id + '"' + (sp.id === sprintId ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
          }).join('') + '</select></div>';
        if (rtype === 'sprint-summary') {
          var d = await api('/api/reports/sprint/' + sprintId);
          renderSprintSummaryReport(cont, d, allSprints, newSel);
        } else if (rtype === 'story-summary') {
          renderStorySummaryReport(cont, selSprint, allSprints, newSel);
        } else if (rtype === 'burndown') {
          var d = await api('/api/reports/burndown/' + sprintId);
          renderBurndownReport(cont, d, allSprints, newSel);
        } else if (rtype === 'velocity') {
          var d2 = await api('/api/reports/velocity?space_id=' + S.currentSpace);
          renderVelocityReport(cont, d2, allSprints, newSel);
        } else if (rtype === 'team-workload') {
          var d = await api('/api/reports/team-workload/' + sprintId);
          renderTeamWorkloadReport(cont, d, selSprint, allSprints, newSel);
        } else if (rtype === 'bug-summary') {
          var d = await api('/api/reports/bugs/' + sprintId);
          renderBugSummaryReport(cont, d, selSprint, allSprints, newSel);
        } else if (rtype === 'epic-progress') {
          renderEpicProgressReport(cont, selSprint, allSprints, newSel);
        } else if (rtype === 'scope-change') {
          var d = await api('/api/reports/scope-change/' + sprintId);
          renderScopeChangeReport(cont, d, allSprints, newSel);
        } else if (rtype === 'blocked-items') {
          renderBlockedItemsReport(cont, selSprint, allSprints, newSel);
        } else if (rtype === 'spillover') {
          var d = await api('/api/reports/spillover/' + sprintId);
          renderSpilloverReport(cont, d, allSprints, newSel);
        } else if (rtype === 'cumulative') {
          var d3 = await api('/api/reports/status?space_id=' + S.currentSpace);
          renderCumulativeReport(cont, d3, allSprints, newSel);
        } else if (rtype === 'control') {
          var d4 = await api('/api/reports/control-chart/' + sprintId);
          renderControlChart(cont, d4, allSprints, newSel);
        }
      } catch(e) { cont.innerHTML = '<p class="text-muted">Error: ' + esc(e.message) + '</p>'; }
    };
  } catch (e) {
    c.innerHTML = '<p class="text-muted">Failed to load report: ' + esc(e.message) + '</p>';
  }
}

// ── Shared drill-down popup used by every report's clickable metrics ──
// A report populates window._reportDrillData[key] = { label, issues } for
// each stat it wants clickable, then wires that tile's onclick to
// window._showReportIssues('key'). Shared across reports so every metric
// (Burn Chart KPIs, Sprint Summary tiles/chips/bars, etc.) uses one popup.
window._reportDrillData = window._reportDrillData || {};
window._showReportIssues = function(key) {
  var group = (window._reportDrillData || {})[key];
  if (!group) return;
  var existing = document.getElementById('_reportDrillOverlay');
  if (existing) existing.remove();

  // Point-based groups (Story Points Completed/Remaining/Total) show each
  // issue's own point value so the list visibly adds up to the tile's number,
  // instead of mixing in 0/unpointed issues that inflate the list without
  // affecting the sum.
  var rows = group.issues.length
    ? group.issues.map(function(iss) {
        var assignee = findUser(iss.assignee_id);
        var ptsBadge = group.points
          ? '<span style="font-size:11px;font-weight:700;color:#0052cc;background:#deebff;border-radius:10px;padding:2px 8px;flex-shrink:0">' + (Number(iss.story_points) || 0) + ' pt' + (Number(iss.story_points) === 1 ? '' : 's') + '</span>'
          : '';
        return '<div class="_reportDrillRow" data-id="' + iss.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'">' +
          '<span style="flex-shrink:0">' + typeIcon(iss.type) + '</span>' +
          '<span style="font-size:12px;font-weight:700;color:#6b778c;flex-shrink:0;min-width:64px">' + esc(issueKeyStr(iss)) + '</span>' +
          '<span style="flex:1;font-size:13px;color:#172b4d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(iss.title || '') + '</span>' +
          ptsBadge +
          statusBadge(iss.status) +
          (assignee ? avatarHtml(assignee, 24) : '') +
        '</div>';
      }).join('')
    : '<div style="padding:28px;text-align:center;color:#6b778c;font-size:13px">No issues in this group.</div>';

  var headerCount = group.issues.length + (group.issues.length === 1 ? ' issue' : ' issues');
  if (group.points) {
    var ptsSum = group.issues.reduce(function(s, i) { return s + (Number(i.story_points) || 0); }, 0);
    headerCount = ptsSum + ' pt' + (ptsSum === 1 ? '' : 's') + ' across ' + headerCount;
  }

  var overlay = document.createElement('div');
  overlay.id = '_reportDrillOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;width:100%;max-width:560px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden">' +
      '<div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
        '<div style="font-size:15px;font-weight:700;color:#0f172a">' + esc(group.label) + ' (' + headerCount + ')</div>' +
        '<button id="_reportDrillClose" style="width:28px;height:28px;border:none;background:#f1f5f9;border-radius:8px;cursor:pointer;font-size:16px;color:#64748b">&times;</button>' +
      '</div>' +
      '<div style="overflow-y:auto">' + rows + '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  var close = function() { if (document.body.contains(overlay)) overlay.remove(); };
  overlay.querySelector('#_reportDrillClose').onclick = close;
  overlay.onclick = function(e) { if (e.target === overlay) close(); };
  overlay.querySelectorAll('._reportDrillRow').forEach(function(row) {
    row.onclick = function() {
      var id = row.dataset.id;
      close();
      // openIssuePage (not openDrawer directly) so this push a history entry
      // like every other drawer-opening path — opening straight via openDrawer
      // only does a replaceState internally, so Back from here used to skip
      // past the drawer entirely instead of closing it first.
      openIssuePage(id);
    };
  });
};

function renderBurndownReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = data.sprint || {};
  var total = Number(data.total) || 0;
  var totalPts = Number(data.totalPts) || 0;
  var series = Array.isArray(data.series) ? data.series : [];

  // ── SVG line chart helper ────────────────────────────────────
  function lineChart(lines, maxY, title, yLabel) {
    var n = series.length;
    if (!n) return '<p style="padding:20px;color:var(--text3)">No daily data yet — data appears once the sprint progresses.</p>';
    // Chart width scales with the number of days so every date gets its own
    // label with room to breathe, instead of thinning labels down to ~8 on a
    // fixed-width chart. The wrapping div is already overflow-x:auto, so a
    // longer sprint just becomes horizontally scrollable.
    var H = 220, pL = 48, pR = 20, pT = 24, pB = 44;
    var W = Math.max(560, pL + pR + (n - 1) * 44);
    var plotW = W - pL - pR, plotH = H - pT - pB;
    maxY = maxY || 1;

    function xp(i) { return pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2); }
    function yp(v) { return pT + plotH - Math.min(1, v / maxY) * plotH; }

    // Grid + Y labels
    var grid = '';
    var gridSteps = 5;
    for (var g = 0; g <= gridSteps; g++) {
      var gv = Math.round((g / gridSteps) * maxY);
      var gy = yp(gv);
      grid += '<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>';
      grid += '<text x="' + (pL - 5) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + gv + '</text>';
    }

    // X labels — every day's date, not thinned
    var xLabels = '';
    for (var i2 = 0; i2 < n; i2++) {
      var x2 = xp(i2);
      var dlbl = series[i2].date ? series[i2].date.slice(5).replace('-', '/') : '';
      xLabels += '<text x="' + x2.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--text3)">' + dlbl + '</text>';
    }

    // Polylines — a line's fn() may return null/undefined for days that
    // don't have actual data yet (future days in an active sprint); those
    // points are skipped so the actual-progress line stops at today while
    // the x-axis/ideal line still spans the whole sprint.
    var polylines = lines.map(function(line) {
      var pts = [];
      for (var i3 = 0; i3 < n; i3++) {
        var v3 = line.fn(series[i3], i3);
        if (v3 === null || v3 === undefined) continue;
        pts.push(xp(i3).toFixed(1) + ',' + yp(v3).toFixed(1));
      }
      if (pts.length < 2) return '';
      var dashAttr = line.dash ? ' stroke-dasharray="' + line.dash + '"' : '';
      return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + line.color + '" stroke-width="' + (line.width || 2.5) + '"' + dashAttr + ' stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');

    // Dots on actual lines — each shows its value permanently (not just on
    // hover), plus a native tooltip with date/label for extra context.
    // Skipped for days with no actual value yet (see polylines note above).
    var dots = lines.filter(function(l) { return !l.dash; }).map(function(line) {
      var out = '';
      for (var i4 = 0; i4 < n; i4++) {
        var s = series[i4];
        var val = line.fn(s, i4);
        if (val === null || val === undefined) continue;
        var cx = xp(i4).toFixed(1), cy = yp(val).toFixed(1);
        var labelY = (parseFloat(cy) - 10).toFixed(1);
        var tip = esc(line.label) + ' — ' + esc(s.date || '') + ': ' + val + ' ' + esc(yLabel);
        out += '<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="transparent" style="cursor:pointer"><title>' + tip + '</title></circle>' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="' + line.color + '" stroke="var(--bg2)" stroke-width="1.5" style="pointer-events:none"/>' +
          '<text x="' + cx + '" y="' + labelY + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + line.color + '" stroke="var(--bg2)" stroke-width="3" paint-order="stroke" style="pointer-events:none">' + val + '</text>';
      }
      return out;
    }).join('');

    return '<div style="overflow-x:auto"><svg width="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:100%">' +
      grid + xLabels +
      '<line x1="' + pL + '" y1="' + pT + '" x2="' + pL + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      '<line x1="' + pL + '" y1="' + (pT + plotH) + '" x2="' + (W - pR) + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      polylines + dots +
      '<text x="' + (pL - 30) + '" y="' + (pT + plotH / 2) + '" text-anchor="middle" font-size="10" fill="var(--text3)" transform="rotate(-90,' + (pL - 30) + ',' + (pT + plotH / 2) + ')">' + yLabel + '</text>' +
      '</svg></div>';
  }

  // ── Legend helper ────────────────────────────────────────────
  function legend(items) {
    return '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--text2)">' +
      items.map(function(it) {
        var dash = it.dash ? 'border-top:2px dashed ' + it.color + ';border-bottom:none' : 'background:' + it.color;
        return '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="display:inline-block;width:20px;height:3px;' + dash + ';border-radius:2px"></span>' + it.label + '</span>';
      }).join('') + '</div>';
  }

  // ── KPI tiles ────────────────────────────────────────────────
  // series now spans the whole sprint, so the last entry may be a future
  // day with no actual data yet — use the last entry that has data instead
  // of the literal last array element.
  var actualSeries = series.filter(function(s) { return !s.future; });
  var lastActual = actualSeries.length ? actualSeries[actualSeries.length - 1] : null;
  var ptsDone = lastActual ? totalPts - (lastActual.remainingPts || 0) : 0;
  var ptsLeft = lastActual ? (lastActual.remainingPts || 0) : totalPts;
  var issuesDone = lastActual ? total - (lastActual.remaining || 0) : 0;
  var pct = total ? Math.round((issuesDone / total) * 100) : 0;
  var startStr = sprint.start_date ? fmtDateShort(sprint.start_date) : '—';
  var endStr = sprint.end_date ? fmtDateShort(sprint.end_date) : '—';

  // ── Issue groups behind each KPI tile, for click-to-drill-down ──
  var sprintIssues = getSpaceIssues(S.currentSpace).filter(function(i) { return i.sprint_id === sprint.id; });
  var doneIssuesArr = sprintIssues.filter(function(i) { return i.status === 'Done'; });
  var remainingIssuesArr = sprintIssues.filter(function(i) { return i.status !== 'Done'; });
  var hasPoints = function(i) { return Number(i.story_points) > 0; };
  Object.assign(window._reportDrillData, {
    total:     { label: 'Total Issues',      issues: sprintIssues },
    completed: { label: 'Completed Issues',  issues: doneIssuesArr },
    remaining: { label: 'Remaining Issues',  issues: remainingIssuesArr },
    // Points-based tiles only list issues that actually carry story points —
    // matches the point SUM shown on the tile instead of every issue regardless
    // of whether it has points set.
    ptsDone:   { label: 'Story Points Completed', issues: doneIssuesArr.filter(hasPoints), points: true },
    ptsLeft:   { label: 'Story Points Remaining', issues: remainingIssuesArr.filter(hasPoints), points: true },
    totalPts:  { label: 'Total Story Points', issues: sprintIssues.filter(hasPoints), points: true }
  });

  function kpi(label, val, color, sub, key) {
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 18px;flex:1;min-width:110px;text-align:center' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">' + label + '</div>' +
      '<div style="font-size:24px;font-weight:800;color:' + color + '">' + val + '</div>' +
      (sub ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + sub + '</div>' : '') +
      '</div>';
  }

  // ── Chart section helper ─────────────────────────────────────
  function chartCard(title, desc, chartHtml, legendHtml) {
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px">' +
      '<div style="margin-bottom:4px;font-size:14px;font-weight:700;color:var(--text)">' + title + '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">' + desc + '</div>' +
      chartHtml + legendHtml + '</div>';
  }

  // Ideal burndown: total→0 linearly across series length
  var idealStepPts = series.length > 1 ? totalPts / (series.length - 1) : 0;
  var idealStepIss = series.length > 1 ? total / (series.length - 1) : 0;

  // totalPts is read fresh from the API on every load, so editing any
  // ticket's story points — at any point in the sprint — is reflected the
  // next time this report is opened. Both reference lines below start at
  // totalPts on day 1 and hold there, so the chart always starts from the
  // current total rather than a stale snapshot from when the sprint began.
  var burndownChart = lineChart([
    { label: 'Ideal', color: '#94a3b8', dash: '6,4', width: 2,
      fn: function(s, i) { return Math.max(0, totalPts - idealStepPts * i); } },
    // remainingPts is null for days beyond today (no actual data yet) —
    // must NOT fall back to 0 here, or the line would falsely plunge to
    // zero on day 1 of an active sprint instead of just stopping.
    { label: 'Actual Remaining', color: '#dc2626', width: 2.5,
      fn: function(s) { return s.remainingPts == null ? null : s.remainingPts; } }
  ], totalPts || 1, 'Burndown', 'Story Points');

  var burnupChart = lineChart([
    { label: 'Scope', color: '#94a3b8', dash: '6,4', width: 2,
      fn: function() { return totalPts; } },
    { label: 'Completed', color: '#10b981', width: 2.5,
      fn: function(s) { return s.remainingPts == null ? null : totalPts - s.remainingPts; } }
  ], totalPts || 1, 'Burnup', 'Story Points');

  // Days elapsed vs total sprint length, for "how many days have we worked" at a glance
  var totalSprintDays = (sprint.start_date && sprint.end_date)
    ? Math.round((new Date(sprint.end_date) - new Date(sprint.start_date)) / 86400000) + 1
    : null;
  // series now spans the whole sprint (including future days with no
  // actual data yet), so "elapsed" must count only days that have data.
  var daysElapsed = series.filter(function(s) { return !s.future; }).length;
  var daysProgressHtml = totalSprintDays
    ? '<div style="font-size:11px;color:#93c5fd">🗓️ Day ' + daysElapsed + ' of ' + totalSprintDays + '</div>'
    : '';

  c.innerHTML = '<div style="display:flex;flex-direction:column;gap:16px">' +
    sprintSelectorHtml +

    // Header bar
    '<div style="background:#0f2d5e;border-radius:10px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
    '<div style="color:#fff;font-size:15px;font-weight:700">📊 Burn Chart — ' + esc(sprint.name || 'Sprint') + '</div>' +
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
    daysProgressHtml +
    '<div style="font-size:11px;color:#93c5fd">📅 ' + startStr + ' → ' + endStr + '</div>' +
    '</div>' +
    '</div>' +

    // KPI row
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    kpi('Total Issues', total, '#0052cc', null, 'total') +
    kpi('Completed', issuesDone, '#10b981', pct + '% done', 'completed') +
    kpi('Remaining Issues', total - issuesDone, '#f59e0b', null, 'remaining') +
    kpi('Pts Done', ptsDone, '#10b981', null, 'ptsDone') +
    kpi('Pts Left', ptsLeft, '#dc2626', null, 'ptsLeft') +
    kpi('Total Pts', totalPts, '#0052cc', null, 'totalPts') +
    '</div>' +

    // Burndown chart
    chartCard(
      '📉 Burndown Chart',
      'Tracks remaining story points each day. Ideal line shows the target pace — actual line should stay at or below it.',
      burndownChart,
      legend([
        { label: 'Ideal (target pace)', color: '#94a3b8', dash: true },
        { label: 'Actual Remaining', color: '#dc2626' }
      ])
    ) +

    // Burnup chart
    chartCard(
      '📈 Burnup Chart',
      'Tracks completed story points over time against total scope. Completed line should reach the scope line by sprint end.',
      burnupChart,
      legend([
        { label: 'Scope (total points)', color: '#94a3b8', dash: true },
        { label: 'Completed', color: '#10b981' }
      ])
    ) +

    '</div>';
}

// ── Sprint Summary ──────────────────────────────────────────
// Working days (Mon-Fri) and on-working-day public holidays for a sprint's
// own date range — shared by the team-wide capacity calc below and by the
// per-person capacity shown in Team Workload. Builds local-midnight dates
// from the LOCAL calendar date the timestamp falls on (matching
// fmtDateShort's display) — NOT fmtDateISO, which reads the UTC calendar
// date and can land a day earlier than what's actually shown as the
// sprint's start/end date.
function computeSprintWorkDays(sprint) {
  if (!sprint || !sprint.start_date || !sprint.end_date) return null;
  var startRaw = new Date(sprint.start_date);
  var endRaw = new Date(sprint.end_date);
  if (isNaN(startRaw) || isNaN(endRaw)) return null;
  var start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate());
  var end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate());
  if (end < start) return null;

  var workingDays = 0;
  for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  // A public holiday only reduces working days if it actually falls on one
  // (a holiday on a weekend wouldn't remove capacity that wasn't already
  // excluded).
  var holidays = (sprint.public_holidays || []).filter(function (ds) {
    var hd = new Date(ds + 'T00:00:00');
    if (isNaN(hd) || hd < start || hd > end) return false;
    var dow = hd.getDay();
    return dow !== 0 && dow !== 6;
  }).length;

  return { workingDays: workingDays, holidays: holidays };
}

// Avatar chips for a list of user ids (Developers/QA on a sprint). If
// `leavesMap` is given, a chip shows "-Nd" when that user has leave days.
function memberChipsHtml(userIds, leavesMap) {
  if (!userIds || !userIds.length) return '<div style="font-size:12px;color:var(--text3)">None assigned</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
    userIds.map(function (uid) {
      var u = findUser(uid);
      var name = u ? u.name : uid;
      var leave = leavesMap && leavesMap[uid] ? Number(leavesMap[uid]) : 0;
      var avatar = u ? avatarHtml(u, 22) : '<span class="avatar" style="width:22px;height:22px;font-size:9px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#94a3b8;color:#fff;font-weight:700;flex-shrink:0">?</span>';
      return '<div style="display:flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:4px 10px 4px 4px">' +
        avatar + '<span style="font-size:12px;color:var(--text)">' + esc(name) + '</span>' +
        (leave ? '<span style="font-size:10px;font-weight:700;color:#f59e0b">−' + leave + 'd</span>' : '') +
        '</div>';
    }).join('') +
    '</div>';
}

// Story points a single person can deliver given the sprint's working days,
// on-working-day holidays, and their own leave days: 7 hours/day at 80%
// utilization, 6.5 hours per story point.
function personCapacitySP(workDays, personLeaveDays) {
  if (!workDays) return null;
  var days = Math.max(0, workDays.workingDays - workDays.holidays - (Number(personLeaveDays) || 0));
  return Math.round(days * 7 * 0.80 / 6.5);
}

// Team capacity (in story points) for a sprint, per the agreed formula:
//   workingDaysPerDeveloper = workingDays - holidaysOnWorkingDays
//   grossPersonDays         = developers * workingDaysPerDeveloper
//   netPersonDays           = max(0, grossPersonDays - totalLeaveDays)
//   availableHours          = netPersonDays * 7 * 0.80
//   capacitySP              = round(availableHours / 6.5)
// developer_leaves is {userId: days}; sprints saved before that field
// existed fall back to the old aggregate leave_days count.
function computeSprintCapacity(sprint) {
  var workDays = computeSprintWorkDays(sprint);
  if (!workDays) return null;

  var developers = (sprint.developer_ids || []).length;
  var devLeaves = sprint.developer_leaves || {};
  var leaveDays = Object.keys(devLeaves).length
    ? Object.values(devLeaves).reduce(function (s, v) { return s + (Number(v) || 0); }, 0)
    : (Number(sprint.leave_days) || 0);

  var workingDaysPerDeveloper = Math.max(0, workDays.workingDays - workDays.holidays);
  var grossPersonDays = developers * workingDaysPerDeveloper;
  var netPersonDays = Math.max(0, grossPersonDays - leaveDays);
  var availableHours = netPersonDays * 7 * 0.80;
  var capacitySP = Math.round(availableHours / 6.5);

  return {
    workingDays: workDays.workingDays, holidays: workDays.holidays, developers: developers,
    leaveDays: leaveDays, netPersonDays: netPersonDays,
    availableHours: availableHours, capacitySP: capacitySP
  };
}

function renderSprintSummaryReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = data.sprint || {};
  var capacityInfo = computeSprintCapacity(sprint);
  var issues = getSpaceIssues(S.currentSpace).filter(function(i){ return i.sprint_id === sprint.id; });
  var total = Number(data.total) || 0;
  var done = Number(data.done) || 0;
  var inProgress = Number(data.in_progress) || 0;
  var inReview = issues.filter(function(i){ return i.status === 'In Review'; }).length;
  var blocked = issues.filter(function(i){ return i.status === 'Blocked'; }).length;
  var toDo = Math.max(0, total - done - inProgress - inReview - blocked);
  var pct = total ? Math.round((done / total) * 100) : 0;
  var ptsDone = Number(data.points_completed) || 0;
  var ptsLeft = Number(data.points_remaining) || 0;
  var totalPts = ptsDone + ptsLeft;
  var ptsPct = totalPts ? Math.round((ptsDone / totalPts) * 100) : 0;
  var bugs = issues.filter(function(i){ return i.type === 'bug'; });
  var openBugs = bugs.filter(function(i){ return i.status !== 'Done'; }).length;
  var totalBugs = bugs.length;
  var bugPct = totalBugs ? Math.round((openBugs / totalBugs) * 100) : 0;
  var blockedPct = total ? Math.round((blocked / total) * 100) : 0;
  var now = new Date();
  var endDate = sprint.end_date ? new Date(sprint.end_date) : null;
  var daysRem = endDate ? Math.max(0, Math.ceil((endDate - now) / 86400000)) : null;
  var health = pct >= 80 ? 'GOOD' : pct >= 50 ? 'AT RISK' : 'NEEDS ATTENTION';
  var healthColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#dc2626';
  var startStr = sprint.start_date ? fmtDateShort(sprint.start_date) : '—';
  var endStr = sprint.end_date ? fmtDateShort(sprint.end_date) : '—';
  var nowStr = (function(){ var d = new Date(); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); })();

  // ── Issue groups behind each stat, for click-to-drill-down ──────
  var doneIssuesArr = issues.filter(function(i){ return i.status === 'Done'; });
  var inProgressIssuesArr = issues.filter(function(i){ return i.status === 'In Progress'; });
  var inReviewIssuesArr = issues.filter(function(i){ return i.status === 'In Review'; });
  var toDoIssuesArr = issues.filter(function(i){ return i.status === 'To Do'; });
  var blockedIssuesArr = issues.filter(function(i){ return i.status === 'Blocked'; });
  var remainingIssuesArr = issues.filter(function(i){ return i.status !== 'Done'; });
  var openBugsArr = bugs.filter(function(i){ return i.status !== 'Done'; });
  // Bug status breakdown for Detailed Metrics (separate from the "Open Bugs"
  // KPI tile above, which intentionally still means "any non-Done bug").
  var closedBugsArr = bugs.filter(function(i){ return i.status === 'Done'; });
  var inProgressBugsArr = bugs.filter(function(i){ return i.status === 'In Progress'; });
  var toDoBugsArr = bugs.filter(function(i){ return i.status === 'To Do'; });
  var closedBugsPct = totalBugs ? Math.round(closedBugsArr.length / totalBugs * 100) : 0;
  var inProgressBugsPct = totalBugs ? Math.round(inProgressBugsArr.length / totalBugs * 100) : 0;
  var toDoBugsPct = totalBugs ? Math.round(toDoBugsArr.length / totalBugs * 100) : 0;
  var hasPoints = function(i) { return Number(i.story_points) > 0; };
  Object.assign(window._reportDrillData, {
    ss_total:      { label: 'Total Stories',       issues: issues },
    ss_done:       { label: 'Completed Stories',   issues: doneIssuesArr },
    ss_inprogress: { label: 'In Progress Stories', issues: inProgressIssuesArr },
    ss_inreview:   { label: 'In Review Stories',   issues: inReviewIssuesArr },
    ss_todo:       { label: 'To Do Stories',       issues: toDoIssuesArr },
    ss_blocked:    { label: 'Blocked Stories',     issues: blockedIssuesArr },
    ss_totalbugs:  { label: 'Total Bugs',          issues: bugs },
    ss_openbugs:   { label: 'Open Bugs',           issues: openBugsArr },
    ss_closedbugs:     { label: 'Closed Bugs',      issues: closedBugsArr },
    ss_inprogressbugs: { label: 'In Progress Bugs', issues: inProgressBugsArr },
    ss_todobugs:       { label: 'To Do Bugs',       issues: toDoBugsArr },
    // Points-based tiles only list issues that actually carry story points —
    // matches the point SUM shown on the tile instead of every issue in that
    // status regardless of whether it has points set.
    ss_totalpts:   { label: 'Total Story Points',       issues: issues.filter(hasPoints), points: true },
    ss_ptsdone:    { label: 'Story Points Completed',   issues: doneIssuesArr.filter(hasPoints), points: true },
    ss_ptsleft:    { label: 'Story Points Remaining',   issues: remainingIssuesArr.filter(hasPoints), points: true }
  });

  // Donut SVG helper
  function donutSvg(segments, cx, cy, r, label, sublabel) {
    var circ = 2 * Math.PI * r;
    var offset = circ * 0.25;
    var arcs = '';
    var cur = 0;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var len = seg.pct / 100 * circ;
      if (len > 0) {
        arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '" stroke-width="14"' +
          ' stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (offset - cur).toFixed(2) + '" stroke-linecap="butt"/>';
        cur += len;
      }
    }
    return '<svg width="' + (cx*2) + '" height="' + (cy*2) + '" viewBox="0 0 ' + (cx*2) + ' ' + (cy*2) + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg3)" stroke-width="14"/>' +
      arcs +
      '<text x="' + cx + '" y="' + (cy-6) + '" text-anchor="middle" font-size="20" font-weight="800" fill="var(--text)">' + label + '</text>' +
      '<text x="' + cx + '" y="' + (cy+14) + '" text-anchor="middle" font-size="10" fill="var(--text3)">' + sublabel + '</text>' +
      '</svg>';
  }

  // Progress donut (single segment)
  var progressDonut = donutSvg(
    [{ pct: pct, color: healthColor }, { pct: 100-pct, color: 'transparent' }],
    70, 70, 54, pct + '%', 'Complete'
  );

  // Story Status donut (multi-segment)
  var donePct2 = total ? Math.round(done/total*100) : 0;
  var ipPct2 = total ? Math.round(inProgress/total*100) : 0;
  var inReviewPct2 = total ? Math.round(inReview/total*100) : 0;
  var todoPct2 = total ? Math.round(toDo/total*100) : 0;
  var blkPct2 = total ? Math.round(blocked/total*100) : 0;
  var statusDonut = donutSvg(
    [{pct:donePct2,color:'#10b981'},{pct:ipPct2,color:'#f59e0b'},{pct:inReviewPct2,color:'#8b5cf6'},{pct:todoPct2,color:'#0052cc'},{pct:blkPct2,color:'#dc2626'}],
    70, 70, 54, total, 'Total Stories'
  );

  // Horizontal bar helper
  function hBar(label, val, maxVal, color, key) {
    var w = maxVal ? Math.round((val/maxVal)*100) : 0;
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" style="cursor:pointer"'
      : '';
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"' + clickable + '>' +
      '<span style="width:130px;font-size:12px;color:var(--text2);flex-shrink:0">' + label + '</span>' +
      '<div style="flex:1;background:var(--bg3);border-radius:4px;height:14px;overflow:hidden">' +
      '<div style="height:100%;width:' + w + '%;background:' + color + ';border-radius:4px;transition:width .4s"></div></div>' +
      '<span style="width:32px;font-size:12px;font-weight:700;color:var(--text);text-align:right">' + val + '</span>' +
      '</div>';
  }

  // KPI tile (top right 4 cards)
  function kpiTile(title, mainNum, total2, subLabel, accentColor, key) {
    var p = total2 ? Math.round(mainNum/total2*100) : 0;
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;flex:1;min-width:130px' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">' + title + '</div>' +
      '<div style="font-size:22px;font-weight:800;color:' + accentColor + '">' + mainNum +
        '<span style="font-size:14px;font-weight:500;color:var(--text3)"> / ' + total2 + '</span></div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + p + '% ' + subLabel + '</div>' +
      '</div>';
  }

  // SVG icon library
  var SVG = {
    clipboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
    checkCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    refresh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0052cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    bug: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
    alertCircle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    ban: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    thumbUp: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    trendUp: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
    star: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    tag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l7.29-7.29a1 1 0 0 0 0-1.41Z"/><path d="M7 7h.01"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    timer: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    chartBar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
  };

  // Metric chip (bottom detailed row)
  function metricChip(icon, label, val, sub, key) {
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;flex:1;min-width:100px;text-align:center' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="display:flex;justify-content:center;margin-bottom:4px">' + icon + '</div>' +
      '<div style="font-size:17px;font-weight:800;color:var(--text)">' + val + '</div>' +
      '<div style="font-size:11px;color:var(--text3);white-space:nowrap">' + label + '</div>' +
      (sub ? '<div style="font-size:11px;font-weight:700;color:var(--text2)">' + sub + '</div>' : '') +
      '</div>';
  }

  // Footer insight card
  function insightCard(icon, label, val, desc, color) {
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid ' + color + ';border-radius:8px;padding:14px 18px;flex:1;min-width:160px;display:flex;align-items:flex-start;gap:12px">' +
      '<span style="display:flex;align-items:center;color:' + color + '">' + icon + '</span>' +
      '<div><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:800;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + desc + '</div></div>' +
      '</div>';
  }

  c.innerHTML =
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:0">' +

    // ── Header ──
    '<div style="background:#0f2d5e;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
    '<div><div style="display:flex;align-items:center;gap:10px">' +
    '<span style="background:#1e4a8c;border-radius:8px;padding:6px 8px;display:inline-flex">' + SVG.chartBar + '</span>' +
    '<div><div style="font-size:16px;font-weight:700;color:#fff">Sprint Summary</div>' +
    '<div style="font-size:11px;color:#93c5fd">Overview of current sprint progress and health</div></div></div></div>' +
    '<div style="font-size:11px;color:#93c5fd;display:flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Last Updated: ' + nowStr + '</div>' +
    (allSprints && allSprints.length > 0
      ? '<div style="display:flex;align-items:center;gap:8px"><label style="font-size:11px;color:#93c5fd;white-space:nowrap;font-weight:600">Sprint:</label>' +
        '<select style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:5px 10px;font-size:12px;font-weight:500;max-width:200px;outline:none;cursor:pointer;backdrop-filter:blur(4px)" onchange="window._globalRptSprintChange(this.value,\'sprint-summary\')">' +
        allSprints.map(function(sp){ return '<option value="' + sp.id + '"' + (sprint.id === sp.id ? ' selected' : '') + ' style="background:#0f2d5e;color:#e2e8f0">' + esc(sp.name) + '</option>'; }).join('') +
        '</select></div>'
      : '') +
    '</div>' +

    '<div style="padding:20px;display:flex;flex-direction:column;gap:16px">' +

    // ── Row 1: Sprint Details | Progress Donut | 4 KPI tiles ──
    '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch">' +

    // Sprint Details card
    '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;min-width:180px;flex:0 0 auto">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">Sprint Details</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' + SVG.tag + '<span style="color:var(--text3)">Sprint Name</span></div>' +
    '<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:-4px;margin-left:22px">' + esc(sprint.name||'—') + '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' + SVG.calendar + '<span style="color:var(--text3)">Start Date</span><span style="margin-left:auto;font-weight:600;color:var(--text)">' + startStr + '</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' + SVG.calendar + '<span style="color:var(--text3)">End Date</span><span style="margin-left:auto;font-weight:600;color:var(--text)">' + endStr + '</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' + SVG.timer + '<span style="color:var(--text3)">Days Remaining</span>' +
    '<span style="margin-left:auto;font-weight:700;color:' + (daysRem !== null && daysRem <= 2 ? '#dc2626' : '#f59e0b') + '">' + (daysRem !== null ? daysRem + ' Days' : '—') + '</span></div>' +
    '</div></div>' +

    // Sprint Progress donut
    '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:160px;flex:0 0 auto">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Sprint Progress</div>' +
    progressDonut + '</div>' +

    // 4 KPI tiles (2x2)
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:1;min-width:300px">' +
    kpiTile('Stories Completed', done, total, 'of total stories', '#10b981', 'ss_done') +
    kpiTile('Story Points Completed', ptsDone, totalPts||1, 'of total points', '#0052cc', 'ss_ptsdone') +
    kpiTile('Open Bugs', openBugs, totalBugs || openBugs || 1, totalBugs ? 'of total bugs' : 'no bugs', '#f59e0b', 'ss_openbugs') +
    kpiTile('Blocked Stories', blocked, total || 1, 'of total stories', '#dc2626', 'ss_blocked') +
    '</div></div>' +

    // ── Row 1.5: Team — Developers | QA ──
    (((sprint.developer_ids && sprint.developer_ids.length) || (sprint.qa_ids && sprint.qa_ids.length))
      ? '<div style="display:flex;gap:14px;flex-wrap:wrap">' +
        '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;flex:1;min-width:240px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Developers</div>' +
        memberChipsHtml(sprint.developer_ids, sprint.developer_leaves) +
        '</div>' +
        '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;flex:1;min-width:240px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">QA</div>' +
        memberChipsHtml(sprint.qa_ids, null) +
        '</div>' +
        '</div>'
      : '') +

    // ── Row 2: Story Status donut | Story Points horizontal bars ──
    '<div style="display:flex;gap:14px;flex-wrap:wrap">' +

    // Story Status donut + legend
    '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;flex:1;min-width:240px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">Story Status</div>' +
    '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">' +
    statusDonut +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer" onclick="window._showReportIssues(\'ss_done\')" title="Click to view issues"><span style="width:12px;height:12px;border-radius:3px;background:#10b981;display:inline-block"></span><span style="color:var(--text2)">Completed</span><span style="margin-left:auto;font-weight:700;color:var(--text)">' + done + ' (' + donePct2 + '%)</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer" onclick="window._showReportIssues(\'ss_inprogress\')" title="Click to view issues"><span style="width:12px;height:12px;border-radius:3px;background:#f59e0b;display:inline-block"></span><span style="color:var(--text2)">In Progress</span><span style="margin-left:auto;font-weight:700;color:var(--text)">' + inProgress + ' (' + ipPct2 + '%)</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer" onclick="window._showReportIssues(\'ss_inreview\')" title="Click to view issues"><span style="width:12px;height:12px;border-radius:3px;background:#8b5cf6;display:inline-block"></span><span style="color:var(--text2)">In Review</span><span style="margin-left:auto;font-weight:700;color:var(--text)">' + inReview + ' (' + inReviewPct2 + '%)</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer" onclick="window._showReportIssues(\'ss_todo\')" title="Click to view issues"><span style="width:12px;height:12px;border-radius:3px;background:#0052cc;display:inline-block"></span><span style="color:var(--text2)">To Do</span><span style="margin-left:auto;font-weight:700;color:var(--text)">' + toDo + ' (' + todoPct2 + '%)</span></div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer" onclick="window._showReportIssues(\'ss_blocked\')" title="Click to view issues"><span style="width:12px;height:12px;border-radius:3px;background:#dc2626;display:inline-block"></span><span style="color:var(--text2)">Blocked</span><span style="margin-left:auto;font-weight:700;color:var(--text)">' + blocked + ' (' + blkPct2 + '%)</span></div>' +
    '</div></div></div>' +

    // Story Points horizontal bars
    '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px 18px;flex:1;min-width:240px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:16px;text-transform:uppercase;letter-spacing:.5px">Story Points Summary</div>' +
    hBar('Total Story Points', totalPts, totalPts||1, '#0052cc', 'ss_totalpts') +
    hBar('Completed', ptsDone, totalPts||1, '#10b981', 'ss_ptsdone') +
    hBar('Remaining', ptsLeft, totalPts||1, '#f59e0b', 'ss_ptsleft') +
    '<div style="display:flex;gap:6px;font-size:10px;color:var(--text3);margin-top:8px">' +
    '<span>0</span><span style="flex:1;text-align:center">Story Points</span><span>' + totalPts + '</span>' +
    '</div></div></div>' +

    // ── Row 3: Detailed Metrics chips ──
    '<div>' +
    '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Detailed Metrics</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    metricChip(SVG.clipboard,'Total Stories', total, '100%', 'ss_total') +
    metricChip(SVG.checkCircle,'Completed Stories', done, donePct2 + '%', 'ss_done') +
    metricChip(SVG.refresh,'In Progress Stories', inProgress, ipPct2 + '%', 'ss_inprogress') +
    metricChip(SVG.eye,'In Review', inReview, inReviewPct2 + '%', 'ss_inreview') +
    metricChip(SVG.pin,'To Do Stories', toDo, todoPct2 + '%', 'ss_todo') +
    metricChip(SVG.bug,'Total Bugs', totalBugs, '100%', 'ss_totalbugs') +
    metricChip(SVG.checkCircle,'Closed Bugs', closedBugsArr.length, closedBugsPct + '%', 'ss_closedbugs') +
    metricChip(SVG.refresh,'In Progress Bugs', inProgressBugsArr.length, inProgressBugsPct + '%', 'ss_inprogressbugs') +
    metricChip(SVG.pin,'To Do Bugs', toDoBugsArr.length, toDoBugsPct + '%', 'ss_todobugs') +
    metricChip(SVG.ban,'Blocked Stories', blocked, blockedPct + '%', 'ss_blocked') +
    '</div></div>' +

    // ── Row 4: Footer insights ──
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    insightCard(SVG.thumbUp, 'Sprint Health', health, pct >= 80 ? 'The sprint is on track! Keep up the great work.' : pct >= 50 ? 'Sprint needs attention, monitor progress.' : 'Sprint is behind schedule.', healthColor) +
    insightCard(SVG.trendUp, 'On Track', pct >= 50 ? 'On Track' : 'Behind', 'Progress is ' + (pct >= 50 ? 'as expected' : 'below target'), pct >= 50 ? '#10b981' : '#dc2626') +
    insightCard(SVG.star, 'Story Points', ptsPct + '%', 'Story points completion', '#0052cc') +
    (daysRem !== null ? insightCard(SVG.clock, 'Days Remaining', daysRem + ' Days', 'Remaining in sprint', daysRem <= 2 ? '#dc2626' : '#f59e0b') : '') +
    (capacityInfo
      ? insightCard(SVG.trendUp, 'Team Capacity', capacityInfo.capacitySP + ' pts',
          capacityInfo.developers + ' dev' + (capacityInfo.developers !== 1 ? 's' : '') + ' × ' + capacityInfo.workingDays + ' working days' +
          (capacityInfo.holidays ? ', −' + capacityInfo.holidays + ' holiday' + (capacityInfo.holidays !== 1 ? 's' : '') : '') +
          (capacityInfo.leaveDays ? ', −' + capacityInfo.leaveDays + ' leave day' + (capacityInfo.leaveDays !== 1 ? 's' : '') : '') +
          (totalPts ? ' · ' + totalPts + ' pts planned' : ''),
          totalPts > capacityInfo.capacitySP ? '#dc2626' : '#10b981')
      : '') +
    '</div>' +

    '</div></div>';
}

// ── Team Workload ───────────────────────────────────────────
function renderTeamWorkloadReport(c, data, sprintArg, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var rows = (data && Array.isArray(data.rows)) ? data.rows : (Array.isArray(data) ? data : []);
  var sprint = (data && data.sprint) || sprintArg || {};
  if (!rows.length) {
    c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml + '<p class="placeholder-text">No Developers/QA assigned to this sprint yet, and no issues assigned either.</p></div>';
    return;
  }

  // Capacity per person = their share of the sprint's working days (minus
  // on-working-day holidays and their own leave days), converted to story
  // points the same way the team-wide capacity figure is — this is what
  // "workload" is measured against, not just a raw assigned-issue count.
  var workDays = computeSprintWorkDays(sprint);
  var roleColor = { 'Developer': '#0052cc', 'QA': '#7c3aed', 'Dev + QA': '#10b981', 'Other': '#6b7280' };

  // Tickets behind each number, for the shared drill-down popup. The API only
  // returns totals, so the lists come from the loaded space issues — the same
  // source the Bug Summary and Spillover reports drill from.
  var sprintIssues = getSpaceIssues(S.currentSpace).filter(function (i) {
    return i.sprint_id === sprint.id;
  });

  var tableRows = rows.map(function(r) {
    var capacity = personCapacitySP(workDays, r.leave_days);

    var mine = sprintIssues.filter(function (i) { return i.assignee_id === r.id; });
    var doneIssues = mine.filter(function (i) { return i.status === 'Done'; });
    var openIssues = mine.filter(function (i) { return i.status !== 'Done'; });
    var safeKey = String(r.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    var who = r.name || 'Unknown';
    // points: true makes the popup show each ticket's own points and sum them
    // in its header, so the list visibly reconciles with the cell you clicked.
    window._reportDrillData['tw_asg_' + safeKey] = { label: who + ' — Assigned', issues: mine, points: true };
    window._reportDrillData['tw_cmp_' + safeKey] = { label: who + ' — Completed', issues: doneIssues, points: true };
    window._reportDrillData['tw_rem_' + safeKey] = { label: who + ' — Remaining', issues: openIssues, points: true };

    // Only offer the click when there is something to show.
    function drill(key, count) {
      if (!count) return '';
      return ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view these tickets"' +
        ' onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'"';
    }
    var clickable = 'cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;';

    // Three different ratios, all in story points — keep them straight:
    //   Workload    = assigned  / capacity  → how much we PUT ON them
    //   Utilization = completed / capacity  → how much they actually DELIVERED
    //   Completion  = completed / assigned  → how far through their own load
    var workloadPct = capacity ? Math.round((r.assigned_sp / capacity) * 100) : (r.assigned_sp ? null : 0);
    var workloadColor = workloadPct === null ? '#6b7280' : workloadPct > 100 ? '#dc2626' : workloadPct >= 80 ? '#10b981' : workloadPct >= 50 ? '#f59e0b' : '#42526e';

    var utilPct = capacity ? Math.round((r.completed_sp / capacity) * 100) : null;
    // Deliberately no red here: a low figure mid-sprint is normal, not a fault.
    var utilColor = utilPct === null ? '#6b7280' : utilPct >= 100 ? '#10b981' : utilPct >= 70 ? '#3b82f6' : utilPct >= 40 ? '#f59e0b' : '#6b7280';

    // Points, not issue counts, so the row reconciles: assigned = completed + remaining.
    var remainingSp = Math.max(r.assigned_sp - r.completed_sp, 0);
    var completionPct = r.assigned_sp ? Math.round((r.completed_sp / r.assigned_sp) * 100) : 0;
    return '<tr>' +
      '<td style="padding:10px 12px;font-weight:600;white-space:nowrap">' +
      '<div style="display:inline-flex;align-items:center;gap:8px">' +
      '<span style="width:28px;height:28px;border-radius:50%;background:' + (r.color||'#0052cc') + ';display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">' +
      esc((r.name||'?').charAt(0).toUpperCase()) + '</span>' +
      '<span>' + esc(r.name||'Unknown') +
      '<span style="display:block;font-size:10px;font-weight:700;color:' + (roleColor[r.role]||'#6b7280') + '">' + esc(r.role) + '</span></span>' +
      '</div></td>' +
      '<td style="padding:10px 12px;text-align:center;color:' + (r.leave_days ? '#f59e0b' : 'var(--text3)') + ';font-weight:600">' + (r.leave_days || 0) + '</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:var(--text)">' + (capacity !== null ? capacity : '—') + '</td>' +
      // Point totals first, then the ratios derived from them. Each total is
      // clickable and opens the tickets it was calculated from.
      '<td style="padding:10px 12px;text-align:center;' + (mine.length ? clickable : '') + '"' + drill('tw_asg_' + safeKey, mine.length) + '>' + r.assigned_sp + '</td>' +
      '<td style="padding:10px 12px;text-align:center;color:#10b981;font-weight:700;' + (doneIssues.length ? clickable : '') + '"' + drill('tw_cmp_' + safeKey, doneIssues.length) + '>' + r.completed_sp + '</td>' +
      '<td style="padding:10px 12px;text-align:center;color:#f59e0b;font-weight:600;' + (openIssues.length ? clickable : '') + '"' + drill('tw_rem_' + safeKey, openIssues.length) + '>' + remainingSp + '</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:' + workloadColor + '">' + (workloadPct !== null ? workloadPct + '%' : '—') + '</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:' + utilColor + '">' + (utilPct !== null ? utilPct + '%' : '—') + '</td>' +
      '<td style="padding:10px 12px;text-align:center;color:var(--text2)">' + completionPct + '%</td>' +
      '</tr>';
  }).join('');
  var thStyle = 'padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)';
  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 4px">Team Workload — ' + esc(sprint.name||'Sprint') + '</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 6px">' +
    (workDays ? 'Capacity is each person\'s share of ' + workDays.workingDays + ' working days' + (workDays.holidays ? ' minus ' + workDays.holidays + ' holiday' + (workDays.holidays !== 1 ? 's' : '') : '') + ', adjusted for their own leave days' : 'Set Start/End Date on this sprint to see capacity') +
    '</p>' +
    // Three percentages sit side by side, so name what each divides by.
    '<p style="font-size:11.5px;color:var(--text3);margin:0 0 16px;line-height:1.7">' +
    '<strong style="color:var(--text2)">Workload</strong> = Assigned ÷ Capacity (how much we put on them) &nbsp;·&nbsp; ' +
    '<strong style="color:var(--text2)">Utilization</strong> = Completed ÷ Capacity (how much they delivered) &nbsp;·&nbsp; ' +
    '<strong style="color:var(--text2)">Completion</strong> = Completed ÷ Assigned (how far through their load)' +
    '</p>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
    '<thead><tr>' +
    '<th style="' + thStyle + '">Team Member</th>' +
    '<th style="' + thStyle + ';text-align:center">Leave Days</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Working days available to this person, in story points">Capacity (pts)</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Story points on the tickets assigned to them in this sprint">Assigned (pts)</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Story points on their tickets that reached Done">Completed (pts)</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Assigned − Completed — points still open">Remaining (pts)</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Assigned ÷ Capacity — how heavily they are loaded. Over 100% means more work than they have days for.">Workload</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Completed ÷ Capacity — how much of their available capacity they actually delivered">Utilization</th>' +
    '<th style="' + thStyle + ';text-align:center" title="Completed ÷ Assigned — how far through their own workload">Completion</th>' +
    '</tr></thead><tbody>' + tableRows + '</tbody></table></div></div>';
}

// ── Story Summary ───────────────────────────────────────────
// Ticket counts for one sprint, broken down by status and then by assignee.
// Computed from the loaded space issues (no endpoint needed) — the same source
// Bug Summary and Blocked Items use.
// Workflow order, Blocked before Done — colours match STATUS_COLORS so a status
// reads the same here as it does on the board.
var STORY_SUMMARY_STATUSES = [
  { key: 'To Do',       label: 'To Do',       color: '#42526e' },
  { key: 'In Progress', label: 'In Progress', color: '#0052cc' },
  { key: 'In Review',   label: 'In Review',   color: '#ff991f' },
  { key: 'Blocked',     label: 'Blocked',     color: '#dc2626' },
  { key: 'Done',        label: 'Done',        color: '#00875a' }
];

function renderStorySummaryReport(c, sprint, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  sprint = sprint || {};
  var issues = getSpaceIssues(S.currentSpace).filter(function (i) { return i.sprint_id === sprint.id; });

  // All five statuses always show, so the columns are the same on every sprint
  // and a zero is a real "none blocked" answer rather than a missing column.
  var statuses = STORY_SUMMARY_STATUSES;
  var byStatus = function (list, key) { return list.filter(function (i) { return i.status === key; }); };

  if (!issues.length) {
    c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
      '<h4 style="margin:0 0 4px">Story Summary — ' + esc(sprint.name || 'Sprint') + '</h4>' +
      '<p class="placeholder-text">No tickets in this sprint yet.</p></div>';
    return;
  }

  // ── Totals across the sprint, as clickable tiles ──
  window._reportDrillData['sy_total'] = { label: 'All tickets — ' + (sprint.name || 'Sprint'), issues: issues };
  var tiles = [{ label: 'Total Tickets', value: issues.length, color: 'var(--text)', key: 'sy_total' }];
  statuses.forEach(function (s) {
    var list = byStatus(issues, s.key);
    var dk = 'sy_st_' + s.key.replace(/[^a-zA-Z0-9]/g, '_');
    window._reportDrillData[dk] = { label: s.label + ' — ' + (sprint.name || 'Sprint'), issues: list };
    tiles.push({ label: s.label, value: list.length, color: s.color, key: dk });
  });

  // Tile styling matches the other reports' KPI cards (inline, not a class —
  // that's the existing convention in this file).
  var tilesHtml = tiles.map(function (t) {
    var click = t.value
      ? ' onclick="window._showReportIssues(\'' + t.key + '\')" title="Click to view these tickets"' +
        ' onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;flex:1;min-width:120px;text-align:center' +
      (t.value ? ';cursor:pointer' : '') + '"' + click + '>' +
      '<div style="font-size:26px;font-weight:800;color:' + t.color + ';line-height:1.1">' + t.value + '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-top:6px">' + esc(t.label) + '</div>' +
      '</div>';
  }).join('');

  // ── Per-assignee breakdown ──
  var groups = {};
  issues.forEach(function (i) {
    var id = i.assignee_id || '_unassigned';
    if (!groups[id]) groups[id] = { id: id, user: i.assignee_id ? findUser(i.assignee_id) : null, issues: [] };
    groups[id].issues.push(i);
  });
  // Unassigned sorts last however many it has — it isn't a person's workload.
  var memberRows = Object.keys(groups).map(function (id) { return groups[id]; })
    .sort(function (a, b) {
      if ((a.id === '_unassigned') !== (b.id === '_unassigned')) return a.id === '_unassigned' ? 1 : -1;
      return b.issues.length - a.issues.length;
    });

  var tdBase = 'padding:10px 12px;text-align:center;font-weight:700;';
  var bodyHtml = memberRows.map(function (g) {
    var safeKey = String(g.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    var who = g.user ? g.user.name : 'Unassigned';
    window._reportDrillData['sy_u_' + safeKey] = { label: who + ' — All tickets', issues: g.issues };

    var cells = statuses.map(function (s) {
      var list = byStatus(g.issues, s.key);
      var dk = 'sy_u_' + safeKey + '_' + s.key.replace(/[^a-zA-Z0-9]/g, '_');
      window._reportDrillData[dk] = { label: who + ' — ' + s.label, issues: list };
      var click = list.length
        ? ' onclick="window._showReportIssues(\'' + dk + '\')" title="Click to view these tickets"' +
          ' onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'"'
        : '';
      return '<td style="' + tdBase + 'color:' + (list.length ? s.color : 'var(--text3)') +
        (list.length ? ';cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px' : '') +
        '"' + click + '>' + list.length + '</td>';
    }).join('');

    var donePct = Math.round((byStatus(g.issues, 'Done').length / g.issues.length) * 100);
    return '<tr>' +
      '<td style="padding:10px 12px;font-weight:600;white-space:nowrap">' +
      '<div style="display:inline-flex;align-items:center;gap:8px">' +
      (g.user ? avatarHtml(g.user, 26)
              : '<span style="width:26px;height:26px;border-radius:50%;background:var(--bg4);display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:var(--text3)">?</span>') +
      '<span>' + esc(who) + '</span></div></td>' +
      '<td style="' + tdBase + 'cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px"' +
        ' onclick="window._showReportIssues(\'sy_u_' + safeKey + '\')" title="Click to view these tickets"' +
        ' onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">' + g.issues.length + '</td>' +
      cells +
      '<td style="padding:10px 12px;text-align:center;color:var(--text2)">' + donePct + '%</td>' +
      '</tr>';
  }).join('');

  var thStyle = 'padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)';
  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 4px">Story Summary — ' + esc(sprint.name || 'Sprint') + '</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Every ticket in this sprint by status, then per assignee. Click any number to see the tickets behind it.</p>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">' + tilesHtml + '</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
    '<thead><tr>' +
    '<th style="' + thStyle + '">Assignee</th>' +
    '<th style="' + thStyle + ';text-align:center">Total</th>' +
    statuses.map(function (s) { return '<th style="' + thStyle + ';text-align:center">' + esc(s.label) + '</th>'; }).join('') +
    '<th style="' + thStyle + ';text-align:center" title="Done ÷ Total for this person">Done %</th>' +
    '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div></div>';
}

// ── Bug Summary ─────────────────────────────────────────────
function renderBugSummaryReport(c, data, sprint, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var issues = getSpaceIssues(S.currentSpace).filter(function(i){ return i.sprint_id === ((sprint||{}).id) && i.type === 'bug'; });
  var openBugsArr = issues.filter(function(i){ return i.status !== 'Done'; });
  var closedBugsArr = issues.filter(function(i){ return i.status === 'Done'; });
  var criticalBugsArr = issues.filter(function(i){ return i.priority === 'highest'; });
  var inProgressBugsArr = issues.filter(function(i){ return i.status === 'In Progress'; });
  var open = openBugsArr.length;
  var closed = closedBugsArr.length;
  var total = issues.length;
  var critical = criticalBugsArr.length;
  var inProgress = inProgressBugsArr.length;
  var resolvedPct = total ? Math.round((closed / total) * 100) : 0;
  Object.assign(window._reportDrillData, {
    bs_open:       { label: 'Open Bugs',        issues: openBugsArr },
    bs_closed:     { label: 'Closed / Fixed Bugs', issues: closedBugsArr },
    bs_critical:   { label: 'Critical Bugs',    issues: criticalBugsArr },
    bs_total:      { label: 'Total Bugs',       issues: issues },
    bs_inprogress: { label: 'In Progress Bugs', issues: inProgressBugsArr }
  });
  var kpiCard = function(label, val, color, key) {
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;flex:1;min-width:120px;text-align:center' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="font-size:32px;font-weight:800;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:4px;font-weight:600">' + label + '</div>' +
      '</div>';
  };
  var bugRows = issues.map(function(i) {
    var sc = {'To Do':'#42526e','In Progress':'#0052cc','In Review':'#ff991f','Done':'#10b981'}[i.status]||'#42526e';
    return '<tr><td style="padding:8px 12px">' + esc(i.key) + '</td>' +
      '<td style="padding:8px 12px;color:var(--text2)">' + esc(i.title) + '</td>' +
      '<td style="padding:8px 12px"><span style="background:' + sc + '22;color:' + sc + ';border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">' + esc(i.status) + '</span></td>' +
      '<td style="padding:8px 12px;font-size:11px;color:var(--text3)">' + esc(i.priority||'—') + '</td></tr>';
  }).join('');
  var thStyle = 'padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)';

  // ── Bugs by Developer — assigned count, split into open vs closed ──
  var devGroups = {};
  issues.forEach(function(i) {
    var aid = i.assignee_id || '_unassigned';
    if (!devGroups[aid]) devGroups[aid] = { assigneeId: i.assignee_id, open: [], closed: [] };
    (i.status === 'Done' ? devGroups[aid].closed : devGroups[aid].open).push(i);
  });
  var devRows = Object.keys(devGroups).map(function(aid) {
    var g = devGroups[aid];
    var user = g.assigneeId ? findUser(g.assigneeId) : null;
    var name = user ? user.name : 'Unassigned';
    var devTotal = g.open.length + g.closed.length;
    var safeKey = aid.replace(/[^a-zA-Z0-9_-]/g, '_');
    Object.assign(window._reportDrillData, {
      ['bs_dev_' + safeKey + '_open']:   { label: name + ' — Open Bugs',   issues: g.open },
      ['bs_dev_' + safeKey + '_closed']: { label: name + ' — Closed Bugs', issues: g.closed }
    });
    return { name: name, user: user, devTotal: devTotal, openCount: g.open.length, closedCount: g.closed.length, safeKey: safeKey };
  }).sort(function(a, b) { return b.devTotal - a.devTotal; });

  // Donut SVG helper (same pattern used by Sprint Summary / Spillover)
  function donutSvg(segments, cx, cy, r, label, sublabel) {
    var circ = 2 * Math.PI * r;
    var offset = circ * 0.25;
    var arcs = '';
    var cur = 0;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var len = seg.pct / 100 * circ;
      if (len > 0) {
        arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '" stroke-width="12"' +
          ' stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (offset - cur).toFixed(2) + '" stroke-linecap="butt"/>';
        cur += len;
      }
    }
    return '<svg width="' + (cx*2) + '" height="' + (cy*2) + '" viewBox="0 0 ' + (cx*2) + ' ' + (cy*2) + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg3)" stroke-width="12"/>' +
      arcs +
      '<text x="' + cx + '" y="' + (cy-4) + '" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text)">' + label + '</text>' +
      '<text x="' + cx + '" y="' + (cy+13) + '" text-anchor="middle" font-size="9" fill="var(--text3)">' + sublabel + '</text>' +
      '</svg>';
  }

  var devChartHtml = devRows.length
    ? '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:20px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text)">Bugs by Developer</div>' +
      '<div style="display:flex;gap:14px;font-size:11px;color:var(--text2)">' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#dc2626;display:inline-block"></span>Open</span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#10b981;display:inline-block"></span>Closed</span>' +
      '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:20px">' +
      devRows.map(function(d) {
        var openPct = d.devTotal ? Math.round((d.openCount / d.devTotal) * 100) : 0;
        var closedPct = 100 - openPct;
        var donut = donutSvg(
          [{ pct: openPct, color: '#dc2626' }, { pct: closedPct, color: '#10b981' }],
          52, 52, 40, d.devTotal, 'bugs'
        );
        var avatar = d.user ? avatarHtml(d.user, 24) : '<span class="avatar" style="width:24px;height:24px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#94a3b8;color:#fff;font-weight:700;flex-shrink:0">?</span>';
        return '<div style="width:140px;text-align:center">' +
          '<div style="display:flex;justify-content:center">' + donut + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px">' +
          avatar + '<span style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px" title="' + esc(d.name) + '">' + esc(d.name) + '</span>' +
          '</div>' +
          '<div style="display:flex;justify-content:center;gap:8px;margin-top:6px;font-size:11px">' +
          (d.openCount ? '<span onclick="window._showReportIssues(\'bs_dev_' + d.safeKey + '_open\')" title="Click to view issues" style="cursor:pointer;color:#dc2626;font-weight:700">' + d.openCount + ' open</span>' : '<span style="color:var(--text3)">0 open</span>') +
          (d.closedCount ? '<span onclick="window._showReportIssues(\'bs_dev_' + d.safeKey + '_closed\')" title="Click to view issues" style="cursor:pointer;color:#10b981;font-weight:700">' + d.closedCount + ' closed</span>' : '<span style="color:var(--text3)">0 closed</span>') +
          '</div>' +
          '</div>';
      }).join('') +
      '</div>' +
      '</div>'
    : '';

  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 16px">Bug Summary — ' + esc((sprint||{}).name||'Sprint') + '</h4>' +
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
    kpiCard('Open Bugs', open, open > 0 ? '#dc2626' : '#10b981', 'bs_open') +
    kpiCard('In Progress', inProgress, '#0052cc', 'bs_inprogress') +
    kpiCard('Closed / Fixed', closed, '#10b981', 'bs_closed') +
    kpiCard('Critical', critical, critical > 0 ? '#dc2626' : '#42526e', 'bs_critical') +
    kpiCard('Total', total, '#0052cc', 'bs_total') +
    '</div>' +
    '<div style="margin-bottom:6px;display:flex;justify-content:space-between;font-size:12px;color:var(--text2)">' +
    '<span>Resolution Rate</span><span style="font-weight:700">' + resolvedPct + '%</span></div>' +
    '<div style="background:var(--bg3);border-radius:8px;height:10px;overflow:hidden;margin-bottom:20px">' +
    '<div style="height:100%;width:' + resolvedPct + '%;background:#10b981;border-radius:8px"></div></div>' +
    devChartHtml +
    (bugRows ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
      '<thead><tr><th style="' + thStyle + '">Key</th><th style="' + thStyle + '">Title</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Priority</th></tr></thead>' +
      '<tbody>' + bugRows + '</tbody></table></div>' : '<p class="placeholder-text">No bugs in this sprint.</p>') +
    '</div>';
}

// ── Epic Progress ───────────────────────────────────────────
function renderEpicProgressReport(c, sprint, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var allIssues = getSpaceIssues(S.currentSpace);
  var epics = allIssues.filter(function(i){ return i.type === 'epic'; });
  if (!epics.length) {
    c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml + '<p class="placeholder-text">No epics found in this space.</p></div>';
    return;
  }
  var bars = epics.map(function(epic) {
    var children = allIssues.filter(function(i){ return i.parent_id === epic.id && i.type !== 'epic'; });
    var done = children.filter(function(i){ return i.status === 'Done'; }).length;
    var total = children.length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var color = pct >= 80 ? '#10b981' : pct >= 50 ? '#0052cc' : '#f59e0b';
    return '<div style="margin-bottom:16px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<span style="font-size:13px;font-weight:600;color:var(--text)">' + esc(epic.key) + ' · ' + esc(epic.title) + '</span>' +
      '<span style="font-size:12px;font-weight:700;color:' + color + '">' + pct + '%</span>' +
      '</div>' +
      '<div style="background:var(--bg3);border-radius:8px;height:12px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:8px;transition:width .4s"></div></div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + done + ' / ' + total + ' issues done</div>' +
      '</div>';
  }).join('');
  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 20px">Epic Progress</h4>' +
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px">' +
    bars + '</div></div>';
}

// ── Scope Change ────────────────────────────────────────────
function renderScopeChangeReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = data.sprint || {};
  var committedArr = Array.isArray(data.committed) ? data.committed : [];
  var addedArr = Array.isArray(data.added) ? data.added : [];
  var removedArr = Array.isArray(data.removed) ? data.removed : [];
  var committed = committedArr.length;
  var added = addedArr.length;
  var removed = removedArr.length;
  var total = committed + added;
  Object.assign(window._reportDrillData, {
    sc_committed: { label: 'Committed at Start', issues: committedArr },
    sc_added:     { label: 'Added Mid-Sprint',   issues: addedArr },
    sc_removed:   { label: 'Removed from Sprint', issues: removedArr },
    sc_total:     { label: 'Current Total',      issues: committedArr.concat(addedArr) }
  });
  var kpi = function(label, val, color, desc, key) {
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;flex:1;min-width:140px;text-align:center' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="font-size:32px;font-weight:800;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:4px;font-weight:600">' + label + '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + desc + '</div></div>';
  };
  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 16px">Scope Change — ' + esc(sprint.name||'Sprint') + '</h4>' +
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
    kpi('Committed at Start', committed, '#0052cc', 'Stories at sprint start', 'sc_committed') +
    kpi('Added Mid-Sprint', added, '#f59e0b', 'Added after sprint started', 'sc_added') +
    kpi('Removed', removed, '#dc2626', 'Moved out of sprint', 'sc_removed') +
    kpi('Current Total', total, '#10b981', 'Committed + Added', 'sc_total') +
    '</div>' +
    (added > 0 || removed > 0
      ? '<div style="background:#f59e0b22;border:1px solid #f59e0b44;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e">' +
        '⚠️ Scope changed during sprint: +' + added + ' added, −' + removed + ' removed. Monitor for scope creep.' +
        '</div>'
      : '<div style="background:#10b98122;border:1px solid #10b98144;border-radius:8px;padding:12px 16px;font-size:13px;color:#065f46">' +
        '✅ No scope changes detected — sprint scope was stable.' + '</div>') +
    '</div>';
}

// ── Blocked Items ───────────────────────────────────────────
function renderBlockedItemsReport(c, sprint, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var issues = getSpaceIssues(S.currentSpace).filter(function(i){
    return i.sprint_id === ((sprint||{}).id) && i.status !== 'Done' && i.priority === 'highest';
  });
  var thStyle = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)';
  var tableRows = issues.map(function(i) {
    var assignee = findUser(i.assignee_id);
    var sc = {'To Do':'#42526e','In Progress':'#0052cc','In Review':'#ff991f'}[i.status]||'#42526e';
    return '<tr><td style="padding:10px 12px;font-weight:600">' + esc(i.key) + '</td>' +
      '<td style="padding:10px 12px;color:var(--text)">' + esc(i.title) + '</td>' +
      '<td style="padding:10px 12px"><span style="background:' + sc + '22;color:' + sc + ';border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">' + esc(i.status) + '</span></td>' +
      '<td style="padding:10px 12px;font-size:12px;color:var(--text2)">' + esc(assignee ? assignee.name : 'Unassigned') + '</td>' +
      '</tr>';
  }).join('');
  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 6px">Blocked / High-Risk Items — ' + esc((sprint||{}).name||'Sprint') + '</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Showing open issues with Highest priority</p>' +
    (issues.length
      ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
        '<thead><tr><th style="' + thStyle + '">Key</th><th style="' + thStyle + '">Title</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Owner</th></tr></thead>' +
        '<tbody>' + tableRows + '</tbody></table></div>'
      : '<div style="background:#10b98122;border:1px solid #10b98144;border-radius:8px;padding:16px;font-size:13px;color:#065f46">✅ No blocked or highest-priority open items in this sprint.</div>') +
    '</div>';
}

// ── Spillover ───────────────────────────────────────────────
function renderSpilloverReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = data.sprint || {};
  var issues = Array.isArray(data.spillover) ? data.spillover : [];
  var count = Number(data.count) || 0;
  var totalPts = Number(data.totalPts) || 0;
  var isCompleted = sprint.status === 'completed';

  if (!isCompleted) {
    c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
      '<h4 style="margin:0 0 16px">Spillover</h4>' +
      '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:40px;text-align:center;color:var(--text3)">' +
      '<div style="font-size:40px;margin-bottom:12px">🏁</div>' +
      '<div style="font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px">No completed sprint selected</div>' +
      '<div style="font-size:13px">Spillover is only available for completed sprints.<br>Please select a completed sprint from the dropdown above.</div>' +
      '</div></div>';
    return;
  }

  // Broken down by type, and stories further split by whether they actually
  // carry story points — a story with no points spilling is a different
  // signal (estimation gap) from a pointed one (capacity gap), so lumping
  // them together as one "Stories" number hid that distinction. Each
  // category gets its own drill-down key so clicking one only opens that
  // subset, never the full spilled list.
  var hasPoints = function(i) { return Number(i.story_points) > 0; };
  var storiesWithPtsArr = issues.filter(function(i){ return i.type === 'story' && hasPoints(i); });
  var storiesNoPtsArr   = issues.filter(function(i){ return i.type === 'story' && !hasPoints(i); });
  var tasksArr = issues.filter(function(i){ return i.type === 'task'; });
  var bugsArr  = issues.filter(function(i){ return i.type === 'bug'; });
  var otherArr = issues.filter(function(i){ return ['story','task','bug'].indexOf(i.type) === -1; });
  // The issues actually contributing to "Story Points Lost" — used to be
  // wired to the same key as "Spilled Issues" (sp_all), so clicking it
  // opened every spilled ticket instead of just the point-carrying ones.
  var withPtsArr = issues.filter(hasPoints);
  Object.assign(window._reportDrillData, {
    sp_all:           { label: 'Spilled Issues',                  issues: issues },
    sp_withpts:       { label: 'Spilled Issues (with points)',     issues: withPtsArr, points: true },
    sp_stories_pts:   { label: 'Spilled Stories (with points)',    issues: storiesWithPtsArr },
    sp_stories_nopts: { label: 'Spilled Stories (no points)',      issues: storiesNoPtsArr },
    sp_tasks:         { label: 'Spilled Tasks',                    issues: tasksArr },
    sp_bugs:          { label: 'Spilled Bugs',                     issues: bugsArr },
    sp_other:         { label: 'Spilled Other Issues',             issues: otherArr }
  });

  var kpi = function(label, val, color, desc, key) {
    var clickable = key
      ? ' onclick="window._showReportIssues(\'' + key + '\')" title="Click to view issues" onmouseover="this.style.boxShadow=\'0 0 0 2px #0052cc55\'" onmouseout="this.style.boxShadow=\'none\'"'
      : '';
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;flex:1;min-width:130px;text-align:center' + (key ? ';cursor:pointer' : '') + '"' + clickable + '>' +
      '<div style="font-size:32px;font-weight:800;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:4px;font-weight:600">' + label + '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + desc + '</div></div>';
  };

  var PCOLORS = {highest:'#dc2626',high:'#ef4444',medium:'#f59e0b',low:'#3b82f6',lowest:'#6b7280'};
  var SCOLORS = {'To Do':'#42526e','In Progress':'#0052cc','In Review':'#ff991f','Blocked':'#dc2626'};

  // Donut SVG helper (same pattern as Sprint Summary's Story Status donut)
  function donutSvg(segments, cx, cy, r, label, sublabel) {
    var circ = 2 * Math.PI * r;
    var offset = circ * 0.25;
    var arcs = '';
    var cur = 0;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var len = seg.pct / 100 * circ;
      if (len > 0) {
        arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '" stroke-width="14"' +
          ' stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (offset - cur).toFixed(2) + '" stroke-linecap="butt"/>';
        cur += len;
      }
    }
    return '<svg width="' + (cx*2) + '" height="' + (cy*2) + '" viewBox="0 0 ' + (cx*2) + ' ' + (cy*2) + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg3)" stroke-width="14"/>' +
      arcs +
      '<text x="' + cx + '" y="' + (cy-6) + '" text-anchor="middle" font-size="20" font-weight="800" fill="var(--text)">' + label + '</text>' +
      '<text x="' + cx + '" y="' + (cy+14) + '" text-anchor="middle" font-size="10" fill="var(--text3)">' + sublabel + '</text>' +
      '</svg>';
  }

  // ── Spillover by Status donut ──
  var statusOrder = ['To Do', 'In Progress', 'In Review', 'Blocked'];
  var statusCounts = statusOrder.map(function(s) {
    return { status: s, n: issues.filter(function(i){ return i.status === s; }).length };
  }).filter(function(sc){ return sc.n > 0; });
  var statusDonutHtml = '';
  if (count > 0 && statusCounts.length) {
    var donutSegs = statusCounts.map(function(sc) {
      return { pct: Math.round(sc.n / count * 100), color: SCOLORS[sc.status] || '#6b7280' };
    });
    var donut = donutSvg(donutSegs, 70, 70, 54, count, 'Spilled');
    var legend = statusCounts.map(function(sc) {
      var safeKey = sc.status.replace(/[^a-zA-Z0-9_-]/g, '_');
      window._reportDrillData['sp_status_' + safeKey] = { label: sc.status + ' — Spillover', issues: issues.filter(function(i){ return i.status === sc.status; }) };
      var pct = Math.round(sc.n / count * 100);
      return '<div onclick="window._showReportIssues(\'sp_status_' + safeKey + '\')" title="Click to view issues" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">' +
        '<span style="width:10px;height:10px;border-radius:2px;background:' + (SCOLORS[sc.status] || '#6b7280') + ';flex-shrink:0"></span>' +
        '<span style="font-size:12px;color:var(--text2);flex:1">' + esc(sc.status) + '</span>' +
        '<span style="font-size:12px;font-weight:700;color:var(--text)">' + sc.n + '</span>' +
        '<span style="font-size:11px;color:var(--text3);width:34px;text-align:right">' + pct + '%</span>' +
        '</div>';
    }).join('');
    statusDonutHtml = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;flex:1;min-width:260px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:14px">Spillover by Status</div>' +
      '<div style="display:flex;align-items:center;gap:20px">' +
      '<div style="flex-shrink:0">' + donut + '</div>' +
      '<div style="flex:1;min-width:0">' + legend + '</div>' +
      '</div></div>';
  }

  var thStyle = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)';
  // Correcting a finished sprint's record is org-admin only. The server decides
  // (can_edit_spillover) so the button is never shown to someone it would 403 for.
  var canEditSpillover = !!data.can_edit_spillover;
  var tableRows = issues.map(function(i) {
    var sc = SCOLORS[i.status] || '#42526e';
    var pc = PCOLORS[i.priority] || fallbackAccentColor(i.priority);
    var assigneeName = i.assignee ? esc(i.assignee.name) : '<span style="color:var(--text3)">Unassigned</span>';
    var typeIcon = {story:'◈',task:'☑',bug:'⚡',epic:'⬡',subtask:'⊡'}[i.type] || '◈';
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:10px 12px;font-weight:600;white-space:nowrap"><span style="color:var(--text3);margin-right:4px">' + typeIcon + '</span>' + esc(i.key) + '</td>' +
      '<td style="padding:10px 12px;color:var(--text);max-width:280px">' + esc(i.title) + '</td>' +
      '<td style="padding:10px 12px"><span style="background:' + sc + '22;color:' + sc + ';border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">' + esc(i.status) + '</span></td>' +
      '<td style="padding:10px 12px"><span style="background:' + pc + '22;color:' + pc + ';border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">' + esc(i.priority||'—') + '</span></td>' +
      '<td style="padding:10px 12px;font-size:12px">' + assigneeName + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;text-align:center;color:var(--text2)">' + (i.story_points != null ? i.story_points : '—') + '</td>' +
      (canEditSpillover
        ? '<td style="padding:10px 12px;text-align:right;white-space:nowrap">' +
            '<button class="btn btn-sm btn-outline text-danger spill-remove-btn" ' +
              'data-issue-id="' + escAttr(i.id) + '" data-key="' + escAttr(i.key) + '" ' +
              'title="Remove this ticket from the sprint\'s spillover record">Remove</button>' +
          '</td>'
        : '') +
      '</tr>';
  }).join('');

  var banner = count === 0
    ? '<div style="background:#10b98122;border:1px solid #10b98144;border-radius:8px;padding:12px 16px;font-size:13px;color:#065f46;margin-bottom:16px">🎉 No spillover — all issues were completed before the sprint ended!</div>'
    : '<div style="background:#dc262622;border:1px solid #dc262644;border-radius:8px;padding:12px 16px;font-size:13px;color:#991b1b;margin-bottom:16px">📋 <strong>' + count + ' issue' + (count !== 1 ? 's' : '') + '</strong> spilled over when this sprint was completed and moved back to the backlog.</div>';

  // ── Spillover by Developer — who's carrying the spilled-over work ──
  var devGroups = {};
  issues.forEach(function(i) {
    var aid = i.assignee_id || '_unassigned';
    if (!devGroups[aid]) devGroups[aid] = { assignee: i.assignee || null, issues: [] };
    devGroups[aid].issues.push(i);
  });
  var devRows = Object.keys(devGroups).map(function(aid) {
    var g = devGroups[aid];
    var name = g.assignee ? g.assignee.name : 'Unassigned';
    var safeKey = aid.replace(/[^a-zA-Z0-9_-]/g, '_');
    window._reportDrillData['sp_dev_' + safeKey] = { label: name + ' — Spillover', issues: g.issues };
    return { name: name, assignee: g.assignee, count: g.issues.length, safeKey: safeKey };
  }).sort(function(a, b) { return b.count - a.count; });
  var maxDevCount = Math.max.apply(null, devRows.map(function(d) { return d.count; })) || 1;
  var devChartHtml = devRows.length
    ? '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;flex:1;min-width:260px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:14px">Spillover by Developer</div>' +
      devRows.map(function(d) {
        var w = Math.round((d.count / maxDevCount) * 100);
        var avatar = d.assignee ? avatarHtml(d.assignee, 26) : '<span class="avatar" style="width:26px;height:26px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#94a3b8;color:#fff;font-weight:700;flex-shrink:0">?</span>';
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
          avatar +
          '<span style="width:120px;font-size:12px;color:var(--text2);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + '</span>' +
          '<div style="flex:1;background:var(--bg3);border-radius:4px;height:18px;overflow:hidden">' +
          '<div onclick="window._showReportIssues(\'sp_dev_' + d.safeKey + '\')" title="' + esc(d.name) + ' — ' + d.count + ' spilled" style="cursor:pointer;width:' + Math.max(w, 4) + '%;height:100%;background:#dc2626"></div>' +
          '</div>' +
          '<span style="width:90px;font-size:11px;color:var(--text3);text-align:right;flex-shrink:0">' + d.count + ' spilled</span>' +
          '</div>';
      }).join('') +
      '</div>'
    : '';

  c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
    '<h4 style="margin:0 0 4px">Spillover — ' + esc(sprint.name || 'Sprint') + '</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Issues not completed at sprint end</p>' +
    banner +
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
    kpi('Spilled Issues', count, count > 0 ? '#dc2626' : '#10b981', 'Total not completed', 'sp_all') +
    kpi('Story Points Lost', totalPts, totalPts > 0 ? '#f59e0b' : '#10b981', 'Points not delivered', 'sp_withpts') +
    kpi('Stories (w/ Pts)', storiesWithPtsArr.length, '#0052cc', 'Pointed stories spilled', 'sp_stories_pts') +
    kpi('Stories (no Pts)', storiesNoPtsArr.length, '#6b7280', 'Unpointed stories spilled', 'sp_stories_nopts') +
    kpi('Tasks', tasksArr.length, '#7c3aed', 'Tasks spilled', 'sp_tasks') +
    kpi('Bugs', bugsArr.length, '#dc2626', 'Bugs spilled', 'sp_bugs') +
    (otherArr.length ? kpi('Other', otherArr.length, '#f59e0b', 'Epics/subtasks spilled', 'sp_other') : '') +
    '</div>' +
    (statusDonutHtml || devChartHtml
      ? '<div style="display:flex;gap:20px;margin-bottom:20px;flex-wrap:wrap">' + statusDonutHtml + devChartHtml + '</div>'
      : '') +
    (issues.length
      ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
        '<thead><tr>' +
        '<th style="' + thStyle + '">Key</th>' +
        '<th style="' + thStyle + '">Title</th>' +
        '<th style="' + thStyle + '">Status</th>' +
        '<th style="' + thStyle + '">Priority</th>' +
        '<th style="' + thStyle + '">Assignee</th>' +
        '<th style="' + thStyle + ';text-align:center">SP</th>' +
        (canEditSpillover ? '<th style="' + thStyle + ';text-align:right">Actions</th>' : '') +
        '</tr></thead>' +
        '<tbody>' + tableRows + '</tbody></table></div>'
      : '') +
    '</div>';

  if (canEditSpillover) bindSpilloverRemoveButtons(c, sprint);
}

// Removing a ticket from a completed sprint's spillover record. Org admin only —
// the button is not rendered otherwise, and the endpoint enforces it again.
function bindSpilloverRemoveButtons(container, sprint) {
  container.querySelectorAll('.spill-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var key = btn.dataset.key;
      var ok = await typedConfirmDialog({
        title: 'Remove ' + key + ' from spillover?',
        intro: 'This corrects how "' + (sprint.name || 'this sprint') + '" reads in the Spillover report.',
        details: [
          'The ticket itself is not changed — it keeps its status, its sprint links and its comments',
          'Only the marker saying it spilled out of this sprint is removed',
          'The correction is recorded in the audit log against your name'
        ],
        warn: 'This rewrites a completed sprint\'s record and cannot be undone from the UI.',
        phrase: key,
        phraseHint: 'To confirm, type the ticket number',
        confirmLabel: 'Remove from spillover'
      });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = 'Removing…';
      try {
        await api('/api/sprints/' + sprint.id + '/spillover/' + btn.dataset.issueId, 'DELETE', null, { silent: true });
        toast(key + ' removed from this sprint\'s spillover', 'success');
        if (typeof renderReports === 'function') renderReports();
        else if (typeof renderCurrentView === 'function') renderCurrentView();
      } catch (e) {
        toast(e.message || 'Could not remove it from spillover', 'error');
        btn.disabled = false;
        btn.textContent = 'Remove';
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
// MBR (MONTHLY BUSINESS REVIEW) — cross-sprint trends per space
// ═══════════════════════════════════════════════════════════
var _mbrActiveTab = 'overview';
var _mbrData = null;
var _mbrDataSpace = null;

// Called two ways: with no arg on a fresh tab entry (always refetches, so a
// newly-completed sprint shows up), and with a sub-tab name from
// window._switchMbrTab (reuses the already-fetched data — no reason to
// re-hit the network just to flip between Overview and Comparison Trends).
async function renderMBR(subTab) {
  var freshEntry = !subTab;
  if (subTab) _mbrActiveTab = subTab;
  qsa('#mbrTabBar .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mtab === _mbrActiveTab);
  });
  var c = $('mbrTabContent');
  if (freshEntry || _mbrDataSpace !== S.currentSpace || !_mbrData) {
    c.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      _mbrData = await api('/api/reports/mbr/' + S.currentSpace);
      _mbrDataSpace = S.currentSpace;
    } catch (e) {
      c.innerHTML = '<p class="placeholder-text">' + esc(e.message || 'Could not load MBR data') + '</p>';
      return;
    }
  }
  if (_mbrActiveTab === 'comparison') renderMBRComparison(c, _mbrData);
  else if (_mbrActiveTab === 'achievements') renderMBRAchievements(c, _mbrData);
  else renderMBROverview(c, _mbrData);
}

window._switchMbrTab = function (tab) {
  renderMBR(tab);
  syncAppUrl();
};

// Sprint names in this app tend to be long descriptive titles ("Sprint-2:
// 350 TB from SharePoint OnPrem 2016 to SharePoint Online"), which don't fit
// under a bar. The team's naming convention puts the short identifier before
// a colon, so that's what shows under bars/columns — the full name is still
// in the hover tooltip and in the tables below.
function shortSprintLabel(name) {
  var s = String(name || '').trim();
  var idx = s.indexOf(':');
  var short = idx > 0 ? s.slice(0, idx).trim() : s;
  return short.length > 18 ? short.slice(0, 16) + '…' : short;
}

// A points-based drill-down popup should only list the tickets actually
// carrying the points it's showing — an unpointed ticket that also spilled
// contributes 0 to the number on screen and just dilutes the list.
function mbrHasPts(i) { return Number(i && i.story_points) > 0; }

// Shared SVG bar chart for every MBR chart — real X/Y axes (numeric grid on
// Y, category labels on X) instead of the CSS-flexbox bars used elsewhere in
// the app, so a category with only a couple of points doesn't look
// identical to one with zero once bars share more than one series.
function mbrBarChart(categories) {
  if (!categories.length) return '<p class="placeholder-text">No data yet.</p>';
  var maxVal = Math.max.apply(null, categories.reduce(function (acc, c) {
    return acc.concat(c.bars.map(function (b) { return b.value; }));
  }, []).concat([1])) || 1;

  var H = 220, pL = 40, pR = 20, pT = 20, pB = 40;
  var catWidth = 84;
  var n = categories.length;
  var W = Math.max(480, pL + pR + n * catWidth);
  var plotW = W - pL - pR, plotH = H - pT - pB;
  function catCenter(i) { return pL + (plotW / n) * (i + 0.5); }
  function yFor(v) { return pT + plotH - (maxVal > 0 ? (v / maxVal) * plotH : 0); }

  var gridSteps = Math.min(Math.max(Math.round(maxVal), 1), 5);
  var grid = '';
  for (var g = 0; g <= gridSteps; g++) {
    var gv = Math.round((g / gridSteps) * maxVal);
    var gy = yFor(gv);
    grid += '<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>' +
      '<text x="' + (pL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + gv + '</text>';
  }

  var body = categories.map(function (cat, i) {
    var cx = catCenter(i);
    var barCount = cat.bars.length;
    var groupW = Math.min(catWidth - 16, barCount * 28);
    var barW = groupW / barCount;
    var barsHtml = cat.bars.map(function (b, bi) {
      var bx = cx - groupW / 2 + bi * barW;
      var by = yFor(b.value);
      var bh = Math.max((pT + plotH) - by, 2);
      var clickAttr = b.key ? ' onclick="window._showReportIssues(\'' + b.key + '\')" style="cursor:pointer"' : '';
      return '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + Math.max(barW - 4, 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + b.color + '" rx="2"' + clickAttr + '><title>' + esc(b.title) + '</title></rect>' +
        (b.value > 0 ? '<text x="' + (bx + barW / 2).toFixed(1) + '" y="' + (by - 4).toFixed(1) + '" text-anchor="middle" font-size="9" font-weight="700" fill="var(--text)">' + b.value + '</text>' : '');
    }).join('');
    return barsHtml + '<text x="' + cx.toFixed(1) + '" y="' + (H - pB + 20) + '" text-anchor="middle" font-size="10" fill="var(--text2)" title="' + esc(cat.title || cat.label) + '">' + esc(cat.label) + '</text>';
  }).join('');

  return '<div style="overflow-x:auto"><svg width="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:100%">' +
    grid +
    '<line x1="' + pL + '" y1="' + pT + '" x2="' + pL + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
    '<line x1="' + pL + '" y1="' + (pT + plotH) + '" x2="' + (W - pR) + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
    body +
    '</svg></div>';
}

// How many sprints of history to show, editable via the selector at the top
// of the Overview tab. 'all' shows everything.
var _mbrSprintWindow = '5';
window._setMbrSprintWindow = function (val) {
  _mbrSprintWindow = val;
  if (_mbrData) renderMBROverview($('mbrTabContent'), _mbrData);
};

function renderMBROverview(c, data) {
  var allSprints = (data && data.sprints) || [];

  if (!allSprints.length) {
    c.innerHTML = '<div class="report-chart"><h4 style="margin:0 0 4px">MBR — Overview</h4>' +
      '<p class="placeholder-text">No completed or active sprints yet. Complete a sprint to see trends here.</p></div>';
    return;
  }

  var sprints = _mbrSprintWindow === 'all' ? allSprints : allSprints.slice(Math.max(0, allSprints.length - Number(_mbrSprintWindow)));
  var completedInWindow = sprints.filter(function (sp) { return sp.status === 'completed'; });
  var windowLabel = _mbrSprintWindow === 'all' ? 'All Sprints' : 'Last ' + _mbrSprintWindow + ' Sprints';

  var windowSelectorHtml = '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:16px">' +
    '<label style="font-size:12px;color:var(--text2)">Show:</label>' +
    '<select class="input input-sm" onchange="window._setMbrSprintWindow(this.value)">' +
    ['5', '10', '15', 'all'].map(function (v) {
      return '<option value="' + v + '"' + (v === _mbrSprintWindow ? ' selected' : '') + '>' + (v === 'all' ? 'All sprints' : 'Last ' + v + ' sprints') + '</option>';
    }).join('') + '</select></div>';

  var trendChartHtml = mbrBarChart(sprints.map(function (sp) {
    var v = sp.completed_points || 0;
    var color = sp.status === 'active' ? '#f59e0b' : '#0129ac';
    var key = 'mbr_ov_' + sp.id;
    window._reportDrillData[key] = { label: sp.name + ' — Completed Issues', issues: (sp.completed_issues || []).filter(mbrHasPts), points: true };
    return {
      label: shortSprintLabel(sp.name), title: sp.name,
      bars: [{ value: v, color: color, key: key, title: sp.name + (sp.status === 'active' ? ' (in progress)' : '') + ': ' + v + ' pts' }]
    };
  }));

  var breakdownRows = completedInWindow.length
    ? completedInWindow.map(function (r) {
        return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 12px">' + esc(r.name) + '</td>' +
          '<td style="padding:8px 12px">' + fmtDate(r.end_date) + '</td>' +
          '<td style="padding:8px 12px;text-align:right">' + r.completed_points + '</td>' +
          '<td style="padding:8px 12px;text-align:right">' + r.committed_points + '</td></tr>';
      }).join('')
    : '<tr><td colspan="4" style="padding:16px;color:var(--text3);text-align:center">No sprints completed in this window</td></tr>';

  var sprintsCompletedCount = completedInWindow.length;
  var pointsCompletedSum = completedInWindow.reduce(function (s, sp) { return s + (sp.completed_points || 0); }, 0);
  var pointsCommittedSum = completedInWindow.reduce(function (s, sp) { return s + (sp.committed_points || 0); }, 0);

  c.innerHTML = '<div class="report-chart">' +
    '<h4 style="margin:0 0 4px">MBR — Overview</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Trends across every completed and ongoing sprint in this board</p>' +
    windowSelectorHtml +
    '<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:180px">' + statCard('Sprints Completed (' + windowLabel + ')', sprintsCompletedCount, '#0129ac') + '</div>' +
    '<div style="flex:1;min-width:180px">' + statCard('Points Committed (' + windowLabel + ')', pointsCommittedSum, '#94a3b8') + '</div>' +
    '<div style="flex:1;min-width:180px">' + statCard('Points Completed (' + windowLabel + ')', pointsCompletedSum, '#10b981') + '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;font-size:11px;color:var(--text2)">' +
    '<span style="display:inline-block;width:12px;height:12px;background:#0129ac;border-radius:2px"></span> Completed' +
    '<span style="display:inline-block;width:12px;height:12px;background:#f59e0b;border-radius:2px;margin-left:8px"></span> In progress (live)' +
    '</div>' +
    trendChartHtml +
    '<h4 style="margin:24px 0 12px">' + esc(windowLabel) + ' — Breakdown</h4>' +
    '<table style="width:100%;border-collapse:collapse">' +
    '<thead><tr>' +
    '<th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Sprint</th>' +
    '<th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Completed On</th>' +
    '<th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Points Completed</th>' +
    '<th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Points Committed</th>' +
    '</tr></thead><tbody>' + breakdownRows + '</tbody></table>' +
    '</div>';
}

// Comparison Trends is scoped to CLOSED sprints only — an in-flight sprint
// hasn't spilled anything yet, so it has no place in a spillover/committed
// comparison (the Overview tab is where its live progress shows instead).
function renderMBRComparison(c, data) {
  var sprints = (data && data.completed_sprints) || [];
  var prevLast = (data && data.previous_vs_last) || { previous: null, last: null };
  var byUser = (data && data.spillover_by_user) || [];

  if (!sprints.length) {
    c.innerHTML = '<div class="report-chart"><h4 style="margin:0 0 4px">Comparison Trends</h4>' +
      '<p class="placeholder-text">No completed sprints yet. Complete a sprint to see comparisons here.</p></div>';
    return;
  }

  function drill(key, label, issues) {
    window._reportDrillData[key] = { label: label, issues: (issues || []).filter(mbrHasPts), points: true };
    return key;
  }

  var committedChartHtml = mbrBarChart(sprints.map(function (sp) {
    var committed = sp.committed_points || 0, completed = sp.completed_points || 0;
    var cKey = drill('mbr_cc_committed_' + sp.id, sp.name + ' — Committed Issues', (sp.completed_issues || []).concat(sp.spillover_issues || []));
    var dKey = drill('mbr_cc_completed_' + sp.id, sp.name + ' — Completed Issues', sp.completed_issues);
    return {
      label: shortSprintLabel(sp.name), title: sp.name,
      bars: [
        { value: committed, color: '#94a3b8', key: cKey, title: sp.name + ' — Committed: ' + committed + ' pts' },
        { value: completed, color: '#0129ac', key: dKey, title: sp.name + ' — Completed: ' + completed + ' pts' }
      ]
    };
  }));

  var spillChartHtml = mbrBarChart(sprints.map(function (sp) {
    var v = sp.spillover_points || 0;
    var key = drill('mbr_sp_' + sp.id, sp.name + ' — Spilled Issues', sp.spillover_issues);
    return {
      label: shortSprintLabel(sp.name), title: sp.name,
      bars: [{ value: v, color: v > 0 ? '#dc2626' : '#10b981', key: key, title: sp.name + ': ' + v + ' pts spilled' }]
    };
  }));

  // Previous vs Last — Completed and Spillover as two separate adjacent
  // bars per sprint (not stacked), so a small spillover value next to a
  // large completed value is still clearly visible on its own.
  var pvlCategories = [];
  [['Previous', prevLast.previous], ['Last', prevLast.last]].forEach(function (pair) {
    var label = pair[0], sp = pair[1];
    if (!sp) { pvlCategories.push({ label: label, title: label, bars: [{ value: 0, color: 'var(--border)' }] }); return; }
    var dKey = drill('mbr_pvl_completed_' + sp.id, sp.name + ' — Completed Issues', sp.completed_issues);
    var sKey = drill('mbr_pvl_spill_' + sp.id, sp.name + ' — Spilled Issues', sp.spillover_issues);
    pvlCategories.push({
      label: label + ': ' + shortSprintLabel(sp.name), title: sp.name,
      bars: [
        { value: sp.completed_points, color: '#10b981', key: dKey, title: sp.name + ' — Completed: ' + sp.completed_points + ' pts' },
        { value: sp.spillover_points, color: '#dc2626', key: sKey, title: sp.name + ' — Spillover: ' + sp.spillover_points + ' pts' }
      ]
    });
  });
  var pvlChartHtml = mbrBarChart(pvlCategories);

  // Spillover by user, sprint-wise — a table (every space member, 0 where
  // they had no spillover), capped to the last 8 sprints as columns so it
  // stays readable. Click a row to see that user's full sprint-wise trend
  // as a chart, covering every completed sprint, not just the visible ones.
  window._mbrUserTrendStore = { sprints: sprints, byUser: byUser };
  var sprintCols = sprints.slice(Math.max(0, sprints.length - 8));
  var userTruncNote = sprints.length > 8
    ? '<p style="font-size:11px;color:var(--text3);margin:4px 0 12px">Showing the last 8 of ' + sprints.length + ' sprints as columns — click a user to see their full trend.</p>' : '';
  var userRows = byUser.length
    ? byUser.map(function (u) {
        var cells = sprintCols.map(function (sp) {
          var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
          return '<td style="padding:8px 12px;text-align:right;font-size:12px">' + (ps ? ps.points : 0) + '</td>';
        }).join('');
        return '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="window._showMbrUserTrend(\'' + u.user_id + '\')" title="Click to see ' + esc(u.name) + '\'s sprint-wise trend">' +
          '<td style="padding:8px 12px;font-weight:600;white-space:nowrap"><span style="width:10px;height:10px;border-radius:2px;background:' + (u.color || '#6b7280') + ';display:inline-block;margin-right:8px"></span>' + esc(u.name) + '</td>' +
          cells + '<td style="padding:8px 12px;text-align:right;font-weight:700">' + u.total_points + '</td></tr>';
      }).join('')
    : '<tr><td colspan="' + (sprintCols.length + 2) + '" style="padding:16px;color:var(--text3);text-align:center">No developers or QA assigned to these sprints</td></tr>';
  var userHeaderCols = sprintCols.map(function (sp) {
    return '<th title="' + esc(sp.name) + '" style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border);white-space:nowrap">' + esc(shortSprintLabel(sp.name)) + '</th>';
  }).join('');

  // ── Bug Summary — overall + sprint-wise + by assignee + by reporter ──
  var bugSummary = data.bug_summary || { total_bugs: 0, open_bugs: 0, closed_bugs: 0 };
  var bugsByAssignee = data.bugs_by_assignee || [];
  var bugsByReporter = data.bugs_by_reporter || [];
  window._mbrBugTrendStore = { sprints: sprints, byAssignee: bugsByAssignee, byReporter: bugsByReporter };

  var bugChartHtml = mbrBarChart(sprints.map(function (sp) {
    var v = sp.bug_count || 0;
    // Bug counts aren't a points metric — bugs are usually unpointed, so this
    // drill-down must NOT go through drill()'s point-carrying filter (that
    // filter is only correct for the story-points-based charts above).
    var key = 'mbr_bug_' + sp.id;
    window._reportDrillData[key] = { label: sp.name + ' — Bugs', issues: sp.bugs || [] };
    return { label: shortSprintLabel(sp.name), title: sp.name, bars: [{ value: v, color: '#ef4444', key: key, title: sp.name + ': ' + v + ' bug' + (v === 1 ? '' : 's') }] };
  }));

  function bugUserTableHtml(rows, kind, emptyLabel) {
    var cols = sprints.slice(Math.max(0, sprints.length - 8));
    var headerCols = cols.map(function (sp) {
      return '<th title="' + esc(sp.name) + '" style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border);white-space:nowrap">' + esc(shortSprintLabel(sp.name)) + '</th>';
    }).join('');
    var bodyRows = rows.length
      ? rows.map(function (u) {
          var cells = cols.map(function (sp) {
            var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
            return '<td style="padding:8px 12px;text-align:right;font-size:12px">' + (ps ? ps.count : 0) + '</td>';
          }).join('');
          return '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="window._showMbrBugTrend(\'' + u.user_id + '\',\'' + kind + '\')" title="Click to see ' + esc(u.name) + '\'s sprint-wise trend">' +
            '<td style="padding:8px 12px;font-weight:600;white-space:nowrap"><span style="width:10px;height:10px;border-radius:2px;background:' + (u.color || '#6b7280') + ';display:inline-block;margin-right:8px"></span>' + esc(u.name) + '</td>' +
            cells + '<td style="padding:8px 12px;text-align:right;font-weight:700">' + u.total_count + '</td></tr>';
        }).join('')
      : '<tr><td colspan="' + (cols.length + 2) + '" style="padding:16px;color:var(--text3);text-align:center">' + emptyLabel + '</td></tr>';
    return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
      '<thead><tr><th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">User</th>' +
      headerCols +
      '<th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Total</th></tr></thead>' +
      '<tbody>' + bodyRows + '</tbody></table></div>';
  }
  var bugAssigneeTableHtml = bugUserTableHtml(bugsByAssignee, 'assignee', 'No bugs assigned across these sprints');
  var bugReporterTableHtml = bugUserTableHtml(bugsByReporter, 'reporter', 'No bugs reported across these sprints');
  var bugColTruncNote = sprints.length > 8
    ? '<p style="font-size:11px;color:var(--text3);margin:4px 0 12px">Showing the last 8 of ' + sprints.length + ' sprints as columns — click a user to see their full trend.</p>' : '';

  c.innerHTML = '<div class="report-chart">' +
    '<h4 style="margin:0 0 4px">Comparison Trends</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 20px">Sprint-over-sprint comparisons for this board — completed sprints only. Click any bar to see its tickets.</p>' +

    '<h4 style="margin:0 0 8px;font-size:13px">Story Points — Committed vs Completed</h4>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;font-size:11px;color:var(--text2)">' +
    '<span style="display:inline-block;width:12px;height:12px;background:#94a3b8;border-radius:2px"></span> Committed' +
    '<span style="display:inline-block;width:12px;height:12px;background:#0129ac;border-radius:2px;margin-left:8px"></span> Completed' +
    '</div>' +
    committedChartHtml +

    '<h4 style="margin:24px 0 8px;font-size:13px">Spillover Points Per Sprint</h4>' +
    spillChartHtml +

    '<h4 style="margin:24px 0 8px;font-size:13px">Previous Sprint vs Last Sprint</h4>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;font-size:11px;color:var(--text2)">' +
    '<span style="display:inline-block;width:12px;height:12px;background:#10b981;border-radius:2px"></span> Completed' +
    '<span style="display:inline-block;width:12px;height:12px;background:#dc2626;border-radius:2px;margin-left:8px"></span> Spillover' +
    '</div>' +
    pvlChartHtml +

    '<h4 style="margin:0 0 4px;font-size:13px">Spillover by User, Sprint-wise</h4>' +
    userTruncNote +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
    '<thead><tr><th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">User</th>' +
    userHeaderCols +
    '<th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)">Total</th></tr></thead>' +
    '<tbody>' + userRows + '</tbody></table></div>' +

    '<h4 style="margin:24px 0 4px;font-size:13px">Bug Summary</h4>' +
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:160px">' + statCard('Total Bugs', bugSummary.total_bugs, '#ef4444') + '</div>' +
    '<div style="flex:1;min-width:160px">' + statCard('Open Bugs', bugSummary.open_bugs, '#f59e0b') + '</div>' +
    '<div style="flex:1;min-width:160px">' + statCard('Closed Bugs', bugSummary.closed_bugs, '#10b981') + '</div>' +
    '</div>' +
    '<h4 style="margin:0 0 8px;font-size:13px">Bugs Per Sprint</h4>' +
    bugChartHtml +
    '<h4 style="margin:24px 0 4px;font-size:13px">Bugs by Assignee, Sprint-wise</h4>' +
    bugColTruncNote +
    bugAssigneeTableHtml +
    '<h4 style="margin:24px 0 4px;font-size:13px">Bugs Created By, Sprint-wise</h4>' +
    bugColTruncNote +
    bugReporterTableHtml +
    '</div>';
}

// Full sprint-wise bug trend for one user, either as assignee or reporter
// (Bug Summary tables are capped to 8 sprint columns — this popup covers
// every completed sprint).
window._showMbrBugTrend = function (userId, kind) {
  var store = window._mbrBugTrendStore;
  if (!store) return;
  var list = kind === 'reporter' ? store.byReporter : store.byAssignee;
  var u = list.find(function (x) { return x.user_id === userId; });
  if (!u) return;
  var existingOverlay = document.getElementById('_mbrBugTrendOverlay');
  if (existingOverlay) existingOverlay.remove();

  var sprints = store.sprints;
  var n = sprints.length;
  var values = sprints.map(function (sp) {
    var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
    return ps ? ps.count : 0;
  });
  var maxVal = Math.max.apply(null, values.concat([1]));
  var H = 220, pL = 40, pR = 24, pT = 20, pB = 40;
  var W = Math.max(480, pL + pR + Math.max(n - 1, 1) * 80);
  var plotW = W - pL - pR, plotH = H - pT - pB;
  function xp(i) { return pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2); }
  function yp(v) { return pT + plotH - (maxVal > 0 ? (v / maxVal) * plotH : 0); }

  var gridSteps = Math.min(maxVal, 5);
  var grid = '';
  for (var g = 0; g <= gridSteps; g++) {
    var gv = Math.round((g / gridSteps) * maxVal);
    var gy = yp(gv);
    grid += '<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>' +
      '<text x="' + (pL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + gv + '</text>';
  }

  var lineColor = u.color || '#ef4444';
  var linePoints = values.map(function (v, i) { return xp(i).toFixed(1) + ',' + yp(v).toFixed(1); }).join(' ');
  var xLabels = sprints.map(function (sp, i) {
    return '<text x="' + xp(i).toFixed(1) + '" y="' + (H - pB + 20) + '" text-anchor="middle" font-size="10" fill="var(--text2)">' + esc(shortSprintLabel(sp.name)) + '</text>';
  }).join('');
  var dots = sprints.map(function (sp, i) {
    var v = values[i];
    var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
    var cx = xp(i).toFixed(1), cy = yp(v).toFixed(1);
    var clickAttr = '';
    if (ps && ps.count) {
      var key = 'mbr_bugtrend_' + kind + '_' + sp.id + '_' + userId;
      window._reportDrillData[key] = { label: sp.name + ' — ' + u.name + ' (' + (kind === 'reporter' ? 'Reported' : 'Assigned') + ')', issues: ps.issues };
      clickAttr = ' onclick="window._showReportIssues(\'' + key + '\')" style="cursor:pointer"';
    }
    return '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="transparent"' + clickAttr + '><title>' + esc(sp.name) + ': ' + v + ' bug' + (v === 1 ? '' : 's') + '</title></circle>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + lineColor + '" stroke="var(--bg)" stroke-width="1.5" style="pointer-events:none"/>' +
      '<text x="' + cx + '" y="' + (Number(cy) - 10) + '" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)" style="pointer-events:none">' + v + '</text>';
  }).join('');

  var chartHtml = n
    ? '<div style="overflow-x:auto"><svg width="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:100%">' +
      grid +
      '<polyline points="' + linePoints + '" fill="none" stroke="' + lineColor + '" stroke-width="2"/>' +
      '<line x1="' + pL + '" y1="' + pT + '" x2="' + pL + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      '<line x1="' + pL + '" y1="' + (pT + plotH) + '" x2="' + (W - pR) + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      xLabels + dots +
      '</svg></div>'
    : '<p class="placeholder-text">No completed sprints yet.</p>';

  var overlay = document.createElement('div');
  overlay.id = '_mbrBugTrendOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML =
    '<div style="background:var(--bg);border-radius:12px;width:100%;max-width:720px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden">' +
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
    '<div style="font-size:15px;font-weight:700;color:var(--text)">' + esc(u.name) + ' — Bugs ' + (kind === 'reporter' ? 'Reported' : 'Assigned') + ' (' + u.total_count + ')</div>' +
    '<button id="_mbrBugTrendClose" style="width:28px;height:28px;border:none;background:var(--bg3);border-radius:8px;cursor:pointer;font-size:16px;color:var(--text3)">&times;</button>' +
    '</div>' +
    '<div style="padding:20px">' + chartHtml + '</div></div>';

  document.body.appendChild(overlay);
  var close = function () { if (document.body.contains(overlay)) overlay.remove(); };
  overlay.querySelector('#_mbrBugTrendClose').onclick = close;
  overlay.onclick = function (e) { if (e.target === overlay) close(); };
};

// Full sprint-wise spillover trend for one user (Comparison Trends' user
// table is capped to 8 sprint columns for readability — this popup covers
// every completed sprint, and each bar drills into that sprint's tickets).
window._showMbrUserTrend = function (userId) {
  var store = window._mbrUserTrendStore;
  if (!store) return;
  var u = store.byUser.find(function (x) { return x.user_id === userId; });
  if (!u) return;
  var existing = document.getElementById('_mbrUserTrendOverlay');
  if (existing) existing.remove();

  var sprints = store.sprints;
  var n = sprints.length;
  var values = sprints.map(function (sp) {
    var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
    return ps ? ps.points : 0;
  });
  var maxVal = Math.max.apply(null, values.concat([1]));
  var H = 220, pL = 40, pR = 24, pT = 20, pB = 40;
  var W = Math.max(480, pL + pR + Math.max(n - 1, 1) * 80);
  var plotW = W - pL - pR, plotH = H - pT - pB;
  function xp(i) { return pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2); }
  function yp(v) { return pT + plotH - (maxVal > 0 ? (v / maxVal) * plotH : 0); }

  var gridSteps = Math.min(maxVal, 5);
  var grid = '';
  for (var g = 0; g <= gridSteps; g++) {
    var gv = Math.round((g / gridSteps) * maxVal);
    var gy = yp(gv);
    grid += '<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>' +
      '<text x="' + (pL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + gv + '</text>';
  }

  var lineColor = u.color || '#0129ac';
  var linePoints = values.map(function (v, i) { return xp(i).toFixed(1) + ',' + yp(v).toFixed(1); }).join(' ');
  var xLabels = sprints.map(function (sp, i) {
    return '<text x="' + xp(i).toFixed(1) + '" y="' + (H - pB + 20) + '" text-anchor="middle" font-size="10" fill="var(--text2)">' + esc(shortSprintLabel(sp.name)) + '</text>';
  }).join('');
  var dots = sprints.map(function (sp, i) {
    var v = values[i];
    var ps = u.per_sprint.find(function (p) { return p.sprint_id === sp.id; });
    var cx = xp(i).toFixed(1), cy = yp(v).toFixed(1);
    var clickAttr = '';
    if (ps && ps.points) {
      var key = 'mbr_ut_' + sp.id + '_' + userId;
      window._reportDrillData[key] = { label: sp.name + ' — ' + u.name + ' Spillover', issues: ps.issues.filter(mbrHasPts), points: true };
      clickAttr = ' onclick="window._showReportIssues(\'' + key + '\')" style="cursor:pointer"';
    }
    return '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="transparent"' + clickAttr + '><title>' + esc(sp.name) + ': ' + v + ' pts</title></circle>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + lineColor + '" stroke="var(--bg)" stroke-width="1.5" style="pointer-events:none"/>' +
      '<text x="' + cx + '" y="' + (Number(cy) - 10) + '" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)" style="pointer-events:none">' + v + '</text>';
  }).join('');

  var chartHtml = n
    ? '<div style="overflow-x:auto"><svg width="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:100%">' +
      grid +
      '<polyline points="' + linePoints + '" fill="none" stroke="' + lineColor + '" stroke-width="2"/>' +
      '<line x1="' + pL + '" y1="' + pT + '" x2="' + pL + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      '<line x1="' + pL + '" y1="' + (pT + plotH) + '" x2="' + (W - pR) + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      xLabels + dots +
      '</svg></div>'
    : '<p class="placeholder-text">No completed sprints yet.</p>';

  var overlay = document.createElement('div');
  overlay.id = '_mbrUserTrendOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML =
    '<div style="background:var(--bg);border-radius:12px;width:100%;max-width:720px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden">' +
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
    '<div style="font-size:15px;font-weight:700;color:var(--text)">' + esc(u.name) + ' — Spillover Trend (' + u.total_points + ' pts across ' + u.total_count + ' issue' + (u.total_count === 1 ? '' : 's') + ')</div>' +
    '<button id="_mbrUserTrendClose" style="width:28px;height:28px;border:none;background:var(--bg3);border-radius:8px;cursor:pointer;font-size:16px;color:var(--text3)">&times;</button>' +
    '</div>' +
    '<div style="padding:20px">' + chartHtml + '</div></div>';

  document.body.appendChild(overlay);
  var close = function () { if (document.body.contains(overlay)) overlay.remove(); };
  overlay.querySelector('#_mbrUserTrendClose').onclick = close;
  overlay.onclick = function (e) { if (e.target === overlay) close(); };
};

// ── MBR Achievements tab — sprint-wise highlights, entered manually ──
// (typically prompted right after a sprint is completed, but editable any
// time from this tab too, since forcing entry only at completion would
// strand sprints completed before this feature existed).
function renderMBRAchievements(c, data) {
  var sprints = ((data && data.completed_sprints) || []).slice().reverse(); // most recent first
  var canManage = canManageSpace(S.currentSpace);

  if (!sprints.length) {
    c.innerHTML = '<div class="report-chart"><h4 style="margin:0 0 4px">Achievements</h4>' +
      '<p class="placeholder-text">No completed sprints yet. Achievements can be added once a sprint is completed.</p></div>';
    return;
  }

  var cards = sprints.map(function (sp) {
    var achievements = Array.isArray(sp.achievements) ? sp.achievements : [];
    var body = achievements.length
      ? achievements.map(function (cat) {
          var items = Array.isArray(cat.items) ? cat.items.filter(function (t) { return t && t.trim(); }) : [];
          return '<div style="margin-bottom:14px">' +
            '<div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:6px">' + esc(cat.category || 'Highlights') + '</div>' +
            (items.length
              ? '<ul style="margin:0;padding-left:20px">' + items.map(function (t) { return '<li style="font-size:13px;color:var(--text2);margin-bottom:4px">' + esc(t) + '</li>'; }).join('') + '</ul>'
              : '<p style="font-size:12px;color:var(--text3);margin:0">No items</p>') +
            '</div>';
        }).join('')
      : '<p style="font-size:12px;color:var(--text3)">No achievements entered yet for this sprint.</p>';

    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 24px;margin-bottom:16px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
      '<div><div style="font-size:15px;font-weight:700;color:var(--text)">' + esc(sp.name) + '</div>' +
      '<div style="font-size:12px;color:var(--text3)">Completed ' + fmtDate(sp.end_date) + '</div></div>' +
      (canManage ? '<button class="btn btn-sm btn-outline" onclick="window._openAchievementsModal(\'' + sp.id + '\')">' + (achievements.length ? 'Edit' : '+ Add') + ' Achievements</button>' : '') +
      '</div>' +
      body +
      '</div>';
  }).join('');

  c.innerHTML = '<div class="report-chart">' +
    '<h4 style="margin:0 0 4px">Achievements</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 20px">Sprint-wise highlights, entered manually per completed sprint</p>' +
    cards +
    '</div>';
}

function achItemRowHtml(text) {
  return '<div class="ach-item-row" style="display:flex;gap:8px;margin-bottom:6px;align-items:center">' +
    '<input type="text" class="input input-sm ach-item-text" placeholder="Achievement detail" value="' + escAttr(text || '') + '" style="flex:1">' +
    '<button type="button" onclick="this.closest(\'.ach-item-row\').remove()" title="Remove" style="width:26px;height:26px;border:none;background:var(--bg3);border-radius:6px;cursor:pointer;color:var(--text3);flex-shrink:0">✕</button>' +
    '</div>';
}

function achCategoryBlockHtml(cat) {
  cat = cat || { category: '', items: [''] };
  var items = (Array.isArray(cat.items) && cat.items.length) ? cat.items : [''];
  return '<div class="ach-category-block" style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">' +
    '<input type="text" class="input ach-category-name" placeholder="Category (e.g. New Features)" value="' + escAttr(cat.category || '') + '" style="flex:1;font-weight:600">' +
    '<button type="button" onclick="this.closest(\'.ach-category-block\').remove()" title="Remove category" style="width:26px;height:26px;border:none;background:var(--bg3);border-radius:6px;cursor:pointer;color:#dc2626;flex-shrink:0">✕</button>' +
    '</div>' +
    '<div class="ach-items-container">' + items.map(achItemRowHtml).join('') + '</div>' +
    '<button type="button" class="btn btn-sm btn-outline" onclick="window._achAddItem(this)">+ Add bullet</button>' +
    '</div>';
}

window._achAddItem = function (btn) {
  var container = btn.closest('.ach-category-block').querySelector('.ach-items-container');
  container.insertAdjacentHTML('beforeend', achItemRowHtml(''));
};

window._achAddCategory = function () {
  $('_achCategoriesContainer').insertAdjacentHTML('beforeend', achCategoryBlockHtml());
};

window._openAchievementsModal = function (sprintId) {
  var sprint = (S.data.sprints || []).find(function (sp) { return sp.id === sprintId; });
  var existing = (sprint && Array.isArray(sprint.achievements)) ? sprint.achievements : [];
  var existingClosure = existing.length ? existing : [{ category: '', items: [''] }];

  var existing2 = document.getElementById('_achModalOverlay');
  if (existing2) existing2.remove();

  var overlay = document.createElement('div');
  overlay.id = '_achModalOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML =
    '<div style="background:var(--bg);border-radius:12px;width:100%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden">' +
    '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
    '<div style="font-size:15px;font-weight:700;color:var(--text)">Sprint Achievements' + (sprint ? ' — ' + esc(sprint.name) : '') + '</div>' +
    '<button id="_achModalClose" style="width:28px;height:28px;border:none;background:var(--bg3);border-radius:8px;cursor:pointer;font-size:16px;color:var(--text3)">&times;</button>' +
    '</div>' +
    '<div style="padding:20px;overflow-y:auto;flex:1" id="_achCategoriesContainer">' +
    existingClosure.map(achCategoryBlockHtml).join('') +
    '</div>' +
    '<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0">' +
    '<button type="button" class="btn btn-sm btn-outline" onclick="window._achAddCategory()">+ Add Category</button>' +
    '<div style="margin-left:auto;display:flex;gap:8px">' +
    '<button type="button" class="btn btn-outline" id="_achModalCancel">Cancel</button>' +
    '<button type="button" class="btn btn-primary" id="_achModalSave">Save</button>' +
    '</div></div></div>';

  document.body.appendChild(overlay);
  var close = function () { if (document.body.contains(overlay)) overlay.remove(); };
  overlay.querySelector('#_achModalClose').onclick = close;
  overlay.querySelector('#_achModalCancel').onclick = close;
  overlay.onclick = function (e) { if (e.target === overlay) close(); };

  overlay.querySelector('#_achModalSave').onclick = async function () {
    var achievements = [];
    qsa('#_achCategoriesContainer .ach-category-block').forEach(function (block) {
      var category = block.querySelector('.ach-category-name').value.trim();
      var items = Array.from(block.querySelectorAll('.ach-item-text')).map(function (inp) { return inp.value.trim(); }).filter(Boolean);
      if (category || items.length) achievements.push({ category: category || 'Highlights', items: items });
    });
    var btn = overlay.querySelector('#_achModalSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var updated = await api('/api/sprints/' + sprintId, 'PUT', { achievements: achievements });
      var cached = (S.data.sprints || []).find(function (sp) { return sp.id === sprintId; });
      if (cached) cached.achievements = updated.achievements;
      if (_mbrData) {
        var mbrSp = (_mbrData.completed_sprints || []).find(function (sp) { return sp.id === sprintId; });
        if (mbrSp) mbrSp.achievements = updated.achievements;
      }
      toast('Achievements saved', 'success');
      close();
      if (_mbrActiveTab === 'achievements') renderMBRAchievements($('mbrTabContent'), _mbrData);
    } catch (e) {
      toast(e.message || 'Could not save achievements', 'error');
      btn.disabled = false; btn.textContent = 'Save';
    }
  };
};

function renderVelocityReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprints = Array.isArray(data) ? data : [];
  if (!sprints.length) { c.innerHTML = '<p class="placeholder-text">No completed sprints yet. Complete a sprint to see velocity data.</p>'; return; }

  var velocities = sprints.map(function(sp) { return sp.velocity || 0; });
  var max = Math.max.apply(null, velocities) || 1;
  var avg = Math.round(velocities.reduce(function(s, v){ return s + v; }, 0) / velocities.length);
  var avgPct = Math.round((avg / max) * 100);

  var bars = sprints.map(function(sp) {
    var v = sp.velocity || 0;
    var pct = Math.round((v / max) * 100);
    var color = v >= avg ? '#10b981' : '#0129ac';
    return '<div class="velocity-bar-group">' +
      '<div class="velocity-bar" style="height:' + Math.max(pct, 4) + '%;background:' + color + '" title="' + esc(sp.name) + ': ' + v + ' pts"></div>' +
      '<span class="velocity-label">' + esc(sp.name) + '</span>' +
      '<span class="velocity-value">' + v + ' pts</span>' +
      '</div>';
  }).join('');

  c.innerHTML = '<div class="report-chart">' +
    sprintSelectorHtml +
    '<h4>Velocity Chart</h4>' +
    '<div class="report-stats-row">' + statCard('Avg Velocity', avg + ' pts', '#0129ac') + '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;font-size:11px;color:var(--text2)">' +
    '<span style="display:inline-block;width:12px;height:12px;background:#10b981;border-radius:2px"></span> Above avg' +
    '<span style="display:inline-block;width:12px;height:12px;background:#0129ac;border-radius:2px;margin-left:8px"></span> Below avg' +
    '</div>' +
    '<div style="position:relative">' +
    '<div class="velocity-bars">' + bars + '</div>' +
    '<div style="position:absolute;bottom:' + avgPct + '%;left:0;right:0;border-top:2px dashed #ef4444;pointer-events:none">' +
    '<span style="position:absolute;right:0;top:-18px;font-size:10px;color:#ef4444;background:var(--bg);padding:0 4px">avg ' + avg + '</span>' +
    '</div>' +
    '</div></div>';
}

function renderCumulativeReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var STATUSES = ISSUE_STATUSES;
  var issues = getSpaceIssues(S.currentSpace);
  var counts = STATUSES.map(function(s) {
    var apiRow = Array.isArray(data) ? data.find(function(x){ return x.status === s; }) : null;
    return {
      label: s,
      count: apiRow ? apiRow.count : issues.filter(function(i){ return i.status === s; }).length,
      color: STATUS_COLORS[s] || '#6b7280'
    };
  });
  var total = counts.reduce(function(s, g){ return s + g.count; }, 0) || 1;

  // Stacked horizontal bar
  var segments = counts.map(function(g) {
    var pct = Math.round((g.count / total) * 100);
    return '<div title="' + esc(g.label) + ': ' + g.count + '" style="width:' + pct + '%;background:' + g.color + ';height:100%;min-width:' + (g.count ? 2 : 0) + 'px"></div>';
  }).join('');

  // Legend + per-status bars
  var legend = counts.map(function(g) {
    var pct = Math.round((g.count / total) * 100);
    return '<div class="bar-row">' +
      '<span class="bar-label" style="display:flex;align-items:center;gap:6px">' +
      '<span style="display:inline-block;width:10px;height:10px;background:' + g.color + ';border-radius:2px;flex-shrink:0"></span>' +
      esc(g.label) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + g.color + '"></div></div>' +
      '<span class="bar-value">' + g.count + ' (' + pct + '%)</span>' +
      '</div>';
  }).join('');

  c.innerHTML = '<div class="report-chart">' +
    sprintSelectorHtml +
    '<h4>Cumulative Flow — Current Snapshot</h4>' +
    '<p style="font-size:12px;color:var(--text2);margin-bottom:12px">Work items across all stages (today\'s snapshot)</p>' +
    '<div style="display:flex;height:28px;border-radius:6px;overflow:hidden;margin-bottom:20px">' + segments + '</div>' +
    legend +
    '</div>';
}

function renderControlChart(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = (data && data.sprint) || {};
  var items = (data && Array.isArray(data.items)) ? data.items : (Array.isArray(data) ? data : []);
  if (!items.length) {
    c.innerHTML = '<div class="report-chart">' + sprintSelectorHtml +
      '<h4>Control Chart — Cycle Time</h4>' +
      '<p class="placeholder-text">No issues completed (In Progress → Done) in this sprint yet.</p></div>';
    return;
  }

  var cycleDays = items.map(function(r){ return parseFloat(r.cycle_days) || 0; });
  var maxDays = Math.max.apply(null, cycleDays) || 1;
  var avgDays = Math.round(cycleDays.reduce(function(s,v){ return s+v; }, 0) / cycleDays.length * 10) / 10;
  var fastest = Math.min.apply(null, cycleDays);
  var slowest = Math.max.apply(null, cycleDays);
  var colorFor = function(d) { return d < 3 ? '#10b981' : d < 7 ? '#f59e0b' : '#ef4444'; };

  Object.assign(window._reportDrillData, {
    ctrl_all: { label: 'Completed Issues', issues: items }
  });

  // ── Scatter: completion date (x) vs cycle time in days (y) — the
  // canonical "control chart" view, with a dashed average-cycle-time line.
  var withDates = items.filter(function(r){ return !!r.done_at; })
    .slice().sort(function(a,b){ return new Date(a.done_at) - new Date(b.done_at); });
  var scatterHtml = '';
  if (withDates.length) {
    var W = Math.max(560, 48 + 20 + (withDates.length - 1) * 34 + 40);
    var H = 220, pL = 48, pR = 20, pT = 16, pB = 34;
    var plotW = W - pL - pR, plotH = H - pT - pB;
    var n = withDates.length;
    var xp = function(i) { return pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2); };
    var yp = function(v) { return pT + plotH - Math.min(1, v / maxDays) * plotH; };
    var gridSteps = 4, grid = '';
    for (var g = 0; g <= gridSteps; g++) {
      var gv = Math.round((g / gridSteps) * maxDays * 10) / 10;
      var gy = yp(gv);
      grid += '<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1"/>';
      grid += '<text x="' + (pL - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--text3)">' + gv + '</text>';
    }
    var avgY = yp(avgDays);
    var avgLine = '<line x1="' + pL + '" y1="' + avgY.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + avgY.toFixed(1) + '" stroke="#0052cc" stroke-dasharray="6,4" stroke-width="1.5"/>' +
      '<text x="' + (W - pR) + '" y="' + (avgY - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#0052cc">avg ' + avgDays + 'd</text>';
    var dots = withDates.map(function(r, i) {
      var days = parseFloat(r.cycle_days) || 0;
      var cx = xp(i).toFixed(1), cy = yp(days).toFixed(1);
      var tip = esc(r.key) + ' — ' + days + 'd (' + esc(fmtDateShort(r.done_at)) + ')';
      return '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="transparent" style="cursor:pointer" onclick="openIssuePage(\'' + r.id + '\')"><title>' + tip + '</title></circle>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + colorFor(days) + '" stroke="var(--bg2)" stroke-width="1.5" style="pointer-events:none"/>';
    }).join('');
    scatterHtml = '<div style="overflow-x:auto"><svg width="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:100%">' +
      grid + avgLine +
      '<line x1="' + pL + '" y1="' + pT + '" x2="' + pL + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      '<line x1="' + pL + '" y1="' + (pT + plotH) + '" x2="' + (W - pR) + '" y2="' + (pT + plotH) + '" stroke="var(--border)" stroke-width="1.5"/>' +
      dots +
      '</svg></div>';
  }

  // ── Cycle time by assignee ──
  var byAssignee = {};
  items.forEach(function(r) {
    var aid = r.assignee ? r.assignee.id : '_unassigned';
    if (!byAssignee[aid]) byAssignee[aid] = { assignee: r.assignee || null, issues: [], totalDays: 0 };
    byAssignee[aid].issues.push(r);
    byAssignee[aid].totalDays += parseFloat(r.cycle_days) || 0;
  });
  var assigneeRows = Object.keys(byAssignee).map(function(aid) {
    var g = byAssignee[aid];
    var avg = Math.round((g.totalDays / g.issues.length) * 10) / 10;
    var safeKey = aid.replace(/[^a-zA-Z0-9_-]/g, '_');
    window._reportDrillData['ctrl_asg_' + safeKey] = { label: (g.assignee ? g.assignee.name : 'Unassigned') + ' — Completed', issues: g.issues };
    return { name: g.assignee ? g.assignee.name : 'Unassigned', assignee: g.assignee, avg: avg, count: g.issues.length, safeKey: safeKey };
  }).sort(function(a, b) { return b.avg - a.avg; });
  var maxAvg = Math.max.apply(null, assigneeRows.map(function(a){ return a.avg; })) || 1;
  var assigneeHtml = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:20px">' +
    '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:14px">Avg Cycle Time by Assignee</div>' +
    assigneeRows.map(function(a) {
      var w = Math.round((a.avg / maxAvg) * 100);
      var avatar = a.assignee ? avatarHtml(a.assignee, 26) : '<span class="avatar" style="width:26px;height:26px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#94a3b8;color:#fff;font-weight:700;flex-shrink:0">?</span>';
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
        avatar +
        '<span style="width:120px;font-size:12px;color:var(--text2);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.name) + '</span>' +
        '<div style="flex:1;background:var(--bg3);border-radius:4px;height:18px;overflow:hidden">' +
        '<div onclick="window._showReportIssues(\'ctrl_asg_' + a.safeKey + '\')" title="' + esc(a.name) + ' — avg ' + a.avg + 'd across ' + a.count + ' issues" style="cursor:pointer;width:' + Math.max(w, 4) + '%;height:100%;background:' + colorFor(a.avg) + '"></div>' +
        '</div>' +
        '<span style="width:110px;font-size:11px;color:var(--text3);text-align:right;flex-shrink:0">' + a.avg + 'd · ' + a.count + ' issue' + (a.count !== 1 ? 's' : '') + '</span>' +
        '</div>';
    }).join('') +
    '</div>';

  var thStyle = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--border)';
  var tableRows = items.map(function(r) {
    var days = parseFloat(r.cycle_days) || 0;
    var color = colorFor(days);
    var assigneeName = r.assignee ? esc(r.assignee.name) : '<span style="color:var(--text3)">Unassigned</span>';
    return '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="openIssuePage(\'' + r.id + '\')">' +
      '<td style="padding:10px 12px;font-weight:600;white-space:nowrap">' + esc(r.key) + '</td>' +
      '<td style="padding:10px 12px;color:var(--text);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.title) + '</td>' +
      '<td style="padding:10px 12px;font-size:12px">' + assigneeName + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;text-align:center;color:var(--text2)">' + (r.story_points != null ? r.story_points : '—') + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;color:var(--text3);white-space:nowrap">' + esc(fmtDateShort(r.done_at)) + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;font-weight:700;text-align:right;color:' + color + '">' + days + 'd</td>' +
      '</tr>';
  }).join('');

  c.innerHTML = '<div class="report-chart">' +
    sprintSelectorHtml +
    '<h4 style="margin:0 0 4px">Control Chart — ' + esc(sprint.name || 'Sprint') + '</h4>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Cycle time from In Progress to Done, for issues completed in this sprint</p>' +
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
    statCard('Completed', items.length, '#0052cc') +
    statCard('Avg Cycle Time', avgDays + ' days', '#0129ac') +
    statCard('Fastest', fastest + ' days', '#10b981') +
    statCard('Slowest', slowest + ' days', '#ef4444') +
    '</div>' +
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:20px">' +
    '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">Cycle Time per Completed Issue</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:14px">Each point is one issue, plotted by completion date — click a point to open it</div>' +
    scatterHtml +
    '<div style="display:flex;gap:12px;font-size:11px;color:var(--text2);margin-top:10px">' +
    '<span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:50%"></span> &lt;3d' +
    '<span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:50%;margin-left:8px"></span> 3–7d' +
    '<span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:50%;margin-left:8px"></span> &gt;7d' +
    '</div></div>' +
    assigneeHtml +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
    '<thead><tr>' +
    '<th style="' + thStyle + '">Key</th>' +
    '<th style="' + thStyle + '">Title</th>' +
    '<th style="' + thStyle + '">Assignee</th>' +
    '<th style="' + thStyle + ';text-align:center">SP</th>' +
    '<th style="' + thStyle + '">Done</th>' +
    '<th style="' + thStyle + ';text-align:right">Cycle Time</th>' +
    '</tr></thead>' +
    '<tbody>' + tableRows + '</tbody></table></div>' +
    '</div>';
}

// ═══════════════════════════════════════════════════════════
// ALL WORK TAB
// ═══════════════════════════════════════════════════════════
// Populate assignee + sprint filter dropdowns from live DB data
// ── Advanced Filter Panel (Jira-style) ───────────────────────────────

// All available filter fields
var AW_FILTER_FIELDS = [
  { key: 'type',      label: 'Type',       kind: 'multi',
    opts: enumOpts(ISSUE_TYPES) },
  { key: 'status',    label: 'Status',     kind: 'multi',
    opts: enumOpts(ISSUE_STATUSES) },
  { key: 'priority',  label: 'Priority',   kind: 'multi',
    opts: enumOpts(ISSUE_PRIORITIES) },
  { key: 'assignee',  label: 'Assignee',   kind: 'multi', opts: [] },
  { key: 'sprint',    label: 'Sprint',     kind: 'multi', opts: [] },
  { key: 'created',   label: 'Created',    kind: 'date',
    fromKey: 'createdFrom',   toKey: 'createdTo' },
  { key: 'updated',   label: 'Updated',    kind: 'date',
    fromKey: 'updatedFrom',   toKey: 'updatedTo' },
  { key: 'duedate',   label: 'Due Date',   kind: 'date',
    fromKey: 'dueDateFrom',   toKey: 'dueDateTo' },
  { key: 'startdate', label: 'Start Date', kind: 'date',
    fromKey: 'startDateFrom', toKey: 'startDateTo' },
  // Same reasoning as the columns fix: Product Type, Team and Description are
  // builtin fields whose real value lives on the issue row itself, never in
  // issue_field_values, so filtering them through the generic cf_<id> path
  // (like _awGetCFFilterFields() used to offer) would silently match nothing.
  // opts for productType/team are filled in by _awLoadDynamicOpts() from the
  // space's own custom_fields.options, the same source _awGetCFFilterFields()
  // would have used -- so this doesn't hardcode a fixed option list that
  // could drift from what's actually configured for the space.
  { key: 'productType', label: 'Product Type', kind: 'multi', opts: [] },
  { key: 'team',         label: 'Team',          kind: 'multi', opts: [] },
  { key: 'desc',         label: 'Description',   kind: 'cftext' },
];

// Which fields are currently shown as rows in the panel
var _awActiveFields = [];

// Persist the All Work advanced filters (which fields are shown, plus every
// value including custom-field ones like Combination) to localStorage, keyed
// per space. Before this, the whole thing -- _awActiveFields and S.awFilters
// -- lived only in memory, so a hard refresh reset it to defaults exactly
// like starting the app fresh; there was never anywhere it survived to.
function _awFilterStorageKey() {
  return S.currentSpace ? ('aw-filters-' + S.currentSpace) : null;
}
function _awSaveFilterState() {
  var key = _awFilterStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ activeFields: _awActiveFields, filters: S.awFilters }));
  } catch (e) { /* storage unavailable/full -- filters just won't persist this time */ }
}
function _awLoadFilterState() {
  var key = _awFilterStorageKey();
  if (!key) return;
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.activeFields)) _awActiveFields = parsed.activeFields;
    if (parsed && parsed.filters && typeof parsed.filters === 'object') {
      // Merge onto the default shape rather than replacing outright, so a
      // stored blob from before some field existed still has every key the
      // rest of the filter code expects to find.
      S.awFilters = Object.assign({
        type: [], status: [], priority: [], assignee: [], sprint: [],
        productType: [], team: [], desc: '',
        createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
        dueDateFrom: '', dueDateTo: '', startDateFrom: '', startDateTo: ''
      }, parsed.filters);
    }
  } catch (e) { /* corrupt/unavailable storage -- fall back to current defaults silently */ }
}

// Distinct values ACTUALLY saved for one custom multi-select field, scoped to
// issues in the current space. Combination stores a structured
// {combinations:[...], productTypes:[...]} value (or a bare string for the
// simple single-combination case) rather than the plain comma-joined string
// every other multi_select custom field uses -- see the multi-select custom
// field filter block in renderAllWork() for that plain-comma-joined
// convention -- so it's parsed with parsePtComboSelection and only its real
// .combinations are counted; productTypes is a different field entirely and
// has nothing to do with this one.
function _awDistinctCFOptions(field) {
  var spaceIssueIds = {};
  getSpaceIssues(S.currentSpace).forEach(function (i) { spaceIssueIds[i.id] = true; });
  var seen = {}, out = [];
  function add(v) {
    if (v == null) return;
    v = String(v).trim();
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  }
  (S.data.issue_field_values || []).forEach(function (fv) {
    if (fv.field_id != field.id || !fv.value || !spaceIssueIds[fv.issue_id]) return;
    if (isCombinationField(field)) {
      parsePtComboSelection('', fv.value).combinations.forEach(add);
    } else {
      String(fv.value).split(',').forEach(add);
    }
  });
  return out.sort(function (a, b) { return a.localeCompare(b); }).map(function (v) { return { v: v, l: v }; });
}

// Build filter field defs from space custom fields. Excludes builtin fields
// (Product Type, Team, Description, etc. -- see DONE_BUILTIN_READERS) for the
// same reason _awGetCFColumns() does: their real value lives on the issue row
// itself, never in issue_field_values, so a cf_<id> filter for one of them
// would silently match nothing no matter what the user picks. Those three now
// have proper native entries in AW_FILTER_FIELDS instead. Genuinely custom
// fields like Combination, which really do store in issue_field_values, are
// unaffected.
function _awGetCFFilterFields() {
  return (S.data.custom_fields || [])
    .filter(function(f){ return f.space_id == S.currentSpace && !DONE_BUILTIN_READERS[f.field_key]; })
    .map(function(f) {
      var kind = (f.field_type === 'select' || f.field_type === 'multi_select') ? 'multi'
               : (f.field_type === 'date') ? 'cfdate'
               : 'cftext';
      var fd = { key: 'cf_' + f.id, label: f.name, kind: kind, cfId: f.id, cfType: f.field_type };
      if (kind === 'multi') {
        // Distinct values ACTUALLY saved on this space's issues for this
        // field, not the field's configured option list -- same reasoning as
        // _awDistinctOpts above: a configured option nobody's used yet would
        // otherwise show up as filterable-but-matches-nothing, and the config
        // can drift from reality over time. This object is rebuilt fresh on
        // every call (see _awGetFieldDef), so there's nowhere to persist a
        // dynamically-loaded value the way the static AW_FILTER_FIELDS entries
        // do -- computing it inline here every time is the correct fix rather
        // than a workaround.
        fd.opts = _awDistinctCFOptions(f);
      }
      if (kind === 'cfdate') {
        fd.fromKey = 'cf_' + f.id + '_from';
        fd.toKey   = 'cf_' + f.id + '_to';
      }
      return fd;
    });
}

function _awGetFieldDef(key) {
  var std = AW_FILTER_FIELDS.find(function(f){ return f.key === key; });
  if (std) return std;
  return _awGetCFFilterFields().find(function(f){ return f.key === key; });
}

function _awFieldHasValue(key) {
  var fd = _awGetFieldDef(key);
  if (!fd) return false;
  if (fd.kind === 'multi')  return S.awFilters[key] && S.awFilters[key].length > 0;
  if (fd.kind === 'cfdate') return !!(S.awFilters[fd.fromKey] || S.awFilters[fd.toKey]);
  if (fd.kind === 'cftext') return !!(S.awFilters[key]);
  return !!(S.awFilters[fd.fromKey] || S.awFilters[fd.toKey]);
}

function _awAnyActive() {
  return _awActiveFields.some(_awFieldHasValue) ||
    ($('allWorkSearch') && $('allWorkSearch').value.trim());
}

// Populate dynamic opts for assignee & sprint
// Distinct values ACTUALLY present on this space's issues right now, for one
// field. Deliberately not the DB's fixed enum, not the space's member/sprint
// list, and not a custom field's configured options -- any of those three
// can drift from what's really on tickets (an option nobody's used yet, a
// member no ticket is assigned to, an option since removed from config but
// still saved somewhere). extract(issue) returns an array of raw values found
// on that issue (usually one, but product_type is a comma-joined multi-value
// string); label(value) formats it for display, defaulting to the raw value.
function _awDistinctOpts(extract, label) {
  var seen = {}, out = [];
  getSpaceIssues(S.currentSpace).forEach(function (iss) {
    (extract(iss) || []).forEach(function (v) {
      if (v == null || v === '') return;
      var key = String(v);
      if (seen[key]) return;
      seen[key] = true;
      out.push(v);
    });
  });
  return out.map(function (v) { return { v: v, l: label ? label(v) : v }; })
    .sort(function (a, b) { return String(a.l).localeCompare(String(b.l)); });
}

async function _awLoadDynamicOpts() {
  _awGetFieldDef('type').opts     = _awDistinctOpts(function(i){ return [i.type]; }, typeLabel);
  _awGetFieldDef('status').opts   = _awDistinctOpts(function(i){ return [i.status]; });
  _awGetFieldDef('priority').opts = _awDistinctOpts(function(i){ return [i.priority]; }, cap);
  _awGetFieldDef('assignee').opts = _awDistinctOpts(function(i){ return [i.assignee_id]; }, function(v){
    var u = findUser(v); return u ? u.name : v;
  });
  _awGetFieldDef('sprint').opts   = _awDistinctOpts(function(i){ return [i.sprint_id]; }, function(v){
    var sp = (S.data.sprints || []).find(function(s){ return s.id == v; }); return sp ? sp.name : v;
  });
  _awGetFieldDef('productType').opts = _awDistinctOpts(function(i){
    return (i.product_type || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  });
  _awGetFieldDef('team').opts = _awDistinctOpts(function(i){ return [i.team]; });
}

// Toggle the filter panel open/closed
window._awToggleFilterPanel = function() {
  var panel = $('awAdvPanel');
  var btn   = $('awFilterBtn');
  if (!panel) return;
  var open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', open);
  if (open) {
    // Pre-populate default filter fields if none added yet
    if (_awActiveFields.length === 0) {
      ['status', 'type', 'priority', 'assignee'].forEach(function(k) {
        if (_awActiveFields.indexOf(k) < 0) _awActiveFields.push(k);
      });
    }
    _awLoadDynamicOpts().then(function() { _awRenderPanel(); });
  }
};

// Render all active filter rows
function _awRenderPanel() {
  var rows = $('awAdvRows');
  if (!rows) return;
  rows.innerHTML = _awActiveFields.map(function(key) {
    var fd = _awGetFieldDef(key);
    if (!fd) return '';
    var valueHtml = '';
    if (fd.kind === 'multi') {
      var sel = S.awFilters[key] || [];
      var btnLabel = sel.length ? sel.map(function(v){
        var o = fd.opts.find(function(o){ return o.v == v; });
        return o ? o.l : v;
      }).join(', ') : 'Any';
      valueHtml =
        '<div class="aw-adv-val-wrap" style="position:relative">' +
          '<button class="aw-adv-val-btn" onclick="window._awToggleMultiDrop(\'' + key + '\')">' +
            esc(btnLabel) + ' <span class="aw-adv-val-arrow">▾</span>' +
          '</button>' +
          '<div class="aw-adv-multi-drop" id="aw-mdrop-' + key + '" style="display:none">' +
            '<input class="aw-adv-drop-search" type="text" placeholder="Search…" oninput="window._awFilterMultiSearch(\'' + key + '\',this.value)">' +
            '<div class="aw-adv-opts" id="aw-mopts-' + key + '">' +
              fd.opts.map(function(o) {
                var chk = sel.indexOf(o.v) >= 0 ? ' checked' : '';
                return '<label class="aw-adv-opt-row"><input type="checkbox" value="' + esc(String(o.v)) + '"' + chk +
                  ' onchange="window._awMultiToggle(\'' + key + '\',this)"> ' + esc(o.l) + '</label>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>';
    } else if (fd.kind === 'cftext') {
      var tv = S.awFilters[key] || '';
      valueHtml =
        '<input type="text" class="input input-sm" style="min-width:160px" value="' + esc(tv) + '" placeholder="Contains…"' +
        ' oninput="window._awSetCFText(\'' + key + '\',this.value)">';
    } else {
      // date / cfdate
      var fv = S.awFilters[fd.fromKey] || '';
      var tv2 = S.awFilters[fd.toKey]  || '';
      valueHtml =
        '<div class="aw-adv-date-row">' +
          '<span class="aw-adv-date-lbl">From</span>' +
          '<input type="date" class="input input-sm" value="' + esc(fv) + '" onchange="window._awSetDate(\'' + key + '\',\'from\',this.value)">' +
          '<span class="aw-adv-date-sep">–</span>' +
          '<span class="aw-adv-date-lbl">To</span>' +
          '<input type="date" class="input input-sm" value="' + esc(tv2) + '" onchange="window._awSetDate(\'' + key + '\',\'to\',this.value)">' +
        '</div>';
    }
    return '<div class="aw-adv-row" id="aw-row-' + key + '">' +
      '<span class="aw-adv-field-label">' + esc(fd.label) + '</span>' +
      '<span class="aw-adv-op">=</span>' +
      valueHtml +
      '<button class="aw-adv-remove" onclick="window._awRemoveField(\'' + key + '\')" title="Remove filter">×</button>' +
    '</div>';
  }).join('');
}

// Toggle a multi-select dropdown open/close
window._awToggleMultiDrop = function(key) {
  var drop = $('aw-mdrop-' + key);
  if (!drop) return;
  var open = drop.style.display === 'none';
  // Close all multi-drops first
  document.querySelectorAll('.aw-adv-multi-drop').forEach(function(d){ d.style.display = 'none'; });
  drop.style.display = open ? 'block' : 'none';
};

// Filter options in multi-select dropdown by search text
window._awFilterMultiSearch = function(key, q) {
  var opts = $('aw-mopts-' + key);
  if (!opts) return;
  opts.querySelectorAll('.aw-adv-opt-row').forEach(function(row) {
    var txt = row.textContent.toLowerCase();
    row.style.display = !q || txt.indexOf(q.toLowerCase()) >= 0 ? '' : 'none';
  });
};

// Toggle a value in a multi-select filter
window._awMultiToggle = function(key, cb) {
  var arr = S.awFilters[key] || (S.awFilters[key] = []);
  if (cb.checked) { if (arr.indexOf(cb.value) < 0) arr.push(cb.value); }
  else { var idx = arr.indexOf(cb.value); if (idx >= 0) arr.splice(idx, 1); }
  // Update button label
  var row = $('aw-row-' + key);
  if (row) {
    var fd = _awGetFieldDef(key);
    var sel = S.awFilters[key];
    var lbl = sel.length ? sel.map(function(v){
      var o = fd.opts.find(function(o){ return o.v == v; });
      return o ? o.l : v;
    }).join(', ') : 'Any';
    var btn = row.querySelector('.aw-adv-val-btn');
    if (btn) btn.childNodes[0].nodeValue = lbl + ' ';
  }
  renderAllWork();
};

// Set a CF text filter value
window._awSetCFText = function(key, val) {
  S.awFilters[key] = val;
  renderAllWork();
};

// Set a date filter value
window._awSetDate = function(key, which, val) {
  var fd = _awGetFieldDef(key);
  if (!fd) return;
  S.awFilters[which === 'from' ? fd.fromKey : fd.toKey] = val;
  renderAllWork();
};

// Add a field to the panel
window._awAddField = function(key) {
  if (_awActiveFields.indexOf(key) < 0) _awActiveFields.push(key);
  _awRenderPanel();
  $('awAddDrop').style.display = 'none';
  renderAllWork();
};

// Remove a field from the panel and clear its filter
window._awRemoveField = function(key) {
  _awActiveFields = _awActiveFields.filter(function(k){ return k !== key; });
  var fd = _awGetFieldDef(key);
  if (fd) {
    if (fd.kind === 'multi')  { S.awFilters[key] = []; }
    else if (fd.kind === 'cftext') { S.awFilters[key] = ''; }
    else { S.awFilters[fd.fromKey] = ''; S.awFilters[fd.toKey] = ''; }
  }
  _awRenderPanel();
  renderAllWork();
};

// Toggle the "+ Add filters" dropdown
window._awToggleAddDrop = function() {
  var drop = $('awAddDrop');
  if (!drop) return;
  var open = drop.style.display === 'none';
  drop.style.display = open ? 'block' : 'none';
  if (open) { _awRenderAddOpts(''); var srch = $('awAddDropSearch'); if (srch) { srch.value = ''; srch.focus(); } }
};

function _awRenderAddOpts(q) {
  var list = $('awAddDropList');
  if (!list) return;
  var cfFields = _awGetCFFilterFields();
  var allFields = AW_FILTER_FIELDS.concat(cfFields);
  var available = allFields.filter(function(fd) {
    return _awActiveFields.indexOf(fd.key) < 0 &&
      (!q || fd.label.toLowerCase().indexOf(q.toLowerCase()) >= 0);
  });
  // Group: standard fields first, then custom fields with a divider
  var stdAvail = available.filter(function(fd){ return fd.key.indexOf('cf_') !== 0; });
  var cfAvail  = available.filter(function(fd){ return fd.key.indexOf('cf_') === 0; });
  var html = stdAvail.map(function(fd){
    return '<div class="aw-add-drop-item" onclick="window._awAddField(\'' + fd.key + '\')">' + esc(fd.label) + '</div>';
  }).join('');
  if (cfAvail.length) {
    if (stdAvail.length) html += '<div class="aw-add-drop-divider">Custom Fields</div>';
    html += cfAvail.map(function(fd){
      return '<div class="aw-add-drop-item" onclick="window._awAddField(\'' + fd.key + '\')">' + esc(fd.label) + '</div>';
    }).join('');
  }
  list.innerHTML = html || '<div class="aw-add-drop-empty">No more filters</div>';
}

window._awFilterAddOpts = function(q) { _awRenderAddOpts(q); };

// Init: load dynamic data (called when allwork view opens)
async function _initAwMultiSelects() {
  await _awLoadDynamicOpts();
}

window._awClearFilters = function() {
  var srch = $('allWorkSearch');
  if (srch) srch.value = '';
  S.awFilters = {
    type: [], status: [], priority: [], assignee: [], sprint: [],
    productType: [], team: [], desc: '',
    createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
    dueDateFrom: '', dueDateTo: '', startDateFrom: '', startDateTo: ''
  };
  // Clear any CF filter values
  _awGetCFFilterFields().forEach(function(fd) {
    if (fd.kind === 'multi')  S.awFilters[fd.key] = [];
    else if (fd.kind === 'cftext') S.awFilters[fd.key] = '';
    else { S.awFilters[fd.fromKey] = ''; S.awFilters[fd.toKey] = ''; }
  });
  _awActiveFields = [];
  _awRenderPanel();
  renderAllWork();
};

// ── Dynamic Columns ──────────────────────────────────────────────────
var AW_ALL_COLUMNS = [
  { key: 'key',             label: 'Key',            sortCol: 'key',          def: true },
  { key: 'title',           label: 'Title',          sortCol: 'title',        def: true },
  { key: 'status',          label: 'Status',         sortCol: 'status',       def: true },
  { key: 'assignee',        label: 'Assignee',       sortCol: 'assignee',     def: true },
  { key: 'reporter',        label: 'Reporter',       sortCol: null,           def: false },
  { key: 'priority',        label: 'Priority',       sortCol: 'priority',     def: true },
  { key: 'sprint',          label: 'Sprint',         sortCol: 'sprint_id',    def: true },
  { key: 'due_date',        label: 'Due Date',       sortCol: 'due_date',     def: true },
  { key: 'updated_at',      label: 'Updated',        sortCol: 'updated_at',   def: true },
  { key: 'work',            label: 'Work',           sortCol: 'key',          def: false },
  { key: 'type',            label: 'Type',           sortCol: 'type',         def: false },
  { key: 'story_points',    label: 'Points',         sortCol: 'story_points', def: false },
  { key: 'start_date',      label: 'Start Date',     sortCol: 'start_date',   def: false },
  { key: 'created_at',      label: 'Created',        sortCol: 'created_at',   def: false },
  { key: 'fix_description', label: 'Fix Description',sortCol: null,           def: false },
  // These three had no native column at all -- only a generic cf_<id> one via
  // _awGetCFColumns(), which reads issue_field_values. Product Type, Team and
  // Description are builtin fields whose real value lives on the issue row
  // itself (issues.product_type/team/description, per DONE_BUILTIN_READERS),
  // never in issue_field_values, so that column always rendered "--" no
  // matter how much real data existed. Reading the issue property directly
  // instead, same as every other native column here already does.
  { key: 'product_type',    label: 'Product Type',   sortCol: null,           def: false },
  { key: 'team',            label: 'Team',            sortCol: null,           def: false },
  { key: 'description',     label: 'Description',    sortCol: null,           def: false },
];
var _AW_COL_STORE_KEY = 'sb_aw_cols';

function _awGetVisibleCols() {
  var cfCols = _awGetCFColumns();
  var allCols = AW_ALL_COLUMNS.concat(cfCols);
  try {
    var saved = JSON.parse(localStorage.getItem(_AW_COL_STORE_KEY));
    if (Array.isArray(saved) && saved.length) {
      return saved.map(function(k){ return allCols.find(function(c){ return c.key === k; }); }).filter(Boolean);
    }
  } catch(_) {}
  return AW_ALL_COLUMNS.filter(function(c){ return c.def; });
}

function _awSaveVisibleCols(keys) {
  localStorage.setItem(_AW_COL_STORE_KEY, JSON.stringify(keys));
}

// Get custom field columns for current space. Excludes any field whose
// field_key is one of DONE_BUILTIN_READERS's keys -- those store their real
// value directly on the issue row (issues.product_type, issues.team, etc.),
// never in issue_field_values, so a cf_<id> column for one of them would
// always render "--" and would just duplicate a column that already exists
// natively above (or, for product_type/team/description, the native column
// added above). Genuinely custom fields like Combination -- whose value
// really does live in issue_field_values -- still come through normally.
function _awGetCFColumns() {
  var spaceFields = (S.data.custom_fields || []).filter(function(f){
    return f.space_id == S.currentSpace && !DONE_BUILTIN_READERS[f.field_key];
  });
  return spaceFields.map(function(f){
    return { key: 'cf_' + f.id, label: f.name, sortCol: null, def: false, cfId: f.id };
  });
}

window._awToggleColPicker = function() {
  var drop = $('awColDrop');
  if (!drop) return;
  var open = drop.style.display === 'none';
  drop.style.display = open ? 'block' : 'none';
  if (open) _awRenderColList();
};

function _awRenderColList() {
  var list = $('awColList');
  if (!list) return;
  var visible = _awGetVisibleCols().map(function(c){ return c.key; });
  var cfCols = _awGetCFColumns();
  var allCols = AW_ALL_COLUMNS.concat(cfCols);
  list.innerHTML = allCols.map(function(col) {
    var chk = visible.indexOf(col.key) >= 0 ? ' checked' : '';
    return '<label class="aw-col-item"><input type="checkbox" value="' + col.key + '"' + chk +
      ' onchange="window._awToggleColKey(\'' + col.key + '\',this.checked)"> ' + esc(col.label) + '</label>';
  }).join('');
}

window._awToggleColKey = function(key, on) {
  var visible = _awGetVisibleCols().map(function(c){ return c.key; });
  if (on) { if (visible.indexOf(key) < 0) visible.push(key); }
  else { visible = visible.filter(function(k){ return k !== key; }); }
  // Keep order: standard columns first (by AW_ALL_COLUMNS order), then CF columns
  var cfCols = _awGetCFColumns();
  var ordered = AW_ALL_COLUMNS.map(function(c){ return c.key; })
    .concat(cfCols.map(function(c){ return c.key; }))
    .filter(function(k){ return visible.indexOf(k) >= 0; });
  _awSaveVisibleCols(ordered);
  renderAllWork();
};

S.allWorkSort = { col: 'key', dir: 'desc' };
function renderAllWork(opts) {
  if (!opts || !opts.keepPage) S.allWorkPage = 1;
  // Every filter mutator (_awAddField, _awRemoveField, _awMultiToggle,
  // _awSetDate, _awSetCFText, _awClearFilters) calls renderAllWork() right
  // after changing _awActiveFields/S.awFilters, so this is the one place that
  // sees every change and can keep localStorage in sync with all of them.
  _awSaveFilterState();
  var search = ($('allWorkSearch') ? $('allWorkSearch').value : '').toLowerCase().trim();
  var f = S.awFilters;

  // _awAnyActive() checks every ACTIVE field generically by kind, so unlike
  // the fixed list this replaced, it correctly covers Product Type/Team/
  // Description and any custom field (Combination) too -- filtering by only
  // one of those used to leave the "Clear all" button hidden.
  var anyFilter = _awAnyActive();
  var clearBtn = $('awClearFilters');
  if (clearBtn) clearBtn.style.display = anyFilter ? '' : 'none';
  var colBtn = $('awColBtn');
  if (colBtn) colBtn.parentElement.style.display = '';

  var issues = getSpaceIssues(S.currentSpace);

  // Text search
  if (search) issues = issues.filter(function(i) {
    return (i.title || '').toLowerCase().indexOf(search) >= 0 ||
      issueKeyStr(i).toLowerCase().indexOf(search) >= 0 ||
      (findUser(i.assignee_id) || {name:''}).name.toLowerCase().indexOf(search) >= 0;
  });
  // Multi-select filters
  if (f.type.length)     issues = issues.filter(function(i) { return f.type.indexOf(i.type) >= 0; });
  if (f.status.length)   issues = issues.filter(function(i) { return f.status.indexOf(i.status) >= 0; });
  if (f.priority.length) issues = issues.filter(function(i) { return f.priority.indexOf(i.priority) >= 0; });
  if (f.assignee.length) issues = issues.filter(function(i) { return f.assignee.indexOf(i.assignee_id) >= 0; });
  if (f.sprint.length)   issues = issues.filter(function(i) { return f.sprint.indexOf(i.sprint_id) >= 0; });
  // Product Type / Team / Description read straight off the issue row, same
  // as the fields above -- see the AW_FILTER_FIELDS comment for why these
  // aren't handled through the generic custom-field filter block below.
  if (f.productType && f.productType.length) {
    issues = issues.filter(function(i) {
      var vals = (i.product_type || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      return f.productType.some(function(a){ return vals.indexOf(a) >= 0; });
    });
  }
  if (f.team && f.team.length) issues = issues.filter(function(i) { return f.team.indexOf(i.team) >= 0; });
  if (f.desc) {
    var descQ = f.desc.toLowerCase();
    issues = issues.filter(function(i) { return (i.description || '').toLowerCase().indexOf(descQ) >= 0; });
  }
  // Date range filters
  if (f.createdFrom)   issues = issues.filter(function(i) { return i.created_at && i.created_at.slice(0,10) >= f.createdFrom; });
  if (f.createdTo)     issues = issues.filter(function(i) { return i.created_at && i.created_at.slice(0,10) <= f.createdTo; });
  if (f.updatedFrom)   issues = issues.filter(function(i) { return i.updated_at && i.updated_at.slice(0,10) >= f.updatedFrom; });
  if (f.updatedTo)     issues = issues.filter(function(i) { return i.updated_at && i.updated_at.slice(0,10) <= f.updatedTo; });
  if (f.dueDateFrom)   issues = issues.filter(function(i) { return i.due_date && i.due_date.slice(0,10) >= f.dueDateFrom; });
  if (f.dueDateTo)     issues = issues.filter(function(i) { return i.due_date && i.due_date.slice(0,10) <= f.dueDateTo; });
  if (f.startDateFrom) issues = issues.filter(function(i) { return i.start_date && i.start_date.slice(0,10) >= f.startDateFrom; });
  if (f.startDateTo)   issues = issues.filter(function(i) { return i.start_date && i.start_date.slice(0,10) <= f.startDateTo; });
  // Sort by created_at descending (newest first)
  issues = issues.slice().sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });
  // Update ticket count display
  var countEl = document.getElementById('awTicketCount');
  if (countEl) countEl.textContent = issues.length + ' work items';
  // Custom field filters
  _awActiveFields.forEach(function(key) {
    if (key.indexOf('cf_') !== 0) return;
    var fd = _awGetFieldDef(key);
    if (!fd) return;
    if (fd.kind === 'multi' && S.awFilters[key] && S.awFilters[key].length) {
      var allowed = S.awFilters[key];
      issues = issues.filter(function(i) {
        var cfv = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == i.id && v.field_id == fd.cfId; });
        if (!cfv || !cfv.value) return false;
        // Value may be comma-separated (multi_select)
        var vals = cfv.value.split(',').map(function(s){ return s.trim(); });
        return allowed.some(function(a){ return vals.indexOf(a) >= 0; });
      });
    } else if (fd.kind === 'cftext' && S.awFilters[key]) {
      var q = S.awFilters[key].toLowerCase();
      issues = issues.filter(function(i) {
        var cfv = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == i.id && v.field_id == fd.cfId; });
        return cfv && cfv.value && cfv.value.toLowerCase().indexOf(q) >= 0;
      });
    } else if (fd.kind === 'cfdate') {
      if (S.awFilters[fd.fromKey]) {
        issues = issues.filter(function(i) {
          var cfv = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == i.id && v.field_id == fd.cfId; });
          return cfv && cfv.value && cfv.value.slice(0,10) >= S.awFilters[fd.fromKey];
        });
      }
      if (S.awFilters[fd.toKey]) {
        issues = issues.filter(function(i) {
          var cfv = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == i.id && v.field_id == fd.cfId; });
          return cfv && cfv.value && cfv.value.slice(0,10) <= S.awFilters[fd.toKey];
        });
      }
    }
  });

  // Sort
  var col = S.allWorkSort.col;
  var dir = S.allWorkSort.dir;
  issues.sort(function (a, b) {
    if (col === 'key') {
      // Extract numeric part from key string e.g. "ENG-12" → 12
      var na = parseInt((issueKeyStr(a) || '').replace(/^[^-]+-/, ''), 10) || 0;
      var nb = parseInt((issueKeyStr(b) || '').replace(/^[^-]+-/, ''), 10) || 0;
      return dir === 'asc' ? na - nb : nb - na;
    }
    var va = col === 'assignee' ? (a.assignee_name || '') : a[col];
    var vb = col === 'assignee' ? (b.assignee_name || '') : b[col];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  var sortIcon = function (c) {
    if (S.allWorkSort.col !== c) return '';
    return S.allWorkSort.dir === 'asc' ? ' \u25B2' : ' \u25BC';
  };
  var th = function (label, c) {
    return '<th class="sortable-th" data-sort-col="' + c + '">' + label + sortIcon(c) + '</th>';
  };

  // Only an admin/site_admin of this space may select tickets and bulk-delete
  // (mirrors canDeleteIssue / the backend's ACTION_MIN_ROLE for issue.bulk).
  // A regular member gets no checkbox column at all -- there is nothing for
  // them to select, so an empty checkbox column would just be UI noise.
  var canBulkDelete = canDeleteIssue(S.currentSpace);
  var hasSelected = canBulkDelete && S.allWorkSelected.size > 0;
  var html = '';

  var bulkWrap = $('awBulkDeleteWrap');
  if (bulkWrap) {
    bulkWrap.style.display = hasSelected ? 'flex' : 'none';
    var bulkCountEl = $('awBulkDeleteCount');
    if (bulkCountEl) bulkCountEl.textContent = S.allWorkSelected.size + ' selected';
  }

  var visCols = _awGetVisibleCols();

  var PAGE_SIZE = 50;
  var totalIssues = issues.length;
  var pagedIssues = issues.slice(0, PAGE_SIZE * (S.allWorkPage || 1));

  html += '<table class="data-table" style="min-width:1200px;width:100%"><thead><tr>' +
    (canBulkDelete ? ('<th><input type="checkbox" id="allWorkSelectAll"' + (S.allWorkSelected.size === issues.length && issues.length > 0 ? ' checked' : '') + '></th>') : '') +
    visCols.map(function(col) {
      return col.sortCol
        ? th(col.label, col.sortCol)
        : '<th>' + esc(col.label) + '</th>';
    }).join('') +
    '</tr></thead><tbody>';

  for (var i = 0; i < pagedIssues.length; i++) {
    var iss = pagedIssues[i];
    var assignee = findUser(iss.assignee_id);
    var sprint = (S.data.sprints || []).find(function (sp) { return sp.id == iss.sprint_id; });
    var reporter = findUser(iss.reporter_id);
    var checked = S.allWorkSelected.has(iss.id) ? ' checked' : '';
    var iid = iss.id;
    var nav = 'openIssuePage(\'' + iid + '\')';
    html += '<tr class="clickable-row" onclick="' + nav + '">' +
      (canBulkDelete ? ('<td onclick="event.stopPropagation()"><input type="checkbox" data-issue-check="' + iid + '"' + checked + '></td>') : '') +
      visCols.map(function(col) {
        var cell = '';
        switch(col.key) {
          case 'key':             cell = '<td class="issue-key" onclick="' + nav + '" style="white-space:nowrap;width:90px;min-width:90px">' + esc(issueKeyStr(iss)) + '</td>'; break;
          case 'title':           cell = '<td onclick="' + nav + '" style="min-width:200px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(iss.title) + '</td>'; break;
          case 'type':            cell = '<td onclick="' + nav + '"><span class="type-cell">' + typeIcon(iss.type) + '<span class="type-cell-label">' + cap(iss.type) + '</span></span></td>'; break;
          case 'status':          cell = '<td onclick="event.stopPropagation();awInlineStatus(event,\'' + iid + '\',\'' + (iss.status||'') + '\'  )" style="cursor:pointer">' + statusBadge(iss.status) + '</td>'; break;
          case 'priority':        cell = '<td onclick="event.stopPropagation();awInlinePriority(event,\'' + iid + '\',\'' + (iss.priority||'') + '\'  )" style="cursor:pointer">' + priorityBadge(iss.priority) + '</td>'; break;
          case 'assignee':        cell = '<td onclick="event.stopPropagation();awInlineAssignee(event,\'' + iid + '\',\'' + (iss.assignee_id||'') + '\'  )" style="cursor:pointer;white-space:nowrap">' + (assignee ? avatarHtml(assignee,24)+'&nbsp;'+esc(assignee.name)+'<span style="color:#6b778c;font-size:10px;margin-left:4px">&#9662;</span>' : '<span class="text-muted">Unassigned</span>') + '</td>'; break;
          case 'sprint':          cell = '<td onclick="' + nav + '">' + (sprint ? esc(sprint.name) : '\u2014') + '</td>'; break;
          case 'story_points':    cell = '<td onclick="' + nav + '">' + (iss.story_points != null ? iss.story_points : '\u2014') + '</td>'; break;
          case 'due_date':        cell = '<td onclick="' + nav + '">' + (fmtDateShort(iss.due_date) || '\u2014') + '</td>'; break;
          case 'updated_at':      cell = '<td class="text-muted" onclick="' + nav + '" style="white-space:nowrap">' + fmtDateTime(iss.updated_at) + '</td>'; break;
          case 'start_date':      cell = '<td onclick="' + nav + '">' + (fmtDateShort(iss.start_date) || '\u2014') + '</td>'; break;
          case 'created_at':      cell = '<td onclick="' + nav + '">' + (fmtDateShort(iss.created_at) || '\u2014') + '</td>'; break;
          case 'reporter':        cell = '<td onclick="' + nav + '">' + (reporter ? esc(reporter.name) : '\u2014') + '</td>'; break;
          case 'fix_description': cell = '<td onclick="' + nav + '">' + (iss.fix_description ? esc(iss.fix_description.slice(0,60)) + (iss.fix_description.length>60?'…':'') : '\u2014') + '</td>'; break;
          case 'product_type':    cell = '<td onclick="' + nav + '">' + (iss.product_type ? esc(iss.product_type.split(',').map(function(t){ return t.trim(); }).join(', ')) : '—') + '</td>'; break;
          case 'team':             cell = '<td onclick="' + nav + '">' + (iss.team ? esc(iss.team) : '—') + '</td>'; break;
          case 'description':      cell = '<td onclick="' + nav + '">' + (iss.description ? esc(iss.description.slice(0,60)) + (iss.description.length>60?'…':'') : '—') + '</td>'; break;
          default:
            // Custom field column (cf_<fieldId>)
            if (col.key.indexOf('cf_') === 0) {
              var cfId = col.cfId || col.key.replace('cf_','');
              var cfVal = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == iss.id && v.field_id == cfId; });
              var cfField = (S.data.custom_fields || []).find(function(f){ return f.id == cfId; });
              var cfDisplay = cfVal && cfVal.value
                ? (isCombinationField(cfField) ? formatCombinationFieldDisplayValue(cfVal.value) : cfVal.value)
                : '';
              cell = '<td onclick="' + nav + '">' + (cfDisplay ? esc(cfDisplay) : '\u2014') + '</td>';
            } else {
              cell = '<td onclick="' + nav + '">\u2014</td>';
            }
        }
        return cell;
      }).join('') +
      '</tr>';
  }
  html += '</tbody></table>';

  var shown = pagedIssues.length;
  if (shown < totalIssues) {
    html += '<div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:18px 0;border-top:1px solid var(--border)">' +
      '<span style="font-size:13px;color:var(--text3)">Showing <b>' + shown + '</b> of <b>' + totalIssues + '</b> issues</span>' +
      '<button id="awLoadMoreBtn" style="padding:7px 20px;border:1.5px solid #0129AC;border-radius:8px;background:#fff;color:#0129AC;font-size:13px;font-weight:600;cursor:pointer" onmouseover="this.style.background=\'#f0f4ff\'" onmouseout="this.style.background=\'#fff\'">Load More</button>' +
      '</div>';
  } else if (totalIssues > PAGE_SIZE) {
    html += '<div style="text-align:center;padding:14px 0;font-size:12px;color:var(--text3);border-top:1px solid var(--border)">All ' + totalIssues + ' issues loaded</div>';
  }

  $('allWorkTable').innerHTML = html;

  var loadMoreBtn = $('awLoadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.onclick = function() { S.allWorkPage = (S.allWorkPage || 1) + 1; renderAllWork({keepPage:true}); };
  }

  // Bind sorting
  qsa('.sortable-th').forEach(function (thEl) {
    thEl.onclick = function () {
      var c = thEl.dataset.sortCol;
      if (S.allWorkSort.col === c) {
        S.allWorkSort.dir = S.allWorkSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        S.allWorkSort.col = c;
        S.allWorkSort.dir = 'desc';
      }
      renderAllWork();
    };
  });

  // Select all checkbox
  var selAll = $('allWorkSelectAll');
  if (selAll) {
    selAll.onchange = function () {
      if (selAll.checked) {
        issues.forEach(function (i) { S.allWorkSelected.add(i.id); });
      } else {
        S.allWorkSelected.clear();
      }
      renderAllWork();
    };
  }

  // Individual checkboxes
  qsa('[data-issue-check]').forEach(function (cb) {
    cb.onchange = function () {
      var id = cb.dataset.issueCheck;
      if (cb.checked) S.allWorkSelected.add(id);
      else S.allWorkSelected.delete(id);
      renderAllWork();
    };
  });

}

window._bulkDelete = async function () {
  var ids = Array.from(S.allWorkSelected);
  if (!ids.length) return;
  var rows = ids.map(function (id) {
    return (S.data.issues || []).find(function (i) { return i.id === id; });
  }).filter(Boolean);
  // Refuse up front for any space the user can't delete in, rather than firing N
  // requests and collecting a pile of 403 toasts halfway through.
  var blocked = rows.filter(function (i) { return !canDeleteIssue(i.space_id); });
  if (blocked.length) {
    toast('Only a space admin can delete tickets. ' + blocked.length + ' of your selected tickets are in spaces you do not administer.', 'error');
    return;
  }
  // One ticket → type its key. Several → "delete all", so nobody has to paste
  // twenty keys but the phrase still can't be typed by accident.
  // Only take the single-key path when the ticket is actually in the cache —
  // otherwise there is no key to show and we fall back to the counted phrasing.
  var single = ids.length === 1 && rows.length === 1;
  var key = single ? (issueKeyStr(rows[0]) || ids[0]) : null;
  var ok = await typedConfirmDialog({
    title: single ? 'Delete ' + key + '?' : 'Delete ' + ids.length + ' tickets?',
    intro: single
      ? (rows[0] && rows[0].title) || ''
      : (rows.slice(0, 6).map(function (i) { return issueKeyStr(i); }).join(', ') +
         (rows.length > 6 ? ' and ' + (rows.length - 6) + ' more' : '')) || (ids.length + ' selected tickets'),
    note: softDeleteNote(),
    phrase: single ? key : 'delete all',
    phraseHint: single ? 'To confirm, type the ticket number' : 'To confirm, type',
    confirmLabel: single ? 'Delete ticket' : 'Delete ' + ids.length + ' tickets'
  });
  if (!ok) return;
  var done = 0, failed = 0;
  for (var i = 0; i < ids.length; i++) {
    try { await api('/api/issues/' + ids[i], 'DELETE', null, { silent: true }); done++; }
    catch (e) { failed++; }
  }
  S.allWorkSelected.clear();
  await refreshData();
  renderAllWork();
  if (failed) toast(done + ' moved to Deleted Items, ' + failed + ' failed', 'error');
  else toast(done + ' ticket' + (done === 1 ? '' : 's') + ' moved to Deleted Items', 'success');
};

window._bulkDeselect = function() {
  S.allWorkSelected.clear();
  renderAllWork();
};

// ═══════════════════════════════════════════════════════════
// SPACE SETTINGS TAB (with sub-tabs: General, People, Custom Fields)
// ═══════════════════════════════════════════════════════════
var _settingsActiveTab = 'general';

function renderSpaceSettings(subTab) {
  var space = getSpace(S.currentSpace);
  if (!space) return;
  if (!canManageSpace(space.id)) {
    toast('Only admins and space admins can access Settings', 'error');
    navigateToSpace(S.currentSpace, 'summary');
    return;
  }
  if (subTab) _settingsActiveTab = subTab;
  // Update tab bar active state
  qsa('#settingsTabBar .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.stab === _settingsActiveTab);
  });
  // Render active sub-tab content
  switch (_settingsActiveTab) {
    case 'general': renderSettingsGeneral(space); break;
    case 'people': renderSettingsPeople(space); break;
    case 'customfields':
      renderSettingsCustomFields(space);
      break;
    // Space admins reach the bin here (their space only). renderDeletedTickets
    // decides read-only vs actionable from the server's can_restore flag, so a
    // space admin sees the list without Restore / Delete forever buttons.
    case 'deleted':
      renderDeletedTickets($('settingsTabContent'), { spaceId: space.id });
      break;
    case 'reports':
      renderSettingsReports(space);
      break;
    default: renderSettingsGeneral(space);
  }
}

window._switchSettingsTab = function (tab) {
  _settingsActiveTab = tab;
  renderSpaceSettings(tab);
  syncAppUrl();
};

function renderSettingsGeneral(space) {
  var canManage = canManageSpace(space.id);
  var canDelete = canDeleteSpace();
  $('settingsTabContent').innerHTML =
    '<div class="settings-section"><h3>General</h3>' +
    '<p><strong>Name:</strong> ' + esc(space.name) + '</p>' +
    '<p><strong>Key:</strong> ' + esc(space.key) + '</p>' +
    '<p><strong>Description:</strong> ' + esc(space.description || 'No description') + '</p>' +
    '<p><strong>Icon:</strong> ' + esc(space.icon || 'None') + '</p>' +
    '<p><strong>Color:</strong> <span class="space-dot" style="background:' + (space.color || '#0129ac') + ';display:inline-block;vertical-align:middle"></span> ' + esc(space.color || '#0129ac') + '</p>' +
    '<p><strong>Type:</strong> ' + cap(space.space_type || 'scrum') + '</p>' +
    '<p><strong>Visibility:</strong> ' + visLabel(space.visibility) + '</p>' +
    '<div class="settings-actions">' +
    (canManage ? '<button class="btn btn-outline" onclick="window._editSpaceSettings()">Edit Space</button>' : '') +
    (canDelete ? '<button class="btn btn-danger" onclick="window._deleteSpace(\'' + space.id + '\')">Delete Space</button>' : '') +
    '</div></div>';
}

// Defaults mirror what the Spillover report already showed before this
// setting existed, so turning the feature on doesn't change anyone's report
// until they actually touch a toggle.
var SPILLOVER_SETTINGS_DEFAULTS = {
  show_issues_with_points: true,
  show_tasks: true,
  show_bugs: true,
  include_qa_assigned: false,
  include_unassigned: true
};

function getSpilloverSettings(space) {
  var raw = (space && space.spillover_settings) || {};
  var merged = Object.assign({}, SPILLOVER_SETTINGS_DEFAULTS, raw);
  // Carry forward a board's prior "stories with points" choice the first time
  // it's read under the new, type-agnostic key.
  if (raw.show_issues_with_points === undefined && raw.show_stories_with_points !== undefined) {
    merged.show_issues_with_points = raw.show_stories_with_points;
  }
  return merged;
}

function renderSettingsReports(space) {
  var canManage = canManageSpace(space.id);
  var s = getSpilloverSettings(space);

  function toggleRow(key, label, desc) {
    return '<label style="display:flex;align-items:flex-start;gap:8px;cursor:' + (canManage ? 'pointer' : 'default') + ';margin-bottom:14px">' +
      '<input type="checkbox" class="spillover-setting-toggle" data-key="' + escAttr(key) + '"' + (s[key] ? ' checked' : '') + (canManage ? '' : ' disabled') +
      ' onchange="window._updateSpilloverSetting(this.dataset.key, this.checked)" style="width:14px;height:14px;padding:0;flex-shrink:0;accent-color:var(--accent);margin-top:3px">' +
      '<span style="flex:1"><strong>' + esc(label) + '</strong>' +
      (desc ? '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(desc) + '</div>' : '') +
      '</span></label>';
  }

  $('settingsTabContent').innerHTML =
    '<div class="settings-section"><h3>Spillover Report</h3>' +
    '<p style="font-size:12px;color:var(--text3);margin:0 0 16px">Choose which spilled tickets show up in the Spillover report for this board.</p>' +
    toggleRow('show_issues_with_points', 'Spilled Issues (With Points)', 'Any spilled ticket that carries story points — story, task, or bug alike — regardless of type.') +
    toggleRow('show_tasks', 'Display spilled tasks', '') +
    toggleRow('show_bugs', 'Display spilled bugs', '') +
    toggleRow('include_qa_assigned', 'Include tickets assigned to Test Engineers (QA)', 'Off by default — only Developer-assigned tickets count. Turn on to also see tickets assigned to someone in the sprint\'s QA list.') +
    toggleRow('include_unassigned', 'Include unassigned tickets', 'Spilled tickets with no assignee at all.') +
    '</div>';
}

window._updateSpilloverSetting = async function (key, checked) {
  // Read every checkbox's live DOM state rather than the cached space object —
  // toggling two settings back-to-back would otherwise race: the second save
  // could read a stale pre-first-toggle value and overwrite it.
  var next = {};
  document.querySelectorAll('.spillover-setting-toggle').forEach(function (box) {
    next[box.dataset.key] = box.checked;
  });
  try {
    var updated = await api('/api/spaces/' + S.currentSpace, 'PUT', { spillover_settings: next });
    var cached = (S.data.spaces || []).find(function (sp) { return sp.id === S.currentSpace; });
    if (cached) cached.spillover_settings = updated.spillover_settings;
    toast('Spillover setting updated', 'success');
  } catch (e) {
    toast(e.message || 'Could not update setting', 'error');
    var box = document.querySelector('.spillover-setting-toggle[data-key="' + key + '"]');
    if (box) box.checked = !checked; // revert the visible toggle on failure
  }
};

// Settings-tab table search. Rows carry a data-search haystack and are shown or
// hidden in place rather than re-rendered, so role selects and Remove buttons
// keep their bound handlers and the box keeps focus while typing.
function settingsSearchBoxHtml(id, placeholder) {
  return '<input type="text" id="' + escAttr(id) + '" class="input input-sm" placeholder="' + escAttr(placeholder) + '" ' +
    'autocomplete="off" style="width:220px">';
}

function wireSettingsTableSearch(inputId, emptyMessage) {
  var input = $(inputId);
  if (!input) return;
  var table = $('settingsTabContent').querySelector('table');
  if (!table) return;
  var tbody = table.querySelector('tbody');

  // Placeholder row reused for "nothing matched", separate from the table's own
  // "none yet" row so clearing the box restores the original empty state.
  var noHit = document.createElement('tr');
  noHit.className = 'settings-search-empty';
  noHit.hidden = true;
  noHit.innerHTML = '<td colspan="' + (table.querySelectorAll('thead th').length || 1) +
    '" class="text-muted" style="text-align:center;padding:24px"></td>';
  tbody.appendChild(noHit);

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0, total = 0;
    tbody.querySelectorAll('tr[data-search]').forEach(function (row) {
      total++;
      var hit = !q || row.getAttribute('data-search').indexOf(q) >= 0;
      row.hidden = !hit;
      if (hit) shown++;
    });
    if (total && !shown) {
      noHit.querySelector('td').textContent = emptyMessage.replace('%s', input.value.trim());
      noHit.hidden = false;
    } else {
      noHit.hidden = true;
    }
  });
}

function renderSettingsPeople(space) {
  var memberRecs = (S.data.space_members || []).filter(function (m) { return m.space_id == space.id; });
  var orgAdmin = isOrgAdminUser();
  var spaceAdmin = canManageSpace(space.id) && !orgAdmin;
  var assignableRoles = orgAdmin
    ? [{ value: 'member', label: 'Member' }, { value: 'site_admin', label: 'Space Admin' }]
    : [{ value: 'member', label: 'Member' }];

  var rowsHtml = '';
  for (var i = 0; i < memberRecs.length; i++) {
    var rec = memberRecs[i];
    var user = findUser(rec.user_id);
    if (!user) continue;
    var role = normalizeSpaceRole(rec.role || 'member');
    var joined = fmtDate(rec.joined_at || rec.created_at);
    var isTargetSpaceAdmin = role === 'site_admin';

    var roleCell;
    if (orgAdmin) {
      var roleOptions = '';
      for (var r = 0; r < assignableRoles.length; r++) {
        roleOptions += '<option value="' + assignableRoles[r].value + '"' + (assignableRoles[r].value === role ? ' selected' : '') + '>' + assignableRoles[r].label + '</option>';
      }
      roleCell = '<select class="input input-sm people-role-select" data-member-id="' + rec.id + '" data-user-id="' + user.id + '" style="max-width:140px">' + roleOptions + '</select>';
    } else if (spaceAdmin && isTargetSpaceAdmin) {
      roleCell = spaceRoleBadgeHtml(rec.role);
    } else if (spaceAdmin) {
      roleCell = '<select class="input input-sm people-role-select" data-member-id="' + rec.id + '" data-user-id="' + user.id + '" style="max-width:140px"><option value="member" selected>Member</option></select>';
    } else {
      roleCell = spaceRoleBadgeHtml(rec.role);
    }

    rowsHtml += '<tr data-search="' + escAttr(((user.name || '') + ' ' + (user.email || '')).toLowerCase()) + '">' +
      '<td>' + avatarHtml(user, 28) + '</td>' +
      '<td>' + esc(user.name) + '</td>' +
      '<td class="text-muted">' + esc(user.email || '') + '</td>' +
      '<td>' + roleCell + '</td>' +
      '<td class="text-muted text-sm">' + joined + '</td>' +
      '<td>' + (canManageSpace(space.id) ? '<button class="btn btn-outline btn-sm people-remove-btn" data-member-id="' + rec.id + '" data-user-name="' + esc(user.name) + '">Remove</button>' : '') + '</td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Members</h3>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    settingsSearchBoxHtml('peopleSearchInput', 'Search name or email…') +
    (canManageSpace(space.id) ? '<button class="btn btn-primary btn-sm" id="inviteMemberBtnSettings">+ Add User</button>' : '') +
    '</div>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th style="width:40px"></th><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th style="width:80px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">No members yet</td></tr>') + '</tbody></table></div>';

  $('settingsTabContent').innerHTML = html;

  wireSettingsTableSearch('peopleSearchInput', 'No members match "%s"');

  // Invite member button
  var invBtn = $('inviteMemberBtnSettings');
  if (invBtn) {
    invBtn.onclick = function () { openInviteMemberModal(); };
  }

  // Role change handlers
  qsa('.people-role-select').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      var memberId = sel.dataset.memberId;
      var newRole = sel.value;
      try {
        await api('/api/space-members/' + memberId, 'PUT', { role: newRole });
        toast('Role updated');
      } catch (e) { /* error shown by api() */ }
    });
  });

  // Remove member handlers
  qsa('.people-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var memberId = btn.dataset.memberId;
      var userName = btn.dataset.userName;
      var ok = await confirmDialog('Remove ' + userName + ' from this space?');
      if (!ok) return;
      try {
        await api('/api/space-members/' + memberId, 'DELETE');
        await refreshData();
        renderSettingsPeople(getSpace(S.currentSpace));
        renderSidebar();
        toast('Member removed');
      } catch (e) { /* error shown by api() */ }
    });
  });
}

function customFieldShowsIn(field, place) {
  var show = field && field.show_in;
  if (!show || !show.length) return place === 'drawer';
  if (Array.isArray(show)) return show.indexOf(place) >= 0;
  return false;
}

function getSpaceFieldRows(spaceId) {
  if (!spaceId) return [];
  return (S.data.custom_fields || []).filter(function (f) { return String(f.space_id) === String(spaceId); });
}

function findSpaceFieldByKey(spaceId, fieldKey) {
  return getSpaceFieldRows(spaceId).find(function (f) {
    if (f.field_key === fieldKey) return true;
    if (fieldKey === 'combination' && isCombinationField(f)) return true;
    if (fieldKey === 'product_type' && (f.name || '').toLowerCase().trim() === 'product type') return true;
    return false;
  }) || null;
}

function ensureSpaceFieldsLoaded(spaceId) {
  if (!spaceId) return Promise.resolve([]);
  if (getSpaceFieldRows(spaceId).length) return Promise.resolve(getSpaceFieldRows(spaceId));
  return api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId), 'GET', null, { silent: true })
    .then(function (data) {
      if (Array.isArray(data) && data.length) {
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return String(f.space_id) !== String(spaceId); })
          .concat(data);
      }
      return getSpaceFieldRows(spaceId);
    })
    .catch(function () { return []; });
}

function isSpaceBuiltinFieldEnabled(spaceId, fieldKey, place) {
  if (fieldKey === 'title' || fieldKey === 'status') return true;
  var field = findSpaceFieldByKey(spaceId, fieldKey);
  if (!field) return false;
  if (place && !customFieldShowsIn(field, place)) return false;
  return true;
}

function applyBuiltinFieldVisibility(spaceId, rootEl, place) {
  var root = rootEl || document;
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-builtin-field]').forEach(function (el) {
    var key = el.getAttribute('data-builtin-field');
    if (key === 'combination' || key === 'product_type') return;
    var locked = el.getAttribute('data-builtin-locked') === 'true';
    var show = locked || isSpaceBuiltinFieldEnabled(spaceId, key, place);
    el.hidden = !show;
  });
}

// ── Required-field validation (create form) ───────────────
// Maps a built-in field_key to its control in the Create Issue modal so the
// "Required" flag set per space in Settings → Custom Fields can actually be
// enforced, instead of only rendering a red asterisk. Keys deliberately
// absent: `combination` (bespoke picker with its own validation) and
// `fix_description`/`status` (not on the create form at all) — a key with no
// entry here is skipped rather than blocking submit on a control that
// doesn't exist.
var CREATE_BUILTIN_INPUTS = {
  title:        { id: 'issueTitleInput',  label: 'Title' },
  type:         { id: 'issueType',        label: 'Type' },
  priority:     { id: 'issuePriority',    label: 'Priority' },
  assignee:     { id: 'issueAssignee',    label: 'Assignee', focusId: 'issueAssigneeSearch' },
  reporter:     { id: 'issueReporter',    label: 'Reporter', focusId: 'issueReporterSearch' },
  sprint:       { id: 'issueSprint',      label: 'Sprint' },
  story_points: { id: 'issuePoints',      label: 'Story Points' },
  start_date:   { id: 'issueStartDate',   label: 'Start Date' },
  due_date:     { id: 'issueDueDate',     label: 'Due Date' },
  team:         { id: 'issueTeam',        label: 'Team' },
  product_type: { id: 'issueProductType', label: 'Product Type', wrapId: 'issueProductTypeGroup' },
  description:  { id: 'issueDescContent', label: 'Description', rich: true }
};

// A control the user can't see must never block submit — Product Type and any
// built-in switched off for this space are hidden via the `hidden` attribute
// by applyBuiltinFieldVisibility, so walk ancestors looking for that.
function isCreateFieldHidden(el) {
  for (var node = el; node && node !== document.body; node = node.parentElement) {
    if (node.hidden) return true;
  }
  return false;
}

function createFieldIsEmpty(el, opts) {
  if (opts && opts.rich) return htmlFieldIsEmpty(el.innerHTML);
  if (el.type === 'checkbox') return !el.checked;
  if (el.tagName === 'SELECT' && el.multiple) return !el.selectedOptions.length;
  return !String(el.value == null ? '' : el.value).trim();
}

// Every required field on the create form that the user left empty, in the
// order they appear, so the first one can be focused.
function getCreateRequiredErrors(spaceId) {
  var errors = [];
  var rows = getSpaceFieldRows(spaceId);
  var checkedTitle = false;
  // The type currently chosen on the form decides which required rules apply,
  // so Story Points can be mandatory for a story but not for a bug.
  var selectedType = $('issueType') ? $('issueType').value : '';

  rows.forEach(function (field) {
    if (!fieldRequiredForType(field, selectedType)) return;
    if (!customFieldShowsIn(field, 'create')) return;

    var el, opts = null, label = field.name;
    if (field.is_builtin) {
      if (isCombinationField(field)) return;
      var desc = CREATE_BUILTIN_INPUTS[field.field_key];
      if (!desc) return;
      el = $(desc.id);
      if (!el) return;
      var wrap = desc.wrapId ? $(desc.wrapId) : el;
      if (wrap && isCreateFieldHidden(wrap)) return;
      opts = desc;
      label = field.name || desc.label;
      if (field.field_key === 'title') checkedTitle = true;
    } else {
      var container = $('issueCustomFieldsContainer');
      el = container && container.querySelector('[data-cf-id="' + field.id + '"]');
      if (!el || isCreateFieldHidden(el)) return;
    }

    if (createFieldIsEmpty(el, opts)) {
      errors.push({ label: label, el: el, focusEl: (opts && opts.focusId && $(opts.focusId)) || el });
    }
  });

  // Title is required regardless of the stored flag (it's the locked built-in,
  // and NOT NULL in the DB). Covers spaces whose built-in rows predate the
  // registry and so have no Title row to iterate.
  if (!checkedTitle) {
    var titleEl = $('issueTitleInput');
    if (titleEl && createFieldIsEmpty(titleEl)) {
      errors.unshift({ label: 'Title', el: titleEl, focusEl: titleEl });
    }
  }
  return errors;
}

function validateCreateRequiredFields(spaceId) {
  var errors = getCreateRequiredErrors(spaceId);
  if (!errors.length) return true;
  var first = errors[0];
  var names = errors.map(function (e) { return e.label; });
  toast(errors.length === 1
    ? 'Please fill in the required field: ' + names[0]
    : 'Please fill in the required fields: ' + names.join(', '), 'error');
  // Flash the control the user can actually see — for Assignee/Reporter the
  // value lives on a hidden input, so highlighting that would show nothing.
  errors.forEach(function (e) {
    var target = e.focusEl || e.el;
    target.style.border = '2px solid #e53e3e';
    setTimeout(function () { target.style.border = ''; }, 3000);
  });
  if (first.focusEl && first.focusEl.focus) first.focusEl.focus();
  return false;
}

// Show a red asterisk on built-in create-form labels whose field is required
// for this space, so required built-ins are as visible as required customs.
function markCreateRequiredLabels(spaceId) {
  var modal = $('modal-issue');
  if (!modal) return;
  modal.querySelectorAll('.cf-req-star').forEach(function (s) { s.remove(); });
  var selectedType = $('issueType') ? $('issueType').value : '';
  function addStar(label) {
    if (!label || label.querySelector('.cf-req-star')) return;
    var star = document.createElement('span');
    star.className = 'cf-req-star';
    star.style.color = 'var(--red)';
    star.textContent = ' *';
    label.appendChild(star);
  }
  getSpaceFieldRows(spaceId).forEach(function (field) {
    if (!fieldRequiredForType(field, selectedType)) return;
    if (!customFieldShowsIn(field, 'create')) return;
    if (field.is_builtin) {
      var desc = CREATE_BUILTIN_INPUTS[field.field_key];
      if (!desc) return;
      var wrap = desc.wrapId ? $(desc.wrapId) : ($(desc.id) && $(desc.id).closest('.form-group'));
      addStar(wrap && wrap.querySelector('.form-label'));
      return;
    }
    // Custom fields: their star is rendered inline at build time, but a type
    // change clears every .cf-req-star, so it has to be re-added here too.
    var input = modal.querySelector('[data-cf-id="' + field.id + '"]');
    var group = input && input.closest('.form-group');
    addStar(group && group.querySelector('.form-label'));
  });
}

function formatFieldShowIn(field) {
  var show = field && field.show_in;
  if (!show || !show.length) return 'Drawer';
  var labels = [];
  if (show.indexOf('create') >= 0) labels.push('Create');
  if (show.indexOf('drawer') >= 0) labels.push('Drawer');
  return labels.join(', ') || 'Drawer';
}

function isLockedBuiltinField(field) {
  // Options are now freely editable on type/priority (migration 016), but the
  // field itself must always exist — deleting it would leave the space with no
  // way to set a value that Create Issue always shows as required.
  return !!(field && field.is_builtin && ['title', 'type', 'priority'].indexOf(field.field_key) >= 0);
}

function isCombinationField(field) {
  if (!field) return false;
  if (field.field_key === 'combination') return true;
  return (field.name || '').toLowerCase().trim() === 'combination';
}

function isBuiltinProductTypeField(field) {
  return !!(field && (field.field_key === 'product_type' || ((field.name || '').toLowerCase().trim() === 'product type' && field.is_builtin)));
}

var BUILTIN_SELECT_DEFAULTS = {
  type: ['epic', 'story', 'task', 'bug', 'subtask'],
  priority: ['highest', 'high', 'medium', 'low', 'lowest'],
  team: ['Dev', 'QA', 'Infra', 'Manage', 'Product_Team'],
  product_type: ['Message', 'Email', 'Content', 'Manage', 'Infra']
};

function getBuiltinDefaultOptions(field) {
  if (!field || !field.field_key) return [];
  return (BUILTIN_SELECT_DEFAULTS[field.field_key] || []).slice();
}

function formatFieldOptionsForEditor(field) {
  if (!field) return '';
  var raw = field.options;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) {}
  }
  if (raw && raw.v === 2 && raw.groups) return '';
  if (Array.isArray(raw) && raw.length) {
    return raw.map(function (o) {
      if (o && typeof o === 'object') return String(o.value != null ? o.value : (o.label != null ? o.label : o));
      return String(o);
    }).join(', ');
  }
  return getBuiltinDefaultOptions(field).join(', ');
}

function readShowInFromField(field) {
  var show = field && field.show_in;
  if (!show || !show.length) return { create: false, drawer: true };
  return { create: show.indexOf('create') >= 0, drawer: show.indexOf('drawer') >= 0 };
}

function writeShowInToForm(field) {
  var places = readShowInFromField(field);
  if ($('customFieldShowInCreate')) $('customFieldShowInCreate').checked = places.create;
  if ($('customFieldShowInDrawer')) $('customFieldShowInDrawer').checked = places.drawer;
}

function readShowInFromForm() {
  var show = [];
  if ($('customFieldShowInCreate') && $('customFieldShowInCreate').checked) show.push('create');
  if ($('customFieldShowInDrawer') && $('customFieldShowInDrawer').checked) show.push('drawer');
  return show.length ? show : ['drawer'];
}

// ── "Required, but only for these issue types" ────────────
// Story Points is the motivating case: mandatory on a story or task, meaningless
// on a bug. `required_types` narrows is_required to the listed types.
// An EMPTY or missing list means "every type", so every field that was already
// required before this feature keeps behaving exactly the same.
function normalizeTypeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (t) { return String(t).toLowerCase().trim(); }).filter(Boolean);
}

// The single rule every caller uses. `type` is the issue type being created/edited.
function fieldRequiredForType(field, type) {
  if (!field || !field.is_required) return false;
  var types = normalizeTypeList(field.required_types);
  if (!types.length) return true;                 // unset = required for all types
  return types.indexOf(String(type || '').toLowerCase().trim()) >= 0;
}

// Type is admin-configurable per space (migration 016) — the checkbox list
// must reflect the SPACE's own current Type options, not the fixed 5, or a
// newly-added type could never be selected here and a removed one would show
// as a stale, unremovable checkbox.
function renderRequiredTypeChoices(selected, spaceId) {
  var box = $('customFieldRequiredTypes');
  if (!box) return;
  var choices = getIssueTypeOptionsForSpace(spaceId || S.currentSpace);
  var sel = normalizeTypeList(selected);
  var all = sel.length === 0;                     // unset shows as "all ticked"
  box.innerHTML = choices.map(function (c) {
    var on = all || sel.indexOf(c.v) >= 0;
    return '<label><input type="checkbox" class="cf-req-type" value="' + c.v + '"' +
      (on ? ' checked' : '') + '> ' + c.l + '</label>';
  }).join('');
}

function readRequiredTypesFromForm() {
  var box = $('customFieldRequiredTypes');
  if (!box) return [];
  return Array.prototype.slice.call(box.querySelectorAll('.cf-req-type'))
    .filter(function (c) { return c.checked; })
    .map(function (c) { return c.value; });
}

// The type checkboxes are meaningless unless Required is on.
function syncRequiredTypesVisibility() {
  var group = $('customFieldRequiredTypesGroup');
  var req = $('customFieldRequired');
  if (group) group.hidden = !(req && req.checked);
}

function formatRequiredForTypes(field) {
  if (!field || !field.is_required) return 'No';
  var choices = getIssueTypeOptionsForSpace(field.space_id);
  var types = normalizeTypeList(field.required_types);
  if (!types.length || types.length === choices.length) return 'Yes — all types';
  var labels = choices
    .filter(function (c) { return types.indexOf(c.v) >= 0; })
    .map(function (c) { return c.l; });
  return 'Yes — ' + (labels.length ? labels.join(', ') : 'no types');
}

function renderSettingsCustomFields(space) {
  $('settingsTabContent').innerHTML =
    '<div class="text-muted" style="padding:24px;text-align:center">Loading custom fields…</div>';
  api('/api/custom-fields?space_id=' + encodeURIComponent(space.id), 'GET', null, { silent: true })
    .then(function (fetched) {
      if (Array.isArray(fetched)) {
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return f.space_id != space.id; })
          .concat(fetched);
      }
      paintSettingsCustomFields(space);
    })
    .catch(function () {
      paintSettingsCustomFields(space);
    });
}

function paintSettingsCustomFields(space) {
  var fields = getSpaceFieldRows(space.id).slice().sort(function (a, b) {
    if (!!a.is_builtin !== !!b.is_builtin) return a.is_builtin ? -1 : 1;
    return (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name));
  });

  var rowsHtml = '';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var optionsDisplay = '\u2014';
    if (isCombinationField(f)) {
      var pg = parseCombinationFieldOptions(f);
      var ptOpts = getProductTypeOptionsForSpace(space.id);
      optionsDisplay = ptOpts.length
        ? ptOpts.map(function (o) { return o.l + ': ' + (pg.groups[o.v] || []).length; }).join(', ')
        : 'No Product Type options configured';
    } else if (f.is_builtin && (f.field_key === 'product_type' || f.field_key === 'team' || f.field_key === 'type' || f.field_key === 'priority')) {
      var optVals = normalizeCFOptions(f.options);
      optionsDisplay = optVals.length ? optVals.join(', ') : formatFieldOptionsForEditor(f);
    } else if (f.is_builtin) {
      optionsDisplay = 'Built-in issue column';
    } else if (f.options) {
      optionsDisplay = Array.isArray(f.options) ? f.options.join(', ') : String(f.options);
    }
    var sourceBadge = f.is_builtin
      ? '<span class="badge" style="background:var(--primary-light,#ede9fe);color:var(--primary,#5b21b6)">Built-in</span>'
      : '<span class="badge badge-muted">Custom</span>';
    var deleteBtn = isLockedBuiltinField(f)
      ? '<span class="text-muted text-sm">Required</span>'
      : '<button class="btn btn-outline btn-sm text-danger cf-delete-btn" data-field-id="' + f.id + '" data-field-name="' + esc(f.name) + '">Remove</button>';
    // "Apply to all boards" posts to /api/custom-fields/:id/apply-to-all, which is
    // org-admin-only. A space admin could see and click it and only get a 403, so
    // it is hidden for anyone who is not an org admin.
    var applyBtn = (f.is_builtin || !isOrgAdminUser())
      ? ''
      : '<button class="btn btn-outline btn-sm cf-apply-all-btn" data-field-id="' + f.id + '" data-field-name="' + esc(f.name) + '" title="Add this field to every other board that doesn\'t already have one with this name">Apply to all boards</button> ';
    // Everything shown in the row is searchable, plus field_key and the raw
    // option values \u2014 so "slack", "multi_select", "built-in", "required" or an
    // option that got truncated in the Options column all still match.
    var haystack = [
      f.name,
      f.field_key,
      f.is_builtin ? 'built-in builtin' : 'custom',
      f.field_type || f.type,
      formatRequiredForTypes(f),
      formatFieldShowIn(f),
      optionsDisplay,
      normalizeCFOptions(f.options).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();

    rowsHtml += '<tr data-search="' + escAttr(haystack) + '">' +
      '<td>' + esc(f.name) + '</td>' +
      '<td>' + sourceBadge + '</td>' +
      '<td><span class="badge badge-muted">' + esc(f.field_type || f.type) + '</span></td>' +
      '<td class="text-sm">' + esc(formatRequiredForTypes(f)) + '</td>' +
      '<td class="text-muted text-sm">' + esc(formatFieldShowIn(f)) + '</td>' +
      '<td class="text-muted text-sm">' + esc(optionsDisplay) + '</td>' +
      '<td>' +
        '<button class="btn btn-outline btn-sm cf-edit-btn" data-field-id="' + f.id + '">Edit</button> ' +
        applyBtn +
        deleteBtn +
      '</td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Issue Fields</h3>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    settingsSearchBoxHtml('cfSearchInput', 'Search name, type, options…') +
    '<button class="btn btn-primary btn-sm" id="addCustomFieldBtnSettings">+ Add Field</button>' +
    '</div>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th>Name</th><th>Source</th><th>Type</th><th>Required</th><th>Show in</th><th>Options</th><th style="width:300px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px">No fields yet — refresh the page</td></tr>') + '</tbody></table></div>' +
    '<p class="text-muted text-sm" style="margin-top:12px">Built-in fields (Title, Team, Sprint, etc.) are added automatically for each space. Remove a field to hide it on create/drawer forms. Use <strong>+ Add Field</strong> for extra custom fields (Environment, Severity, etc.).</p>';

  $('settingsTabContent').innerHTML = html;

  wireSettingsTableSearch('cfSearchInput', 'No fields match "%s"');

  // Add field button
  $('addCustomFieldBtnSettings').onclick = function () { openCustomFieldModal(); };

  // Edit buttons
  qsa('.cf-edit-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fieldId = btn.dataset.fieldId;
      var field = fields.find(function (f) { return f.id == fieldId; });
      if (field) openCustomFieldModal(field);
    });
  });

  // Delete buttons
  qsa('.cf-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var fieldId = btn.dataset.fieldId;
      var fieldName = btn.dataset.fieldName;
      var ok = await confirmDialog('Remove "' + fieldName + '" from this space? It will be hidden on create and issue forms.');
      if (!ok) return;
      try {
        await api('/api/custom-fields/' + fieldId, 'DELETE');
        await refreshData();
        renderSettingsCustomFields(getSpace(S.currentSpace));
        toast('Custom field deleted');
      } catch (e) { /* error shown by api() */ }
    });
  });

  // Apply-to-all-boards buttons
  qsa('.cf-apply-all-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var fieldId = btn.dataset.fieldId;
      var fieldName = btn.dataset.fieldName;
      var ok = await confirmDialog('Add "' + fieldName + '" to every other board that doesn\'t already have a field with this name?');
      if (!ok) return;
      btn.disabled = true;
      var origText = btn.textContent;
      btn.textContent = 'Applying…';
      try {
        var result = await api('/api/custom-fields/' + fieldId + '/apply-to-all', 'POST');
        await refreshData();
        await refreshAllCustomFields();
        if (result.added > 0) {
          toast('Added "' + fieldName + '" to: ' + result.addedTo.join(', '));
        } else if (result.totalSpaces === 0) {
          toast('No other boards exist to add "' + fieldName + '" to', 'warning');
        } else {
          toast('Every other board already has a field named "' + fieldName + '" (' + result.skipped.join(', ') + ')', 'warning');
        }
      } catch (e) {
        /* error shown by api() */
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });
}

window._editSpaceSettings = function () {
  var space = getSpace(S.currentSpace);
  if (space) openSpaceModal(space);
};

window._deleteSpace = async function (spaceId) {
  var space = getSpace(spaceId);
  var spaceName = space ? space.name : 'this space';
  if (!canDeleteSpace()) {
    toast('Only an org admin can delete a space.', 'error');
    return;
  }
  var issueCount = (S.data.issues || []).filter(function (i) { return i.space_id === spaceId; }).length;
  // DELETE /api/spaces/:id archives the space — nothing is destroyed. The old copy
  // claimed "all issues, sprints, and data will be permanently lost", which was
  // simply untrue and made a reversible action look terrifying.
  var ok = await typedConfirmDialog({
    title: 'Delete space "' + spaceName + '"?',
    intro: 'The space and its ' + issueCount + ' ticket' + (issueCount === 1 ? '' : 's') +
      ' are removed from the sidebar and from everyone\'s boards, searches and reports.',
    note: 'Nothing is destroyed: the space is archived and appears in Deleted Items, where an org admin can restore it. ' +
      'Archived spaces are never auto-deleted.',
    phrase: spaceName,
    phraseHint: 'To confirm, type the space name',
    confirmLabel: 'Delete space'
  });
  if (!ok) return;
  try {
    await api('/api/spaces/' + spaceId, 'DELETE', null, { silent: true });
    await refreshData();
    if (S.currentSpace === spaceId) S.currentSpace = null;
    navigateTo('home');
    renderSidebar();
    popupAlert('Space deleted', '"' + spaceName + '" is in Deleted Items. An org admin can restore it from Admin Settings.', 'success');
  } catch (e) {
    popupAlert('Delete failed', e.message || 'Could not delete the space. Please try again.', 'error');
  }
};

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
