
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
