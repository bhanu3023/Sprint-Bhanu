
// ═══════════════════════════════════════════════════════════
// HTML BADGE / AVATAR HELPERS
// ═══════════════════════════════════════════════════════════
function statusBadge(status, noCaret) {
  var styles = {
    'To Do':      'background:#dfe1e6;color:#42526e',
    'In Progress':'background:#deebff;color:#0052cc',
    'In Review':  'background:#fff0b3;color:#974f0c',
    'Blocked':    'background:#ffebe6;color:#bf2600',
    'Done':       'background:#e3fcef;color:#006644'
  };
  var style = styles[status] || 'background:#dfe1e6;color:#42526e';
  // noCaret: read-only contexts that have no inline status editor wired up, so
  // the ▾ would advertise a dropdown that never opens.
  var caret = noCaret ? '' : '<span style="font-size:11px">&#9662;</span>';
  var cursor = noCaret ? 'default' : 'pointer';
  // Layout (fixed width, centred text) lives in .issue-status-badge so every
  // status pill in the app is the same size; only the colours are per-status.
  return '<span class="issue-status-badge" style="' + style + ';cursor:' + cursor + '">' +
    esc(status) + caret + '</span>';
}

function priorityBadge(priority, noCaret) {
  var colors = {
    highest: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6', lowest: '#6b7280'
  };
  var color = colors[priority] || fallbackAccentColor(priority);
  // No margin-top nudge on the caret — the flex container centres it, and the
  // nudge left it sitting a few pixels below the label.
  var caret = noCaret ? ''
    : '<span style="color:#6b778c;font-size:12px;line-height:1">&#9662;</span>';
  // Layout (fixed width, centred) lives in .issue-priority-badge; only the
  // colour varies per priority.
  return '<span class="issue-priority-badge" style="cursor:' + (noCaret ? 'default' : 'pointer') + '">' +
    '<span style="color:#172b4d;font-weight:500">' + cap(priority) + '</span>' +
    caret +
    '</span>';
}

function typeIcon(type) {
  // Wrapped so the SVG doesn't sit on the text baseline. A bare inline <svg>
  // baseline-aligns, which left the icon looking raised next to its label in
  // the Type columns; the wrapper centres it instead. Harmless where the parent
  // is already a flex row.
  return '<span class="type-icon">' + (TYPE_ICONS[type] || '\uD83D\uDCC4') + '</span>';
}

function typeLabel(type) {
  return cap(type || 'task');
}

// badge-type-<type> in styles.css only has rules for the original 5 types --
// an admin-added type has no matching class, and plain .badge-type has no
// background/color of its own, so the badge would render as invisible text.
// Known types keep the real CSS classes (best visual quality); anything else
// gets an inline-style fallback so it's still a readable, distinct pill.
function applyTypeBadgeStyle(el, type) {
  if (!el) return;
  if (TYPE_ICONS[type]) {
    el.className = 'badge badge-type badge-type-' + type;
    el.style.background = '';
    el.style.color = '';
  } else {
    el.className = 'badge badge-type';
    el.style.background = fallbackBadgeBg(type);
    el.style.color = fallbackBadgeText(type);
  }
}

function sprintStatusBadge(status) {
  var color = SPRINT_STATUS_COLORS[status] || '#6b7280';
  return '<span class="badge" style="background:' + color + ';color:#fff">' + cap(status) + '</span>';
}

function avatarHtml(user, size) {
  size = size || 32;
  var baseStyle = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;flex-shrink:0;vertical-align:middle;line-height:1;text-align:center;overflow:hidden;';
  if (!user) return '<span class="avatar" style="' + baseStyle + 'background:#ccc">?</span>';
  var color = user.color || '#0129ac';
  return '<span class="avatar av-tip" style="' + baseStyle + 'background:' + color + ';position:relative;cursor:default" data-tip="' + escAttr(user.name) + '">' + initials(user.name) + '</span>';
}

function issueKeyStr(issue) {
  return issue.key || (issue.project_key ? issue.project_key + '-?' : '#' + issue.id);
}

function statCard(label, value, color, filter) {
  var click = filter ? ' onclick="window._statCardClick(\'' + filter + '\')" style="cursor:pointer"' : '';
  return '<div class="stat-card"' + click + '><div class="stat-value" style="color:' + color + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}
window._statCardClick = function(filter) {
  // "Total Issues" goes to All Work (the space-wide list), not Backlog --
  // the other four cards (To Do/In Progress/Done/Overdue) are unaffected,
  // still go to Backlog with their status filter applied as before.
  if (filter === 'all') {
    window._awShowAllOverride = true;
    navigateToSpace(S.currentSpace, 'allwork');
    return;
  }
  navigateToSpace(S.currentSpace, 'backlog');
  setTimeout(function() {
    window._activeStatFilter = filter;
    renderBacklog();
  }, 100);
};
