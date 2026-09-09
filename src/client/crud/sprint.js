
// ═══════════════════════════════════════════════════════════
// SPRINT CRUD
// ═══════════════════════════════════════════════════════════
async function handleSprintSubmit(e) {
  e.preventDefault();
  var id = $('sprintIdInput').value;
  var startDate = $('sprintStartDate').value || null;
  var endDate = $('sprintEndDate').value || null;
  // Start Date has no lower bound of its own -- a sprint may legitimately be
  // planned to have started in the past -- but an End Date before Start Date
  // is never meaningful. The End Date picker's own min attribute (set in
  // _openSprintModal) already steers away from this, but typing a date
  // directly bypasses that, so it's checked again here before saving. The
  // server enforces the same rule regardless of caller (sprint-lifecycle.md).
  if (startDate && endDate && endDate < startDate) {
    toast('End Date cannot be before Start Date', 'error');
    return;
  }
  var payload = {
    space_id: $('sprintSpaceId').value || S.currentSpace,
    name: $('sprintNameInput').value,
    goal: $('sprintGoal').value,
    start_date: startDate,
    end_date: endDate,
    developer_ids: collectCheckedIds('sprintDeveloperList'),
    qa_ids: collectCheckedIds('sprintQaList'),
    public_holidays: Array.from(window._sprintHolidaySet || []).sort(),
    developer_leaves: Object.assign({}, window._sprintDeveloperLeaves || {})
  };

  // payload.name is what the user just typed, so the message can name the
  // sprint without looking anything up.
  var sprintLabel = (payload.name || '').trim() || 'Sprint';
  if (id) {
    await api('/api/sprints/' + id, 'PUT', payload, { silent: true });
    toast(sprintLabel + ' updated');
  } else {
    await api('/api/sprints', 'POST', payload, { silent: true });
    toast(sprintLabel + ' created');
  }
  closeModal('modal-sprint');
  await refreshData();
  if (S.currentTab === 'backlog') renderBacklog();
  else if (S.currentTab === 'sprint') renderSprintBoard();
}
