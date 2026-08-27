
// ═══════════════════════════════════════════════════════════
// ACTIVE SPRINT (BOARD) TAB
// ═══════════════════════════════════════════════════════════
function renderSprintBoard() {
  var sprints = getSpaceSprints(S.currentSpace);
  var activeSprints = sprints.filter(function(sp) { return sp.status === 'active'; });

  if (!activeSprints.length) {
    $('sprintHeader').innerHTML = '';
    $('sprintBoard').innerHTML = '<p class="placeholder-text">No active sprint. Go to Backlog to start a sprint.</p>';
    return;
  }

  $('sprintHeader').innerHTML = '';
  var allBoardHtml = '';
  var statuses = ISSUE_STATUSES;

  for (var si = 0; si < activeSprints.length; si++) {
    var activeSprint = activeSprints[si];
    var issues = getSpaceIssues(S.currentSpace).filter(function (i) { return i.sprint_id == activeSprint.id; });
    var doneCount = issues.filter(function (i) { return i.status === 'Done'; }).length;
    var pct = issues.length ? Math.round((doneCount / issues.length) * 100) : 0;
    var totalPoints = issues.reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);
    var donePoints = issues.filter(function (i) { return i.status === 'Done'; }).reduce(function (sum, i) { return sum + (i.story_points || 0); }, 0);

    allBoardHtml += '<div class="multi-sprint-section">' +
      '<div class="sprint-info">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
      '<h3 style="margin:0">' + esc(activeSprint.name) + '</h3>' +
      '<button class="btn btn-sm btn-secondary" onclick="window._completeSprint(\'' + activeSprint.id + '\')">Complete Sprint</button>' +
      '</div>' +
      (activeSprint.goal ? '<p class="sprint-goal">' + esc(activeSprint.goal) + '</p>' : '') +
      '<div class="sprint-stats-row">' +
      '<span>\ud83d\udcc5 ' + fmtDateShort(activeSprint.start_date) + ' \u2014 ' + fmtDateShort(activeSprint.end_date) + '</span>' +
      '<span>\ud83c\udfaf ' + doneCount + '/' + issues.length + ' issues</span>' +
      '<span>\u2b50 ' + donePoints + '/' + totalPoints + ' pts</span>' +
      '<span style="margin-left:auto;font-size:12px;font-weight:600;color:var(--text2)">' + pct + '%</span>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="board-cols">';

    for (var c = 0; c < statuses.length; c++) {
      var status = statuses[c];
      var colIssues = issues.filter(function (i) { return i.status === status; });
      allBoardHtml += '<div class="board-col" data-status="' + status + '" data-sprint-id="' + activeSprint.id + '" ' +
        'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
        'ondragleave="this.classList.remove(\'drag-over\')" ' +
        'ondrop="window._dropToStatus(event,\'' + status + '\')">' +
        '<div class="board-col-header"><span>' + status + '</span>' +
        '<span class="col-count">' + colIssues.length + '</span></div>' +
        '<div class="board-col-body">';
      for (var ci = 0; ci < colIssues.length; ci++) {
        allBoardHtml += boardCard(colIssues[ci]);
      }
      allBoardHtml += '</div></div>';
    }
    allBoardHtml += '</div></div>';
  }
  $('sprintBoard').innerHTML = allBoardHtml;
}

function boardCard(iss) {
  var assignee = findUser(iss.assignee_id);
  var isSubtask = iss.type === 'subtask';
  var parentTag = '';
  if (isSubtask && iss.parent_id) {
    var parent = S.data.issues.find(function(i){ return i.id === iss.parent_id; });
    if (parent) parentTag = '<span class="subtask-parent-ref" style="font-size:10px;margin-left:4px">' + esc(parent.key) + '</span>';
  }
  return '<div class="board-card' + (isSubtask ? ' board-card-subtask' : '') + '" draggable="true" data-issue-id="' + iss.id + '" ' +
    'ondragstart="event.dataTransfer.setData(\'text/plain\',\'' + iss.id + '\')" ' +
    'onclick="openIssuePage(\'' + iss.id + '\')">' +
    '<div class="board-card-header"><span class="issue-type-icon" style="font-size:12px">' + typeIcon(iss.type) + '</span> <span class="issue-key">' + esc(issueKeyStr(iss)) + '</span>' + parentTag +
    (iss.story_points != null ? '<span class="badge badge-points" style="margin-left:auto">' + iss.story_points + '</span>' : '') +
    '</div>' +
    '<div class="board-card-title">' + esc(iss.title) + '</div>' +
    '<div class="board-card-footer">' + priorityBadge(iss.priority) + avatarHtml(assignee, 24) + '</div></div>';
}

window._dropToStatus = async function (event, status) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  var issueId = event.dataTransfer.getData('text/plain');
  if (!issueId) return;
  if (status === 'Done') {
    var cached = (S.data.issues || []).find(function (iss) { return iss.id === issueId; });
    if (!canTransitionIssueToDone(cached || issueId)) return;
  }
  await api('/api/issues/' + issueId, 'PUT', { status: status });
  await refreshData();
  renderSprintBoard();
  toast((cachedIssueKey(issueId) || 'Issue') + ' moved to ' + status);
};
