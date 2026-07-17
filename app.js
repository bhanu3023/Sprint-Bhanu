window._isMemberOnly = (function() { try { const u = JSON.parse(localStorage.getItem("sb-user")); return u && u.role === "member"; } catch(e) { return false; } })();

// ═══════════════════════════════════════════════════════════
// SPRINTBOARD ENTERPRISE — SPA CORE LOGIC
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
  data: null,
  currentUser: null,
  currentSpace: null,
  currentView: 'home',
  currentTab: null,
  drawerIssueId: null,
  calendarDate: new Date(),
  calendarView: 'month',
  allWorkSort: { col: 'updated_at', dir: 'desc' },
  allWorkPage: 1,
  allWorkSelected: new Set(),
  yourWorkTab: 'assigned',
  awFilters: {
    type: [], status: [], priority: [], assignee: [], sprint: [],
    createdFrom: '', createdTo: '',
    updatedFrom: '', updatedTo: '',
    dueDateFrom: '', dueDateTo: '',
    startDateFrom: '', startDateTo: ''
  }
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const visLabel = (v) => ({ private: 'Private', team: 'Team', org: 'Organization' }[v] || cap(v || 'private'));
const esc = (str) => {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
};

function fmtMins(mins) {
  if (!mins || mins <= 0) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + 'h';
  return m + 'm';
}

function fmtDate(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '\u2014';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '\u2014';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDateShort(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateISO(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().split('T')[0];
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
}

function relativeTime(d) {
  if (!d) return '';
  var diff = Date.now() - new Date(d).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return fmtDate(d);
}

function parseEstimate(str) {
  if (!str) return 0;
  var total = 0;
  var hMatch = str.match(/(\d+)\s*h/i);
  var mMatch = str.match(/(\d+)\s*m/i);
  if (hMatch) total += parseInt(hMatch[1], 10) * 60;
  if (mMatch) total += parseInt(mMatch[1], 10);
  if (!hMatch && !mMatch) {
    var n = parseFloat(str);
    if (!isNaN(n)) total = Math.round(n * 60);
  }
  return total;
}

// ═══════════════════════════════════════════════════════════
// API WRAPPER
// ═══════════════════════════════════════════════════════════
function getAuthToken() { return localStorage.getItem('sb-token') || ''; }

async function api(url, method, body) {
  method = method || 'GET';
  try {
    var token = getAuthToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var opts = { method: method, headers: headers };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    if (res.status === 401) {
      localStorage.removeItem('sb-token');
      localStorage.removeItem('sb-user');
      window.location.href = '/login.html';
      return;
    }
    if (!res.ok) {
      var err;
      try { err = await res.json(); } catch (_) { err = {}; }
      throw new Error(err.error || res.statusText);
    }
    if (res.status === 204) return null;
    return await res.json();
  } catch (e) {
    if (e.message && e.message.includes('redirect')) return;
    toast(e.message || 'API request failed', 'error');
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function toast(msg, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  var icon = type === 'error' ? '✕' : type === 'warning' ? '⚠️' : '✓';
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + msg + '</span>';
  c.appendChild(el);
  setTimeout(function () { el.classList.add('toast-fade'); }, 3000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3600);
}

function popupAlert(title, msg, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'popup-alert popup-alert-' + type;
  var icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅';
  el.innerHTML =
    '<div class="popup-alert-icon">' + icon + '</div>' +
    '<div class="popup-alert-body">' +
    '<div class="popup-alert-title">' + title + '</div>' +
    '<div class="popup-alert-msg">' + msg + '</div>' +
    '</div>' +
    '<button class="popup-alert-close" onclick="this.parentNode.remove()">✕</button>';
  c.appendChild(el);
  setTimeout(function () { el.classList.add('popup-fade'); }, 4000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4700);
}

// ═══════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════
var _confirmResolve = null;
function confirmDialog(msg) {
  return new Promise(function (resolve) {
    $('confirmMsg').textContent = msg;
    openModal('modal-confirm');
    _confirmResolve = resolve;
    $('confirmYes').onclick = function () { _confirmResolve = null; closeModal('modal-confirm'); resolve(true); };
    $('confirmNo').onclick = function () { _confirmResolve = null; closeModal('modal-confirm'); resolve(false); };
  });
}

// ═══════════════════════════════════════════════════════════
// MODAL / DRAWER HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  var el = $(id);
  if (el) el.removeAttribute('hidden');
}

function closeModal(id) {
  var el = $(id);
  if (el) el.setAttribute('hidden', '');
  if (id === 'modal-confirm' && _confirmResolve) {
    _confirmResolve(false);
    _confirmResolve = null;
  }
}
window.openModal = openModal;
window.closeModal = closeModal;

var _drawerSyncTimer = null;
function stopDrawerLiveSync() {
  if (_drawerSyncTimer) { clearInterval(_drawerSyncTimer); _drawerSyncTimer = null; }
}

function closeDrawer() {
  document.body.classList.remove('issue-page');
  window.history.replaceState({}, "", "/");
  stopDrawerLiveSync();
  $('issueDrawer').setAttribute('hidden', '');
  S.drawerIssueId = null;
  window._drawerPending = {};
  if (S._prevTab && S._prevSpace) {
    S.currentSpace = S._prevSpace;
    navigateToSpace(S._prevSpace, S._prevTab);
  } else if (S._prevView) {
    navigateTo(S._prevView);
  }
  S._prevView = null; S._prevTab = null; S._prevSpace = null;
}
window.closeDrawer = closeDrawer;

function goBackToSavedPage() {
  window.history.replaceState({}, "", "/");
  stopDrawerLiveSync();
  $('issueDrawer').setAttribute('hidden', '');
  S.drawerIssueId = null;
  window._drawerPending = {};
  var pTab   = S._prevTab;
  var pSpace = S._prevSpace;
  var pView  = S._prevView;
  S._prevView = null; S._prevTab = null; S._prevSpace = null;
  if (pTab && pSpace) {
    S.currentSpace = pSpace;
    navigateToSpace(pSpace, pTab);
  } else if (pView && pView !== 'home') {
    navigateTo(pView);
  } else if (S.currentSpace) {
    navigateToSpace(S.currentSpace, 'allwork');
  } else {
    var firstSpace = S.data && S.data.spaces && S.data.spaces[0];
    if (firstSpace) navigateToSpace(firstSpace.id, 'allwork');
    else navigateTo('home');
  }
}
window.goBackToSavedPage = goBackToSavedPage;

// Opens an issue in a new browser tab
function openIssuePage(issueId) {
  S._prevView = S.currentView;
  S._prevTab = S.currentTab;
  S._prevSpace = S.currentSpace;
  S._prevScrollY = window.scrollY;
  var issueObj = (S.data.issues || []).find(function(i){ return i.id == issueId; });
  var issueKey = issueObj ? issueObj.key : issueId;
  window.history.pushState({ issueId: issueId }, "", "?issue=" + issueKey);
  document.body.classList.add("issue-page");
  openDrawer(issueId);
}
window.openIssuePage = openIssuePage;

// Save all pending drawer changes to DB
async function saveDrawerChanges() {
  // No-op — fields now auto-save via bindDrawerEdits autoSave()
}
window.saveDrawerChanges = saveDrawerChanges;

// ═══════════════════════════════════════════════════════════
// CONSTANTS: STATUSES, PRIORITIES, TYPES
// ═══════════════════════════════════════════════════════════
var STATUS_COLORS = {
  'To Do': '#42526e',
  'In Progress': '#0052cc',
  'In Review': '#ff991f',
  'Done': '#00875a'
};
var PRIORITY_COLORS = {
  highest: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6', lowest: '#6b7280'
};
var PRIORITY_ICONS = {
  highest: '\u2B06\u2B06', high: '\u2B06', medium: '\u2B1B', low: '\u2B07', lowest: '\u2B07\u2B07'
};
var TYPE_ICONS = {
  epic: '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#9747FF"/><path d="M9.5 3.5L6 8h3l-2.5 5 6-6.5H9L11 3.5z" fill="white"/></svg>', story: '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#36B37E"/><path d="M5 4.5h6v1H8.5V11h-1V5.5H5V4.5z" fill="white"/><rect x="4" y="7" width="8" height="1" fill="white"/></svg>', task: '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#0052CC"/><polyline points="3.5,8 6.5,11 12.5,5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', bug: '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#FF5630"/><circle cx="8" cy="8" r="3" fill="white" opacity="0.9"/><line x1="8" y1="3" x2="8" y2="5" stroke="white" stroke-width="1.5"/><line x1="8" y1="11" x2="8" y2="13" stroke="white" stroke-width="1.5"/><line x1="3" y1="7" x2="5" y2="7.5" stroke="white" stroke-width="1.5"/><line x1="11" y1="7.5" x2="13" y2="7" stroke="white" stroke-width="1.5"/><line x1="4" y1="5" x2="6" y2="6.5" stroke="white" stroke-width="1.5"/><line x1="10" y1="6.5" x2="12" y2="5" stroke="white" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5" fill="#FF5630"/></svg>', subtask: '<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#00B8D9"/><path d="M4 4v5h2" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="6,7 9,10.5 13.5,5.5" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
var SPRINT_STATUS_COLORS = {
  planning: '#6b7280', active: '#3b82f6', completed: '#10b981'
};

// ═══════════════════════════════════════════════════════════
// HTML BADGE / AVATAR HELPERS
// ═══════════════════════════════════════════════════════════
function statusBadge(status) {
  var styles = {
    'To Do':      'background:#dfe1e6;color:#42526e',
    'In Progress':'background:#deebff;color:#0052cc',
    'In Review':  'background:#fff0b3;color:#974f0c',
    'Done':       'background:#e3fcef;color:#006644'
  };
  var style = styles[status] || 'background:#dfe1e6;color:#42526e';
  return '<span style="' + style + ';border-radius:3px;text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:0.04em;padding:2px 8px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer">' + esc(status) + '<span style="font-size:11px;margin-left:2px">&#9662;</span></span>';
}

function priorityBadge(priority) {
  var colors = {
    highest: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6', lowest: '#6b7280'
  };
  var color = colors[priority] || '#6b7280';
  return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;white-space:nowrap;cursor:pointer">' +
    '<span style="color:#172b4d;font-weight:500">' + cap(priority) + '</span>' +
    '<span style="color:#6b778c;font-size:12px;line-height:1;vertical-align:middle;margin-top:3px">&#9662;</span>' +
    '</span>';
}

function typeIcon(type) {
  return TYPE_ICONS[type] || '\uD83D\uDCC4';
}

function typeLabel(type) {
  return cap(type || 'task');
}

function sprintStatusBadge(status) {
  var color = SPRINT_STATUS_COLORS[status] || '#6b7280';
  return '<span class="badge" style="background:' + color + ';color:#fff">' + cap(status) + '</span>';
}

function avatarHtml(user, size) {
  size = size || 32;
  var baseStyle = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;flex-shrink:0;vertical-align:middle;line-height:1;text-align:center;overflow:hidden;';
  if (!user) return '<span class="avatar" style="' + baseStyle + 'background:#ccc">?</span>';
  var color = user.color || '#0129ac';
  return '<span class="avatar av-tip" style="' + baseStyle + 'background:' + color + ';position:relative;cursor:default" data-tip="' + esc(user.name) + '">' + initials(user.name) + '</span>';
}

function issueKeyStr(issue) {
  return issue.key || (issue.project_key ? issue.project_key + '-?' : '#' + issue.id);
}

function statCard(label, value, color, filter) {
  var click = filter ? ' onclick="window._statCardClick(\'' + filter + '\')" style="cursor:pointer"' : '';
  return '<div class="stat-card"' + click + '><div class="stat-value" style="color:' + color + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}
window._statCardClick = function(filter) {
  navigateToSpace(S.currentSpace, 'backlog');
  setTimeout(function() {
    window._activeStatFilter = filter;
    renderBacklog();
  }, 100);
};

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

function getSpaceIssues(spaceId) {
  return (S.data.issues || []).filter(function (i) { return i.space_id == spaceId; });
}

function getSpaceSprints(spaceId) {
  return (S.data.sprints || []).filter(function (sp) { return sp.space_id == spaceId; });
}

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

function populateSprintSelect(sel, sprints, selectedId) {
  var html = '<option value="">None</option>';
  for (var i = 0; i < sprints.length; i++) {
    var sp = sprints[i];
    html += '<option value="' + sp.id + '"' + (sp.id == selectedId ? ' selected' : '') + '>' + esc(sp.name) + ' (' + sp.status + ')</option>';
  }
  sel.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════
function initTheme() {
  applyTheme('light', false);
}

function toggleTheme() {
  var isDark = !document.body.classList.contains('light');
  applyTheme(isDark ? 'light' : 'dark', true);
}

function applyTheme(theme, saveToDb) {
  if (theme === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
  var moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#42526e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#42526e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var icon = theme === 'light' ? sunSvg : moonSvg;
  if ($('themeToggle')) $('themeToggle').innerHTML = icon;
  if ($('themeToggleTop')) $('themeToggleTop').innerHTML = icon;
  localStorage.setItem('sb-theme', theme);
  // Persist to DB when user explicitly toggles
  if (saveToDb && S.currentUser) {
    api('/api/users/' + S.currentUser, 'PUT', { theme: theme }).then(function(u) {
      if (u && S.currentUserObj) S.currentUserObj.theme = u.theme;
    }).catch(function(){});
  }
}

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
    if (!issueParam) navigateTo('home');
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
            S.currentTab = 'backlog';
            var space = getSpace(iss.space_id);
            if (space) {
              // $('spaceNav').removeAttribute('hidden'); // Already have top nav
              // Removed: navSection hiding - keep visible
              qsa('.space-item').forEach(function(el) {
                el.classList.toggle('active', el.dataset.spaceId === iss.space_id);
              });
              qsa('.nav-item[data-tab]').forEach(function(el) {
                el.classList.toggle('active', el.dataset.tab === 'backlog');
              });
            }
          }
        } catch(_) {}
        openDrawer(issueParam);
        setTimeout(function() {
          var key = $('drawerKey') && $('drawerKey').textContent;
          var title = $('drawerTitle') && $('drawerTitle').textContent;
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

  // Toggle dropdown
  btn.onclick = function(e) {
    e.stopPropagation();
    var menu = $('topbarProfileMenu');
    if (menu) menu.hidden = !menu.hidden;
  };

  // Close on outside click
  document.addEventListener('click', function(e) {
    var menu = $('topbarProfileMenu');
    if (menu && !menu.hidden && !$('topbarProfileWrap').contains(e.target)) menu.hidden = true;
  });

  window._topbarProfileAction = function(action) {
    var menu = $('topbarProfileMenu');
    if (menu) menu.hidden = true;
    if (action === 'settings') navigateTo('settings');
    else if (action === 'profile') openProfileSettingsModal();
    else if (action === 'logout') doLogout();
  };
}

function openProfileSettingsModal() {
  var user = S.currentUserObj || {};
  var nameParts = (user.name || '').split(' ');
  var firstName = nameParts[0] || '';
  var lastName = nameParts.slice(1).join(' ') || '';
  var color = user.color || '#0129AC';
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
          '<div style="margin-top:6px"><span style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:20px">' + cap(user.role || 'member') + '</span></div>' +
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
          '<input id="_profEmail" type="email" value="' + esc(user.email || '') + '" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'#0129AC\'" onblur="this.style.borderColor=\'#e2e8f0\'">' +
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
    var em = overlay.querySelector('#_profEmail').value.trim();
    var fullName = (fn + ' ' + ln).trim();
    if (!fullName) { toast('Name is required', 'error'); return; }
    var saveBtn = overlay.querySelector('#_profileSaveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      var updated = await api('/api/users/' + user.id, 'PUT', { name: fullName, email: em });
      // Update local state
      if (S.currentUserObj) { S.currentUserObj.name = updated.name; S.currentUserObj.email = updated.email; }
      if (S.data && S.data.users) {
        var idx = S.data.users.findIndex(function(u){ return u.id === user.id; });
        if (idx !== -1) { S.data.users[idx].name = updated.name; S.data.users[idx].email = updated.email; }
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
  var roleBadge = '<span style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);padding:1px 6px;border-radius:10px">' + cap(user.role || 'member') + '</span>';
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
function _exitIssuePage() {
  document.body.classList.remove('issue-page');
  var drawer = $('issueDrawer');
  if (drawer) drawer.setAttribute('hidden', '');
  window.history.replaceState({}, "", "/");
  S.drawerIssueId = null;
  window._currentIssueKey = null;
}

function navigateTo(view) {
  document.body.classList.remove('settings-active');
  // Guard: global Reports is owner-only
  if (view === 'global-reports' && !isSpaceOwner(S.currentSpace)) {
    toast('Only owners can access Reports', 'error');
    return;
  }
  _exitIssuePage();
  S.currentView = view;
  S.currentSpace = null;
  S.currentTab = null;

  // Hide everything
  qsa('.view').forEach(function (v) { v.setAttribute('hidden', ''); });
  $('spaceHeader').setAttribute('hidden', '');
  $('spaceNav').setAttribute('hidden', '');
  var navSection = document.querySelector('.nav-section');
              // Removed: navSection hiding - keep visible

  // Show target
  var target = $('view-' + view);
  if (target) target.removeAttribute('hidden');

  // Breadcrumb
  var label = view === 'yourwork' ? 'Assigned to me' : view === 'global-reports' ? 'Reports' : view === 'worklog-report' ? 'Work Log' : view === 'product-roadmap' ? 'Product Roadmap' : view === 'spaces' ? 'Spaces' : cap(view);
  updateBreadcrumb([{ label: label }]);

  // Active state
  qsa('.nav-item[data-view]').forEach(function (el) {
    el.classList.toggle('active', el.dataset.view === view);
  });
  qsa('.nav-item[data-tab]').forEach(function (el) { el.classList.remove('active'); });
  qsa('.space-item').forEach(function (el) { el.classList.remove('active'); });

  // Render
  if (view === 'home') renderHome();
  else if (view === 'yourwork') renderYourWork();
  else if (view === 'spaces') renderSpacesView();
  else if (view === 'worklog-report') renderWorklogReport();
  else if (view === 'product-roadmap') renderProductRoadmap();
  else if (view === 'user-management') renderUserManagement();
  else if (view === 'settings') { document.body.classList.add('settings-active'); renderAdminSettings('org-general'); }
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
        var d4 = await api('/api/reports/cycle-time?space_id=' + spaceId);
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

function navigateToSpace(spaceId, tab) {
  _exitIssuePage();
  tab = tab || 'summary';
  // Reset All Work filters when switching spaces
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
  // $('spaceNav').removeAttribute('hidden'); // Already have top nav
  renderSpaceHeader(space);

  updateBreadcrumb([
    { label: 'Home', action: function () { navigateTo('home'); } },
    { label: space.name, action: function () { navigateToSpace(spaceId, 'summary'); } },
    { label: cap(tab) }
  ]);

  qsa('.nav-item[data-view]').forEach(function (el) { el.classList.remove('active'); });
  qsa('.space-subnav').forEach(function(el){ el.remove(); });
  qsa('.space-item').forEach(function(el){
    var isSel = String(el.dataset.spaceId) === String(spaceId);
    el.classList.toggle('active', isSel);
    if(isSel){
      var sub = document.createElement('div');
      sub.className = 'space-subnav';
      sub.innerHTML = [
        {t:'summary',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',l:'Summary'},
        {t:'backlog',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',l:'Backlog'},
        {t:'sprint',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',l:'Active Sprint'},
        {t:'reports',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',l:'Reports'},
        {t:'allwork',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',l:'All Work'},
        {t:'space-settings',i:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',l:'Settings'}
      ].map(function(x){
        return '<a class="nav-item space-subitem'+(x.t===tab?' active':'')+' " data-tab="'+x.t+'" data-space-id="'+spaceId+'"><span class="nav-icon">'+x.i+'</span> '+x.l+'</a>';
      }).join('');
      el.parentNode.insertBefore(sub, el.nextSibling);
    }
  });

  renderTab(tab);
}
window.navigateToSpace = navigateToSpace;

function renderTab(tab) {
  // Guard: Reports and Settings are owner-only (global owner OR space owner)
  if (!isSpaceOwner(S.currentSpace) && (tab === 'reports' || tab === 'space-settings')) {
    toast('Only owners can access this section', 'error');
    return;
  }
  _exitIssuePage();
  S.currentTab = tab;
  qsa('.view').forEach(function (v) { v.setAttribute('hidden', ''); });
  qsa('.nav-item[data-tab]').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === tab); });

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

  switch (tab) {
    case 'summary': renderSummary(); break;
    case 'backlog': renderBacklog(); break;
    case 'sprint': renderSprintBoard(); break;
    case 'reports': renderReports(); break;
    case 'allwork': (async function() {
      // Skip full refresh if data was loaded within last 30s for this space
      var now = Date.now();
      if (!S._dataLoadedAt || (now - S._dataLoadedAt) > 30000 || S._dataLoadedSpace !== S.currentSpace) {
        await refreshData();
        S._dataLoadedAt = now;
        S._dataLoadedSpace = S.currentSpace;
      }
      await _initAwMultiSelects();
      renderAllWork();
    })(); break;
    case 'filters': renderFilters(); break;
    case 'space-settings': renderSpaceSettings(); break;
  }
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

async function refreshAfterIssueChange() {
  await refreshData();
  if (S.currentSpace && S.currentTab) renderTab(S.currentTab);
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════
function renderSidebar() {
  var role = (S.currentUserObj || {}).role;
  var isOwner = role === 'owner';
  var isOwnerOrAdmin = role === 'owner' || role === 'admin';

  // Show/hide the + new space button (owner only)
  var newSpaceBtn = $('newSpaceBtn');
  if (newSpaceBtn) newSpaceBtn.style.display = isOwner ? '' : 'none';

  // Reports and Settings: visible to global owner OR space owner
  var effectiveOwner = isOwner || isSpaceOwner(S.currentSpace);
  var ownerOnlyItems = document.querySelectorAll('[data-tab="reports"], [data-tab="space-settings"], [data-view="global-reports"]');
  ownerOnlyItems.forEach(function(el) { el.style.display = effectiveOwner ? '' : 'none'; });

  // Work Log and Product Roadmap visible to owner and admin only (hidden for members)
  var memberHiddenItems = document.querySelectorAll('[data-view="worklog-report"], [data-view="product-roadmap"]');
  memberHiddenItems.forEach(function(el) { el.style.display = isOwnerOrAdmin ? '' : 'none'; });

  // Favorites
  var favRecs = (S.data.space_favorites || []).filter(function (f) { return f.user_id == S.currentUser; });
  var favs = favRecs.map(function (f) { return getSpace(f.space_id); }).filter(Boolean);
  $('favSpaces').innerHTML = favs.length
    ? favs.map(spaceNavItem).join('')
    : '<p class="text-muted sidebar-empty">No favorites yet</p>';

  // All spaces — members only see spaces they are assigned to in DB
  var allSpaces = (S.data.spaces || []).filter(function (s) { return !s.is_archived; });
  var spaces = isOwnerOrAdmin ? allSpaces : allSpaces.filter(function(s) {
    return (S.data.space_members || []).some(function(m) {
      return m.space_id === s.id && m.user_id === S.currentUser;
    });
  });
  $('spacesList').innerHTML = spaces.length
    ? spaces.map(spaceNavItem).join('')
    : '<p class="text-muted sidebar-empty">No spaces</p>';

  // Bind space clicks — toggle collapse if already active
  qsa('.space-item').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var spaceId = el.dataset.spaceId;
      if (String(S.currentSpace) === String(spaceId) && S.currentView === 'space') {
        // Already open — collapse: remove subnav and deactivate
        qsa('.space-subnav').forEach(function(s){ s.remove(); });
        qsa('.space-item').forEach(function(s){ s.classList.remove('active'); });
        S.currentSpace = null;
        S.currentView = 'home';
        qsa('.view').forEach(function(v){ v.setAttribute('hidden',''); });
        var homeView = $('view-home');
        if (homeView) homeView.removeAttribute('hidden');
        $('spaceHeader').setAttribute('hidden','');
        qsa('.nav-item[data-view]').forEach(function(n){ n.classList.toggle('active', n.dataset.view === 'home'); });
        updateBreadcrumb([{ label: 'Home' }]);
        renderHome();
      } else {
        navigateToSpace(spaceId);
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
}

function spaceNavItem(sp) {
  var active = S.currentSpace == sp.id ? ' active' : '';
  var isOwner = canCreateSpace();
  var initLetter = sp.name ? sp.name.charAt(0).toUpperCase() : '?';
  var bgColor = sp.color || '#0129ac';
  var isActive = S.currentSpace != null && String(S.currentSpace) === String(sp.id);
  var subnav = isActive ? (
    '<div class="space-subnav">' +
'<a class="nav-item space-subitem' + (S.currentTab==='summary'?' active':'') + '" data-tab="summary" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg></span> Summary</a>' +
    '<a class="nav-item space-subitem' + (S.currentTab==='backlog'?' active':'') + '" data-tab="backlog" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span> Backlog</a>' +
    '<a class="nav-item space-subitem' + (S.currentTab==='sprint'?' active':'') + '" data-tab="sprint" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span> Active Sprint</a>' +
    '<a class="nav-item space-subitem' + (S.currentTab==='reports'?' active':'') + '" data-tab="reports" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg></span> Reports</a>' +
    '<a class="nav-item space-subitem' + (S.currentTab==='allwork'?' active':'') + '" data-tab="allwork" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span> All Work</a>' +
    '<a class="nav-item space-subitem' + (S.currentTab==='space-settings'?' active':'') + '" data-tab="space-settings" data-space-id="' + sp.id + '"><span class="nav-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span> Settings</a>' +
    '</div>'
  ) : '';
  return '<div class="space-item-wrap">' +
    '<a class="nav-item space-item' + active + '" data-space-id="' + sp.id + '">' +
    '<span class="space-dot" style="background:transparent;"></span>' +
    '<span class="space-jira-icon" style="background:' + bgColor + ';width:20px;height:20px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;margin-right:6px;">' + initLetter + '</span>' +
    '<span class="space-item-name">' + esc(sp.name) + '</span>' +
    (isOwner ? '<button class="btn-icon space-item-menu-btn" data-space-menu-id="' + sp.id + '" title="More options">\u22EF</button>' : '') +
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

  var members = getSpaceMembers(space.id);
  var shown = members.slice(0, 5);
  var overflow = members.length - 5;
  var membersHtml = shown.map(function (u) { return avatarHtml(u, 28); }).join('');
  if (overflow > 0) membersHtml += '<span class="avatar-overflow" style="cursor:pointer" title="View all members" onclick="_settingsActiveTab=\'people\';navigateToSpace(S.currentSpace,\'space-settings\')">+' + overflow + '</span>';
  $('spaceMembers').innerHTML = membersHtml;

  var starred = isFavorited(space.id);
  $('starSpaceBtn').textContent = starred ? '\u2605' : '\u2606';
  $('starSpaceBtn').classList.toggle('starred', starred);
  $('starSpaceBtn').onclick = async function () {
    await api('/api/spaces/' + space.id + '/favorite', 'POST', { user_id: S.currentUser });
    await refreshData();
    renderSidebar();
    renderSpaceHeader(getSpace(space.id));
  };

  $('spaceActionsBtn').onclick = function () { openSpaceModal(space); };
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
  var allIssues = S.data.issues || [];
  var myIssues = allIssues.filter(function (i) { return i.assignee_id == S.currentUser && i.status !== 'Done'; });
  var recentIssues = allIssues.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 10);

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
  function dbStat(label, value, color, rgb, svgPath, onclick) {
    var click = onclick ? ' onclick="' + onclick + '" style="--db-stat-color:' + color + ';--db-stat-rgb:' + rgb + ';cursor:pointer"' : ' style="--db-stat-color:' + color + ';--db-stat-rgb:' + rgb + '"';
    return '<div class="db-stat"' + click + '>' +
      '<div class="db-stat-icon"><svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">' + svgPath + '</svg></div>' +
      '<div class="db-stat-body"><div class="db-stat-value">' + value + '</div><div class="db-stat-label">' + label + '</div></div>' +
      '</div>';
  }
  $('homeStats').innerHTML =
    dbStat('Spaces', spaces.length, '#0129ac', '23,79,150',
      '<path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>',
      'navigateTo(\'spaces\')') +
    dbStat('Total Issues', allIssues.length, '#6366f1', '99,102,241',
      '<path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zM3 5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8zm0 2.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5z"/>',
      null) +
    dbStat('My Open Issues', myIssues.length, '#f59e0b', '245,158,11',
      '<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/>',
      'navigateTo(\'yourwork\')') +
    dbStat('Recent Updates', recentIssues.length, '#10b981', '16,185,129',
      '<path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>',
      'navigateTo(\'yourwork\');setTimeout(function(){var t=document.querySelector(\'.yw-tab[data-yourwork-tab=recent]\');if(t)t.click();},200)');

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
        statusBadge(issue.status) +
        priorityBadge(issue.priority) +
        '</div>';
    }
  } else {
    myHtml = '<div class="db-issue-empty">' +
      '<svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/></svg>' +
      'No issues assigned to you</div>';
  }
  $('myIssues').innerHTML = myHtml;

  // Recent Activity
  var actHtml = '';
  for (var j = 0; j < recentIssues.length; j++) {
    var ri = recentIssues[j];
    var user = findUser(ri.assignee_id);
    actHtml += '<div class="db-act-row" onclick="openIssuePage(\'' + ri.id + '\')">' +
      avatarHtml(user, 30) +
      '<div class="db-act-body">' +
      '<div class="db-act-title"><span class="db-act-key">' + esc(issueKeyStr(ri)) + '</span> ' + esc(ri.title) + '</div>' +
      '<div class="db-act-time">' + relativeTime(ri.updated_at) + '</div>' +
      '</div></div>';
  }
  $('recentActivity').innerHTML = actHtml || '<div class="db-issue-empty">No recent activity</div>';

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

function renderYourWork() {
  var tabs = qsa('.yw-tab');
  tabs.forEach(function (t) {
    t.classList.toggle('active', t.dataset.yourworkTab === S.yourWorkTab);
    t.onclick = function () {
      S.yourWorkTab = t.dataset.yourworkTab;
      tabs.forEach(function (x) { x.classList.toggle('active', x.dataset.yourworkTab === S.yourWorkTab); });
      renderYourWorkContent(_ywCache);
    };
  });
  $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
  api('/api/my-issues').then(function (data) {
    _ywCache = data;
    // Update badge with assigned count
    var badge = $('ywBadge');
    if (badge) {
      var n = (data.assigned || []).length;
      badge.textContent = n;
      badge.classList.toggle('visible', n > 0);
    }
    renderYourWorkContent(data);
  }).catch(function (e) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>' +
      '<h3>Could not load issues</h3><p>Please refresh the page or restart the server.</p></div>';
  });
}

function renderYourWorkContent(data) {
  if (!data) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
    return;
  }
  var issues;
  if (S.yourWorkTab === 'assigned') issues = (data.assigned || []).slice();
  else if (S.yourWorkTab === 'reported') issues = (data.reported || []).slice();
  else issues = (data.recent || []).slice();
  issues.sort(function(a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });

  if (!issues.length) {
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

  var html = '<table class="yw-table"><thead><tr>' +
    '<th>Key</th><th>Title</th><th>Type</th><th>Status</th><th>Priority</th><th>Space</th><th>Updated</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < issues.length; i++) {
    var iss = issues[i];
    var iid = iss.id;
    html += '<tr onclick="openIssuePage(\'' + iid + '\')">' +
      '<td class="yw-key">' + esc(issueKeyStr(iss)) + '</td>' +
      '<td class="yw-title-cell">' + esc(iss.title) + '</td>' +
      '<td>' + typeIcon(iss.type) + ' <span style="font-size:12px;color:var(--text2)">' + cap(iss.type || '') + '</span></td>' +
      '<td onclick="event.stopPropagation();awInlineStatus(event,\'' + iid + '\',\'' + (iss.status||'') + '\')" style="cursor:pointer">' + statusBadge(iss.status) + '</td>' +
      '<td onclick="event.stopPropagation();awInlinePriority(event,\'' + iid + '\',\'' + (iss.priority||'') + '\')" style="cursor:pointer">' + priorityBadge(iss.priority) + '</td>' +
      '<td class="yw-space-cell">' + esc(iss.space_name || '') + '</td>' +
      '<td class="yw-time-cell">' + relativeTime(iss.updated_at) + '</td></tr>';
  }
  html += '</tbody></table>';
  $('yourWorkContent').innerHTML = html;
}

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
  var prioGroups = ['highest', 'high', 'medium', 'low', 'lowest'].map(function (p) {
    return {
      label: cap(p),
      count: issues.filter(function (iss) { return iss.priority === p; }).length,
      color: PRIORITY_COLORS[p]
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

  // Sort sprints: active first, planning, completed
  var order = { active: 0, planning: 1, completed: 2 };
  var sorted = sprints.slice().sort(function (a, b) {
    return (order[a.status] || 9) - (order[b.status] || 9);
  });

  var html = '';

  for (var s = 0; s < sorted.length; s++) {
    var sp = sorted[s];
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

    html += '<div class="backlog-lane" data-sprint-id="' + sp.id + '">' +
      '<div class="backlog-lane-header" onclick="window._toggleBacklogLane(this)">' +
      '<div class="lane-header-left">' +
      '<span class="lane-toggle">' + (collapsed ? '\u25B8' : '\u25BE') + '</span>' +
      '<strong>' + esc(sp.name) + '</strong> ' +
      sprintStatusBadge(sp.status) +
      (sp.start_date || sp.end_date
        ? ' <span class="sprint-dates">📅 ' +
          (sp.start_date ? fmtDateShort(sp.start_date) : '?') +
          ' — ' +
          (sp.end_date ? fmtDateShort(sp.end_date) : '?') +
          '</span>'
        : '') +
      ' <span class="text-muted">' + sprintIssues.length + ' issues</span>' +
      ' <span class="text-muted">' + points + ' pts</span></div>' +
      '<div class="lane-header-actions">';

    if (sp.status === 'planning') {
      html += '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();window._startSprint(\'' + sp.id + '\')">Start Sprint</button>';
    }
    if (sp.status === 'active') {
      html += (window._isMemberOnly ? "" : '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._completeSprint(\'' + sp.id + '\')">' + 'Complete</button>');
    }
    html += (window._isMemberOnly ? "" : '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._openSprintModal(\'' + sp.id + '\')">' + 'Edit</button>') +
      (window._isMemberOnly ? "" : '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window._deleteSprint(\'' + sp.id + '\')">' + 'Delete</button>') +
      '</div></div>' +
      '<div class="backlog-lane-body' + (collapsed ? ' collapsed' : '') + '" data-sprint-drop="' + sp.id + '" ' +
      'ondragover="event.preventDefault();event.currentTarget.classList.add(\'drag-over\')" ' +
      'ondragleave="window._laneDragLeave(event)" ' +
      'ondrop="window._dropToSprint(event,\'' + sp.id + '\')">';

    for (var bi = 0; bi < sprintIssues.length; bi++) {
      html += backlogRow(sprintIssues[bi]);
    }
    html += '<div class="backlog-add-row"><button class="btn btn-link btn-sm" onclick="window._addIssueToSprint(\'' + sp.id + '\')">+ Add issue</button></div>';
    html += '</div></div>';
  }

  // Backlog (no sprint)
  var backlogIssues = issues.filter(function (iss) { return !iss.sprint_id; });
  if (searchTerm) {
    backlogIssues = backlogIssues.filter(function (iss) {
      return iss.title.toLowerCase().indexOf(searchTerm) >= 0 || issueKeyStr(iss).toLowerCase().indexOf(searchTerm) >= 0;
    });
  }

  html += '<div class="backlog-lane">' +
    '<div class="backlog-lane-header" onclick="window._toggleBacklogLane(this)">' +
    '<div class="lane-header-left"><span class="lane-toggle">\u25BE</span>' +
    '<strong>Backlog</strong> <span class="text-muted">' + backlogIssues.length + ' issues</span></div></div>' +
    '<div class="backlog-lane-body" data-sprint-drop="null" ' +
    'ondragover="event.preventDefault();event.currentTarget.classList.add(\'drag-over\')" ' +
    'ondragleave="window._laneDragLeave(event)" ' +
    'ondrop="window._dropToSprint(event,null)">';

  for (var bk = 0; bk < backlogIssues.length; bk++) {
    html += backlogRow(backlogIssues[bk]);
  }
  html += '<div class="backlog-add-row"><button class="btn btn-link btn-sm" onclick="window._addIssueToSprint(null)">+ Add issue</button></div>';
  html += '</div></div>';

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
  return '<div class="backlog-row' + (isSubtask ? ' backlog-row-subtask' : '') + '" draggable="true" data-issue-id="' + iss.id + '" ' +
    'ondragstart="event.dataTransfer.setData(\'text/plain\',\'' + iss.id + '\')" ' +
    'onclick="openIssuePage(\'' + iss.id + '\')">' +
    '<span class="issue-type-icon">' + typeIcon(iss.type) + '</span>' +
    '<span class="issue-key">' + esc(issueKeyStr(iss)) + '</span>' +
    parentInfo +
    '<span class="backlog-issue-title">' + esc(iss.title) + '</span>' +
    priorityBadge(iss.priority) +
    statusBadge(iss.status) +
    (iss.story_points != null ? '<span class="badge badge-points">' + iss.story_points + '</span>' : '') +
    avatarHtml(assignee, 24) +
    '</div>';
}

// Backlog global handlers
window._toggleBacklogLane = function (header) {
  var body = header.nextElementSibling;
  body.classList.toggle('collapsed');
  var toggle = header.querySelector('.lane-toggle');
  toggle.textContent = body.classList.contains('collapsed') ? '\u25B8' : '\u25BE';
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
  try {
    await api('/api/issues/' + issueId + '/move', 'PUT', { sprint_id: targetSprintId, position: 0 });
    await refreshData();
    renderBacklog();
    toast('Issue moved');
  } catch(e) {
    toast('Failed to move issue — is the server running?', 'error');
  }
};

window._addIssueToSprint = function (sprintId) {
  resetIssueForm();
  $('issueSpaceId').value = S.currentSpace;
  $('issueModalTitle').textContent = 'Create Issue';
  populateIssueFormSelects();
  if (window._onIssueSpaceChange) window._onIssueSpaceChange(S.currentSpace || '');
  if (sprintId) $('issueSprint').value = sprintId;
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
};

window._deleteSprint = async function (id) {
  var ok = await confirmDialog('Delete this sprint? Issues will be moved to the backlog.');
  if (!ok) return;
  await api('/api/sprints/' + id, 'DELETE');
  await refreshData();
  renderBacklog();
  toast('Sprint deleted');
};

window._openSprintModal = function (id) {
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
  } else {
    $('sprintIdInput').value = '';
    $('sprintSpaceId').value = S.currentSpace;
    $('sprintNameInput').value = '';
    $('sprintGoal').value = '';
    $('sprintStartDate').value = '';
    $('sprintEndDate').value = '';
    $('sprintModalTitle').textContent = 'Create Sprint';
  }
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
  var statuses = ['To Do', 'In Progress', 'In Review', 'Done'];

  for (var si = 0; si < activeSprints.length; si++) {
    var activeSprint = activeSprints[si];
    var issues = getSpaceIssues(S.currentSpace).filter(function (i) { return i.sprint_id == activeSprint.id; });
    var doneCount = issues.filter(function (i) { return i.status === 'Done'; }).length;
    var pct = issues.length ? Math.round((doneCount / issues.length) * 100) : 0;
    var totalPoints = issues.reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);
    var donePoints = issues.filter(function (i) { return i.status === 'Done'; }).reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);

    allBoardHtml += '<div class="multi-sprint-section">' +
      '<div class="sprint-info">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
      '<h3 style="margin:0">' + esc(activeSprint.name) + '</h3>' +
      '<button class="btn btn-sm btn-secondary" onclick="window._completeSprint(\'' + activeSprint.id + '\')">Complete Sprint</button>' +
      '</div>' +
      (activeSprint.goal ? '<p class="text-muted" style="margin:4px 0 0">' + esc(activeSprint.goal) + '</p>' : '') +
      '<div class="sprint-meta">' +
      '<span>' + fmtDateShort(activeSprint.start_date) + ' \u2014 ' + fmtDateShort(activeSprint.end_date) + '</span>' +
      '<span>' + doneCount + '/' + issues.length + ' issues</span>' +
      '<span>' + donePoints + '/' + totalPoints + ' pts</span></div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
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
    var sprintSelectorHtml = allSprints && allSprints.length > 0
      ? '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text2);margin-right:8px">Sprint:</label>' +
        '<select class="input input-sm" onchange="window._globalRptSprintChange(this.value,\'' + type + '\')">' +
        allSprints.map(function(sp) {
          return '<option value="' + sp.id + '"' + (activeSprint && sp.id === activeSprint.id ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
        }).join('') + '</select></div>'
      : '';
    if (type === 'burndown') {
      if (!activeSprint) { c.innerHTML = '<p class="placeholder-text">No sprints found.</p>'; return; }
      var data = await api('/api/reports/sprint/' + activeSprint.id);
      renderBurndownReport(c, data, allSprints, sprintSelectorHtml);
    } else if (type === 'velocity') {
      var data2 = await api('/api/reports/velocity?space_id=' + S.currentSpace);
      renderVelocityReport(c, data2, allSprints, sprintSelectorHtml);
    } else if (type === 'cumulative') {
      var data3 = await api('/api/reports/status?space_id=' + S.currentSpace);
      renderCumulativeReport(c, data3, allSprints, sprintSelectorHtml);
    } else if (type === 'control') {
      var data4 = await api('/api/reports/cycle-time?space_id=' + S.currentSpace);
      renderControlChart(c, data4, allSprints, sprintSelectorHtml);
    }
    window._globalRptSprintChange = async function(sprintId, rtype) {
      window._lastSelectedSprintId = sprintId;
      var cont = $('reportContent') || c;
      cont.innerHTML = '<p class="text-muted">Loading…</p>';
      try {
        var newSel = '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text2);margin-right:8px">Sprint:</label>' +
          '<select class="input input-sm" onchange="window._globalRptSprintChange(this.value,\'' + rtype + '\')">' +
          allSprints.map(function(sp) {
            return '<option value="' + sp.id + '"' + (sp.id === sprintId ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
          }).join('') + '</select></div>';
        if (rtype === 'burndown') {
          var d = await api('/api/reports/sprint/' + sprintId);
          renderBurndownReport(cont, d, allSprints);
          var sel = cont.querySelector('select'); if (sel) sel.value = sprintId;
        } else if (rtype === 'velocity') {
          var d2 = await api('/api/reports/velocity?space_id=' + S.currentSpace);
          renderVelocityReport(cont, d2, allSprints, newSel);
        } else if (rtype === 'cumulative') {
          var d3 = await api('/api/reports/status?space_id=' + S.currentSpace);
          renderCumulativeReport(cont, d3, allSprints, newSel);
        } else if (rtype === 'control') {
          var d4 = await api('/api/reports/cycle-time?space_id=' + S.currentSpace);
          renderControlChart(cont, d4, allSprints, newSel);
        }
      } catch(e) { cont.innerHTML = '<p class="text-muted">Error: ' + esc(e.message) + '</p>'; }
    };
  } catch (e) {
    c.innerHTML = '<p class="text-muted">Failed to load report: ' + esc(e.message) + '</p>';
  }
}

function renderBurndownReport(c, data, allSprints, sprintSelectorHtml) {
  sprintSelectorHtml = sprintSelectorHtml || '';
  var sprint = data.sprint || {};
  var total = Number(data.total) || 0;
  var done = Number(data.done) || 0;
  var inProgress = Number(data.in_progress) || 0;
  var toDo = Math.max(0, total - done - inProgress);
  var remaining = total - done;
  var ptsDone = Number(data.points_completed) || 0;
  var ptsLeft = Number(data.points_remaining) || 0;
  var completionPct = total ? Math.round((done / total) * 100) : 0;

  var selectorHtml = sprintSelectorHtml || (allSprints && allSprints.length > 1
    ? '<div class="rpt-sprint-selector"><label>Sprint</label>' +
      '<select class="input input-sm" onchange="window._rptChangeSprint(this.value)">' +
      (allSprints || []).map(function(sp) {
        return '<option value="' + sp.id + '"' + (sp.id === sprint.id ? ' selected' : '') + '>' + esc(sp.name) + '</option>';
      }).join('') + '</select></div>'
    : '');

  // Donut SVG
  var r = 54, cx = 70, cy = 70, circ = 2 * Math.PI * r;
  var donePct = total ? done / total : 0;
  var ipPct = total ? inProgress / total : 0;
  var todoPct = total ? toDo / total : 0;
  var doneLen = donePct * circ, ipLen = ipPct * circ, todoLen = todoPct * circ;
  var doneOff = 0, ipOff = -doneLen, todoOff = -(doneLen + ipLen);
  var donutSvg = '<svg width="140" height="140" viewBox="0 0 140 140">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg2)" stroke-width="16"/>' +
    (total ? (
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#10b981" stroke-width="16" stroke-dasharray="' + doneLen + ' ' + (circ - doneLen) + '" stroke-dashoffset="' + (circ * 0.25) + '" stroke-linecap="round"/>' +
      (ipLen > 0 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#0052cc" stroke-width="16" stroke-dasharray="' + ipLen + ' ' + (circ - ipLen) + '" stroke-dashoffset="' + (circ * 0.25 - doneLen) + '" stroke-linecap="round"/>' : '') +
      (todoLen > 0 ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#42526e" stroke-width="16" stroke-dasharray="' + todoLen + ' ' + (circ - todoLen) + '" stroke-dashoffset="' + (circ * 0.25 - doneLen - ipLen) + '" stroke-linecap="round"/>' : '')
    ) : '') +
    '<text x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">' + completionPct + '%</text>' +
    '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="11" fill="var(--text2)">Complete</text>' +
    '</svg>';

  // Vertical bar chart
  var chartH = 120;
  var segments = [
    { label: 'Done', count: done, color: '#10b981' },
    { label: 'In Progress', count: inProgress, color: '#0052cc' },
    { label: 'To Do', count: toDo, color: '#42526e' }
  ];
  var maxSeg = Math.max.apply(null, segments.map(function(s){ return s.count; })) || 1;
  var barCols = segments.map(function(seg) {
    var h = Math.max(total ? Math.round((seg.count / maxSeg) * chartH) : 0, seg.count > 0 ? 4 : 0);
    return '<div class="rpt-bd-col">' +
      '<div class="rpt-bd-count">' + seg.count + '</div>' +
      '<div class="rpt-bd-barwrap" style="height:' + chartH + 'px">' +
      '<div class="rpt-bd-bar2" style="height:' + h + 'px;background:' + seg.color + '"></div>' +
      '</div>' +
      '<div class="rpt-bd-chip" style="background:' + seg.color + '20;color:' + seg.color + '">' + esc(seg.label) + '</div>' +
      '</div>';
  }).join('');

  // Stacked progress bar
  var donePctW = total ? (done / total * 100).toFixed(1) : 0;
  var ipPctW = total ? (inProgress / total * 100).toFixed(1) : 0;
  var todoPctW = total ? (toDo / total * 100).toFixed(1) : 0;
  var stackedBar = '<div class="rpt-stacked-wrap">' +
    '<div class="rpt-stacked-bar">' +
    (done > 0 ? '<div style="width:' + donePctW + '%;background:#10b981" title="Done: ' + done + '"></div>' : '') +
    (inProgress > 0 ? '<div style="width:' + ipPctW + '%;background:#0052cc" title="In Progress: ' + inProgress + '"></div>' : '') +
    (toDo > 0 ? '<div style="width:' + todoPctW + '%;background:#42526e" title="To Do: ' + toDo + '"></div>' : '') +
    '</div>' +
    '<div class="rpt-stacked-legend">' +
    '<span><i style="background:#10b981"></i>Done (' + done + ')</span>' +
    '<span><i style="background:#0052cc"></i>In Progress (' + inProgress + ')</span>' +
    '<span><i style="background:#42526e"></i>To Do (' + toDo + ')</span>' +
    '</div></div>';

  // Points row
  var ptsTotalPts = ptsDone + ptsLeft;
  var ptsPct = ptsTotalPts ? Math.round((ptsDone / ptsTotalPts) * 100) : 0;
  var ptsRow = '<div class="rpt-pts-row">' +
    '<div class="rpt-pts-card"><div class="rpt-pts-val" style="color:#10b981">' + ptsDone + '</div><div class="rpt-pts-label">Pts Done</div></div>' +
    '<div class="rpt-pts-card"><div class="rpt-pts-val" style="color:#f59e0b">' + ptsLeft + '</div><div class="rpt-pts-label">Pts Left</div></div>' +
    '<div class="rpt-pts-card"><div class="rpt-pts-val" style="color:#0129ac">' + ptsTotalPts + '</div><div class="rpt-pts-label">Total Pts</div></div>' +
    '</div>';

  c.innerHTML = '<div class="rpt-rich-wrap">' +
    '<div class="rpt-rich-header">' +
    '<div class="rpt-rich-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>Sprint Report</div>' +
    '<div class="rpt-rich-sprint">' + esc(sprint.name || 'Sprint') + '</div>' +
    selectorHtml +
    '</div>' +
    '<div class="rpt-rich-body">' +
    '<div class="rpt-rich-donut-col">' + donutSvg +
    '<div class="rpt-rich-donut-stats">' +
    '<div class="rpt-ds-row"><span class="rpt-ds-dot" style="background:#10b981"></span><span class="rpt-ds-lbl">Done</span><span class="rpt-ds-val">' + done + '</span></div>' +
    '<div class="rpt-ds-row"><span class="rpt-ds-dot" style="background:#0052cc"></span><span class="rpt-ds-lbl">In Progress</span><span class="rpt-ds-val">' + inProgress + '</span></div>' +
    '<div class="rpt-ds-row"><span class="rpt-ds-dot" style="background:#42526e"></span><span class="rpt-ds-lbl">To Do</span><span class="rpt-ds-val">' + toDo + '</span></div>' +
    '<div class="rpt-ds-row rpt-ds-total"><span class="rpt-ds-lbl">Total</span><span class="rpt-ds-val">' + total + '</span></div>' +
    '</div></div>' +
    '<div class="rpt-rich-chart-col">' +
    '<div class="rpt-bd-chart">' + barCols + '</div>' +
    stackedBar +
    ptsRow +
    '</div>' +
    '</div>' +
    '</div>';

  window._rptChangeSprint = async function(sprintId) {
    window._lastSelectedSprintId = sprintId;
    var cont = c;
    try {
      var d = await api("/api/reports/sprint/" + sprintId);
      renderBurndownReport(cont, d, allSprints);
      var sel = cont.querySelector("select"); if (sel) sel.value = sprintId;
    } catch(e) { cont.innerHTML = "<p class=\"text-muted\">Error: " + esc(e.message) + "</p>"; }
  };
}

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
  var STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
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
  var items = Array.isArray(data) ? data : [];
  if (!items.length) {
    c.innerHTML = '<div class="report-chart"><h4>Control Chart — Cycle Time</h4><p class="placeholder-text">No completed issues with history data yet.</p></div>';
    return;
  }

  var cycleDays = items.map(function(r){ return parseFloat(r.cycle_days) || 0; });
  var maxDays = Math.max.apply(null, cycleDays) || 1;
  var avgDays = Math.round(cycleDays.reduce(function(s,v){ return s+v; }, 0) / cycleDays.length * 10) / 10;

  var rows = items.map(function(r) {
    var days = parseFloat(r.cycle_days) || 0;
    var pct = Math.round((days / maxDays) * 100);
    var color = days < 3 ? '#10b981' : days < 7 ? '#f59e0b' : '#ef4444';
    return '<div class="rpt-ct-row">' +
      '<span class="rpt-ct-key" title="' + esc(r.key) + '">' + esc(r.key) + '</span>' +
      '<span style="flex:1;font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="' + esc(r.title) + '">' + esc(r.title) + '</span>' +
      '<div class="rpt-ct-track" style="margin:0 8px">' +
      '<div class="rpt-ct-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
      '</div>' +
      '<span class="rpt-ct-days">' + days + 'd</span>' +
      '</div>';
  }).join('');

  c.innerHTML = '<div class="report-chart">' +
    sprintSelectorHtml +
    '<h4>Control Chart — Cycle Time per Issue</h4>' +
    '<div class="report-stats-row">' + statCard('Avg Cycle Time', avgDays + ' days', '#0129ac') + '</div>' +
    '<div style="display:flex;gap:12px;font-size:11px;color:var(--text2);margin-bottom:12px">' +
    '<span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px"></span> &lt;3d' +
    '<span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;margin-left:8px"></span> 3–7d' +
    '<span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-left:8px"></span> &gt;7d' +
    '</div>' +
    rows +
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
    opts: [{v:'task',l:'Task'},{v:'bug',l:'Bug'},{v:'story',l:'Story'},{v:'epic',l:'Epic'},{v:'subtask',l:'Subtask'}] },
  { key: 'status',    label: 'Status',     kind: 'multi',
    opts: [{v:'To Do',l:'To Do'},{v:'In Progress',l:'In Progress'},{v:'In Review',l:'In Review'},{v:'Done',l:'Done'}] },
  { key: 'priority',  label: 'Priority',   kind: 'multi',
    opts: [{v:'critical',l:'Critical'},{v:'high',l:'High'},{v:'medium',l:'Medium'},{v:'low',l:'Low'}] },
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
];

// Which fields are currently shown as rows in the panel
var _awActiveFields = [];

// Build filter field defs from space custom fields
function _awGetCFFilterFields() {
  return (S.data.custom_fields || [])
    .filter(function(f){ return f.space_id == S.currentSpace; })
    .map(function(f) {
      var kind = (f.field_type === 'select' || f.field_type === 'multi_select') ? 'multi'
               : (f.field_type === 'date') ? 'cfdate'
               : 'cftext';
      var fd = { key: 'cf_' + f.id, label: f.name, kind: kind, cfId: f.id, cfType: f.field_type };
      if (kind === 'multi') {
        fd.opts = (Array.isArray(f.options) ? f.options : []).map(function(o){ return {v: o, l: o}; });
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
async function _awLoadDynamicOpts() {
  var assigneeFd = _awGetFieldDef('assignee');
  var sprintFd   = _awGetFieldDef('sprint');
  try {
    var members = await api('/api/spaces/' + S.currentSpace + '/members');
    assigneeFd.opts = (members || []).map(function(m){ return {v: m.user_id, l: m.name}; });
  } catch(_) {}
  try {
    var sprintRows = await api('/api/sprints?space_id=' + S.currentSpace);
    sprintFd.opts = (sprintRows || []).map(function(sp){ return {v: sp.id, l: sp.name}; });
  } catch(_) {
    var sprints = (S.data.sprints || []).filter(function(sp){ return sp.space_id == S.currentSpace; });
    sprintFd.opts = sprints.map(function(sp){ return {v: sp.id, l: sp.name}; });
  }
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
  { key: 'labels',          label: 'Labels',         sortCol: 'labels',       def: false },
  { key: 'fix_description', label: 'Fix Description',sortCol: null,           def: false },
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

// Get custom field columns for current space
function _awGetCFColumns() {
  var spaceFields = (S.data.custom_fields || []).filter(function(f){ return f.space_id == S.currentSpace; });
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
  var search = ($('allWorkSearch') ? $('allWorkSearch').value : '').toLowerCase().trim();
  var f = S.awFilters;

  var anyFilter = search ||
    f.type.length || f.status.length || f.priority.length || f.assignee.length || f.sprint.length ||
    f.createdFrom || f.createdTo || f.updatedFrom || f.updatedTo ||
    f.dueDateFrom || f.dueDateTo || f.startDateFrom || f.startDateTo;
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

  var hasSelected = S.allWorkSelected.size > 0;
  var html = '';

  if (hasSelected) {
    // Build assignee options from space members
    var memberOpts = '<option value="">Assignee\u2026</option>';
    var spaceMembers = getSpaceMembers(S.currentSpace);
    if (!spaceMembers.length) spaceMembers = S.data.users || [];
    spaceMembers.forEach(function(u) { memberOpts += '<option value="' + u.id + '">' + esc(u.name) + '</option>'; });

    // Build sprint options
    var sprintOpts = '<option value="">Sprint\u2026</option><option value="__none__">None (Backlog)</option>';
    (S.data.sprints || []).filter(function(sp){ return sp.space_id == S.currentSpace; }).forEach(function(sp) {
      sprintOpts += '<option value="' + sp.id + '">' + esc(sp.name) + '</option>';
    });

    html += '<div class="bulk-bar">' +
      '<span class="bulk-count">' + S.allWorkSelected.size + ' issue' + (S.allWorkSelected.size > 1 ? 's' : '') + ' selected</span>' +
      '<div class="bulk-actions">' +
      '<select id="bulkStatusChange" class="input input-sm" title="Change status"><option value="">Status\u2026</option>' +
        '<option value="To Do">To Do</option><option value="In Progress">In Progress</option>' +
        '<option value="In Review">In Review</option><option value="Done">Done</option></select>' +
      '<select id="bulkPriorityChange" class="input input-sm" title="Change priority"><option value="">Priority\u2026</option>' +
        '<option value="critical">Critical</option><option value="high">High</option>' +
        '<option value="medium">Medium</option><option value="low">Low</option></select>' +
      '<select id="bulkAssigneeChange" class="input input-sm" title="Change assignee">' + memberOpts + '</select>' +
      '<select id="bulkSprintChange" class="input input-sm" title="Move to sprint">' + sprintOpts + '</select>' +
      '<button class="btn btn-sm btn-danger" onclick="window._bulkDelete()">🗑 Delete</button>' +
      '</div>' +
      '<button class="btn btn-sm btn-ghost bulk-deselect" onclick="window._bulkDeselect()" title="Clear selection">✕</button>' +
      '</div>';
  }

  var visCols = _awGetVisibleCols();

  var PAGE_SIZE = 50;
  var totalIssues = issues.length;
  var pagedIssues = issues.slice(0, PAGE_SIZE * (S.allWorkPage || 1));

  html += '<table class="data-table" style="min-width:1200px;width:100%"><thead><tr>' +
    '<th><input type="checkbox" id="allWorkSelectAll"' + (S.allWorkSelected.size === issues.length && issues.length > 0 ? ' checked' : '') + '></th>' +
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
      '<td onclick="event.stopPropagation()"><input type="checkbox" data-issue-check="' + iid + '"' + checked + '></td>' +
      visCols.map(function(col) {
        var cell = '';
        switch(col.key) {
          case 'key':             cell = '<td class="issue-key" onclick="' + nav + '" style="white-space:nowrap;width:90px;min-width:90px">' + esc(issueKeyStr(iss)) + '</td>'; break;
          case 'title':           cell = '<td onclick="' + nav + '" style="min-width:200px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(iss.title) + '</td>'; break;
          case 'type':            cell = '<td onclick="' + nav + '">' + typeIcon(iss.type) + ' ' + cap(iss.type) + '</td>'; break;
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
          case 'labels':          cell = '<td onclick="' + nav + '">' + (iss.labels ? esc(iss.labels) : '\u2014') + '</td>'; break;
          case 'fix_description': cell = '<td onclick="' + nav + '">' + (iss.fix_description ? esc(iss.fix_description.slice(0,60)) + (iss.fix_description.length>60?'…':'') : '\u2014') + '</td>'; break;
          default:
            // Custom field column (cf_<fieldId>)
            if (col.key.indexOf('cf_') === 0) {
              var cfId = col.cfId || col.key.replace('cf_','');
              var cfVal = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == iss.id && v.field_id == cfId; });
              cell = '<td onclick="' + nav + '">' + (cfVal && cfVal.value ? esc(cfVal.value) : '\u2014') + '</td>';
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

  // Generic bulk field change handler
  async function doBulkUpdate(field, value) {
    if (!value) return;
    var ids = Array.from(S.allWorkSelected);
    var updates = {};
    if (field === 'sprint_id') updates.sprint_id = value === '__none__' ? null : value;
    else updates[field] = value;
    await api('/api/issues/bulk', 'POST', { ids: ids, updates: updates });
    S.allWorkSelected.clear();
    await refreshData();
    renderAllWork();
    toast('Updated ' + ids.length + ' issue' + (ids.length > 1 ? 's' : ''));
  }

  var bulkStatus   = $('bulkStatusChange');
  var bulkPriority = $('bulkPriorityChange');
  var bulkAssignee = $('bulkAssigneeChange');
  var bulkSprint   = $('bulkSprintChange');
  if (bulkStatus)   bulkStatus.onchange   = function() { doBulkUpdate('status',      bulkStatus.value); };
  if (bulkPriority) bulkPriority.onchange = function() { doBulkUpdate('priority',    bulkPriority.value); };
  if (bulkAssignee) bulkAssignee.onchange = function() { doBulkUpdate('assignee_id', bulkAssignee.value); };
  if (bulkSprint)   bulkSprint.onchange   = function() { doBulkUpdate('sprint_id',   bulkSprint.value); };
}

window._bulkDelete = async function () {
  var ids = Array.from(S.allWorkSelected);
  var ok = await confirmDialog('Delete ' + ids.length + ' issue(s)? This cannot be undone.');
  if (!ok) return;
  for (var i = 0; i < ids.length; i++) {
    await api('/api/issues/' + ids[i], 'DELETE');
  }
  S.allWorkSelected.clear();
  await refreshData();
  renderAllWork();
  toast('Deleted ' + ids.length + ' issues');
};

window._bulkDeselect = function() {
  S.allWorkSelected.clear();
  renderAllWork();
};

// ═══════════════════════════════════════════════════════════
// FILTERS TAB
// ═══════════════════════════════════════════════════════════
function renderFilters() {
  var filters = (S.data.saved_filters || []).filter(function (f) {
    return f.space_id == S.currentSpace || f.user_id == S.currentUser;
  });

  if (!filters.length) {
    $('filtersList').innerHTML = '<p class="placeholder-text">No saved filters. Create one to save your search criteria.</p>';
    return;
  }

  var html = '';
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    var conditions = [];
    try {
      conditions = f.conditions ? (typeof f.conditions === 'string' ? JSON.parse(f.conditions) : f.conditions) : [];
    } catch (e) { conditions = []; }
    var condPreview = conditions.length
      ? conditions.map(function (c) { return c.field + ' ' + c.operator + ' ' + c.value; }).join(', ')
      : 'No conditions';

    html += '<div class="filter-card">' +
      '<div class="filter-card-header"><h4>' + esc(f.name) + '</h4><div class="filter-card-badges">' +
      (f.is_shared ? '<span class="badge badge-muted">Shared</span>' : '') +
      (f.is_pinned ? '<span class="badge badge-muted">Pinned</span>' : '') +
      '</div></div>' +
      '<p class="text-muted">' + esc(condPreview) + '</p>' +
      '<div class="filter-card-actions">' +
      '<button class="btn btn-sm btn-outline" onclick="window._applyFilter(\'' + f.id + '\')">Apply</button>' +
      '<button class="btn btn-sm btn-outline" onclick="window._editFilter(\'' + f.id + '\')">Edit</button>' +
      '<button class="btn btn-sm btn-outline" onclick="window._deleteFilter(\'' + f.id + '\')">Delete</button>' +
      '</div></div>';
  }
  $('filtersList').innerHTML = html;
}

window._applyFilter = function (filterId) {
  var f = (S.data.saved_filters || []).find(function (x) { return x.id == filterId; });
  if (!f) return;
  renderTab('allwork');
  try {
    var conditions = f.conditions ? (typeof f.conditions === 'string' ? JSON.parse(f.conditions) : f.conditions) : [];
    if (conditions.length && conditions[0].value) {
      $('allWorkSearch').value = conditions[0].value;
      renderAllWork();
    }
  } catch (e) { /* ignore parse errors */ }
};

window._editFilter = function (filterId) {
  var f = (S.data.saved_filters || []).find(function (x) { return x.id == filterId; });
  if (!f) return;
  $('filterId').value = f.id;
  $('filterSpaceId').value = f.space_id || S.currentSpace;
  $('filterNameInput').value = f.name || '';
  $('filterShared').checked = !!f.is_shared;
  $('filterPinned').checked = !!f.is_pinned;
  $('filterModalTitle').textContent = 'Edit Filter';
  var conditions = [];
  try {
    conditions = f.conditions ? (typeof f.conditions === 'string' ? JSON.parse(f.conditions) : f.conditions) : [];
  } catch (e) { /* ignore */ }
  renderFilterConditions(conditions);
  openModal('modal-filter');
};

window._deleteFilter = async function (filterId) {
  var ok = await confirmDialog('Delete this filter?');
  if (!ok) return;
  await api('/api/filters/' + filterId, 'DELETE');
  await refreshData();
  renderFilters();
  toast('Filter deleted');
};

function renderFilterConditions(conditions) {
  var c = $('filterConditions');
  var html = '';
  for (var i = 0; i < conditions.length; i++) {
    var cond = conditions[i];
    html += '<div class="filter-condition-row" data-cond-idx="' + i + '">' +
      '<select class="input input-sm fc-field">' +
      '<option value="status"' + (cond.field === 'status' ? ' selected' : '') + '>Status</option>' +
      '<option value="priority"' + (cond.field === 'priority' ? ' selected' : '') + '>Priority</option>' +
      '<option value="type"' + (cond.field === 'type' ? ' selected' : '') + '>Type</option>' +
      '<option value="assignee_id"' + (cond.field === 'assignee_id' ? ' selected' : '') + '>Assignee</option>' +
      '<option value="labels"' + (cond.field === 'labels' ? ' selected' : '') + '>Labels</option></select>' +
      '<select class="input input-sm fc-op">' +
      '<option value="equals"' + (cond.operator === 'equals' ? ' selected' : '') + '>equals</option>' +
      '<option value="not_equals"' + (cond.operator === 'not_equals' ? ' selected' : '') + '>not equals</option>' +
      '<option value="contains"' + (cond.operator === 'contains' ? ' selected' : '') + '>contains</option></select>' +
      '<input type="text" class="input input-sm fc-value" value="' + esc(cond.value || '') + '">' +
      '<button type="button" class="btn btn-sm btn-outline" onclick="this.closest(\'.filter-condition-row\').remove()">x</button></div>';
  }
  c.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// SPACE SETTINGS TAB (with sub-tabs: General, People, Custom Fields)
// ═══════════════════════════════════════════════════════════
var _settingsActiveTab = 'general';

function renderSpaceSettings(subTab) {
  var space = getSpace(S.currentSpace);
  if (!space) return;
  if (subTab) _settingsActiveTab = subTab;
  // Update tab bar active state
  qsa('#settingsTabBar .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.stab === _settingsActiveTab);
  });
  // Render active sub-tab content
  switch (_settingsActiveTab) {
    case 'general': renderSettingsGeneral(space); break;
    case 'people': renderSettingsPeople(space); break;
    case 'customfields': renderSettingsCustomFields(space); break;
    default: renderSettingsGeneral(space);
  }
}

window._switchSettingsTab = function (tab) {
  _settingsActiveTab = tab;
  renderSpaceSettings(tab);
};

function renderSettingsGeneral(space) {
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
    '<button class="btn btn-outline" onclick="window._editSpaceSettings()">Edit Space</button>' +
    '<button class="btn btn-danger" onclick="window._deleteSpace(\'' + space.id + '\')">Delete Space</button></div></div>';
}

function renderSettingsPeople(space) {
  var memberRecs = (S.data.space_members || []).filter(function (m) { return m.space_id == space.id; });
  var roles = [
    { value: 'owner',      label: 'Owner'      },
    { value: 'site_admin', label: 'Site Admin' },
    { value: 'manager',    label: 'Manager'    },
    { value: 'member',     label: 'Member'     },
    { value: 'viewer',     label: 'Viewer'     }
  ];

  var rowsHtml = '';
  for (var i = 0; i < memberRecs.length; i++) {
    var rec = memberRecs[i];
    var user = findUser(rec.user_id);
    if (!user) continue;
    var role = (rec.role || 'member').toLowerCase();
    var joined = fmtDate(rec.joined_at || rec.created_at);

    var roleOptions = '';
    for (var r = 0; r < roles.length; r++) {
      roleOptions += '<option value="' + roles[r].value + '"' + (roles[r].value === role ? ' selected' : '') + '>' + roles[r].label + '</option>';
    }

    rowsHtml += '<tr>' +
      '<td>' + avatarHtml(user, 28) + '</td>' +
      '<td>' + esc(user.name) + '</td>' +
      '<td class="text-muted">' + esc(user.email || '') + '</td>' +
      '<td><select class="input input-sm people-role-select" data-member-id="' + rec.id + '" data-user-id="' + user.id + '" style="max-width:120px">' + roleOptions + '</select></td>' +
      '<td class="text-muted text-sm">' + joined + '</td>' +
      '<td><button class="btn btn-outline btn-sm people-remove-btn" data-member-id="' + rec.id + '" data-user-name="' + esc(user.name) + '">Remove</button></td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Members</h3>' +
    '<button class="btn btn-primary btn-sm" id="inviteMemberBtnSettings">+ Add User</button>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th style="width:40px"></th><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th style="width:80px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">No members yet</td></tr>') + '</tbody></table></div>';

  $('settingsTabContent').innerHTML = html;

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

function renderSettingsCustomFields(space) {
  var fields = (S.data.custom_fields || []).filter(function (f) { return f.space_id == space.id; });

  var rowsHtml = '';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var options = f.options ? (Array.isArray(f.options) ? f.options.join(', ') : f.options) : '\u2014';
    rowsHtml += '<tr>' +
      '<td>' + esc(f.name) + '</td>' +
      '<td><span class="badge badge-muted">' + esc(f.field_type || f.type) + '</span></td>' +
      '<td>' + (f.is_required ? '\u2705 Yes' : 'No') + '</td>' +
      '<td class="text-muted text-sm">' + esc(options) + '</td>' +
      '<td>' +
        '<button class="btn btn-outline btn-sm cf-edit-btn" data-field-id="' + f.id + '">Edit</button> ' +
        '<button class="btn btn-outline btn-sm text-danger cf-delete-btn" data-field-id="' + f.id + '" data-field-name="' + esc(f.name) + '">Delete</button>' +
      '</td>' +
      '</tr>';
  }

  var html = '<div class="flex items-center justify-between mb-16">' +
    '<h3 style="margin:0">Custom Fields</h3>' +
    '<button class="btn btn-primary btn-sm" id="addCustomFieldBtnSettings">+ Add Field</button>' +
    '</div>' +
    '<div class="table-container"><table class="data-table" style="width:100%"><thead><tr>' +
    '<th>Name</th><th>Type</th><th>Required</th><th>Options</th><th style="width:140px">Actions</th>' +
    '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px">No custom fields yet</td></tr>') + '</tbody></table></div>';

  $('settingsTabContent').innerHTML = html;

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
      var ok = await confirmDialog('Delete custom field "' + fieldName + '"?');
      if (!ok) return;
      try {
        await api('/api/custom-fields/' + fieldId, 'DELETE');
        await refreshData();
        renderSettingsCustomFields(getSpace(S.currentSpace));
        toast('Custom field deleted');
      } catch (e) { /* error shown by api() */ }
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
  var ok = await confirmDialog('Delete "' + spaceName + '"? All issues, sprints, and data will be permanently lost.');
  if (!ok) return;
  try {
    await api('/api/spaces/' + spaceId, 'DELETE');
    await refreshData();
    if (S.currentSpace === spaceId) S.currentSpace = null;
    navigateTo('home');
    renderSidebar();
    popupAlert('Space Deleted', '"' + spaceName + '" has been deleted successfully.', 'success');
  } catch (e) {
    popupAlert('Delete Failed', 'Could not delete the space. Please try again.', 'error');
  }
};

// ═══════════════════════════════════════════════════════════
// SPACE CONTEXT MENU (3-dot on sidebar items)
// ═══════════════════════════════════════════════════════════
function showSpaceContextMenu(anchorBtn, spaceId) {
  // Remove any existing context menu
  var existing = qs('.space-context-menu');
  if (existing) existing.remove();

  var starred = isFavorited(spaceId);
  var starLabel = starred ? '\u2B50 Remove from starred' : '\u2B50 Add to starred';

  var isAdminUser = S.currentUserObj && (S.currentUserObj.role === 'admin' || S.currentUserObj.role === 'owner');
  var menu = document.createElement('div');
  menu.className = 'space-context-menu';
  var starSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="' + (starred ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  var starText = starred ? 'Remove from starred' : 'Add to starred';
  menu.innerHTML =
    '<div class="space-context-menu-item" data-action="star">' + starSvg + ' ' + starText + '</div>' +
    (isAdminUser ? '<div class="space-context-menu-item" data-action="people"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Manage people</div>' : '') +
    (isAdminUser ? '<div class="space-context-menu-item" data-action="settings"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Space settings</div>' : '') +
    (isAdminUser ? '<div class="space-context-menu-item danger" data-action="delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete space</div>' : '');

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
      case 'star':
        await api('/api/spaces/' + spaceId + '/favorite', 'POST', { user_id: S.currentUser });
        await refreshData();
        renderSidebar();
        toast('Updated starred spaces');
        break;
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
  $('inviteMemberRole').value = 'member';

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
  if (field) {
    $('customFieldModalTitle').textContent = 'Edit Custom Field';
    $('customFieldId').value = field.id;
    $('customFieldName').value = field.name || '';
    $('customFieldType').value = field.field_type || field.type || 'text';
    $('customFieldRequired').checked = !!(field.is_required || field.required);
    var opts = field.options ? (Array.isArray(field.options) ? field.options.join(', ') : field.options) : '';
    $('customFieldOptions').value = opts;
  } else {
    $('customFieldModalTitle').textContent = 'Add Custom Field';
    $('customFieldId').value = '';
    $('customFieldName').value = '';
    $('customFieldType').value = 'text';
    $('customFieldRequired').checked = false;
    $('customFieldOptions').value = '';
  }
  toggleCustomFieldOptions();
  openModal('modal-custom-field');
}
window.openCustomFieldModal = openCustomFieldModal;

function toggleCustomFieldOptions() {
  var type = $('customFieldType').value;
  var show = (type === 'select' || type === 'multi_select');
  $('customFieldOptionsGroup').hidden = !show;
}

$('customFieldType').addEventListener('change', toggleCustomFieldOptions);

// Selected files for Create Issue modal (allows individual removal)
var _selectedFiles = [];

function _renderAttachmentFileList() {
  var list = $('attachmentFileList');
  if (!list) return;
  if (!_selectedFiles.length) { list.innerHTML = ''; return; }
  list.innerHTML = _selectedFiles.map(function(f, i) {
    return '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📄 ' + f.name + '</span>' +
      '<span style="color:var(--text3);flex-shrink:0">' + (f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB') + '</span>' +
      '<button type="button" onclick="_removeAttachmentFile('+i+')" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;line-height:1;padding:0 2px" title="Remove">×</button>' +
      '</div>';
  }).join('');
}

window._removeAttachmentFile = function(idx) {
  _selectedFiles.splice(idx, 1);
  _renderAttachmentFileList();
};

// Show selected file names in Create Issue modal
document.addEventListener('change', function(e) {
  if (e.target.id === 'issueAttachments') {
    var files = e.target.files;
    for (var i = 0; i < files.length; i++) _selectedFiles.push(files[i]);
    e.target.value = ''; // reset input so same file can be re-added
    _renderAttachmentFileList();
  }
});

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
      if (files[i].size > 500 * 1024 * 1024) { toast('File too large (max 500 MB)', 'error'); continue; }
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
    }).then(function(r) { return r.json(); }).then(function() {
      toast('Attachment uploaded');
      api('/api/issues/' + S.drawerIssueId).then(function(issue) {
        if (issue) renderDrawerAttachments(issue.attachments || []);
      });
    }).catch(function() { toast('Upload failed', 'error'); });
    e.target.value = '';
  }
});

$('customFieldForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var id = $('customFieldId').value;
  var name = $('customFieldName').value.trim();
  var type = $('customFieldType').value;
  var required = $('customFieldRequired').checked;
  var optionsRaw = $('customFieldOptions').value.trim();
  var options = (type === 'select' || type === 'multi_select') && optionsRaw
    ? optionsRaw.split(',').map(function (o) { return o.trim(); }).filter(Boolean)
    : [];

  if (!name) { toast('Field name is required', 'error'); return; }

  var payload = { space_id: S.currentSpace, name: name, field_type: type, is_required: required, options: options };
  try {
    if (id) {
      await api('/api/custom-fields/' + id, 'PUT', payload);
    } else {
      await api('/api/custom-fields', 'POST', payload);
    }
    await refreshData();
    closeModal('modal-custom-field');
    if (S.currentTab === 'space-settings' && _settingsActiveTab === 'customfields') {
      renderSettingsCustomFields(getSpace(S.currentSpace));
    }
    toast(id ? 'Custom field updated' : 'Custom field created');
  } catch (e) { /* error shown by api() */ }
});

// ═══════════════════════════════════════════════════════════
// ISSUE DRAWER (open)
// ═══════════════════════════════════════════════════════════
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
  } catch (e) { return; }

  if (!issue) { toast('Could not load issue', 'error'); return; }
  if (issue.key) { history.replaceState({ issueId: issueId }, '', '/?issue=' + encodeURIComponent(issue.key)); window._currentIssueKey = issue.key; }
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
  $('drawerType').className = 'badge badge-type badge-type-' + (issue.type || 'task');
  $('drawerTitle').textContent = issue.title || '';
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
      return fixed
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/(<br\s*\/?>){3,}/gi, '<br>')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    }
    var p = text.replace(/\n{3,}/g,'\n\n').replace(/\n/g,'<br>');
    var d = p.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    return d.replace(/(https?:\/\/[^\s<"]+)/g,'<a href="$1" style="' + linkStyle + '" target="_blank">$1</a>');
  }
  $('drawerDesc').innerHTML = renderDesc(descText);
  $('drawerFixDesc').innerHTML = renderDesc(fixDescText);

  $('drawerStatus').value = issue.status || 'To Do';
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

  var sprints = (S.data.sprints || []).filter(function (sp) { return sp.space_id == spaceId; });
  populateSprintSelect($('drawerSprint'), sprints, issue.sprint_id);

  $('drawerLabels').value = issue.labels || '';
  $('drawerPoints').value = issue.story_points != null ? issue.story_points : '';
  $('drawerStartDate').value = fmtDateISO(issue.start_date);
  $('drawerDueDate').value = fmtDateISO(issue.due_date);
  if ($('drawerTeam')) $('drawerTeam').value = issue.team || '';
  if ($('drawerProductType')) $('drawerProductType').value = issue.product_type || '';
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
  renderDrawerCustomFields(issue.custom_field_values || [], issue.id, issue.space_id || S.currentSpace);
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
      if (activeId !== 'drawerPriority')  $('drawerPriority').value  = fresh.priority  || '';
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
      if (activeId !== 'drawerLabels')      $('drawerLabels').value      = fresh.labels      || '';
      if (activeId !== 'drawerPoints')      $('drawerPoints').value      = fresh.story_points != null ? fresh.story_points : '';
      if (activeId !== 'drawerStartDate')   $('drawerStartDate').value   = fresh.start_date  ? fresh.start_date.slice(0,10) : '';
      if (activeId !== 'drawerDueDate')     $('drawerDueDate').value     = fresh.due_date    ? fresh.due_date.slice(0,10)   : '';
      if (activeId !== 'drawerTeam'        && $('drawerTeam'))        $('drawerTeam').value        = fresh.team         || '';
      if (activeId !== 'drawerProductType' && $('drawerProductType')) $('drawerProductType').value = fresh.product_type || '';
      if (activeId !== 'drawerTitle')     $('drawerTitle').textContent = fresh.title    || '';
      // Update time tracking, attachments, activity
      var timeSpentEl = document.querySelector('.drawer-time-spent');
      if (timeSpentEl) timeSpentEl.textContent = fresh.time_spent || '—';
      renderDrawerAttachments(fresh.attachments || []);
      $('drawerUpdated').textContent = fmtDateTime(fresh.updated_at);
      // Refresh custom fields silently (only if no input is focused inside them)
      var cfSection = $('drawerCustomFields');
      var cfFocused = cfSection && cfSection.contains(document.activeElement);
      if (!cfFocused) renderDrawerCustomFields(fresh.custom_field_values || [], issueId, fresh.space_id || S.currentSpace);
      // Refresh worklog tab if it is currently active
      var actBody = $('activitySectionBody');
      if (actBody && actBody.dataset.activeTab === 'worklog') _renderActivityTab('worklog', fresh);
      _drawerIssueData = fresh;
    } catch(_) {}
  }, 15000);
}
window.openDrawer = openDrawer;

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
        if (updated) $('drawerUpdated').textContent = fmtDateTime(updated.updated_at);
        refreshData(); // silent background refresh — no navigation
        toast('Saved');
      } catch(e) { toast('Save failed', 'error'); }
    }, 800);
  }


  $('drawerStatus').onchange = function () { autoSave('status', $('drawerStatus').value); updateStatusBtn($('drawerStatus').value); };
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
      var types = ['epic','story','task','bug','subtask'];
      var icons = {epic:'⚡',story:'📖',task:'✅',bug:'🐛',subtask:'📌'};
      var rect = typeEl.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = '_typeMenu';
      menu.style.cssText = 'position:fixed;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px;background:#fff;border:1px solid #dfe1e6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:9999;min-width:160px;padding:4px;';
      types.forEach(function(t) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:13px;border-radius:4px;display:flex;align-items:center;gap:8px;';
        item.innerHTML = '<span>'+ icons[t] +'</span><span>'+(t.charAt(0).toUpperCase()+t.slice(1))+'</span>';
        item.onmouseover = function(){ this.style.background='#f4f5f7'; };
        item.onmouseout = function(){ this.style.background='';};
        item.onclick = function(){
          menu.remove();
          typeEl.textContent = t.charAt(0).toUpperCase()+t.slice(1);
          typeEl.className = 'badge badge-type badge-type-'+t;
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
    // Check if existing due date exceeds the newly selected sprint's end date
    var dueVal = $('drawerDueDate').value;
    if (sprintId && dueVal) {
      var sprint = (S.data.sprints || []).find(function(sp){ return sp.id === sprintId; });
      if (sprint && sprint.end_date) {
        var sprintEnd = new Date(sprint.end_date.slice(0,10) + 'T00:00:00');
        var duePicked = new Date(dueVal + 'T00:00:00');
        if (duePicked > sprintEnd) {
          toast('Due date (' + dueVal + ') exceeds sprint end date (' + sprint.end_date.slice(0,10) + '). Due date cleared.', 'error');
          $('drawerDueDate').value = '';
          autoSave('due_date', null);
        }
      }
    }
    autoSave('sprint_id', sprintId || null);
  };
  $('drawerLabels').oninput     = function () { autoSave('labels',       $('drawerLabels').value); };
  $('drawerPoints').oninput     = function () {
    autoSave('story_points', $('drawerPoints').value ? parseInt($('drawerPoints').value, 10) : null);
  };
  if ($('drawerTeam'))        $('drawerTeam').onchange        = function () { autoSave('team',         $('drawerTeam').value || null); };
  if ($('drawerProductType')) $('drawerProductType').onchange = function () { autoSave('product_type', $('drawerProductType').value || null); };
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

  $('drawerTitle').oninput = function () {
    var title = $('drawerTitle').textContent.trim();
    if (title) autoSave('title', title);
  };

  var _drawerDescOriginal = '';
  $('drawerDesc').onfocus = function() {
    _drawerDescOriginal = $('drawerDesc').innerHTML;
    var b = $('drawerDescBtns'); if(b) b.style.display='flex';
  };

  // Open links inside contenteditable description
  $('drawerDesc').addEventListener('mousedown', function(e) {
    var a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); e.stopPropagation(); window.open(a.href, '_blank', 'noopener'); }
  });
  $('drawerDesc').addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); e.stopPropagation(); window.open(a.href, '_blank', 'noopener'); }
  });
  var drawerDescSaveBtn = $('drawerDescSave');
  var drawerDescCancelBtn = $('drawerDescCancel');
  if(drawerDescSaveBtn) drawerDescSaveBtn.onclick = async function(e) {
    e.preventDefault(); e.stopPropagation();
    drawerDescSaveBtn.disabled = true;
    drawerDescSaveBtn.textContent = 'Saving...';
    var b = $('drawerDescBtns'); if(b) b.style.display='none';
    var descEl = $('drawerDesc');
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
    autoSave('description', descEl.innerHTML.trim());
  };
  if(drawerDescCancelBtn) drawerDescCancelBtn.onclick = function() {
    $('drawerDesc').innerHTML = _drawerDescOriginal;
    var b = $('drawerDescBtns'); if(b) b.style.display='none';
  };
  $('drawerDesc').oninput = function () {
    autoSave('description', $('drawerDesc').innerHTML.trim());
  };
  var _drawerFixDescOriginal = '';
  $('drawerFixDesc').onfocus = function() {
    _drawerFixDescOriginal = $('drawerFixDesc').innerHTML;
    var b = $('drawerFixDescBtns'); if(b) b.style.display='flex';
  };
  var fixSaveBtn = $('drawerFixDescSave');
  var fixCancelBtn = $('drawerFixDescCancel');
  if(fixSaveBtn) fixSaveBtn.onclick = function() {
    var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
    autoSave('fix_description', $('drawerFixDesc').innerHTML.trim());
  };
  if(fixCancelBtn) fixCancelBtn.onclick = function() {
    $('drawerFixDesc').innerHTML = _drawerFixDescOriginal;
    var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
  };
  $('drawerFixDesc').oninput = function () {
    autoSave('fix_description', $('drawerFixDesc').textContent.trim());
  };

  // Expose pending to the global save handler (fallback)
  window._drawerPending = pending;

  // ── @mention autocomplete ─────────────────────────────────
  (function() {
    var textarea = $('drawerCommentInput');
    var dropdown = $('mentionDropdown');
    var mentionStart = -1;

    function getMembers() {
      return window._drawerMembers || S.data.users || [];
    }

    function closeMention() {
      dropdown.style.display = 'none';
      mentionStart = -1;
    }

    // Returns all text before the caret inside a contenteditable element
    function getTextBeforeCaret(el) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return '';
      var r = sel.getRangeAt(0).cloneRange();
      r.selectNodeContents(el);
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
        var walker = document.createTreeWalker(textarea, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        // build full text before caret
        var fullText = getTextBeforeCaret(textarea);
        var atIdx2 = fullText.lastIndexOf('@');
        if (atIdx2 === -1) return;
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
      var chip = '<span class="mention-chip" data-user-id="' + (userId || '') + '" contenteditable="false">@' + esc(name) + '</span> ';
      document.execCommand('insertHTML', false, chip);
    }

    function showMention(query) {
      var members = getMembers().filter(function(m) {
        return !query || m.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
      });
      if (!members.length) { closeMention(); return; }

      dropdown.style.top = (textarea.offsetHeight + 2) + 'px';
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
          e.preventDefault(); // keeps focus in textarea so selection is intact
          var name = item.dataset.name;
          var id = item.dataset.id;
          if (textarea.contentEditable === 'true') {
            insertMentionAtCaret(name, id);
          } else {
            var val = textarea.value;
            var before = val.substring(0, mentionStart);
            var after = val.substring(textarea.selectionStart);
            textarea.value = before + '@' + name + ' ' + after;
            var pos = mentionStart + name.length + 2;
            textarea.setSelectionRange(pos, pos);
            textarea.focus();
          }
          closeMention();
        });
      });
    }

    textarea.addEventListener('input', function() {
      var isContentEditable = textarea.contentEditable === 'true';
      var textBefore;
      if (isContentEditable) {
        textBefore = getTextBeforeCaret(textarea);
      } else {
        textBefore = textarea.value.substring(0, textarea.selectionStart);
      }
      var atIdx = textBefore.lastIndexOf('@');
      if (atIdx === -1) { closeMention(); return; }
      var charBefore = textBefore[atIdx - 1];
      if (atIdx > 0 && charBefore !== ' ' && charBefore !== '\n') { closeMention(); return; }
      var query = textBefore.substring(atIdx + 1);
      if (query.split(' ').length > 4) { closeMention(); return; }
      mentionStart = atIdx;
      showMention(query);
    });

    textarea.addEventListener('keydown', function(e) {
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

    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== textarea) closeMention();
    });
  })();

  $('drawerCommentSubmit').onclick = async function () {
  // Paste image support for comment box
  var _commentPasteEl = $('drawerCommentInput');
  if (_commentPasteEl) {
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
  }
    var _ci = $('drawerCommentInput');
    var body;
    if (!_ci) { body = ''; }
    else if (_ci.value !== undefined) {
      body = _ci.value.trim();
    } else {
      // contenteditable: convert mention chips to plain @Name text, preserve line breaks
      var _clone = _ci.cloneNode(true);
      _clone.querySelectorAll('.mention-chip').forEach(function(chip) {
        chip.replaceWith('@' + chip.textContent.replace(/^@/, ''));
      });
      _clone.querySelectorAll('br').forEach(function(br) { br.replaceWith('\n'); });
      _clone.querySelectorAll('div,p').forEach(function(block) {
        if (block.previousSibling) block.insertBefore(document.createTextNode('\n'), block.firstChild);
      });
      body = (_clone.textContent || '').trim();
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

    // Upload attached files to comment-specific endpoint
    if (_commentFiles.length) {
      var fd = new FormData();
      fd.append('issue_id', issueId);
      _commentFiles.forEach(function(f) { fd.append('files', f); });
      try {
        toast('Uploading attachment…');
        var uploadRes = await fetch('/api/comments/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
        var uploadData = await uploadRes.json();
        if (uploadData.files && uploadData.files.length) {
          var fileRefs = uploadData.files.map(function(f) {
            var isImg = f.type && f.type.startsWith('image/');
            return (isImg ? '[img:' : '[file:') + f.name + '|' + f.url + ']';
          }).join('\n');
          commentBody = commentBody ? commentBody + '\n' + fileRefs : fileRefs;
        }
      } catch(e) { toast('Attachment upload failed', 'error'); }
      _commentFiles = [];
      _renderCommentFileList();
    }

    if (commentBody) {
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
      // Re-enable button immediately
      submitBtn._submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Comment';
      // Post in background then refresh
      await api('/api/comments', 'POST', { issue_id: issueId, user_id: S.currentUser, body: commentBody });
    } else {
      var _ci3 = $('drawerCommentInput'); if (_ci3) { if (_ci3.value !== undefined) _ci3.value = ''; else _ci3.innerHTML = ''; }
      // Re-enable button
      submitBtn._submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Comment';
    }
    // Refresh in background to get real comment ID
    api('/api/issues/' + issueId).then(function(updated) {
      if (updated) {
        _drawerIssueData = updated;
        renderDrawerActivity(updated);
      }
    });
    toast('Comment added');
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

  // ⋯ Actions menu — Move to board + Delete issue
  $('drawerActionsBtn').onclick = function (e) {
    e.stopPropagation();
    var existing = document.querySelector('.drawer-actions-menu');
    if (existing) { existing.remove(); return; }

    var isOwner = (S.currentUserObj || {}).role === 'owner' || (S.currentUserObj || {}).role === 'admin';

    var menu = document.createElement('div');
    menu.className = 'drawer-actions-menu';
    // Member quick actions always shown; Move/Delete for owner/admin only
    var memberActions =
      '';
    menu.innerHTML = isOwner
      ? '<div class="drawer-actions-item danger" id="drawerDeleteItem">🗑️ Delete issue</div>'
      : '<div class="drawer-actions-item" style="color:var(--text3);padding:8px 12px;font-size:13px">No actions available</div>';

    var rect = $('drawerActionsBtn').getBoundingClientRect();
    menu.style.cssText = 'position:fixed;right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 4) + 'px;' +
      'background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:9999;min-width:180px;padding:4px;';

    document.body.appendChild(menu);


    if (isOwner) {
      // Move to another board
      var drawerMoveItem = document.getElementById('drawerMoveItem'); if (drawerMoveItem) drawerMoveItem.onclick = function () {
        menu.remove();
        // Build list of other spaces (boards) excluding current
        var currentIssue = (S.data.issues || []).find(function(i){ return i.id === issueId; });
        var currentSpaceId = currentIssue ? currentIssue.space_id : null;
        var otherSpaces = (S.data.spaces || []).filter(function(sp){ return sp.id !== currentSpaceId; });

        if (!otherSpaces.length) {
          toast('No other boards available to move to', 'error');
          return;
        }

        // Show board picker overlay
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';
        var picker = document.createElement('div');
        picker.style.cssText = 'background:var(--bg2);border-radius:12px;padding:24px;min-width:300px;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.25);';
        picker.innerHTML = '<div style="font-weight:700;font-size:15px;margin-bottom:4px">Move to another board</div>' +
          '<div style="font-size:12px;color:var(--text2);margin-bottom:16px">Select the destination board</div>' +
          '<div id="boardPickerList" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;"></div>' +
          '<div style="margin-top:16px;display:flex;justify-content:flex-end;">' +
          '<button id="boardPickerCancel" style="padding:7px 16px;border-radius:7px;border:1px solid var(--border);background:none;cursor:pointer;font-size:13px;">Cancel</button>' +
          '</div>';
        overlay.appendChild(picker);
        document.body.appendChild(overlay);

        var list = picker.querySelector('#boardPickerList');
        otherSpaces.forEach(function(sp) {
          var btn = document.createElement('button');
          btn.style.cssText = 'width:100%;text-align:left;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);cursor:pointer;font-size:13px;font-weight:500;transition:background 0.15s;';
          btn.textContent = sp.name;
          btn.onmouseover = function(){ btn.style.background = 'var(--accent-light, #eff6ff)'; };
          btn.onmouseout  = function(){ btn.style.background = 'var(--bg)'; };
          btn.onclick = async function() {
            overlay.remove();
            try {
              await api('/api/issues/' + issueId, 'PUT', { space_id: sp.id, sprint_id: null });
              goBackToSavedPage();
              await refreshData();
              if (S.currentTab) renderTab(S.currentTab);
              toast('Issue moved to ' + sp.name);
            } catch(err) {
              toast('Failed to move issue', 'error');
            }
          };
          list.appendChild(btn);
        });

        picker.querySelector('#boardPickerCancel').onclick = function(){ overlay.remove(); };
        overlay.onclick = function(ev){ if (ev.target === overlay) overlay.remove(); };
      };

      // Delete issue
      var drawerDeleteItem = document.getElementById('drawerDeleteItem'); if (drawerDeleteItem) drawerDeleteItem.onclick = async function () {
        menu.remove();
        // Only owner and admin can delete
        var role = (S.currentUserObj || {}).role;
        if (role !== 'owner' && role !== 'admin') {
          toast('Only owners and admins can delete issues', 'error');
          return;
        }
        // Show confirmation modal
        var confirmModal = document.createElement('div');
        confirmModal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center';
        confirmModal.innerHTML = '<div style="background:#fff;border-radius:8px;padding:28px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2)">' +
          '<h3 style="margin:0 0 8px;color:#172b4d;font-size:18px">Delete Issue</h3>' +
          '<p style="color:#42526e;margin:0 0 16px">Are you sure you want to delete this issue? This action cannot be undone.</p>' +
          '<p style="color:#42526e;margin:0 0 16px">Type <strong>delete</strong> to confirm:</p>' +
          '<input id="deleteConfirmInput" type="text" placeholder="Type delete here..." style="width:100%;padding:8px 12px;border:1px solid #dfe1e6;border-radius:4px;font-size:14px;box-sizing:border-box;margin-bottom:16px">' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="deleteCancelBtn" style="padding:8px 16px;border:1px solid #dfe1e6;border-radius:4px;background:#fff;cursor:pointer;font-size:14px">Cancel</button>' +
          '<button id="deleteConfirmBtn" style="padding:8px 16px;border:none;border-radius:4px;background:#de350b;color:#fff;cursor:pointer;font-size:14px;font-weight:600">Delete</button>' +
          '</div></div>';
        document.body.appendChild(confirmModal);
        document.getElementById('deleteConfirmInput').focus();
        document.getElementById('deleteCancelBtn').onclick = function() { confirmModal.remove(); };
        confirmModal.onclick = function(e) { if (e.target === confirmModal) confirmModal.remove(); };
        document.getElementById('deleteConfirmBtn').onclick = async function() {
          var val = document.getElementById('deleteConfirmInput').value.trim().toLowerCase();
          if (val !== 'delete') {
            document.getElementById('deleteConfirmInput').style.border = '1px solid #de350b';
            document.getElementById('deleteConfirmInput').placeholder = 'Please type "delete" to confirm';
            return;
          }
          confirmModal.remove();
          try {
            await api('/api/issues/' + issueId, 'DELETE');
            toast('Issue deleted successfully');
            // Close drawer and go back
            var drawer = document.getElementById('issueDrawer');
            if (drawer) drawer.setAttribute('hidden', '');
            S.drawerIssueId = null;
            window.history.replaceState({}, '', '/');
            await refreshData();
            renderCurrentView();
          } catch (err) {
            toast('Failed to delete issue', 'error');
          }
        };
      };
    }

    function closeMenu(ev) {
      if (!menu.contains(ev.target) && ev.target !== $('drawerActionsBtn')) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    }
    setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
  };
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
        '<input type="checkbox" ' + (isDone ? 'checked' : '') + ' onclick="event.stopPropagation();window._toggleSubtaskDone(\'' + st.id + '\',this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--success)">' +
        '<span class="subtask-key" style="font-size:11px;font-weight:700;color:var(--accent);min-width:48px;cursor:pointer" onclick="event.stopPropagation();openIssuePage(\'' + st.id + '\')">' + esc(st.key || '') + '</span>' +
        '<span style="flex:1;font-size:13px;' + (isDone ? 'text-decoration:line-through;color:var(--text3)' : '') + '" onclick="openIssuePage(\'' + st.id + '\')">' + esc(st.title) + '</span>' +
        statusBadge(st.status) +
        '<button class="btn-icon" style="width:20px;height:20px;font-size:12px;opacity:0.5" onclick="event.stopPropagation();window._deleteSubtask(\'' + st.id + '\')" title="Delete subtask">\u2715</button>' +
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
  populateIssueFormSelects();
  if (window._onIssueSpaceChange) window._onIssueSpaceChange(spaceId || '');
  // Pre-fill sprint and assignee from parent
  if (parentIssue) {
    if (parentIssue.sprint_id) $('issueSprint').value = parentIssue.sprint_id;
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

window._toggleSubtaskDone = async function(subtaskId, checked) {
  var newStatus = checked ? 'Done' : 'To Do';
  try {
    await api('/api/issues/' + subtaskId, 'PUT', { status: newStatus });
    var issue = await api('/api/issues/' + S.drawerIssueId);
    renderDrawerSubtasks(issue.subtasks || []);
    await refreshData();
  } catch(e) { toast(e.message, 'error'); }
};

window._deleteSubtask = async function(subtaskId) {
  var ok = await confirmDialog('Delete this subtask?');
  if (!ok) return;
  try {
    await api('/api/issues/' + subtaskId, 'DELETE');
    toast('Subtask deleted');
    var issue = await api('/api/issues/' + S.drawerIssueId);
    renderDrawerSubtasks(issue.subtasks || []);
    await refreshData();
  } catch(e) { toast(e.message, 'error'); }
};

// ═══════════════════════════════════════════════════════════
// LINKED ITEMS (Jira-style)
// ═══════════════════════════════════════════════════════════
var LINK_TYPES = [
  { value: 'blocks', label: 'blocks', inverse: 'is blocked by' },
  { value: 'is_blocked_by', label: 'is blocked by', inverse: 'blocks' },
  { value: 'clones', label: 'clones', inverse: 'is cloned by' },
  { value: 'is_cloned_by', label: 'is cloned by', inverse: 'clones' },
  { value: 'duplicates', label: 'duplicates', inverse: 'is duplicated by' },
  { value: 'is_duplicated_by', label: 'is duplicated by', inverse: 'duplicates' },
  { value: 'relates_to', label: 'relates to', inverse: 'relates to' },
  { value: 'is_child_of', label: 'is child of', inverse: 'is parent of' },
  { value: 'is_parent_of', label: 'is parent of', inverse: 'is child of' },
];

function linkTypeLabel(type) {
  var found = LINK_TYPES.find(function(t){ return t.value === type; });
  return found ? found.label : type.replace(/_/g, ' ');
}

function renderDrawerLinks(issue) {
  var c = $('drawerLinks');
  var links = issue.links || [];
  var html = '';

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
        html += '<div class="link-item" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;border:1px solid var(--border);margin-bottom:4px;background:var(--bg3);cursor:pointer" ' +
          'onmouseenter="this.style.borderColor=\'var(--accent)\'" onmouseleave="this.style.borderColor=\'var(--border)\'">' +
          '<span style="font-size:12px">' + typeIcon(it.type) + '</span>' +
          '<span style="font-size:11px;font-weight:700;color:var(--accent);cursor:pointer" onclick="openIssuePage(\'' + it.id + '\')">' + esc(it.key) + '</span>' +
          '<span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" onclick="openIssuePage(\'' + it.id + '\')">' + esc(it.title) + '</span>' +
          statusBadge(it.status) +
          '<button class="btn-icon" style="width:18px;height:18px;font-size:10px;opacity:0.4;flex-shrink:0" onclick="event.stopPropagation();window._removeLink(\'' + it.linkId + '\')" title="Remove link">\u2715</button>' +
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
    html += '<option value="' + LINK_TYPES[lti].value + '">' + esc(LINK_TYPES[lti].label) + '</option>';
  }
  html += '</select></div>' +
    '<div style="margin-bottom:8px">' +
    '<label class="form-label">Search for an issue</label>' +
    '<input type="text" id="linkSearchInput" class="input input-sm" placeholder="Search by issue key or title (e.g. BT-1)" oninput="window._searchLinkIssues(this.value)" style="width:100%">' +
    '</div>' +
    '<div id="linkSearchResults" style="max-height:160px;overflow-y:auto;margin-bottom:8px"></div>' +
    '<div id="linkSelectedIssue" style="display:none;padding:6px 8px;border:1px solid var(--accent);border-radius:4px;background:var(--accent-bg);margin-bottom:8px;display:none;align-items:center;gap:6px"></div>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end">' +
    '<button class="btn btn-outline btn-sm" onclick="window._hideLinkDialog()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" id="linkSubmitBtn" disabled onclick="window._submitLink()">Link</button>' +
    '</div></div>';

  c.innerHTML = html;
}

window._showLinkDialog = function() {
  var dlg = $('linkDialogInline');
  if (dlg) {
    dlg.style.display = '';
    $('linkSearchInput').value = '';
    var sel = $('linkSelectedIssue');
    sel.style.display = 'none';
    sel.dataset.issueId = '';
    $('linkSubmitBtn').disabled = true;
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
  var currentIssueId = S.drawerIssueId;
  // Get already-linked issue IDs to exclude them
  var linkedIds = [];
  var linkItems = document.querySelectorAll('#drawerLinks .link-item [onclick]');
  // Show all when empty, otherwise filter by key/title
  var matches = (S.data.issues || []).filter(function(i) {
    if (i.id === currentIssueId) return false;
    if (!term || term.trim().length === 0) return true; // show all when empty
    var lower = term.toLowerCase().trim();
    return (i.key && i.key.toLowerCase().indexOf(lower) >= 0) ||
           (i.title && i.title.toLowerCase().indexOf(lower) >= 0);
  }).slice(0, 10);

  if (!matches.length) {
    results.innerHTML = '<p class="text-muted text-xs" style="padding:6px 4px">No matching issues found</p>';
    return;
  }

  var html = '';
  for (var mi = 0; mi < matches.length; mi++) {
    var m = matches[mi];
    html += '<div class="link-search-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:12px" ' +
      'onmouseenter="this.style.background=\'var(--bg4)\'" onmouseleave="this.style.background=\'\'" ' +
      'onclick="window._selectLinkIssue(\'' + m.id + '\',\'' + esc(m.key) + '\',\'' + esc(m.title).replace(/'/g, "\\'") + '\')">' +
      '<span style="font-size:11px">' + typeIcon(m.type) + '</span>' +
      '<span style="font-weight:700;color:var(--accent);min-width:48px">' + esc(m.key) + '</span>' +
      '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.title) + '</span>' +
      statusBadge(m.status) +
      '</div>';
  }
  results.innerHTML = html;
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

window._submitLink = async function() {
  var targetId = $('linkSelectedIssue').dataset.issueId;
  var linkType = $('linkTypeSelect').value;
  if (!targetId) return;
  try {
    await api('/api/links', 'POST', {
      source_id: S.drawerIssueId,
      target_id: targetId,
      link_type: linkType
    });
    toast('Issue linked');
    window._hideLinkDialog();
    // Refresh the drawer
    var issue = await api('/api/issues/' + S.drawerIssueId);
    renderDrawerLinks(issue);
    await refreshData();
  } catch(e) { toast(e.message || 'Failed to create link', 'error'); }
};

window._removeLink = async function(linkId) {
  var ok = await confirmDialog('Remove this link?');
  if (!ok) return;
  try {
    await api('/api/links/' + linkId, 'DELETE');
    toast('Link removed');
    var issue = await api('/api/issues/' + S.drawerIssueId);
    renderDrawerLinks(issue);
    await refreshData();
  } catch(e) { toast(e.message, 'error'); }
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
      var html = esc(body).replace(/@([\w][\w.]*(?:\s[\w][\w.]*)?)/g, '<span style="color:#0052cc;font-weight:600">@$1</span>');
      html = html.replace(/\[img:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:8px"><img src="' + url + '" style="max-width:300px;max-height:200px;border-radius:6px;border:1px solid #dfe1e6;cursor:pointer;display:block" onclick="window.open(this.src)" title="' + fname + '"><div style="font-size:11px;color:#6b778c;margin-top:2px">📷 ' + fname + '</div></div>';
      });
      html = html.replace(/\[file:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:6px"><a href="' + url + '" target="_blank" style="color:#0052cc;text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #dfe1e6;border-radius:4px;font-size:13px;background:#f4f5f7">📎 ' + fname + '</a></div>';
      });
      if (/<[a-z][\s\S]*>/i.test(body)) return body;
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

    var editArea = isOwn
      ? '<div class="comment-edit-area-' + cm.id + '" style="display:none;margin-top:8px;border:1px solid var(--border);border-radius:6px;overflow:hidden">' +
        richToolbar +
        '<div id="edit-rich-' + cm.id + '" class="jira-editor-body" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13px;outline:none"></div>' +
        '<div style="display:flex;gap:8px;padding:8px 10px;background:var(--bg2);border-top:1px solid var(--border)">' +
        '<button onclick="window._saveComment(\'' + cm.id + '\')" style="background:#0052cc;color:#fff;border:none;border-radius:4px;padding:5px 16px;font-size:12px;cursor:pointer;font-weight:600">Save</button>' +
        '<button onclick="window._cancelEditComment(\'' + cm.id + '\')" style="background:none;border:1px solid var(--border);border-radius:4px;padding:5px 14px;font-size:12px;cursor:pointer">Cancel</button>' +
        '</div></div>'
      : '';

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
    // Pre-fill with current HTML content
    richEl.innerHTML = bodyDiv ? bodyDiv.innerHTML : '';
    editArea.style.display = '';
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
    if (editArea) editArea.style.display = 'none';
  };

  window._deleteComment = function(id) {
    if (!confirm('Delete this comment?')) return;
    api('/api/comments/' + id, 'DELETE').then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          _drawerIssueData = fresh;
          _renderActivityTab('comment', fresh);
        }).catch(function(){});
      }
    }).catch(function() { toast('Failed to delete comment', 'error'); });
  };

  window._saveComment = function(id) {
    var richEl = document.getElementById('edit-rich-' + id);
    if (!richEl) return;
    var newBody = richEl.innerHTML.trim();
    if (!newBody || newBody === '<br>') return;
    api('/api/comments/' + id, 'PUT', { body: newBody }).then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          _drawerIssueData = fresh;
          _renderActivityTab('comment', fresh);
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
    var oldVal = resolveVal(h.field_name, h.old_value) || '—';
    var newVal = resolveVal(h.field_name, h.new_value) || '—';
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
      '<a href="/api/files/' + esc(a.filename) + '" target="_blank" style="font-size:13px;color:var(--accent);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Click to open">' + esc(a.original_name) + '</a>' +
      '<div style="font-size:11px;color:var(--text3)">' + fmtSize(a.size) + (a.uploader_name ? ' · ' + esc(a.uploader_name) : '') + ' · ' + fmtDateTime(a.created_at) + '</div>' +
      '</div>' +
      '<a href="/api/files/' + esc(a.filename) + '" download="' + esc(a.original_name) + '" title="Download" style="color:var(--text3);font-size:15px;text-decoration:none;padding:2px 4px;border-radius:4px;line-height:1" onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">⬇</a>' +
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

function renderDrawerCustomFields(cfValues, issueId, spaceId) {
  var c = $('drawerCustomFields');
  if (!c) return;

  // Get ALL custom fields defined for this space
  var spaceFields = (S.data.custom_fields || []).filter(function(f) { return f.space_id == spaceId; });
  if (!spaceFields.length) { c.innerHTML = ''; return; }

  // Build a lookup map of existing values: field_id → value
  // Merge: prefer live cfValues passed in, fallback to bulk-loaded S.data.issue_field_values
  var valueMap = {};
  var bulkVals = (S.data.issue_field_values || []).filter(function(v) { return v.issue_id == issueId; });
  bulkVals.forEach(function(v) { valueMap[v.field_id] = v.value; });
  (cfValues || []).forEach(function(v) { valueMap[v.field_id] = v.value; }); // live values override

  // Fields that are already rendered as built-in drawer fields — skip to avoid duplicates
  var _builtinFields = ['team', 'product type'];
  var html = '';
  spaceFields.forEach(function(field) {
    if (_builtinFields.indexOf((field.name || '').toLowerCase().trim()) !== -1) return;
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
      var mopts = (Array.isArray(field.options) ? field.options : (typeof field.options === 'string' ? JSON.parse(field.options || '[]') : (field.options || [])));
      var selected = val ? val.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
      var isMultiSel = ftype === 'multi_select';
      var displayVal = selected.length ? esc(selected.join(', ')) : '';
      inputHtml = '<div class="cf-select-wrap" data-cf-id="' + fid + '" data-multi="' + (isMultiSel ? '1' : '0') + '">' +
        '<div class="cf-select-trigger">' +
          '<input class="cf-sel-search" type="text" value="' + displayVal + '" placeholder="' + (isMultiSel ? 'Select options…' : 'Select an option…') + '" readonly>' +
          (selected.length ? '<span class="cf-sel-clear" title="Clear">×</span>' : '') +
          '<span class="cf-sel-arrow">⌄</span>' +
        '</div>' +
        '<div class="cf-select-dropdown" style="display:none">' +
          '<div class="cf-sel-search-wrap"><input class="cf-sel-filter" type="text" placeholder="Search…"></div>' +
          '<div class="cf-sel-list">' +
          mopts.map(function(o) {
            var sel = selected.indexOf(o) >= 0;
            return '<div class="cf-sel-opt' + (sel ? ' cf-sel-opt-active' : '') + '" data-val="' + esc(o) + '">' + esc(o) + '</div>';
          }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    } else if (ftype === 'user') {
      var uopts = (S.data.users || [])
        .map(function(u) { return '<option value="' + u.id + '"' + (u.id == val ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');
      inputHtml = '<select class="input input-sm" data-cf-id="' + fid + '"><option value="">—</option>' + uopts + '</select>';
    }

    html += '<div class="drawer-field">' +
      '<label class="drawer-label">' + fname + req + '</label>' +
      '<div class="drawer-cf-input">' + inputHtml + '</div>' +
      '</div>';
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
      var isMulti = el.dataset.multi === '1';
      var selArr = Array.from(el.querySelectorAll('.cf-sel-opt-active')).map(function(o){ return o.dataset.val; });
      var trigger  = el.querySelector('.cf-select-trigger');
      var dropdown = el.querySelector('.cf-select-dropdown');
      var searchInput = el.querySelector('.cf-sel-search');
      var filterInput = el.querySelector('.cf-sel-filter');

      function refreshTrigger() {
        searchInput.value = selArr.length ? selArr.join(', ') : '';
        searchInput.placeholder = isMulti ? 'Select options…' : 'Select an option…';
        var clearBtn = trigger.querySelector('.cf-sel-clear');
        if (selArr.length && !clearBtn) {
          var c = document.createElement('span');
          c.className = 'cf-sel-clear'; c.title = 'Clear'; c.textContent = '×';
          trigger.insertBefore(c, trigger.querySelector('.cf-sel-arrow'));
          c.addEventListener('click', function(ev) {
            ev.stopPropagation();
            selArr = []; refreshTrigger(); refreshOpts(''); saveValue('');
          });
        } else if (!selArr.length && clearBtn) {
          clearBtn.remove();
        }
      }

      function refreshOpts(filter) {
        el.querySelectorAll('.cf-sel-opt').forEach(function(opt) {
          var v = opt.dataset.val;
          opt.classList.toggle('cf-sel-opt-active', selArr.indexOf(v) >= 0);
          opt.style.display = filter && v.toLowerCase().indexOf(filter.toLowerCase()) < 0 ? 'none' : '';
        });
      }

      // Open/close dropdown
      trigger.addEventListener('click', function(ev) {
        ev.stopPropagation();
        var isOpen = dropdown.style.display !== 'none';
        document.querySelectorAll('.cf-select-dropdown').forEach(function(d){ d.style.display = 'none'; });
        if (!isOpen) {
          dropdown.style.display = 'block';
          if (filterInput) { filterInput.value = ''; refreshOpts(''); filterInput.focus(); }
        }
      });

      // Filter input
      if (filterInput) {
        filterInput.addEventListener('input', function(ev) { ev.stopPropagation(); refreshOpts(filterInput.value); });
        filterInput.addEventListener('click', function(ev) { ev.stopPropagation(); });
      }

      // Option click
      el.querySelectorAll('.cf-sel-opt').forEach(function(opt) {
        opt.addEventListener('click', function(ev) {
          ev.stopPropagation();
          var v = opt.dataset.val;
          if (isMulti) {
            var idx = selArr.indexOf(v);
            if (idx >= 0) selArr.splice(idx, 1); else selArr.push(v);
          } else {
            selArr = [v];
            dropdown.style.display = 'none';
          }
          refreshTrigger(); refreshOpts(filterInput ? filterInput.value : '');
          saveValue(selArr.join(','));
        });
      });

      // Close on outside click
      document.addEventListener('click', function() { dropdown.style.display = 'none'; });

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
  var role = (S.currentUserObj || {}).role;
  return role === 'owner';
}

// Returns current user's role in a given space (from space_members)
function getMySpaceRole(spaceId) {
  if (!spaceId) return null;
  var sm = (S.data.space_members || []).find(function(m) {
    return m.space_id === spaceId && m.user_id === S.currentUser;
  });
  return sm ? (sm.role || 'member') : null;
}

// Returns true if the current user can access owner-level features for the given space
function isSpaceOwner(spaceId) {
  var globalRole = (S.currentUserObj || {}).role;
  if (globalRole === 'owner') return true;
  var spaceRole = getMySpaceRole(spaceId);
  return spaceRole === 'owner';
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
  var payload = {
    name: spaceName,
    key: $('spaceKey_input').value.toUpperCase(),
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
    end_date: $('sprintEndDate').value || null
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
  if ($('issueLabels')) $('issueLabels').value = '';
  if ($('issueTeam')) $('issueTeam').value = '';
  if ($('issueProductType')) $('issueProductType').value = '';
  $('issueStartDate').value = fmtDateISO(new Date()); // default to today
  $('issueDueDate').value = '';
  var descEl = $('issueDescription'); if (descEl) { if (descEl.value !== undefined) descEl.value = ''; else descEl.innerHTML = ''; }
  _selectedFiles = [];
  _renderAttachmentFileList();
  var fi = $('issueAttachments');
  if (fi) fi.value = '';
  var fnLabel = $('attachmentFileNames');
  if (fnLabel) fnLabel.textContent = 'No files chosen';
}

function populateIssueFormSelects() {
  var spaceId = $('issueSpaceId').value || S.currentSpace;
  var members = spaceId ? getSpaceMembers(spaceId) : (S.data.users || []);
  if (!members.length) members = S.data.users || [];
  var sprints = spaceId ? getSpaceSprints(spaceId) : [];

  populateUserSelect($('issueAssignee'), members, null);
  populateUserSelect($('issueReporter'), members, S.currentUser);
  populateSprintSelect($('issueSprint'), sprints, null);
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  var titleVal = $('issueTitleInput') && $('issueTitleInput').value.trim();
  if (titleVal == null || titleVal == '') {
    toast('Please fill in the Title — it is mandatory', 'error');
    $('issueTitleInput').focus();
    $('issueTitleInput').style.border = '2px solid #e53e3e';
    setTimeout(function(){ $('issueTitleInput').style.border = ''; }, 3000);
    return;
  }
  var spaceVal = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || (S.data && S.data.spaces && S.data.spaces[0] && S.data.spaces[0].id);
  if (spaceVal == null || spaceVal == '') {
    toast('Please select a Space — it is mandatory', 'error');
    return;
  }
  var teamVal = $('issueTeam') ? $('issueTeam').value : '';
  var productVal = $('issueProductType') ? $('issueProductType').value : '';
  var startVal = $('issueStartDate').value;
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
  // Ensure space_id is set
  var resolvedSpace = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || (S.data && S.data.spaces && S.data.spaces[0] && S.data.spaces[0].id);
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
    product_type: $('issueProductType') ? ($('issueProductType').value || null) : null,
    labels: $('issueLabels') ? $('issueLabels').value : '',
    start_date: $('issueStartDate').value || null,
    due_date:   $('issueDueDate').value   || null,
    description: await (async function(){
      var el = $('issueDescription');
      if (!el) return '';
      var html = el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.innerHTML;
      // Upload any base64/blob images in description
      var imgs = el.querySelectorAll ? el.querySelectorAll('img[src^="data:"],img[src^="blob:"]') : [];
      for (var i = 0; i < imgs.length; i++) {
        try {
          var imgEl = imgs[i];
          var resp = await fetch(imgEl.src);
          var blob = await resp.blob();
          var fd = new FormData();
          fd.append('files', blob, 'image-' + Date.now() + '.png');
          var spaceId = $('issueSpaceId').value || S.currentSpace;
          // Upload to temp endpoint and get URL
          var uploadResp = await fetch('/api/upload-temp', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getAuthToken() },
            body: fd
          });
          if (uploadResp.ok) {
            var uploadData = await uploadResp.json();
            if (uploadData.url) {
              imgEl.src = uploadData.url;
            }
          }
        } catch(e) {}
      }
      return el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.innerHTML;
    })(),
    original_estimate: $('issueEstimate') ? parseEstimate($('issueEstimate').value) : 0,
    status: 'To Do',
    _customFields: (function() {
      var cfs = {};
      var fields = document.querySelectorAll('#issueCustomFieldsContainer .cf-field');
      fields.forEach(function(f) { if (f.value) cfs[f.dataset.cfId] = f.value; });
      return cfs;
    })()
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
      // Save dynamic custom fields
      var cfFields = document.querySelectorAll('#issueCustomFieldsContainer .cf-field');
      cfFields.forEach(function(f) {
        if (f.value && f.dataset.cfId) {
          api('/api/issues/' + created.id + '/field-values/' + f.dataset.cfId, 'PUT', { value: f.value }).catch(function(){});
        }
      });
      // team and product_type are saved directly via payload
    }
    // Upload any attached files
    if (created && created.id && _selectedFiles.length) {
      var fd = new FormData();
      for (var i = 0; i < _selectedFiles.length; i++) fd.append('files', _selectedFiles[i]);
      try {
        await fetch('/api/issues/' + created.id + '/attachments', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
      } catch(e) { toast('Issue created but attachments failed to upload', 'warning'); }
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    } catch(e) { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save"; } toast("Failed to create issue: " + e.message, "error"); return; }
    closeModal('modal-issue');
    await refreshData();
    if (parentId && S.drawerIssueId === parentId) {
      var parentIssue = await api('/api/issues/' + parentId);
      renderDrawerSubtasks(parentIssue.subtasks || []);
    } else {
      renderCurrentView();
    }
    if (created && created.id && !parentId) {
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
  }
}

// ═══════════════════════════════════════════════════════════
// FILTER CRUD
// ═══════════════════════════════════════════════════════════
async function handleFilterSubmit(e) {
  e.preventDefault();
  var id = $('filterId').value;
  var condRows = qsa('.filter-condition-row');
  var conditions = [];
  condRows.forEach(function (row) {
    conditions.push({
      field: row.querySelector('.fc-field').value,
      operator: row.querySelector('.fc-op').value,
      value: row.querySelector('.fc-value').value
    });
  });

  var payload = {
    space_id: $('filterSpaceId').value || S.currentSpace,
    user_id: S.currentUser,
    name: $('filterNameInput').value,
    conditions: JSON.stringify(conditions),
    is_shared: $('filterShared').checked,
    is_pinned: $('filterPinned').checked
  };

  if (id) {
    await api('/api/filters/' + id, 'PUT', payload);
    toast('Filter updated');
  } else {
    await api('/api/filters', 'POST', payload);
    toast('Filter created');
  }
  closeModal('modal-filter');
  await refreshData();
  renderFilters();
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
    var notifs = await api('/api/notifications?user_id=' + S.currentUser);
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
  'comment_added':  'comment_added',
  'sprint_started': 'sprint_started',
  'sprint_completed': 'sprint_started', // same toggle as sprint_started
  'mention': 'comment_added'            // mentions follow comment pref
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
  'comment_added':  '💬',
  'sprint_started': '🚀',
  'sprint_completed': '✅',
  'mention': '@'
};

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
  var tIcons = { comment_added:'&#128172;', issue_assigned:'&#128100;', status_changed:'&#128260;', sprint_started:'&#128640;', sprint_completed:'&#9989;', issue_created:'&#128203;', mention:'@' };
  var tColors = { comment_added:'#0129AC', issue_assigned:'#7c3aed', status_changed:'#059669', sprint_started:'#d97706', sprint_completed:'#059669', issue_created:'#0129AC', mention:'#dc2626' };
  var html = '';
  var limit = Math.min(sorted.length, 50);
  for (var i = 0; i < limit; i++) {
    var n = sorted[i];
    var icon = tIcons[n.type] || '&#128276;';
    var color = tColors[n.type] || '#0129AC';
    var isU = !n.is_read;
    var encodedLink = encodeURIComponent(n.link || '');
    html += '<div class="notif-item' + (isU ? ' unread' : '') + '" onclick="window._markNotifRead(\'' + n.id + '\',\'' + encodedLink + '\')">' +
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

window._markNotifRead = async function (id, encodedLink) {
  await api('/api/notifications/' + id + '/read', 'PUT');
  // Close panel
  var panel = $('notifPanel');
  if (panel) panel.setAttribute('hidden', '');
  // Navigate to the linked issue
  if (encodedLink) {
    var link = decodeURIComponent(encodedLink); // e.g. "/?ENG-41"
    var issueKey = link.replace(/^\/?\??/, ''); // → "ENG-41"
    if (issueKey) {
      // Try to find the issue in local data first
      var issue = (S.data && S.data.issues || []).find(function(i) { return i.key === issueKey; });
      if (issue) {
        openIssuePage(issue.id, issue.key);
      } else {
        // Fetch across spaces then open
        api('/api/issues/' + encodeURIComponent(issueKey)).then(function(data) {
          if (data && data.id) openIssuePage(data.id, data.key);
        }).catch(function() {});
      }
    }
  }
  await loadNotifications();
  renderNotifPanel();
};

async function markAllRead() {
  await api('/api/notifications/read-all', 'PUT', { user_id: S.currentUser });
  await loadNotifications();
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
  init();

  // Sidebar global nav
  qsa('.nav-item[data-view]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      navigateTo(el.dataset.view);
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
  window._onIssueSpaceChange = function(spaceId) {
    if ($('issueSpaceId')) $('issueSpaceId').value = spaceId || '';
    // Update sprint dropdown
    var sprints = (S.data.sprints || []).filter(function(sp){ return sp.space_id === spaceId; });
    var sprintSel = $('issueSprint');
    if (sprintSel) {
      sprintSel.innerHTML = '<option value="">None</option>' +
        sprints.map(function(sp){ return '<option value="' + sp.id + '">' + esc(sp.name) + '</option>'; }).join('');
    }
    // Render custom fields — always show ALL unique custom fields across all spaces
    var cfContainer = $('issueCustomFieldsContainer');
    if (!cfContainer) return;

    function renderCF(cfs) {
      var excluded = ['team', 'product type', 'environment', 'story category', 'testing'];
      // Deduplicate by lowercase name — keep first occurrence
      var seen = {};
      var unique = [];
      cfs.forEach(function(f) {
        var key = (f.name || '').toLowerCase().trim();
        if (excluded.indexOf(key) !== -1) return;
        if (seen[key]) return;
        seen[key] = true;
        unique.push(f);
      });
      cfContainer.innerHTML = unique.map(function(f) {
        var opts = Array.isArray(f.options) ? f.options :
          (typeof f.options === 'string' ? (function(){ try{ return JSON.parse(f.options); }catch(e){ return []; } })() : []);
        if (f.field_type === 'select') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + (f.is_required ? ' <span style="color:var(--red)">*</span>' : '') + '</label>' +
            '<select class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '">' +
            '<option value="">— Select —</option>' +
            opts.map(function(o){ return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
            '</select></div>';
        } else if (f.field_type === 'multiselect') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + (f.is_required ? ' <span style="color:var(--red)">*</span>' : '') + '</label>' +
            '<select class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '" data-multi="1" multiple style="min-height:80px">' +
            opts.map(function(o){ return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
            '</select></div>';
        } else if (f.field_type === 'text') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + (f.is_required ? ' <span style="color:var(--red)">*</span>' : '') + '</label>' +
            '<input type="text" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '"></div>';
        } else if (f.field_type === 'number') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + (f.is_required ? ' <span style="color:var(--red)">*</span>' : '') + '</label>' +
            '<input type="number" class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '"></div>';
        } else if (f.field_type === 'textarea') {
          return '<div class="form-group">' +
            '<label class="form-label">' + esc(f.name) + (f.is_required ? ' <span style="color:var(--red)">*</span>' : '') + '</label>' +
            '<textarea class="input cf-field" data-cf-id="' + f.id + '" data-cf-name="' + esc(f.name) + '" rows="3"></textarea></div>';
        }
        return '';
      }).join('');
    }

    // Always use ALL cached custom fields from all spaces (deduplicated)
    var allCFs = S.data.custom_fields || [];
    if (allCFs.length) {
      renderCF(allCFs);
    } else if (spaceId) {
      cfContainer.innerHTML = '';
      api('/api/data?space_id=' + spaceId).then(function(data) {
        if (data && data.custom_fields) {
          S.data.custom_fields = (S.data.custom_fields || []).filter(function(f){ return f.space_id !== spaceId; }).concat(data.custom_fields);
          renderCF(S.data.custom_fields);
        }
      }).catch(function(){});
    } else {
      cfContainer.innerHTML = '';
    }
  };

  $('createIssueBtn').addEventListener('click', function () {
    resetIssueForm();
    $('issueModalTitle').textContent = 'Create Issue';
    // Use current space or fall back to first available space so custom fields always load
    var spaceToUse = S.currentSpace || ((S.data && S.data.spaces && S.data.spaces[0]) ? S.data.spaces[0].id : '');
    $('issueSpaceId').value = spaceToUse;
    window._populateIssueSpaceDropdown && window._populateIssueSpaceDropdown(spaceToUse);
    window._onIssueSpaceChange && window._onIssueSpaceChange(spaceToUse);
    populateIssueFormSelects();
    openModal('modal-issue');
  });

  // Create sprint
  $('createSprintBtn').addEventListener('click', function () { window._openSprintModal(null); });

  // Invite member (header button opens invite modal directly)
  $('inviteMemberBtn').addEventListener('click', function () {
    if (S.currentSpace) {
      openInviteMemberModal();
    } else {
      toast('Select a space first', 'error');
    }
  });

  // Notifications
  $('notifBtn').addEventListener('click', function () {
    var panel = $('notifPanel');
    if (panel.hasAttribute('hidden')) {
      panel.removeAttribute('hidden');
      renderNotifPanel();
      // Mark all as read when panel opens and clear badge immediately
      if (S.data && S.data.notifications) {
        S.data.notifications.forEach(function(n){ n.is_read = true; });
      }
      var badge = $('notifBadge');
      if (badge) badge.setAttribute('hidden', '');
      markAllRead().then(function() {
        renderNotifBadge();
      });
    } else {
      panel.setAttribute('hidden', '');
    }
  });
  $('markAllReadBtn').addEventListener('click', function () { markAllRead(); });

  // Close notif panel on outside click
  document.addEventListener('click', function (e) {
    var panel = $('notifPanel');
    if (!panel.hasAttribute('hidden') &&
        !panel.contains(e.target) &&
        e.target !== $('notifBtn') &&
        !$('notifBtn').contains(e.target)) {
      panel.setAttribute('hidden', '');
    }
  });

  // Form submits
  $('spaceForm').addEventListener('submit', handleSpaceSubmit);
  $('sprintForm').addEventListener('submit', handleSprintSubmit);
  $('issueForm').addEventListener('submit', handleIssueSubmit);
  $('filterForm').addEventListener('submit', handleFilterSubmit);
  $('worklogForm').addEventListener('submit', handleWorklogSubmit);

  // Create filter
  $('createFilterBtn').addEventListener('click', function () {
    $('filterId').value = '';
    $('filterSpaceId').value = S.currentSpace || '';
    $('filterNameInput').value = '';
    $('filterShared').checked = false;
    $('filterPinned').checked = false;
    $('filterConditions').innerHTML = '';
    $('filterModalTitle').textContent = 'Create Filter';
    openModal('modal-filter');
  });

  // Add filter condition
  $('addConditionBtn').addEventListener('click', function () {
    var row = document.createElement('div');
    row.className = 'filter-condition-row';
    row.innerHTML = '<select class="input input-sm fc-field">' +
      '<option value="status">Status</option><option value="priority">Priority</option>' +
      '<option value="type">Type</option><option value="assignee_id">Assignee</option>' +
      '<option value="labels">Labels</option></select>' +
      '<select class="input input-sm fc-op">' +
      '<option value="equals">equals</option><option value="not_equals">not equals</option>' +
      '<option value="contains">contains</option></select>' +
      '<input type="text" class="input input-sm fc-value" value="">' +
      '<button type="button" class="btn btn-sm btn-outline" onclick="this.closest(\'.filter-condition-row\').remove()">x</button>';
    $('filterConditions').appendChild(row);
  });

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
  }, true);

  // Space search
  $('spaceSearch').addEventListener('input', function () {
    var term = $('spaceSearch').value;
    if (S.currentTab === 'backlog') {
      $('backlogSearch').value = term;
      renderBacklog();
    } else if (S.currentTab === 'allwork') {
      $('allWorkSearch').value = term;
      renderAllWork();
    }
  });

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
    var content = btn.closest('.sidebar-section').querySelector('.sidebar-section-content');
    if (content) {
      content.classList.toggle('collapsed');
      btn.textContent = content.classList.contains('collapsed') ? '\u25B8' : '\u25BE';
    }
  });
});

// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT VIEW
// ═══════════════════════════════════════════════════════════
async function renderUserManagement() {
  var view = $('view-user-management');
  if (!view) return;
  var me = S.currentUserObj || {};
  var isAdmin = me.role === 'admin' || me.role === 'owner';
  if (!isAdmin) {
    view.innerHTML = '<div class="view-empty"><h2>Access Denied</h2><p>Only admins can manage users.</p></div>';
    return;
  }

  view.innerHTML = '<div class="settings-loading">Loading users...</div>';

  var users = [];
  try { users = await api('/api/users'); } catch (e) { return; }
  var totalActive = users.filter(function(u){ return u.is_active !== false; }).length;
  var pendingInvites = [];
  try { var allInvites = await api('/api/auth/invitations'); var regEmails = users.map(function(u){ return u.email.toLowerCase(); }); pendingInvites = (allInvites||[]).filter(function(inv){ return inv.status==='pending' && !regEmails.includes(inv.email.toLowerCase()); }); } catch(e) {}

  var rows = users.map(function (u) {
    var statusBadge = u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-muted">Inactive</span>';
    var lastLogin = u.last_login ? relativeTime(u.last_login) : 'Never';
    return '<tr data-um-status="' + (u.is_active !== false ? 'active' : 'inactive') + '" style="border-bottom:1px solid #f4f5f7" onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'\'">' +
      '<td style="padding:12px 20px;min-width:250px;max-width:300px"><div style="display:flex;align-items:center;gap:12px">' +
      '<div class="user-avatar-sm" style="background:' + (u.color || '#6366f1') + ';flex-shrink:0">' + initials(u.name) + '</div>' +
      '<div style="overflow:hidden"><div style="font-weight:600;color:#172b4d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.name) + '</div><div style="font-size:12px;color:#6b778c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.email) + '</div></div>' +
      '</div></td>' +
      '<td><select class="input input-sm um-role-sel" data-uid="' + u.id + '" ' + (u.id === me.id ? 'disabled' : '') + '>' +
      ['owner','admin','member'].map(function(r){ return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+cap(r)+'</option>'; }).join('') +
      '</select></td>' +
      '<td style="padding:14px 16px">' + statusBadge + '</td>' +
      '<td style="padding:14px 16px;font-size:13px;color:var(--text2)">' + lastLogin + '</td>' +
      '<td>' +
      (u.id !== me.id ? '<button class="btn btn-sm btn-outline um-toggle-btn" data-uid="' + u.id + '" data-active="' + u.is_active + '">' + (u.is_active ? 'Deactivate' : 'Activate') + '</button> ' : '') +
      '<button class="btn btn-sm btn-outline um-pwd-btn" data-uid="' + u.id + '" data-uname="' + esc(u.name) + '">Reset PW</button>' +
      '</td>' +
      '</tr>';
  }).join('');

  view.innerHTML =
    '<div style="padding:0">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px">' +
    '<div>' +
    '<h2 style="margin:0 0 6px;font-size:22px;font-weight:700;color:var(--text)">User Management</h2>' +
    '<p style="margin:0 0 10px;color:var(--text2);font-size:14px">Manage all users, roles and access in your organization.</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<div class="um-filter-chip" data-filter="all" onclick="window._umFilter(\'all\')" style="display:flex;align-items:center;gap:6px;background:var(--bg3);padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:2px solid #0129AC"><span style="font-weight:700;color:var(--text)">' + users.length + '</span><span style="color:var(--text3)">Registered</span></div>' +
    '<div class="um-filter-chip" data-filter="active" onclick="window._umFilter(\'active\')" style="display:flex;align-items:center;gap:6px;background:#dcfce7;padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:2px solid transparent"><span style="font-weight:700;color:#166534">' + totalActive + '</span><span style="color:#166534">Active</span></div>' +
    '<div class="um-filter-chip" data-filter="inactive" onclick="window._umFilter(\'inactive\')" style="display:flex;align-items:center;gap:6px;background:#f1f5f9;padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:2px solid transparent"><span style="font-weight:700;color:#64748b">' + (users.length - totalActive) + '</span><span style="color:#64748b">Inactive</span></div>' +
    (pendingInvites.length ? '<div class="um-filter-chip" data-filter="pending" onclick="window._umFilter(\'pending\')" style="display:flex;align-items:center;gap:6px;background:#fef3c7;padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:2px solid transparent"><span style="font-weight:700;color:#92400e">' + pendingInvites.length + '</span><span style="color:#92400e">Pending Invites</span></div>' : '') +
    '</div>' +
    '</div>' +
    '<button onclick="openInviteUserModal()" style="background:#0129AC;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">+ Invite User</button>' +
    '</div>' +
    '<div style="margin-bottom:14px"><input type="text" id="userSearchInput" placeholder="Search by name or email..." oninput="window._filterUsers(this.value)" style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:14px;box-sizing:border-box;outline:none"></div>' +
    '<div id="userTableWrap" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr style="background:var(--bg3)">' +
    '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);width:30%">User</th>' +
    '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);width:15%">Role</th>' +
    '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);width:12%">Status</th>' +
    '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);width:15%">Last Login</th>' +
    '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);width:28%">Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';

  // Filter chips
  window._umFilter = function(filter) {
    qsa('.um-filter-chip').forEach(function(chip) {
      chip.style.border = chip.dataset.filter === filter ? '2px solid #0129AC' : '2px solid transparent';
    });
    qsa('tr[data-um-status]').forEach(function(row) {
      row.style.display = (filter === 'all' || row.dataset.umStatus === filter) ? '' : 'none';
    });
    qsa('tr[data-um-invite]').forEach(function(row) {
      row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
    });
  };

  // Role change handlers
  qsa('.um-role-sel').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      var uid = sel.dataset.uid;
      try {
        await api('/api/users/' + uid, 'PUT', { role: sel.value });
        toast('Role updated');
      } catch (e) { /* shown by api */ }
    });
  });

  // Activate/deactivate handlers
  qsa('.um-toggle-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var uid = btn.dataset.uid;
      var isActive = btn.dataset.active === 'true';
      var ok = await confirmDialog((isActive ? 'Deactivate' : 'Activate') + ' this user?');
      if (!ok) return;
      try {
        await api('/api/users/' + uid, 'PUT', { is_active: !isActive });
        toast('User ' + (isActive ? 'deactivated' : 'activated'));
        renderUserManagement();
      } catch (e) {}
    });
  });

  // Reset password handlers
  qsa('.um-pwd-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openResetPasswordModal(btn.dataset.uid, btn.dataset.uname);
    });
  });
}

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
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Database Connection <span class="badge badge-success" style="margin-left:8px;font-size:11px">🟢 Live</span></h3>' +
    '<div class="admin-field-row"><div class="admin-field-label">Host</div><code style="font-size:12px;background:var(--bg3);padding:3px 8px;border-radius:4px">localhost:5432</code></div>' +
    '<div class="admin-field-row"><div class="admin-field-label">Database</div><code style="font-size:12px;background:var(--bg3);padding:3px 8px;border-radius:4px">sprintboard</code></div>' +
    '<div class="admin-field-row"><div class="admin-field-label">User</div><code style="font-size:12px;background:var(--bg3);padding:3px 8px;border-radius:4px">postgres</code></div>' +
    '<div class="admin-field-row"><div class="admin-field-label">Status</div><span class="badge badge-success">🟢 Active — All data persisted</span></div>' +
    '<div class="admin-field-row"><div class="admin-field-label">Tables</div><span style="font-size:13px;color:var(--text)">18 tables · scrypt password hashing · session-based auth</span></div>' +
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
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Require Mixed Case</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" checked disabled><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Require Special Characters</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" checked disabled><span class="toggle-slider"></span></label>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Access Control</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Invite-Only Registration</div><div class="admin-field-desc">New users can only join via admin invite</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" checked disabled><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Admin User Creation</div><div class="admin-field-desc">Only admins and owners can create users</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" checked disabled><span class="toggle-slider"></span></label>' +
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
    var rolesel = '<select class="input input-sm um-role-sel" data-uid="' + u.id + '" style="font-size:13px;height:30px;border-radius:6px;padding:0 8px;min-width:110px"' + (u.id===me.id?' disabled':'') + '>' + ['owner','admin','member'].map(function(r){ return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+cap(r)+'</option>'; }).join('') + '</select>';
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
        popupAlert('Role Updated', 'User role changed to ' + cap(sel.value) + ' successfully.', 'success');
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
    { action: 'Create Space',       owner: true,  admin: true,  member: false },
    { action: 'Delete Space',       owner: true,  admin: true,  member: false },
    { action: 'Manage Space Members', owner: true, admin: true, member: false },
    { action: 'Invite Users',       owner: true,  admin: true,  member: false },
    { action: 'Manage User Roles',  owner: true,  admin: true,  member: false },
    { action: 'Create Issue',       owner: true,  admin: true,  member: true  },
    { action: 'Edit Issue',         owner: true,  admin: true,  member: true  },
    { action: 'Delete Issue',       owner: true,  admin: true,  member: false },
    { action: 'Create Sprint',      owner: true,  admin: true,  member: false },
    { action: 'Start/Complete Sprint', owner: true, admin: true, member: false },
    { action: 'Add Comments',       owner: true,  admin: true,  member: true  },
    { action: 'Log Work',           owner: true,  admin: true,  member: true  },
    { action: 'Manage Custom Fields', owner: true, admin: true, member: false },
    { action: 'View Admin Settings', owner: true, admin: true,  member: false },
    { action: 'Deactivate Users',   owner: true,  admin: true,  member: false },
  ];

  var rows = perms.map(function(p) {
    return '<tr>' +
      '<td style="font-size:13px">' + p.action + '</td>' +
      '<td class="' + (p.owner?'perm-check':'perm-cross') + '">' + (p.owner?'✓':'—') + '</td>' +
      '<td class="' + (p.admin?'perm-check':'perm-cross') + '">' + (p.admin?'✓':'—') + '</td>' +
      '<td class="' + (p.member?'perm-check':'perm-cross') + '">' + (p.member?'✓':'—') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🛡️ Roles &amp; Permissions</h2>' +
    '<p>Overview of what each role can do in the workspace.</p>' +
    '</div>' +

    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    '<table class="perm-table"><thead><tr>' +
    '<th style="width:55%">Permission</th>' +
    '<th style="width:15%;text-align:center">Owner</th>' +
    '<th style="width:15%;text-align:center">Admin</th>' +
    '<th style="width:15%;text-align:center">Member</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '</div>' +

    '<div class="admin-card" style="margin-top:16px">' +
    '<h3>Role Descriptions</h3>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">👑 Owner</div><div class="admin-field-desc">Full control — created the organization. Can manage billing, delete org, all permissions.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">🛡️ Admin</div><div class="admin-field-desc">Can manage users, spaces, and all settings. Cannot delete the organization.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">👤 Member</div><div class="admin-field-desc">Can create and edit issues, add comments and log work. No admin capabilities.</div></div></div>' +
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

// ── Image paste in description (base64 inline) ─────────────
document.addEventListener('paste', function(e) {
  var active = document.activeElement;
  if (!active || (active.id !== 'drawerDesc' && active.id !== 'drawerFixDesc')) return;
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === -1) continue;
    e.preventDefault();
    var file = items[i].getAsFile();
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result;
      var img = document.createElement('img');
      img.src = base64;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '4px';
      img.style.margin = '8px 0';
      img.style.display = 'block';
      // Insert at cursor position
      var sel = window.getSelection();
      if (sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        // Move cursor after image
        range.setStartAfter(img);
        range.setEndAfter(img);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        active.appendChild(img);
      }
      // Autosave with innerHTML to preserve image
      var field = active.id === 'drawerDesc' ? 'description' : 'fix_description';
      autoSave(field, active.innerHTML.trim());
    };
    reader.readAsDataURL(file);
    break;
  }
});

// ── Clickable issue type badge (like Jira) ─────────────────
document.addEventListener('click', function(e) {
  var typeEl = document.getElementById('drawerType');
  if (!typeEl || !typeEl.contains(e.target)) return;
  // Remove existing menu
  var old = document.getElementById('typeDropdownMenu');
  if (old) { old.remove(); return; }
  var types = ['epic','story','task','bug','subtask'];
  var icons = {
    epic: '<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:#9747FF;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:14px">E</span>',
    story: '<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:#36B37E;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:14px">S</span>',
    task: '<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:#0052CC;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:14px">T</span>',
    bug: '<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:#FF5630;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:14px">B</span>',
    subtask: '<span style="display:inline-block;width:14px;height:14px;border-radius:2px;background:#0065FF;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:14px">ST</span>'
  };
  var rect = typeEl.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.id = 'typeDropdownMenu';
  menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;' +
    'background:var(--bg2);border:1px solid var(--border);border-radius:6px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:9999;min-width:160px;padding:4px;';
  body.light && (menu.style.background = '#fff');
  types.forEach(function(t) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:13px;border-radius:4px;display:flex;align-items:center;gap:8px;';
    item.innerHTML = '<span>' + icons[t] + '</span><span>' + (t.charAt(0).toUpperCase() + t.slice(1)) + '</span>';
    item.onmouseover = function() { this.style.background = 'var(--bg3)'; };
    item.onmouseout = function() { this.style.background = ''; };
    item.onclick = function() {
      menu.remove();
      // Update badge immediately
      typeEl.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      typeEl.className = 'badge badge-type badge-type-' + t;
      // Save via autoSave
      if (window._drawerAutoSave) window._drawerAutoSave('type', t);
      else {
        var issueId = window.S && S.drawerIssueId;
        if (issueId) {
          fetch('/api/issues/' + issueId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAuthToken() },
            body: JSON.stringify({ type: t })
          }).then(function() { toast('Type updated'); });
        }
      }
    };
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function handler(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', handler); }
    });
  }, 100);
});

// ── All Work inline edit functions ─────────────────────────
function _awRemoveMenu() {
  var m = document.getElementById('_awInlineMenu');
  if (m) m.remove();
}

function _awShowMenu(e, items, onSelect) {
  _awRemoveMenu();
  var menu = document.createElement('div');
  menu.id = '_awInlineMenu';
  menu.style.cssText = 'position:fixed;top:'+(e.clientY+4)+'px;left:'+e.clientX+'px;background:#ffffff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 8px 16px rgba(9,30,66,0.25);z-index:9999;min-width:240px;padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:300px;overflow-y:auto;';
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
  setTimeout(function() {
    document.addEventListener('click', function h() { _awRemoveMenu(); document.removeEventListener('click', h); });
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
  'Done':       'background:#00875a;color:#ffffff'
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
  var statuses = ['To Do','In Progress','In Review','Done'];
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
      updateStatusBtn(s);
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
  var statuses = ['To Do','In Progress','In Review','Done'];
  var items = statuses.map(function(s) {
    var check = s === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: s, html: '<span style="font-size:14px;color:#172b4d;flex:1">' + s + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    api('/api/issues/' + issueId, 'PUT', { status: val }).then(function() {
      refreshData().then(renderAllWork);
      toast('Status updated');
    });
  });
}

function awInlinePriority(e, issueId, current) {
  e.stopPropagation();
  var priorities = ['highest','high','medium','low','lowest'];
  var items = priorities.map(function(p) {
    var check = p === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: p, html: '<span style="font-size:14px;color:#172b4d;flex:1;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">' + cap(p) + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    api('/api/issues/' + issueId, 'PUT', { priority: val }).then(function() {
      refreshData().then(renderAllWork);
      toast('Priority updated');
    });
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
function copyDrawerLink() {
  // Use current issue key saved when drawer opened
  var issueKey = window._currentIssueKey || (window.S && S.drawerIssueId);
  var url = window.location.origin + '/?issue=' + encodeURIComponent(issueKey);
  navigator.clipboard.writeText(url).then(function() {
    toast('Link copied!');
  }).catch(function() {
    var el = document.createElement('input');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('Link copied!');
  });
}

// ── Browser back button support ─────────────────────────
window.addEventListener("popstate", function(e) {
  if (window._navigatingBack) return;
  window._navigatingBack = true;
  goBackToSavedPage();
});






// ── Back button from issue ──────────────────────────────
function goBackFromIssue() {
  _exitIssuePage();
  history.replaceState(null, '', window.location.pathname);
  var returnTab = S._prevTab || window._issueReturnTab || 'allwork';
  var returnSpace = S._prevSpace || window._issueReturnSpace || S.currentSpace;
  window._issueReturnTab = null;
  window._issueReturnSpace = null;
  if (returnSpace) {
    S.currentSpace = returnSpace;
    // Show space nav
    var spaceNavEl = $('spaceNav');
    if (spaceNavEl) spaceNavEl.removeAttribute('hidden');
    qsa('.space-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.spaceId === returnSpace);
    });
    renderTab(returnTab);
  } else {
    navigateTo('home');
  }
}

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

// Description paste handler - clean formatting
(function() {
  function initDescPaste() {
    var descEl = document.getElementById("issueDescription");
    if (descEl == null || descEl._pasteInit) return;
    descEl._pasteInit = true;
    descEl.addEventListener('paste', function(e) {
      e.preventDefault();
      // Handle image paste
      var items = e.clipboardData && e.clipboardData.items;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            var file = items[i].getAsFile();
            if (file) {
              var reader = new FileReader();
              reader.onload = function(ev) {
                var img = document.createElement('img');
                img.src = ev.target.result;
                img.style.maxWidth = '100%';
                img.style.borderRadius = '4px';
                img.style.margin = '4px 0';
                img.style.display = 'block';
                var sel = window.getSelection();
                if (sel.rangeCount) {
                  var range = sel.getRangeAt(0);
                  range.deleteContents();
                  range.insertNode(img);
                  range.setStartAfter(img);
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        }
      }
      var text = '';
      if (e.clipboardData) {
        var html = e.clipboardData.getData('text/html');
        if (html) {
          var tmp = document.createElement("div"); tmp.innerHTML = html;
          tmp.querySelectorAll("*").forEach(function(el) { el.removeAttribute("class"); el.removeAttribute("id"); var s=el.getAttribute("style")||""; var k=""; if(s.includes("bold"))k+="font-weight:bold;"; if(s.includes("italic"))k+="font-style:italic;"; if(s.includes("underline"))k+="text-decoration:underline;"; if(k)el.setAttribute("style",k); else el.removeAttribute("style"); });
          tmp.querySelectorAll("span:empty").forEach(function(s){s.remove();});
          text = tmp.innerHTML;
        } else {
          text = e.clipboardData.getData("text/plain");
          // Auto-convert URLs to clickable links
          text = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#0129AC;text-decoration:underline" target="_blank">$1</a>');
          text = text.replace(/\n\n+/g,"<br><br>").replace(/\n/g,"<br>");
        }
      }
      document.execCommand('insertHTML', false, text);
    });
  }
  // Init on modal open
  var origOpen = window.openModal;
  window.openModal = function(id) {
    origOpen && origOpen(id);
    if (id === 'modal-issue') setTimeout(initDescPaste, 100);
  };
})();

// Description Save/Cancel buttons
(function() {
  function initDescButtons() {
    var descEl = document.getElementById('issueDescription');
    var btnDiv = document.getElementById('descActionBtns');
    descEl._btnInit = true;
    var originalContent = '';
    descEl.addEventListener('focus', function() {
      originalContent = descEl.innerHTML;
      btnDiv.style.display = 'flex';
    });
    window._saveDesc = function() {
      btnDiv.style.display = 'none';
    };
    window._cancelDesc = function() {
      descEl.innerHTML = originalContent;
      btnDiv.style.display = 'none';
    };
  }
  var origOpen = window.openModal;
  window.openModal = function(id) {
    origOpen && origOpen(id);
    if (id === 'modal-issue') setTimeout(initDescButtons, 150);
  };
})();

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
  function linkify(el,field){
    if(!el||el._lf)return;
    el._lf=true;
    el.addEventListener("blur",function(){
      var h=el.innerHTML;
      var h2=h.replace(/(?<!href=")(https?:\/\/[^\s<"]+)/g,'<a href="$1" style="color:#0129AC;text-decoration:underline;cursor:pointer" target="_blank">$1</a>');
      if(h2!==h){el.innerHTML=h2;autoSave(field,h2.trim());}
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
    var issues = (S.data && S.data.issues || [])
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
    var issues = (S.data && S.data.issues || []).filter(function(i) {
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
        if (issue) openIssuePage(issue.id, issue.key);
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
  // Also init after app data loads
  var _gsOrigInit = window._afterDataLoad;
  window._gsLateInit = function() { gsInit(); };
  setTimeout(function(){ gsInit(); }, 1200);
})();

document.addEventListener('DOMContentLoaded', function() {
  const submitBtn = document.querySelector('[onclick*="submitIssueForm"]') || document.querySelector('button[type="submit"]');
  
  if (submitBtn) {
    const originalClick = submitBtn.onclick;
    submitBtn.onclick = function(e) {
      const team = document.getElementById('issueTeam')?.value || '';
      const productType = document.getElementById('issueProductType')?.value || '';
      const createdAt = new Date().toISOString();
      
      window.issueTeamValue = team;
      window.issueProductTypeValue = productType;
      window.issueCreatedAt = createdAt;
      
      console.log('Team:', team, 'Product Type:', productType);
      
      if (originalClick) return originalClick.call(this, e);
    };
  }
  
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      const team = document.getElementById('issueTeam')?.value || '';
      const productType = document.getElementById('issueProductType')?.value || '';
      
      if (e.target.method && e.target.method.toUpperCase() === 'POST') {
        const formData = new FormData(e.target);
        formData.append('team', team);
        formData.append('productType', productType);
        formData.append('createdAt', new Date().toISOString());
      }
    });
  });
});

var _gsTimer=null;
window._globalSearch=function(query){
  var box=document.getElementById("globalSearchResults");
  if(!box)return;
  var q=(query||"").trim();
  if(q.length<2){box.style.display="none";return;}
  box.innerHTML="<div style=\"padding:12px 16px;color:var(--text3);font-size:13px\">Searching...</div>";
  box.style.display="block";
  clearTimeout(_gsTimer);
  _gsTimer=setTimeout(async function(){
    try{
      var r=await api("/api/issues/search?q="+encodeURIComponent(q));
      if(!r||!r.length){box.innerHTML="<div style=\"padding:12px 16px;color:var(--text3);font-size:13px\">No results found</div>";return;}
      box.innerHTML=r.slice(0,15).map(function(i){
        var sc=i.status==="Done"?"#36b37e":i.status==="In Progress"?"#0129AC":"#42526e";
        return "<div onclick=\"window._gsg(\x27"+i.id+"\x27)\" style=\"padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px\">"+"<span style=\"font-size:11px;font-weight:700;color:#0129AC;min-width:70px\">"+i.key+"</span>"+"<span style=\"flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">"+i.title+"</span>"+"<span style=\"font-size:11px;color:"+sc+";font-weight:600\">"+i.status+"</span></div>";
      }).join("");
    }catch(e){box.innerHTML="<div style=\"padding:12px\">Error</div>";}
  },300);
};
window._gsg=function(id){
  var b=document.getElementById("globalSearchResults");
  var inp=document.getElementById("globalSearchInput");
  if(b)b.style.display="none";
  if(inp)inp.value="";
  openIssuePage(id);
};
document.addEventListener("click",function(e){
  var b=document.getElementById("globalSearchResults");
  var inp=document.getElementById("globalSearchInput");
  if(b&&inp&&e.target!==inp&&!b.contains(e.target))b.style.display="none";
});

async function renderDeletedTickets(el) {
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading deleted tickets...</div>';
  try {
    var tickets = await api('/api/issues/deleted');
    if (!tickets || !tickets.length) {
      el.innerHTML = '<div style="padding:24px;color:var(--text3);text-align:center;font-size:14px">No deleted tickets found.</div>';
      return;
    }
    var html = '<div style="padding:0 0 16px"><h3 style="margin:0 0 4px;font-size:16px">Deleted Tickets</h3><p style="color:var(--text3);font-size:13px;margin:0">' + tickets.length + ' ticket(s) in bin</p></div>';
    html += '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr style="background:var(--bg3);color:var(--text2)"><th style="padding:10px 12px;text-align:left">Key</th><th style="padding:10px 12px;text-align:left">Title</th><th style="padding:10px 12px;text-align:left">Status</th><th style="padding:10px 12px;text-align:left">Deleted At</th><th style="padding:10px 12px;text-align:left">Action</th></tr></thead><tbody>';
    tickets.forEach(function(t) {
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:10px 12px;font-weight:700;color:#0129AC">' + esc(t.key||'') + '</td>' +
        '<td style="padding:10px 12px">' + esc(t.title||'No title') + '</td>' +
        '<td style="padding:10px 12px">' + esc(t.status||'') + '</td>' +
        '<td style="padding:10px 12px;color:var(--text3);font-size:12px">' + fmtDateTime(t.deleted_at) + '</td>' +
        '<td style="padding:10px 12px"><button class="btn btn-sm btn-outline" onclick="window._restoreTicket(\'' + t.id + '\',this)">∩ Restore</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
    window._restoreTicket = async function(id, btn) {
      btn.disabled = true; btn.textContent = 'Restoring...';
      try {
        await api('/api/issues/' + id + '/restore', 'POST');
        toast('Ticket restored successfully', 'success');
        await refreshData();
        renderDeletedTickets(el);
      } catch(e) {
        toast('Failed to restore ticket', 'error');
        btn.disabled = false; btn.textContent = '∩ Restore';
      }
    };
  } catch(err) {
    el.innerHTML = '<div style="padding:20px;color:red">Error loading deleted tickets</div>';
  }
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
