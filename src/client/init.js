
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
    if (typeof loadIssueDraftsList === 'function') loadIssueDraftsList();

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
        // openDrawer itself now sets document.title directly from the fetched
        // issue (see issue-drawer.js) -- this used to be the only place the
        // title was ever set at all, via a 400ms guess at when drawerKey's
        // text would be rendered, which is both fragile (a slow fetch could
        // still lose the race) and only ever ran once per page load, so
        // navigating from this ticket to a different one in-app left the
        // FIRST ticket's title stuck in the tab forever.
        openDrawer(issueParam);
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
    btn.innerHTML = '<img src="' + esc(user.avatar_url) + '" alt="' + escAttr(user.name || '') + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    if (av2) av2.innerHTML = '<img src="' + esc(user.avatar_url) + '" alt="' + escAttr(user.name || '') + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    // The <img alt> above already carries the name, so the button's own
    // aria-label just needs to not contradict it.
    btn.setAttribute('aria-label', 'Profile');
  } else {
    var ini = initials(user.name);
    btn.style.background = color;
    btn.style.color = '#fff';
    btn.innerHTML = '<span aria-hidden="true" style="font-size:13px;font-weight:700">' + esc(ini) + '</span>';
    // aria-hidden on the initials span keeps them out of the accessible
    // name, so the label has to say what they say instead of just "Profile"
    // -- axe's label-content-name-mismatch rule flags visible text that
    // isn't reflected in the accessible name at all, aria-hidden or not.
    btn.setAttribute('aria-label', 'Profile: ' + ini);
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
    ? '<img src="' + esc(user.avatar_url) + '" alt="' + escAttr(user.name || '') + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover">'
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
            '<input id="_profFirstName" value="' + escAttr(firstName) + '" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'#0129AC\'" onblur="this.style.borderColor=\'#e2e8f0\'">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px">Last Name</label>' +
            '<input id="_profLastName" value="' + escAttr(lastName) + '" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'#0129AC\'" onblur="this.style.borderColor=\'#e2e8f0\'">' +
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
      // silent: the catch renders its own 'Profile update failed - <why>'
      var updated = await api('/api/users/' + user.id, 'PUT', { name: fullName }, { silent: true });
      // Update local state
      if (S.currentUserObj) { S.currentUserObj.name = updated.name; }
      if (S.data && S.data.users) {
        var idx = S.data.users.findIndex(function(u){ return u.id === user.id; });
        if (idx !== -1) { S.data.users[idx].name = updated.name; }
      }
      renderTopbarProfile(S.currentUserObj);
      close();
      toast('Profile updated', 'success');
    } catch(e) {
      toast('Profile update failed — ' + errorReason(e), 'error');
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
    ? '<img src="' + esc(user.avatar_url) + '" alt="' + escAttr(user.name || '') + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.2)" />'
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
