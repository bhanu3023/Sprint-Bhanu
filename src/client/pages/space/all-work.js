
// ═══════════════════════════════════════════════════════════
// ALL WORK TAB
// ═══════════════════════════════════════════════════════════
// Populate assignee + sprint filter dropdowns from live DB data
// ── Advanced Filter Panel (Jira-style) ───────────────────────────────

// All available filter fields
var AW_FILTER_FIELDS = [
  { key: 'type',      label: 'Type',       kind: 'multi',
    opts: enumOpts(ISSUE_TYPES) },
  { key: 'status',    label: 'Status',     kind: 'multi',
    opts: enumOpts(ISSUE_STATUSES) },
  { key: 'priority',  label: 'Priority',   kind: 'multi',
    opts: enumOpts(ISSUE_PRIORITIES) },
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
  // Same reasoning as the columns fix: Product Type, Team and Description are
  // builtin fields whose real value lives on the issue row itself, never in
  // issue_field_values, so filtering them through the generic cf_<id> path
  // (like _awGetCFFilterFields() used to offer) would silently match nothing.
  // opts for productType/team are filled in by _awLoadDynamicOpts() from the
  // space's own custom_fields.options, the same source _awGetCFFilterFields()
  // would have used -- so this doesn't hardcode a fixed option list that
  // could drift from what's actually configured for the space.
  { key: 'productType', label: 'Product Type', kind: 'multi', opts: [] },
  { key: 'team',         label: 'Team',          kind: 'multi', opts: [] },
  { key: 'desc',         label: 'Description',   kind: 'cftext' },
];

// Which fields are currently shown as rows in the panel
var _awActiveFields = [];

// Persist the All Work advanced filters (which fields are shown, plus every
// value including custom-field ones like Combination) to localStorage, keyed
// per space. Before this, the whole thing -- _awActiveFields and S.awFilters
// -- lived only in memory, so a hard refresh reset it to defaults exactly
// like starting the app fresh; there was never anywhere it survived to.
function _awFilterStorageKey() {
  return S.currentSpace ? ('aw-filters-' + S.currentSpace) : null;
}
function _awSaveFilterState() {
  var key = _awFilterStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ activeFields: _awActiveFields, filters: S.awFilters }));
  } catch (e) { /* storage unavailable/full -- filters just won't persist this time */ }
}
function _awLoadFilterState() {
  // One-shot override for "Total Issues" on Summary -- set (synchronously,
  // before navigation starts) by _statCardClick, consumed here rather than
  // via a setTimeout in the caller. The 'allwork' case's own data refresh is
  // a real network call of unpredictable duration, so a fixed-delay timeout
  // clearing filters AFTER navigating would race this exact function and
  // could lose either way depending on how long that refresh took. Reading
  // the flag from inside the function this restore always runs through
  // removes the race instead of hoping to win it.
  if (window._awShowAllOverride) {
    window._awShowAllOverride = false;
    S.awFilters = {
      type: [], status: [], priority: [], assignee: [], sprint: [],
      productType: [], team: [], desc: '',
      createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
      dueDateFrom: '', dueDateTo: '', startDateFrom: '', startDateTo: ''
    };
    _awActiveFields = [];
    return;
  }
  var key = _awFilterStorageKey();
  if (!key) return;
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.activeFields)) _awActiveFields = parsed.activeFields;
    if (parsed && parsed.filters && typeof parsed.filters === 'object') {
      // Merge onto the default shape rather than replacing outright, so a
      // stored blob from before some field existed still has every key the
      // rest of the filter code expects to find.
      S.awFilters = Object.assign({
        type: [], status: [], priority: [], assignee: [], sprint: [],
        productType: [], team: [], desc: '',
        createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
        dueDateFrom: '', dueDateTo: '', startDateFrom: '', startDateTo: ''
      }, parsed.filters);
    }
  } catch (e) { /* corrupt/unavailable storage -- fall back to current defaults silently */ }
}

// Distinct values ACTUALLY saved for one custom multi-select field, scoped to
// issues in the current space. Combination stores a structured
// {combinations:[...], productTypes:[...]} value (or a bare string for the
// simple single-combination case) rather than the plain comma-joined string
// every other multi_select custom field uses -- see the multi-select custom
// field filter block in renderAllWork() for that plain-comma-joined
// convention -- so it's parsed with parsePtComboSelection and only its real
// .combinations are counted; productTypes is a different field entirely and
// has nothing to do with this one.
function _awDistinctCFOptions(field) {
  var spaceIssueIds = {};
  getSpaceIssues(S.currentSpace).forEach(function (i) { spaceIssueIds[i.id] = true; });
  var seen = {}, out = [];
  function add(v) {
    if (v == null) return;
    v = String(v).trim();
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  }
  (S.data.issue_field_values || []).forEach(function (fv) {
    if (fv.field_id != field.id || !fv.value || !spaceIssueIds[fv.issue_id]) return;
    if (isCombinationField(field)) {
      parsePtComboSelection('', fv.value).combinations.forEach(add);
    } else {
      String(fv.value).split(',').forEach(add);
    }
  });
  return out.sort(function (a, b) { return a.localeCompare(b); }).map(function (v) { return { v: v, l: v }; });
}

// Build filter field defs from space custom fields. Excludes builtin fields
// (Product Type, Team, Description, etc. -- see DONE_BUILTIN_READERS) for the
// same reason _awGetCFColumns() does: their real value lives on the issue row
// itself, never in issue_field_values, so a cf_<id> filter for one of them
// would silently match nothing no matter what the user picks. Those three now
// have proper native entries in AW_FILTER_FIELDS instead. Genuinely custom
// fields like Combination, which really do store in issue_field_values, are
// unaffected.
function _awGetCFFilterFields() {
  return (S.data.custom_fields || [])
    .filter(function(f){ return f.space_id == S.currentSpace && !DONE_BUILTIN_READERS[f.field_key]; })
    .map(function(f) {
      var kind = (f.field_type === 'select' || f.field_type === 'multi_select') ? 'multi'
               : (f.field_type === 'date') ? 'cfdate'
               : 'cftext';
      var fd = { key: 'cf_' + f.id, label: f.name, kind: kind, cfId: f.id, cfType: f.field_type };
      if (kind === 'multi') {
        // Distinct values ACTUALLY saved on this space's issues for this
        // field, not the field's configured option list -- same reasoning as
        // _awDistinctOpts above: a configured option nobody's used yet would
        // otherwise show up as filterable-but-matches-nothing, and the config
        // can drift from reality over time. This object is rebuilt fresh on
        // every call (see _awGetFieldDef), so there's nowhere to persist a
        // dynamically-loaded value the way the static AW_FILTER_FIELDS entries
        // do -- computing it inline here every time is the correct fix rather
        // than a workaround.
        fd.opts = _awDistinctCFOptions(f);
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
// Distinct values ACTUALLY present on this space's issues right now, for one
// field. Deliberately not the DB's fixed enum, not the space's member/sprint
// list, and not a custom field's configured options -- any of those three
// can drift from what's really on tickets (an option nobody's used yet, a
// member no ticket is assigned to, an option since removed from config but
// still saved somewhere). extract(issue) returns an array of raw values found
// on that issue (usually one, but product_type is a comma-joined multi-value
// string); label(value) formats it for display, defaulting to the raw value.
function _awDistinctOpts(extract, label) {
  var seen = {}, out = [];
  getSpaceIssues(S.currentSpace).forEach(function (iss) {
    (extract(iss) || []).forEach(function (v) {
      if (v == null || v === '') return;
      var key = String(v);
      if (seen[key]) return;
      seen[key] = true;
      out.push(v);
    });
  });
  return out.map(function (v) { return { v: v, l: label ? label(v) : v }; })
    .sort(function (a, b) { return String(a.l).localeCompare(String(b.l)); });
}

async function _awLoadDynamicOpts() {
  _awGetFieldDef('type').opts     = _awDistinctOpts(function(i){ return [i.type]; }, typeLabel);
  _awGetFieldDef('status').opts   = _awDistinctOpts(function(i){ return [i.status]; });
  _awGetFieldDef('priority').opts = _awDistinctOpts(function(i){ return [i.priority]; }, cap);
  _awGetFieldDef('assignee').opts = _awDistinctOpts(function(i){ return [i.assignee_id]; }, function(v){
    var u = findUser(v); return u ? u.name : v;
  });
  _awGetFieldDef('sprint').opts   = _awDistinctOpts(function(i){ return [i.sprint_id]; }, function(v){
    var sp = (S.data.sprints || []).find(function(s){ return s.id == v; }); return sp ? sp.name : v;
  });
  _awGetFieldDef('productType').opts = _awDistinctOpts(function(i){
    return (i.product_type || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  });
  _awGetFieldDef('team').opts = _awDistinctOpts(function(i){ return [i.team]; });
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
                return '<label class="aw-adv-opt-row"><input type="checkbox" value="' + escAttr(String(o.v)) + '"' + chk +
                  ' onchange="window._awMultiToggle(\'' + key + '\',this)"> ' + esc(o.l) + '</label>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>';
    } else if (fd.kind === 'cftext') {
      var tv = S.awFilters[key] || '';
      valueHtml =
        '<input type="text" class="input input-sm" style="min-width:160px" value="' + escAttr(tv) + '" placeholder="Contains…"' +
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
    productType: [], team: [], desc: '',
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
  { key: 'fix_description', label: 'Fix Description',sortCol: null,           def: false },
  // These three had no native column at all -- only a generic cf_<id> one via
  // _awGetCFColumns(), which reads issue_field_values. Product Type, Team and
  // Description are builtin fields whose real value lives on the issue row
  // itself (issues.product_type/team/description, per DONE_BUILTIN_READERS),
  // never in issue_field_values, so that column always rendered "--" no
  // matter how much real data existed. Reading the issue property directly
  // instead, same as every other native column here already does.
  { key: 'product_type',    label: 'Product Type',   sortCol: null,           def: false },
  { key: 'team',            label: 'Team',            sortCol: null,           def: false },
  { key: 'description',     label: 'Description',    sortCol: null,           def: false },
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

// Get custom field columns for current space. Excludes any field whose
// field_key is one of DONE_BUILTIN_READERS's keys -- those store their real
// value directly on the issue row (issues.product_type, issues.team, etc.),
// never in issue_field_values, so a cf_<id> column for one of them would
// always render "--" and would just duplicate a column that already exists
// natively above (or, for product_type/team/description, the native column
// added above). Genuinely custom fields like Combination -- whose value
// really does live in issue_field_values -- still come through normally.
function _awGetCFColumns() {
  var spaceFields = (S.data.custom_fields || []).filter(function(f){
    return f.space_id == S.currentSpace && !DONE_BUILTIN_READERS[f.field_key];
  });
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
  // Every filter mutator (_awAddField, _awRemoveField, _awMultiToggle,
  // _awSetDate, _awSetCFText, _awClearFilters) calls renderAllWork() right
  // after changing _awActiveFields/S.awFilters, so this is the one place that
  // sees every change and can keep localStorage in sync with all of them.
  _awSaveFilterState();
  var search = ($('allWorkSearch') ? $('allWorkSearch').value : '').toLowerCase().trim();
  var f = S.awFilters;

  // _awAnyActive() checks every ACTIVE field generically by kind, so unlike
  // the fixed list this replaced, it correctly covers Product Type/Team/
  // Description and any custom field (Combination) too -- filtering by only
  // one of those used to leave the "Clear all" button hidden.
  var anyFilter = _awAnyActive();
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
  // Product Type / Team / Description read straight off the issue row, same
  // as the fields above -- see the AW_FILTER_FIELDS comment for why these
  // aren't handled through the generic custom-field filter block below.
  if (f.productType && f.productType.length) {
    issues = issues.filter(function(i) {
      var vals = (i.product_type || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      return f.productType.some(function(a){ return vals.indexOf(a) >= 0; });
    });
  }
  if (f.team && f.team.length) issues = issues.filter(function(i) { return f.team.indexOf(i.team) >= 0; });
  if (f.desc) {
    var descQ = f.desc.toLowerCase();
    issues = issues.filter(function(i) { return (i.description || '').toLowerCase().indexOf(descQ) >= 0; });
  }
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

  // Only an admin/site_admin of this space may select tickets and bulk-delete
  // (mirrors canDeleteIssue / the backend's ACTION_MIN_ROLE for issue.bulk).
  // A regular member gets no checkbox column at all -- there is nothing for
  // them to select, so an empty checkbox column would just be UI noise.
  var canBulkDelete = canDeleteIssue(S.currentSpace);
  var hasSelected = canBulkDelete && S.allWorkSelected.size > 0;
  var html = '';

  var bulkWrap = $('awBulkDeleteWrap');
  if (bulkWrap) {
    bulkWrap.style.display = hasSelected ? 'flex' : 'none';
    var bulkCountEl = $('awBulkDeleteCount');
    if (bulkCountEl) bulkCountEl.textContent = S.allWorkSelected.size + ' selected';
  }

  var visCols = _awGetVisibleCols();

  var PAGE_SIZE = 50;
  var totalIssues = issues.length;
  var pagedIssues = issues.slice(0, PAGE_SIZE * (S.allWorkPage || 1));

  html += '<table class="data-table" style="min-width:1200px;width:100%"><thead><tr>' +
    (canBulkDelete ? ('<th><input type="checkbox" id="allWorkSelectAll"' + (S.allWorkSelected.size === issues.length && issues.length > 0 ? ' checked' : '') + '></th>') : '') +
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
      (canBulkDelete ? ('<td onclick="event.stopPropagation()"><input type="checkbox" data-issue-check="' + iid + '"' + checked + '></td>') : '') +
      visCols.map(function(col) {
        var cell = '';
        switch(col.key) {
          case 'key':             cell = '<td class="issue-key" onclick="' + nav + '" style="white-space:nowrap;width:90px;min-width:90px">' + esc(issueKeyStr(iss)) + '</td>'; break;
          case 'title':           cell = '<td onclick="' + nav + '" style="min-width:200px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(iss.title) + '</td>'; break;
          case 'type':            cell = '<td onclick="' + nav + '"><span class="type-cell">' + typeIcon(iss.type) + '<span class="type-cell-label">' + cap(iss.type) + '</span></span></td>'; break;
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
          case 'fix_description': cell = '<td onclick="' + nav + '">' + (iss.fix_description ? esc(iss.fix_description.slice(0,60)) + (iss.fix_description.length>60?'…':'') : '\u2014') + '</td>'; break;
          case 'product_type':    cell = '<td onclick="' + nav + '">' + (iss.product_type ? esc(iss.product_type.split(',').map(function(t){ return t.trim(); }).join(', ')) : '—') + '</td>'; break;
          case 'team':             cell = '<td onclick="' + nav + '">' + (iss.team ? esc(iss.team) : '—') + '</td>'; break;
          case 'description':      cell = '<td onclick="' + nav + '">' + (iss.description ? esc(iss.description.slice(0,60)) + (iss.description.length>60?'…':'') : '—') + '</td>'; break;
          default:
            // Custom field column (cf_<fieldId>)
            if (col.key.indexOf('cf_') === 0) {
              var cfId = col.cfId || col.key.replace('cf_','');
              var cfVal = (S.data.issue_field_values || []).find(function(v){ return v.issue_id == iss.id && v.field_id == cfId; });
              var cfField = (S.data.custom_fields || []).find(function(f){ return f.id == cfId; });
              var cfDisplay = cfVal && cfVal.value
                ? (isCombinationField(cfField) ? formatCombinationFieldDisplayValue(cfVal.value) : cfVal.value)
                : '';
              cell = '<td onclick="' + nav + '">' + (cfDisplay ? esc(cfDisplay) : '\u2014') + '</td>';
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

}

window._bulkDelete = async function () {
  var ids = Array.from(S.allWorkSelected);
  if (!ids.length) return;
  var rows = ids.map(function (id) {
    return (S.data.issues || []).find(function (i) { return i.id === id; });
  }).filter(Boolean);
  // Refuse up front for any space the user can't delete in, rather than firing N
  // requests and collecting a pile of 403 toasts halfway through.
  var blocked = rows.filter(function (i) { return !canDeleteIssue(i.space_id); });
  if (blocked.length) {
    toast('Only a space admin can delete issues. ' + blocked.length + ' of the selected issues are in spaces you do not administer.', 'error');
    return;
  }
  // One ticket → type its key. Several → "delete all", so nobody has to paste
  // twenty keys but the phrase still can't be typed by accident.
  // Only take the single-key path when the ticket is actually in the cache —
  // otherwise there is no key to show and we fall back to the counted phrasing.
  var single = ids.length === 1 && rows.length === 1;
  var key = single ? (issueKeyStr(rows[0]) || ids[0]) : null;
  var ok = await typedConfirmDialog({
    title: single ? 'Delete ' + key + '?' : 'Delete ' + ids.length + ' issues?',
    intro: single
      ? (rows[0] && rows[0].title) || ''
      : (rows.slice(0, 6).map(function (i) { return issueKeyStr(i); }).join(', ') +
         (rows.length > 6 ? ' and ' + (rows.length - 6) + ' more' : '')) || (ids.length + ' selected tickets'),
    note: softDeleteNote(),
    phrase: single ? key : 'delete all',
    phraseHint: single ? 'To confirm, type the issue key' : 'To confirm, type',
    confirmLabel: single ? 'Delete issue' : 'Delete ' + ids.length + ' issues'
  });
  if (!ok) return;
  var done = 0, failed = 0;
  for (var i = 0; i < ids.length; i++) {
    try { await api('/api/issues/' + ids[i], 'DELETE', null, { silent: true }); done++; }
    catch (e) { failed++; }
  }
  S.allWorkSelected.clear();
  await refreshData();
  renderAllWork();
  if (failed) toast(done + ' of ' + (done + failed) + ' issues moved to Deleted Items — ' + failed + ' failed', 'error');
  else toast(done + ' issue' + (done === 1 ? '' : 's') + ' moved to Deleted Items', 'success');
};

window._bulkDeselect = function() {
  S.allWorkSelected.clear();
  renderAllWork();
};
