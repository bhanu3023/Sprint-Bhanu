
// ═══════════════════════════════════════════════════════════
// CREATE ISSUE — AUTOSAVED DRAFTS
// ═══════════════════════════════════════════════════════════
// Whatever is typed into the Create Issue form is autosaved (debounced) as
// soon as any field actually carries content, so a refresh, an accidental
// close, or just walking away mid-form never loses it. A prompt to keep or
// discard the draft appears however the modal is closed WITHOUT submitting
// (Cancel, the × button, and the backdrop all route through the same
// window._handleCreateIssueCancelClick, wired in index.html) — actually
// submitting the form is the only path that skips it, since a successful
// create deletes the draft outright instead of asking.
//
// _currentIssueDraftId identifies the ONE draft the currently-open modal
// session is attached to: null until the first autosave creates one (POST),
// non-null from then on so every later change PUTs the same row instead of
// creating a new one each time. resetIssueForm() (crud/issue.js) clears it
// back to null on every fresh open; openCreateIssueModalFromDraft below sets
// it explicitly when reopening an existing draft.
var _currentIssueDraftId = null;
var _issueDraftAutosaveTimer = null;
var _issueDraftLastSavedJSON = null; // last payload actually written -- skips a redundant PUT when nothing changed
var _issueDraftSaveInFlight = null;  // the in-flight save's promise, so flush can wait on it instead of racing it

var ISSUE_DRAFT_AUTOSAVE_DELAY_MS = 1200;

// What actually counts as "the user has started this ticket" — deliberately
// excludes fields the form pre-fills on its own (type='task', priority=
// 'medium', reporter=current user, start_date=today), so opening the modal
// and immediately closing it again never creates a throwaway draft.
function isIssueDraftFormDataBlank(d) {
  if (!d) return true;
  if (d.title && d.title.trim()) return false;
  if (d.description && d.description.trim()) return false;
  if (d.assignee_id) return false;
  if (d.sprint_id) return false;
  if (d.story_points != null && d.story_points !== '') return false;
  if (d.team) return false;
  if (d.product_type) return false;
  if (d.combination && d.combination.value) return false;
  if (d.due_date) return false;
  if (d.custom_fields && Object.keys(d.custom_fields).length) return false;
  return true;
}

// Snapshot of every Create Issue field this feature knows how to restore.
// Deliberately excludes file attachments — a File object cannot survive a
// page reload no matter where its metadata is stored, so there is nothing
// meaningful to snapshot there; re-attaching after resuming a draft is a
// manual step same as any other edit.
function snapshotIssueDraftFormData() {
  var descEl = document.getElementById('issueDescContent');
  var comboVal = (typeof getCombinationFieldValue === 'function') ? getCombinationFieldValue() : null;
  var ptPayload = (typeof getProductTypeSetsFieldValue === 'function') ? getProductTypeSetsFieldValue() : null;
  return {
    title: $('issueTitleInput') ? $('issueTitleInput').value : '',
    description: descEl ? getDescriptionHtmlForSave(descEl) : '',
    type: $('issueType') ? $('issueType').value : '',
    priority: $('issuePriority') ? $('issuePriority').value : '',
    assignee_id: $('issueAssignee') ? ($('issueAssignee').value || null) : null,
    reporter_id: $('issueReporter') ? ($('issueReporter').value || null) : null,
    sprint_id: $('issueSprint') ? ($('issueSprint').value || null) : null,
    story_points: $('issuePoints') ? $('issuePoints').value : '',
    team: $('issueTeam') ? $('issueTeam').value : '',
    product_type: ptPayload ? (ptPayload.product_type || '') : ($('issueProductType') ? $('issueProductType').value : ''),
    combination: comboVal ? { fieldId: comboVal.fieldId, value: comboVal.value } : null,
    start_date: $('issueStartDate') ? $('issueStartDate').value : '',
    due_date: $('issueDueDate') ? $('issueDueDate').value : '',
    parent_id: $('issueParentId') ? ($('issueParentId').value || null) : null,
    custom_fields: (typeof getCreateModalCustomFieldValues === 'function') ? getCreateModalCustomFieldValues() : {}
  };
}

function scheduleIssueDraftAutosave() {
  clearTimeout(_issueDraftAutosaveTimer);
  _issueDraftAutosaveTimer = setTimeout(saveIssueDraftNow, ISSUE_DRAFT_AUTOSAVE_DELAY_MS);
}

// The actual write. Safe to call directly (flush paths do) or via the
// debounce above. No-ops quietly on a blank form or a request already in
// flight — the next input/change event schedules another attempt.
async function saveIssueDraftNow() {
  clearTimeout(_issueDraftAutosaveTimer);
  if (_issueDraftSaveInFlight) return _issueDraftSaveInFlight;
  var spaceId = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || '';
  var data = snapshotIssueDraftFormData();
  if (isIssueDraftFormDataBlank(data)) return;
  var json = JSON.stringify(data);
  if (json === _issueDraftLastSavedJSON) return; // nothing actually changed since the last save

  var body = { space_id: spaceId || null, form_data: data };
  var run = (async function () {
    try {
      if (_currentIssueDraftId) {
        await api('/api/issue-drafts/' + _currentIssueDraftId, 'PUT', body, { silent: true });
      } else {
        var created = await api('/api/issue-drafts', 'POST', body, { silent: true });
        if (created && created.id) _currentIssueDraftId = created.id;
      }
      _issueDraftLastSavedJSON = json;
    } catch (_) {
      // Non-critical by design (matches createNotif's own fire-and-forget
      // stance) — a failed autosave just means the NEXT change gets another
      // attempt a moment later. Interrupting the user over it would be worse
      // than the small risk of losing a few seconds of typing.
    } finally {
      _issueDraftSaveInFlight = null;
    }
  })();
  _issueDraftSaveInFlight = run;
  return run;
}

// Cancel any pending debounce and save right now, awaited — used wherever
// the modal is about to leave the page's control (Cancel click, the tab
// being hidden) and a stale pending change would otherwise be lost.
async function flushIssueDraftAutosave() {
  clearTimeout(_issueDraftAutosaveTimer);
  await saveIssueDraftNow();
}

async function deleteCurrentIssueDraft() {
  var id = _currentIssueDraftId;
  _currentIssueDraftId = null;
  _issueDraftLastSavedJSON = null;
  clearTimeout(_issueDraftAutosaveTimer);
  if (!id) return;
  try { await api('/api/issue-drafts/' + id, 'DELETE', null, { silent: true }); } catch (_) {}
}

// Bound once — #issueForm is static markup, always present, and every
// dynamically-rebuilt section inside it (custom fields, the combination
// picker) is still a descendant, so a single delegated listener here covers
// fields that do not exist yet at bind time.
(function bindIssueDraftAutosave() {
  var form = document.getElementById('issueForm');
  if (!form || form._draftAutosaveBound) return;
  form._draftAutosaveBound = true;
  form.addEventListener('input', scheduleIssueDraftAutosave);
  form.addEventListener('change', scheduleIssueDraftAutosave);

  // Covers the tab being switched away from or the window losing focus
  // (mobile app-switch, alt-tab) — a real network round trip, not the
  // sendBeacon-with-no-auth-header workaround a beforeunload handler would
  // need, since visibilitychange fires well before the page is actually
  // torn down and a normal authenticated fetch still has time to land.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !document.getElementById('modal-issue').hidden) flushIssueDraftAutosave();
  });
})();

// ── Any non-submit way of closing the modal ───────────────────────────────
// Wired to Cancel, the × button, AND the backdrop click (index.html) — every
// way of leaving the form without actually creating the ticket shows the
// same keep-or-discard prompt when there is something to keep.
window._handleCreateIssueCancelClick = async function () {
  await flushIssueDraftAutosave();
  if (!_currentIssueDraftId) { closeModal('modal-issue'); return; }
  var keep = await confirmDialog('Save this ticket as a draft so you can finish it later?');
  if (!keep) await deleteCurrentIssueDraft();
  closeModal('modal-issue');
};

// ── The drafts list panel, next to + Create Issue ────────────────────────
var _issueDraftsCache = [];

async function loadIssueDraftsList() {
  try {
    _issueDraftsCache = await api('/api/issue-drafts', 'GET', null, { silent: true }) || [];
  } catch (_) {
    _issueDraftsCache = [];
  }
  renderIssueDraftsBadge();
  return _issueDraftsCache;
}

function renderIssueDraftsBadge() {
  var badge = $('draftsBadge');
  if (!badge) return;
  var n = _issueDraftsCache.length;
  if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.removeAttribute('hidden'); }
  else badge.setAttribute('hidden', '');
}

function draftPreviewLabel(draft) {
  var d = draft.form_data || {};
  if (d.title && d.title.trim()) return d.title.trim();
  if (d.description) {
    var text = String(d.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 60);
  }
  return 'Untitled draft';
}

function renderIssueDraftsPanel() {
  var listEl = $('draftsList');
  if (!listEl) return;
  if (!_issueDraftsCache.length) {
    listEl.innerHTML = '<div style="padding:28px 20px;text-align:center;color:var(--text3);font-size:13px">No drafts — anything you start typing in Create Issue is saved here automatically.</div>';
    return;
  }
  listEl.innerHTML = _issueDraftsCache.map(function (draft) {
    var space = getSpace(draft.space_id);
    return '<div class="notif-item draft-item" data-draft-id="' + esc(draft.id) + '">' +
      '<div class="notif-item-body">' +
        '<div class="notif-item-title">' + esc(draftPreviewLabel(draft)) + '</div>' +
        '<div class="notif-item-time">' + (space ? esc(space.name) + ' · ' : '') + relativeTime(draft.updated_at) + '</div>' +
      '</div>' +
      '<button type="button" class="btn-icon draft-item-delete" title="Discard draft" data-draft-id="' + esc(draft.id) + '">&times;</button>' +
    '</div>';
  }).join('');
}

(function bindIssueDraftsButton() {
  var btn = $('draftsBtn');
  var panel = $('draftsPanel');
  var listEl = $('draftsList');
  if (!btn || !panel || btn._draftsBound) return;
  btn._draftsBound = true;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (panel.hasAttribute('hidden')) {
      panel.removeAttribute('hidden');
      loadIssueDraftsList().then(renderIssueDraftsPanel);
    } else {
      panel.setAttribute('hidden', '');
    }
  });

  document.addEventListener('click', function (e) {
    if (panel.hasAttribute('hidden')) return;
    if (panel.contains(e.target) || e.target === btn || btn.contains(e.target)) return;
    panel.setAttribute('hidden', '');
  });

  if (listEl) {
    listEl.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.draft-item-delete');
      if (delBtn) {
        e.stopPropagation();
        var id = delBtn.dataset.draftId;
        api('/api/issue-drafts/' + id, 'DELETE', null, { silent: true }).catch(function () {}).then(function () {
          _issueDraftsCache = _issueDraftsCache.filter(function (d) { return d.id !== id; });
          renderIssueDraftsBadge();
          renderIssueDraftsPanel();
        });
        return;
      }
      var item = e.target.closest('.draft-item');
      if (!item) return;
      var draft = _issueDraftsCache.find(function (d) { return d.id === item.dataset.draftId; });
      if (!draft) return;
      panel.setAttribute('hidden', '');
      window.openCreateIssueModalFromDraft(draft);
    });
  }
  // The initial load (so the badge has a count before the panel is ever
  // opened) happens from init.js, right alongside loadNotifications() --
  // this IIFE only runs at script-parse time, before login/auth has even
  // been checked, so firing the request from here would hit the API
  // unauthenticated on every anonymous page load.
})();

// Waits for the async, space-dependent parts of the Create Issue form
// (custom fields, the combination/product-type picker) to finish rendering
// before the draft's saved values are applied to them — both are populated
// by _onIssueSpaceChange, which does not return a promise this can simply
// await (it fires a fetch-then-render chain internally when a space's fields
// are not already cached). A short bounded poll is simpler and safer than
// changing that function's contract for every OTHER caller that doesn't
// need to await it.
function waitForIssueFormFieldsReady(spaceId) {
  return new Promise(function (resolve) {
    var attempts = 0;
    (function check() {
      attempts++;
      // Real signal: the space's own custom-field count matches what's been
      // rendered, OR (a space with zero configurable fields) there was never
      // anything to wait for.
      var expected = (getSpaceFieldRows(spaceId) || []).filter(function (f) {
        return !f.is_builtin && customFieldShowsIn(f, 'create');
      }).length;
      var rendered = document.querySelectorAll('#issueCustomFieldsContainer [data-cf-id]').length;
      if (expected === 0 || rendered > 0 || attempts > 40) resolve();
      else setTimeout(check, 50);
    })();
  });
}

// ── Reopening a draft ─────────────────────────────────────────────────────
window.openCreateIssueModalFromDraft = async function (draft) {
  resetIssueForm();
  var d = draft.form_data || {};
  var spaceId = draft.space_id || S.currentSpace || '';
  $('issueModalTitle').textContent = 'Create Issue';
  window._populateIssueSpaceDropdown && window._populateIssueSpaceDropdown(spaceId);
  var spaceSel = $('issueSpaceSelect');
  var effectiveSpace = spaceSel ? (spaceSel.value || '') : spaceId;
  $('issueSpaceId').value = effectiveSpace;
  window._onIssueSpaceChange && window._onIssueSpaceChange(effectiveSpace, d.sprint_id || null);
  populateIssueFormSelects({ includeSprintId: d.sprint_id || null });

  // Fields that render synchronously and don't depend on the space's
  // dynamic custom-field/combination sections.
  if ($('issueTitleInput')) $('issueTitleInput').value = d.title || '';
  var descEl = document.getElementById('issueDescContent');
  if (descEl) descEl.innerHTML = d.description || '';
  if ($('issuePoints')) $('issuePoints').value = d.story_points || '';
  if ($('issueStartDate') && d.start_date) $('issueStartDate').value = d.start_date;
  if ($('issueDueDate')) $('issueDueDate').value = d.due_date || '';
  if ($('issueParentId')) $('issueParentId').value = d.parent_id || '';
  if ($('issueSprint') && d.sprint_id) $('issueSprint').value = d.sprint_id;

  if (d.assignee_id && $('issueAssignee')) {
    $('issueAssignee').value = d.assignee_id;
    var assignee = findUser(d.assignee_id);
    if (assignee && $('issueAssigneeSearch')) $('issueAssigneeSearch').value = assignee.name;
  }
  if (d.reporter_id && $('issueReporter')) {
    $('issueReporter').value = d.reporter_id;
    var reporter = findUser(d.reporter_id);
    if (reporter && $('issueReporterSearch')) $('issueReporterSearch').value = reporter.name;
  }

  openModal('modal-issue');

  // Type/Priority/Team rebuild their own <option> lists per space inside
  // _onIssueSpaceChange, so their restored value has to be re-applied AFTER
  // that call, not before it.
  if ($('issueType') && d.type) $('issueType').value = d.type;
  if ($('issuePriority') && d.priority) $('issuePriority').value = d.priority;
  if ($('issueTeam') && d.team) $('issueTeam').value = d.team;

  await waitForIssueFormFieldsReady(effectiveSpace);

  // Product Type + Combination — reuses the exact same restore path the
  // drawer's own edit view already relies on (parsePtComboSelection ->
  // _issuePtComboSel -> re-render), rather than a second, parallel way of
  // reconstructing the same picker state.
  if (typeof parsePtComboSelection === 'function') {
    var comboValue = (d.combination && d.combination.value) || '';
    _issuePtComboSel = parsePtComboSelection(d.product_type || '', comboValue);
    if (typeof renderIssueProductTypeSets === 'function') await renderIssueProductTypeSets(effectiveSpace);
  }
  if (!_issuePtComboSel || (!_issuePtComboSel.combinations.length && $('issueProductType'))) {
    $('issueProductType').value = d.product_type || '';
  }

  // Generic custom fields, restored per widget type. Select/multi-select
  // widgets are restored by dispatching a real click on each saved value's
  // option — reusing bindCFSelectWrap's own click handler exactly, rather
  // than reaching into its private selection state and risking it drifting
  // out of sync with what a manual click would have produced.
  Object.keys(d.custom_fields || {}).forEach(function (fieldId) {
    var savedVal = d.custom_fields[fieldId];
    var selectWrap = document.querySelector('.cf-select-wrap[data-cf-id="' + fieldId + '"]');
    if (selectWrap) {
      var savedList = String(savedVal).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      selectWrap.querySelectorAll('.cf-sel-opt').forEach(function (opt) {
        if (savedList.indexOf(opt.dataset.val) !== -1) opt.click();
      });
      return;
    }
    var field = document.querySelector('.cf-field[data-cf-id="' + fieldId + '"]');
    if (!field) return;
    if (field.type === 'checkbox') field.checked = (savedVal === 'true' || savedVal === true);
    else field.value = savedVal;
  });

  _currentIssueDraftId = draft.id;
  _issueDraftLastSavedJSON = JSON.stringify(snapshotIssueDraftFormData());
};
