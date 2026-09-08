
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
  var btn = $('notifBtn');
  if (unread > 0) {
    var shown = unread > 99 ? '99+' : String(unread);
    badge.textContent = shown;
    badge.classList.add('visible'); badge.removeAttribute('hidden');
    // aria-hidden alone does not satisfy axe's label-content-name-mismatch --
    // the badge's visible count has to be IN the accessible name, not just
    // absent from the accessibility tree, so a screen reader user gets the
    // same "how many" a sighted user sees at a glance.
    if (btn) btn.setAttribute('aria-label', 'Notifications: ' + shown + ' unread');
  } else {
    badge.classList.remove('visible'); badge.setAttribute('hidden',''); badge.textContent = '';
    if (btn) btn.setAttribute('aria-label', 'Notifications');
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
  toast('Could not open ' + issueLabelFor(issueKey) + ' — it may have been deleted', 'error');
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

  // Space board route: /space/ENG/board -- 'board' is the URL segment, but
  // the app's own tab for this view is named 'sprint' (Active Sprint); there
  // is no 'board' case in renderTab()'s switch, so navigating to it left the
  // content pane blank -- looked exactly like the click did nothing.
  var spaceBoardMatch = link.match(/^\/space\/([^/]+)\/board\/?$/i);
  if (spaceBoardMatch) {
    var sp = getSpaceByKey(decodeURIComponent(spaceBoardMatch[1]));
    if (sp) {
      navigateToSpace(sp.id, 'sprint');
      return true;
    }
  }

  // Space reports route: /space/ENG/reports -- sprint_completed's real link
  // target (notification-triggers.md), which the old 'board'-only regex
  // never matched at all. Reports is site_admin-only (permission-matrix.md);
  // a plain member sent there gets a permission toast instead of a redirect,
  // so send them to Backlog & Sprints instead -- the completed sprint's own
  // issues live there now (spilled back per sprint-lifecycle.md), so it is
  // still the right place to land, just not the reports view.
  var spaceReportsMatch = link.match(/^\/space\/([^/]+)\/reports\/?$/i);
  if (spaceReportsMatch) {
    var spr = getSpaceByKey(decodeURIComponent(spaceReportsMatch[1]));
    if (spr) {
      navigateToSpace(spr.id, canManageSpace(spr.id) ? 'reports' : 'backlog');
      return true;
    }
  }

  if (type === 'sprint_started' && spaceId) {
    navigateToSpace(spaceId, 'sprint');
    return true;
  }
  if (type === 'sprint_completed' && spaceId) {
    navigateToSpace(spaceId, canManageSpace(spaceId) ? 'reports' : 'backlog');
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
  var tIcons = { comment_added:'&#128172;', issue_assigned:'&#128100;', reporter_assigned:'&#128221;', status_changed:'&#128260;', priority_changed:'&#9889;', sprint_started:'&#128640;', sprint_completed:'&#9989;', issue_created:'&#128203;', mention:'@', space_created:'&#127970;', space_member_added:'&#128101;', space_role_changed:'&#128737;', org_member_joined:'&#128075;' };
  var tColors = { comment_added:'#0129AC', issue_assigned:'#7c3aed', reporter_assigned:'#0891b2', status_changed:'#059669', priority_changed:'#f59e0b', sprint_started:'#d97706', sprint_completed:'#059669', issue_created:'#0129AC', mention:'#dc2626', space_created:'#4f46e5', space_member_added:'#16a34a', space_role_changed:'#ea580c', org_member_joined:'#db2777' };
  var html = '';
  var limit = Math.min(sorted.length, 50);
  for (var i = 0; i < limit; i++) {
    var n = sorted[i];
    var icon = tIcons[n.type] || '&#128276;';
    var color = tColors[n.type] || '#0129AC';
    var isU = !n.is_read;
    html += '<div class="notif-item' + (isU ? ' unread' : '') + '" data-notif-id="' + esc(n.id) + '" data-notif-link="' + esc(n.link || '') + '" data-notif-type="' + esc(n.type || '') + '" data-notif-space-id="' + esc(n.space_id || '') + '" data-notif-title="' + escAttr(n.title || '') + '">' +
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
    toast('Could not open that notification — ' + errorReason(e), 'error');
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
