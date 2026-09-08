
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

  // Point-based groups (Story Points Completed/Remaining/Total, Team Workload's
  // Assigned/Completed/Remaining) show each issue's own point value so the
  // list visibly adds up to the tile's number, instead of mixing in 0/unpointed
  // issues that inflate the list without affecting the sum. Sorted highest
  // points first for the same reason -- the biggest contributors to that
  // number should be the first thing you see, not wherever they happened to
  // sit in the underlying issue list.
  var groupIssues = group.points
    ? group.issues.slice().sort(function(a, b) { return (Number(b.story_points) || 0) - (Number(a.story_points) || 0); })
    : group.issues;
  var rows = groupIssues.length
    ? groupIssues.map(function(iss) {
        var assignee = findUser(iss.assignee_id);
        var ptsBadge = group.points
          ? '<span style="font-size:11px;font-weight:700;color:#0052cc;background:#deebff;border-radius:10px;padding:2px 8px;flex-shrink:0">' + (Number(iss.story_points) || 0) + ' pt' + (Number(iss.story_points) === 1 ? '' : 's') + '</span>'
          : '';
        // showReporter is additive and off by default — only the combination-
        // by-upgrader drill-down (which needs "assigned to" AND "raised by"
        // side by side) turns it on, every other caller of this shared popup
        // is unaffected.
        var reporterHtml = '';
        if (group.showReporter) {
          var reporter = findUser(iss.reporter_id);
          var reporterName = (reporter && reporter.name) || iss.reporter_name || 'Unknown';
          reporterHtml = '<span style="font-size:11px;color:#6b778c;flex-shrink:0;white-space:nowrap">raised by <strong style="color:#172b4d">' + esc(reporterName) + '</strong></span>';
        }
        return '<div class="_reportDrillRow" data-id="' + iss.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'">' +
          '<span style="flex-shrink:0">' + typeIcon(iss.type) + '</span>' +
          '<span style="font-size:12px;font-weight:700;color:#6b778c;flex-shrink:0;min-width:64px">' + esc(issueKeyStr(iss)) + '</span>' +
          '<span style="flex:1;font-size:13px;color:#172b4d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(iss.title || '') + '</span>' +
          ptsBadge +
          reporterHtml +
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
          avatar + '<span style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px" title="' + escAttr(d.name) + '">' + esc(d.name) + '</span>' +
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
          '<div onclick="window._showReportIssues(\'sp_dev_' + d.safeKey + '\')" title="' + escAttr(d.name + ' — ' + d.count + ' spilled') + '" style="cursor:pointer;width:' + Math.max(w, 4) + '%;height:100%;background:#dc2626"></div>' +
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
        phraseHint: 'To confirm, type the issue key',
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
        toast(key + ' could not be removed from spillover — ' + errorReason(e), 'error');
        btn.disabled = false;
        btn.textContent = 'Remove';
      }
    });
  });
}
