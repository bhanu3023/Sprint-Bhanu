
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
      heroAv.innerHTML = '<img src="' + esc(me.avatar_url) + '" alt="' + escAttr(me.name || '') + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
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
