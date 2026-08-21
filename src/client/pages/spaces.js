
// ═══════════════════════════════════════════════════════════
// SPACES VIEW
// ═══════════════════════════════════════════════════════════
var _spacesViewQuery = '';

function renderSpacesView() {
  var allSpaces = (S.data.spaces || []).filter(function(s) { return !s.is_archived; });
  var isOwnerOrAdmin = canCreateSpace();
  var spaces = isOwnerOrAdmin ? allSpaces : allSpaces.filter(function(s) {
    return (S.data.space_members || []).some(function(m) {
      return m.space_id === s.id && m.user_id === S.currentUser;
    });
  });

  var countEl = $('spacesViewCount');
  if (countEl) countEl.textContent = spaces.length;

  // Wire create button to existing new-space flow
  var createBtn = $('spacesViewCreateBtn');
  if (createBtn) {
    createBtn.onclick = function() {
      var nb = $('newSpaceBtn'); if (nb) nb.click();
    };
    createBtn.style.display = isOwnerOrAdmin ? '' : 'none';
  }

  // Search filter
  window._filterSpacesView = function(q) {
    _spacesViewQuery = (q || '').toLowerCase();
    _drawSpacesGrid(spaces);
  };

  _drawSpacesGrid(spaces);
}

function _drawSpacesGrid(spaces) {
  var grid = $('spacesViewGrid');
  if (!grid) return;
  var q = _spacesViewQuery;
  var filtered = q ? spaces.filter(function(s) {
    return (s.name || '').toLowerCase().indexOf(q) !== -1 ||
           (s.key  || '').toLowerCase().indexOf(q) !== -1;
  }) : spaces;

  if (!filtered.length) {
    grid.innerHTML = '<p class="text-muted" style="font-size:14px;padding:32px 0">No spaces found.</p>';
    return;
  }
  var html = '';
  filtered.forEach(function(sp) {
    var color = sp.color || '#0129ac';
    var mems = getSpaceMembers(sp.id);
    var issCount = getSpaceIssues(sp.id).length;
    html += '<div class="db-space-card" style="--db-sc-color:' + color + '" onclick="navigateToSpace(\'' + sp.id + '\')">' +
      '<div class="db-sc-head">' +
      '<div class="db-sc-avatar" style="background:' + color + '">' + (sp.name ? sp.name.charAt(0).toUpperCase() : '?') + '</div>' +
      '<div class="db-sc-info"><div class="db-sc-name">' + esc(sp.name) + '</div><div class="db-sc-key">' + esc(sp.key) + '</div></div>' +
      '</div>' +
      '<div class="db-sc-desc">' + esc(sp.description || 'No description') + '</div>' +
      '<div class="db-sc-footer"><div class="db-sc-meta">' +
      '<span class="db-sc-stat"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 5a5 5 0 0 0-10 0h10z"/></svg> ' + mems.length + ' member' + (mems.length !== 1 ? 's' : '') + '</span>' +
      '<span class="db-sc-stat"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13z"/></svg> ' + issCount + ' issue' + (issCount !== 1 ? 's' : '') + '</span>' +
      '</div></div>' +
      '</div>';
  });
  grid.innerHTML = html;
}
