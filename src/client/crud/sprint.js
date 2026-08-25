
// ═══════════════════════════════════════════════════════════
// SPRINT CRUD
// ═══════════════════════════════════════════════════════════
async function handleSprintSubmit(e) {
  e.preventDefault();
  var id = $('sprintIdInput').value;
  var payload = {
    space_id: $('sprintSpaceId').value || S.currentSpace,
    name: $('sprintNameInput').value,
    goal: $('sprintGoal').value,
    start_date: $('sprintStartDate').value || null,
    end_date: $('sprintEndDate').value || null,
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
