
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

