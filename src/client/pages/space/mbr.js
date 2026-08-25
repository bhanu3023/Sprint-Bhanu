
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
      // silent: the catch renders its own 'Achievements save failed - <why>'
      var updated = await api('/api/sprints/' + sprintId, 'PUT', { achievements: achievements }, { silent: true });
      var cached = (S.data.sprints || []).find(function (sp) { return sp.id === sprintId; });
      if (cached) cached.achievements = updated.achievements;
      if (_mbrData) {
        var mbrSp = (_mbrData.completed_sprints || []).find(function (sp) { return sp.id === sprintId; });
        if (mbrSp) mbrSp.achievements = updated.achievements;
      }
      toast((sprintName(sprintId) || 'Sprint') + ' achievements saved', 'success');
      close();
      if (_mbrActiveTab === 'achievements') renderMBRAchievements($('mbrTabContent'), _mbrData);
    } catch (e) {
      toast('Achievements save failed — ' + errorReason(e), 'error');
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
