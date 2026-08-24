
// ═══════════════════════════════════════════════════════════
// SPACE HEADER
// ═══════════════════════════════════════════════════════════
function renderSpaceHeader(space) {
  $('spaceIcon').textContent = space.icon || '\uD83D\uDCC1';
  $('spaceName').textContent = space.name;
  $('spaceKey').textContent = space.key;
}

function countAssignedPlusReported(data) {
  if (!data) return 0;
  var ids = {};
  (data.assigned || []).forEach(function (i) { ids[i.id] = true; });
  (data.reported || []).forEach(function (i) { ids[i.id] = true; });
  return Object.keys(ids).length;
}

function countOpenAssignedIssues(data) {
  if (!data) return 0;
  return (data.assigned || []).filter(function (i) { return i.status !== 'Done'; }).length;
}

function getOpenAssignedCountLocal() {
  return getVisibleIssues().filter(function (i) {
    return i.assignee_id == S.currentUser && i.status !== 'Done';
  }).length;
}

function getMyIssueCountFromLocalData() {
  var ids = {};
  getVisibleIssues().forEach(function (i) {
    if (i.assignee_id == S.currentUser || i.reporter_id == S.currentUser) ids[i.id] = true;
  });
  return Object.keys(ids).length;
}

// Tickets ASSIGNED to me — the set every dashboard tile from Total Tickets
// through Closed Tickets is measured against. Reported-by-me is deliberately
// excluded: these tiles describe the user's own workload, and mixing in tickets
// they merely raised for someone else inflated the totals.
// Prefers the /api/my-issues cache, falling back to the locally loaded issues
// before it arrives. Returned as a list so the status tiles break down exactly
// the same set and therefore always sum to Total.
function getMyDashboardIssues() {
  if (_ywCache) return (_ywCache.assigned || []).slice();
  return getVisibleIssues().filter(function (i) { return i.assignee_id == S.currentUser; });
}

// Status groups for the dashboard tiles. "Active" is deliberately both
// In Progress and In Review — work that has been picked up but isn't finished.
var DASH_STATUS_GROUPS = {
  open:    ['To Do'],
  active:  ['In Progress', 'In Review'],
  blocked: ['Blocked'],
  closed:  ['Done']
};

function countMyIssuesByStatusGroup(list, group) {
  var wanted = DASH_STATUS_GROUPS[group] || [];
  return (list || []).filter(function (i) { return wanted.indexOf(i.status) >= 0; }).length;
}

function formatDashboardActivity(row) {
  if (!row) return 'updated an issue';
  if (row.activity_type === 'created' || row.field_name === 'created') return 'created';
  var field = row.field_name || '';
  if (field === 'status') return 'changed status to ' + (row.new_value || '');
  if (field === 'priority') return 'changed priority to ' + (row.new_value || '');
  if (field === 'assignee_id') return 'changed assignee';
  if (field === 'title') return 'updated title';
  if (field === 'description' || field === 'fix_description') return 'updated description';
  if (field === 'sprint_id') return 'moved sprint';
  if (field.indexOf('custom_field_') === 0) {
    if (row.custom_field_key === 'combination') {
      var what = diffCombinationFieldChange(row.old_value, row.new_value);
      if (what) return 'updated ' + what;
    }
    return row.custom_field_name ? 'updated ' + row.custom_field_name : 'updated a custom field';
  }
  if (field) return 'updated ' + field.replace(/_/g, ' ');
  return 'updated an issue';
}
