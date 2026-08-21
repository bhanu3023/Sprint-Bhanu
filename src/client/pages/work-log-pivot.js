
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
