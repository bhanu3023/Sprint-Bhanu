
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
