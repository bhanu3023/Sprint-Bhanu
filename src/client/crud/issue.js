
// ═══════════════════════════════════════════════════════════
// ISSUE CRUD
// ═══════════════════════════════════════════════════════════
function resetIssueForm() {
  $('issueId').value = '';
  $('issueSpaceId').value = S.currentSpace || '';
  $('issueParentId').value = '';
  // Populate space dropdown with current space selected
  if (window._populateIssueSpaceDropdown) window._populateIssueSpaceDropdown(S.currentSpace || '');
  $('issueTitleInput').value = '';
  $('issueType').value = 'task';
  $('issuePriority').value = 'medium';
  $('issuePoints').value = '';
  if ($('issueTeam')) $('issueTeam').value = '';
  if ($('issueProductType')) $('issueProductType').value = '';
  _issuePtComboSel = null;
  $('issueStartDate').value = fmtDateISO(new Date()); // default to today
  $('issueDueDate').value = '';
  var descEl = document.getElementById('issueDescContent'); if (descEl) descEl.innerHTML = '';
  if ($('issueAssigneeSearch')) $('issueAssigneeSearch').value = '';
  if ($('issueAssignee')) $('issueAssignee').value = '';
  if ($('issueReporterSearch')) $('issueReporterSearch').value = '';
  if ($('issueReporter')) $('issueReporter').value = '';
  if ($('assigneeDropdown')) $('assigneeDropdown').style.display = 'none';
  if ($('reporterDropdown')) $('reporterDropdown').style.display = 'none';
  _selectedFiles = [];
  _revokeAttachmentThumbUrls();
  _lastPasteFingerprint = '';
  _lastPasteTime = 0;
  _issuePasteBusy = false;
  _renderAttachmentFileList();
  var fi = $('issueAttachments');
  if (fi) fi.value = '';
  var fnLabel = $('attachmentFileNames');
  if (fnLabel) fnLabel.textContent = 'No files chosen';
  var cfContainer = $('issueCustomFieldsContainer');
  if (cfContainer) cfContainer.innerHTML = '';
  var comboContainer = $('issueCombinationField');
  if (comboContainer) comboContainer.innerHTML = '';
  var comboGroup = $('issueCombinationGroup');
  if (comboGroup) comboGroup.hidden = true;
}

function populateIssueFormSelects(opts) {
  opts = opts || {};
  var spaceId = $('issueSpaceId').value || S.currentSpace;
  var members = spaceId ? getSpaceMembers(spaceId) : (S.data.users || []);
  if (!members.length) members = S.data.users || [];
  var sprints = spaceId ? getIssueFormSprints(spaceId, opts) : [];

  initUserSearchDropdown('issueAssigneeSearch', 'issueAssignee', 'assigneeDropdown', members, null);
  initUserSearchDropdown('issueReporterSearch', 'issueReporter', 'reporterDropdown', members, S.currentUser);
  populateSprintSelect($('issueSprint'), sprints, opts.includeSprintId || null);
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  // Space first — required-field validation is per space, so it needs to be
  // resolved before anything else can be checked.
  // No spaces[0] fallback: it made the guard below unreachable, so submitting
  // with nothing selected quietly created the ticket in whichever space happened
  // to be first in the list.
  var spaceVal = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || '';
  if (spaceVal == null || spaceVal == '') {
    toast('Please select a Space — it is mandatory', 'error');
    var spaceSel = $('issueSpaceSelect');
    if (spaceSel) { spaceSel.focus(); }
    return;
  }
  // Enforces whatever is flagged Required in Settings → Custom Fields for this
  // space (built-in and custom alike), instead of hardcoding Title.
  if (!validateCreateRequiredFields(spaceVal)) return;
  var teamVal = $('issueTeam') ? $('issueTeam').value : '';
  var productVal = $('issueProductType') ? $('issueProductType').value : '';
  var startVal = $('issueStartDate').value;
  if (!_validateIssueAttachments()) return;
  var descEl = document.getElementById('issueDescContent');
  var rawDesc = getDescriptionHtmlForSave(descEl);
  if (rawDesc.length > ISSUE_MAX_DESC_CHARS) {
    toast('Description is too large — remove extra content or use attachments for files', 'error');
    return;
  }
  // Validate due date does not exceed sprint end date
  var dueVal = $('issueDueDate').value;
  if (dueVal) {
    var sprintId = $('issueSprint').value;
    if (sprintId) {
      var sprint = (S.data.sprints || []).find(function(sp){ return sp.id === sprintId; });
      if (sprint && sprint.end_date) {
        var sprintEnd = new Date(sprint.end_date.slice(0,10) + 'T00:00:00');
        var duePicked = new Date(dueVal + 'T00:00:00');
        if (duePicked > sprintEnd) {
          toast('Due date cannot exceed sprint end date (' + sprint.end_date.slice(0,10) + ')', 'error');
          $('issueDueDate').focus();
          return;
        }
      }
    }
  }
  var id = $('issueId').value;
  var parentId = $('issueParentId').value || null;
  // Already validated above as non-empty — reuse it rather than re-resolving with
  // a different fallback chain, which is how the two could disagree.
  var resolvedSpace = spaceVal;
  var ptPayload = getProductTypeSetsFieldValue();
  var payload = {
    space_id: resolvedSpace,
    title: $('issueTitleInput').value,
    type: $('issueType').value,
    priority: $('issuePriority').value,
    assignee_id: $('issueAssignee').value || null,
    reporter_id: $('issueReporter').value || S.currentUser || null,
    sprint_id: $('issueSprint').value || null,
    story_points: $('issuePoints').value ? parseInt($('issuePoints').value, 10) : null,
    team: $('issueTeam') ? ($('issueTeam').value || null) : null,
    product_type: ptPayload ? ptPayload.product_type : ($('issueProductType') ? ($('issueProductType').value || null) : null),
    start_date: $('issueStartDate').value || null,
    due_date:   $('issueDueDate').value   || null,
    description: rawDesc,
    original_estimate: $('issueEstimate') ? parseEstimate($('issueEstimate').value) : 0,
    status: 'To Do',
    _customFields: getCreateModalCustomFieldValues()
  };
  if (parentId) payload.parent_id = parentId;

  if (id) {
    delete payload.status;
    await api('/api/issues/' + id, 'PUT', payload);
    toast('Issue updated');
    closeModal('modal-issue');
    await refreshData();
    renderCurrentView();
  } else {
    var submitBtn = $('issueSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    try {
    var created = await api('/api/issues', 'POST', payload);
    // Save custom field values
    if (created && created.id) {
      // Save dynamic custom fields. A native <select multiple> element's
      // own .value only ever returns the FIRST selected option — reading
      // selectedOptions is required to capture every value chosen, matching
      // the comma-joined format the rest of the app already stores/parses.
      var cfFields = document.querySelectorAll('#issueCustomFieldsContainer .cf-field');
      var cfValues = getCreateModalCustomFieldValues();
      Object.keys(cfValues).forEach(function (cfId) {
        api('/api/issues/' + created.id + '/field-values/' + cfId, 'PUT', { value: cfValues[cfId] }).catch(function () {});
      });
      var comboVal = getCombinationFieldValue();
      if (comboVal && comboVal.fieldId) {
        api('/api/issues/' + created.id + '/field-values/' + comboVal.fieldId, 'PUT', { value: comboVal.value || '' }).catch(function () {});
      } else if (ptPayload && ptPayload.fieldId) {
        api('/api/issues/' + created.id + '/field-values/' + ptPayload.fieldId, 'PUT', { value: ptPayload.combination || '' }).catch(function () {});
      }
      cfFields.forEach(function (f) {
        if (cfValues[f.dataset.cfId]) return;
        var v = (f.tagName === 'SELECT' && f.multiple)
          ? Array.from(f.selectedOptions).map(function (o) { return o.value; }).join(',')
          : f.value;
        if (v && f.dataset.cfId) {
          api('/api/issues/' + created.id + '/field-values/' + f.dataset.cfId, 'PUT', { value: v }).catch(function () {});
        }
      });
      // team and product_type are saved directly via payload
    }
    // Upload any attached files
    if (created && created.id && _selectedFiles.length) {
      var fd = new FormData();
      for (var i = 0; i < _selectedFiles.length; i++) fd.append('files', _selectedFiles[i]);
      try {
        var uploadRes = await fetch('/api/issues/' + created.id + '/attachments', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
        if (!uploadRes.ok) {
          var uploadErr = 'Attachment upload failed';
          try { var ej = await uploadRes.json(); if (ej.error) uploadErr = ej.error; } catch (_) {}
          toast('Issue created but ' + uploadErr, 'warning');
        }
      } catch(e) { toast('Issue created but attachments failed to upload', 'warning'); }
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    } catch(e) { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save"; } toast("Failed to create issue: " + e.message, "error"); return; }
    closeModal('modal-issue');
    await refreshData();
    // Captured before anything below navigates: renderCurrentView() ->
    // navigateToSpace() unconditionally calls _exitIssuePage(), so if a ticket
    // was open when Create Issue was launched (it opens as an overlay on top
    // of whatever page is behind it), calling that would silently close it out
    // from under the user even before the auto-open-new-ticket behavior below
    // ever ran.
    var ticketWasOpen = !!S.drawerIssueId;
    var subtaskOfOpenTicket = parentId && S.drawerIssueId === parentId;
    if (subtaskOfOpenTicket) {
      var parentIssue = await api('/api/issues/' + parentId);
      renderDrawerSubtasks(parentIssue.subtasks || []);
    } else if (!ticketWasOpen) {
      renderCurrentView();
    }
    // else: some ticket is open that isn't this new one's parent -- leave it
    // on screen untouched; the toast below is the only feedback.
    if (created && created.id) {
      if (subtaskOfOpenTicket) {
        toast('Issue created');
      } else if (ticketWasOpen) {
        // Don't yank the user away from whatever they're reading. Offer a way
        // to jump to the new ticket instead of forcing it.
        var newKey = issueKeyStr(created) || created.id;
        toastWithButtons(newKey + ' created', [
          { label: 'Open', handler: function () { openIssuePage(created.id); } },
          { label: 'Copy link', handler: function () { copyIssueLinkByKey(newKey); }, dismissOnClick: false }
        ]);
      } else if (!parentId) {
        toast('Issue created — opening in new tab…');
        // Wait for custom fields to be saved before opening
        setTimeout(async function() {
          await new Promise(r => setTimeout(r, 500));
          var fresh = await api('/api/issues/' + created.id);
          openIssuePage(created.id);
        }, 300);
      } else {
        toast('Issue created');
      }
    } else {
      toast('Issue created');
    }
  }
}
