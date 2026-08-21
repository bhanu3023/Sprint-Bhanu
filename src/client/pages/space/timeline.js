
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
