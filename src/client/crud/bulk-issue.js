
// ═══════════════════════════════════════════════════════════
// BULK ISSUE IMPORT (CSV) — admin / space admin only
// ═══════════════════════════════════════════════════════════
// Reachable only from the "Bulk Create" button on the normal Create Issue
// modal, and only once a space is selected there — the CSV deliberately
// carries no space column; the space already chosen in that form is the
// target for every row. Visibility of the button is gated client-side by
// canManageSpace()/isOrgAdminUser() (see _onIssueSpaceChange in
// event-bindings.js), but that is UX only: the real boundary is the server's
// POST /api/issues/bulk-import, gated at the 'issue.bulk' action (site_admin
// tier, org admin bypasses) — the exact same action the existing bulk-EDIT
// endpoint already uses. A member who never sees the button still cannot
// call that endpoint successfully.
//
// Every row this file resolves and validates client-side (assignee/reporter
// email, sprint name, per-space Type/Priority/Team/Product Type options,
// per-space required-field rules) is re-resolved and re-validated
// independently on the server from the same raw strings — this file's checks
// exist for immediate feedback before the user commits, not as the security
// boundary, matching how every other form in this app works.
//
// Deliberately NOT supported via CSV: attachments (a CSV cell cannot hold a
// file), the Combination field (a compound, Product-Type-dependent picker
// with its own bespoke UI), and arbitrary per-space custom fields beyond
// Team/Product Type. A space that has marked any OTHER field required for a
// given issue Type is detected and reported per-row, not silently ignored —
// see BULK_UNSUPPORTED_REQUIRED_MESSAGE below.

// Canonical CSV column keys, in the order the sample CSV writes them, each
// with the header names accepted on import (case-insensitive, trimmed, and
// tolerant of spaces vs underscores) so a header renamed slightly in Excel
// (or re-ordered entirely) still maps correctly instead of silently reading
// as "column not found".
var BULK_ISSUE_COLUMNS = [
  { key: 'title',           aliases: ['title'],                                   required: true },
  { key: 'type',            aliases: ['type', 'issue type'] },
  { key: 'priority',        aliases: ['priority'] },
  { key: 'assignee_email',  aliases: ['assignee email', 'assignee', 'assignee_email'] },
  { key: 'reporter_email',  aliases: ['reporter email', 'reporter', 'reporter_email'] },
  { key: 'sprint',          aliases: ['sprint', 'sprint name'] },
  { key: 'story_points',    aliases: ['story points', 'points', 'story_points'] },
  { key: 'team',            aliases: ['team'] },
  { key: 'product_type',    aliases: ['product type', 'product_type'] },
  { key: 'start_date',      aliases: ['start date', 'start_date'] },
  { key: 'due_date',        aliases: ['due date', 'due_date'] },
  { key: 'description',     aliases: ['description'] }
];
var BULK_ISSUE_MAX_ROWS = 500;
var BULK_ISSUE_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB — generous for a text CSV, small enough to parse instantly

var _bulkIssueValidRows = [];   // rows ready to send, in the shape the server expects
var _bulkIssueParsedCount = 0;
var _bulkIssueSpaceId = null;
var _bulkIssueBusy = false;

// ── CSV parsing (RFC4180-ish: quoted fields, embedded commas/newlines, "" ==
// one literal quote inside a quoted field, CRLF or LF, a leading BOM). ─────
function parseCsvText(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM (Excel always adds one)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // normalize line endings up front
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;
  var len = text.length;
  while (i < len) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  // Last field/row (files don't always end with a trailing newline).
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop fully-blank trailing rows (a common artifact of Excel's own export).
  while (rows.length && rows[rows.length - 1].every(function (c) { return !String(c).trim(); })) rows.pop();
  return rows;
}

function normalizeCsvHeaderCell(s) {
  return String(s || '').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

// Maps raw CSV text to an array of { title, type, ... } objects keyed by our
// canonical field names, using the header row to figure out which physical
// column is which — so a reordered or renamed-but-recognizable header still
// works. Returns { rows, headerError } — headerError is set (and rows empty)
// only when the header row cannot be found at all (no recognizable Title
// column), since every other column is optional.
function mapCsvToBulkRows(csvText) {
  var table = parseCsvText(csvText);
  if (!table.length) return { rows: [], headerError: 'The file is empty.' };
  var header = table[0].map(normalizeCsvHeaderCell);
  var colIndex = {};
  BULK_ISSUE_COLUMNS.forEach(function (col) {
    for (var i = 0; i < header.length; i++) {
      if (col.aliases.indexOf(header[i]) !== -1) { colIndex[col.key] = i; break; }
    }
  });
  if (colIndex.title == null) {
    return { rows: [], headerError: 'No "Title" column found in the header row. Use the sample CSV\'s column names (order does not matter, but Title must be present).' };
  }
  var dataRows = table.slice(1).filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  var rows = dataRows.map(function (r) {
    var obj = {};
    BULK_ISSUE_COLUMNS.forEach(function (col) {
      var idx = colIndex[col.key];
      obj[col.key] = idx != null ? (r[idx] != null ? String(r[idx]) : '') : '';
    });
    return obj;
  });
  return { rows: rows, headerError: null };
}

// ── Sample CSV, built from the space's OWN configured options ─────────────
function csvEscapeCell(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function csvRowToLine(cells) { return cells.map(csvEscapeCell).join(','); }

function bulkGetOptionList(spaceId, fieldKey) {
  var field = findSpaceFieldByKey(spaceId, fieldKey);
  var opts = field ? getCustomFieldOptions(field) : [];
  if (!opts.length && BUILTIN_SELECT_FALLBACKS[fieldKey]) opts = BUILTIN_SELECT_FALLBACKS[fieldKey];
  return opts;
}

function buildBulkSampleCsv(spaceId) {
  var typeOpts = bulkGetOptionList(spaceId, 'type');
  var priorityOpts = bulkGetOptionList(spaceId, 'priority');
  var teamEnabled = isSpaceBuiltinFieldEnabled(spaceId, 'team', 'create');
  var productTypeEnabled = isSpaceBuiltinFieldEnabled(spaceId, 'product_type', 'create');
  var teamOpts = teamEnabled ? bulkGetOptionList(spaceId, 'team') : [];
  var productTypeOpts = productTypeEnabled ? bulkGetOptionList(spaceId, 'product_type') : [];
  var todayIso = fmtDateISO(new Date());

  var columns = BULK_ISSUE_COLUMNS.filter(function (col) {
    if (col.key === 'team') return teamEnabled;
    if (col.key === 'product_type') return productTypeEnabled;
    return true;
  });
  var headerLabels = {
    title: 'Title', type: 'Type', priority: 'Priority', assignee_email: 'Assignee Email',
    reporter_email: 'Reporter Email', sprint: 'Sprint', story_points: 'Story Points',
    team: 'Team', product_type: 'Product Type', start_date: 'Start Date', due_date: 'Due Date',
    description: 'Description'
  };
  var lines = [csvRowToLine(columns.map(function (c) { return headerLabels[c.key]; }))];

  function sampleRow(overrides) {
    var base = {
      title: '', type: typeOpts[0] || '', priority: priorityOpts[0] || '',
      assignee_email: '', reporter_email: '', sprint: '', story_points: '',
      team: teamOpts[0] || '', product_type: productTypeOpts[0] || '',
      start_date: todayIso, due_date: '', description: ''
    };
    Object.assign(base, overrides);
    return columns.map(function (c) { return base[c.key]; });
  }

  lines.push(csvRowToLine(sampleRow({
    title: 'Example: fix the login redirect loop',
    story_points: '3',
    description: 'Plain text only -- formatting typed in a spreadsheet cell is not preserved.'
  })));
  lines.push(csvRowToLine(sampleRow({
    title: 'Example: leave a cell blank to skip that field',
    type: typeOpts[1] || typeOpts[0] || '',
    priority: priorityOpts[priorityOpts.length - 1] || '',
    team: '', product_type: '', story_points: '', start_date: '', description: ''
  })));

  // ﻿ BOM so Excel opens this as UTF-8 rather than guessing the system
  // codepage -- without it, anything non-ASCII typed into a cell later can
  // come back mangled the next time this same file round-trips through Excel.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function downloadBulkSampleCsv() {
  var spaceId = $('issueSpaceId') ? $('issueSpaceId').value : '';
  if (!spaceId) { toast('Select a Space on the Create Issue form first', 'error'); return; }
  var space = getSpace(spaceId);
  var csv = buildBulkSampleCsv(spaceId);
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'bulk-issues-' + (space ? space.key : 'sample') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
window.downloadBulkSampleCsv = downloadBulkSampleCsv;

// ── Client-side validation, mirroring the server's own checks ─────────────
// A field this codebase supports via CSV but that a space's admin has
// switched off for Create (applyBuiltinFieldVisibility) is treated as if the
// column were not there: any value in it is ignored, not an error, since the
// column itself is a fixed part of the shared sample CSV template and its
// presence says nothing about whether THIS space uses that field.
function bulkFieldEnabled(spaceId, fieldKey) {
  if (['title', 'type', 'priority', 'assignee', 'reporter', 'sprint', 'story_points', 'start_date', 'due_date', 'description'].indexOf(fieldKey) !== -1) return true;
  return isSpaceBuiltinFieldEnabled(spaceId, fieldKey, 'create');
}

var BULK_SUPPORTED_FIELD_KEYS = ['title', 'type', 'priority', 'assignee', 'reporter', 'sprint', 'story_points', 'team', 'product_type', 'start_date', 'due_date', 'description'];

function bulkParseDateForValidation(raw, label, errors) {
  var s = String(raw || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) {
    errors.push(label + ' is not a valid date (expected YYYY-MM-DD): "' + s + '"');
    return undefined;
  }
  return s;
}

function validateBulkRow(row, spaceId, ctx) {
  var errors = [];
  var title = String(row.title || '').trim();
  if (!title) errors.push('Title is required');
  else if (title.length > 500) errors.push('Title is too long (max 500 characters)');

  var typeVal = String(row.type || '').trim().toLowerCase() || (ctx.typeOpts[0] || 'task');
  if (bulkFieldEnabled(spaceId, 'type') && String(row.type || '').trim() && ctx.typeOpts.indexOf(typeVal) === -1) {
    errors.push('Type "' + row.type + '" is not configured for this space. Valid: ' + ctx.typeOpts.join(', '));
  }
  var priorityVal = String(row.priority || '').trim().toLowerCase() || (ctx.priorityOpts[0] || 'medium');
  if (bulkFieldEnabled(spaceId, 'priority') && String(row.priority || '').trim() && ctx.priorityOpts.indexOf(priorityVal) === -1) {
    errors.push('Priority "' + row.priority + '" is not configured for this space. Valid: ' + ctx.priorityOpts.join(', '));
  }
  if (ctx.teamEnabled && String(row.team || '').trim() && ctx.teamOpts.indexOf(String(row.team).trim()) === -1) {
    errors.push('Team "' + row.team + '" is not configured for this space. Valid: ' + ctx.teamOpts.join(', '));
  }
  if (ctx.productTypeEnabled && String(row.product_type || '').trim() && ctx.productTypeOpts.indexOf(String(row.product_type).trim().toLowerCase()) === -1) {
    errors.push('Product Type "' + row.product_type + '" is not configured for this space. Valid: ' + ctx.productTypeOpts.join(', '));
  }

  var storyPoints = null;
  var spRaw = String(row.story_points || '').trim();
  if (spRaw) {
    var n = Number(spRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) errors.push('Story Points must be a whole number 0 or greater: "' + spRaw + '"');
    else storyPoints = n;
  }

  var assigneeEmail = String(row.assignee_email || '').trim();
  if (assigneeEmail && !ctx.memberEmails.has(assigneeEmail.toLowerCase())) {
    errors.push('Assignee "' + assigneeEmail + '" is not a member of this space');
  }
  var reporterEmail = String(row.reporter_email || '').trim();
  if (reporterEmail && !ctx.memberEmails.has(reporterEmail.toLowerCase())) {
    errors.push('Reporter "' + reporterEmail + '" is not a member of this space');
  }

  var sprintName = String(row.sprint || '').trim();
  if (sprintName) {
    var matches = ctx.sprints.filter(function (sp) { return sp.name.toLowerCase() === sprintName.toLowerCase(); });
    if (!matches.length) errors.push('Sprint "' + sprintName + '" was not found (or is completed) in this space');
    else if (matches.length > 1) errors.push('Sprint "' + sprintName + '" matches more than one sprint in this space; rename one or leave this blank');
  }

  bulkParseDateForValidation(row.start_date, 'Start Date', errors);
  var startOk = !errors.some(function (e) { return e.indexOf('Start Date') === 0; });
  var dueOk0 = errors.length;
  bulkParseDateForValidation(row.due_date, 'Due Date', errors);
  var startDate = String(row.start_date || '').trim();
  var dueDate = String(row.due_date || '').trim();
  if (startOk && errors.length === dueOk0 && startDate && dueDate && startDate > dueDate) {
    errors.push('Due Date (' + dueDate + ') is before Start Date (' + startDate + ')');
  }

  // Required-field rules configured for this space (Settings -> Custom
  // Fields), applied to the type this row resolves to. A field this codebase
  // does not expose as a CSV column but that the space marks required blocks
  // the row outright, rather than silently creating a ticket that violates a
  // rule the admin configured on purpose.
  var fieldRows = getSpaceFieldRows(spaceId);
  fieldRows.forEach(function (field) {
    if (!fieldRequiredForType(field, typeVal)) return;
    if (!customFieldShowsIn(field, 'create')) return;
    if (field.is_builtin && field.field_key === 'title') return; // already checked above unconditionally
    var supportedKey = field.is_builtin ? field.field_key : null;
    if (!field.is_builtin || BULK_SUPPORTED_FIELD_KEYS.indexOf(supportedKey) === -1) {
      errors.push('Issue type "' + esc(typeVal) + '" requires "' + esc(field.name) + '" in this space, which bulk import does not support — create this ticket individually');
      return;
    }
    var csvKey = supportedKey === 'assignee' ? 'assignee_email' : supportedKey === 'reporter' ? 'reporter_email' : supportedKey;
    if (!String(row[csvKey] || '').trim()) {
      errors.push('"' + esc(field.name) + '" is required for issue type "' + esc(typeVal) + '" in this space');
    }
  });

  return {
    errors: errors,
    resolved: {
      title: title, type: typeVal, priority: priorityVal,
      assignee_email: assigneeEmail || undefined, reporter_email: reporterEmail || undefined,
      sprint: sprintName || undefined, story_points: storyPoints,
      team: ctx.teamEnabled ? (String(row.team || '').trim() || undefined) : undefined,
      product_type: ctx.productTypeEnabled ? (String(row.product_type || '').trim() || undefined) : undefined,
      start_date: startDate || undefined, due_date: dueDate || undefined,
      description: String(row.description || '')
    }
  };
}

function buildBulkValidationContext(spaceId) {
  var members = getSpaceMembers(spaceId);
  return {
    typeOpts: bulkGetOptionList(spaceId, 'type'),
    priorityOpts: bulkGetOptionList(spaceId, 'priority'),
    teamEnabled: isSpaceBuiltinFieldEnabled(spaceId, 'team', 'create'),
    productTypeEnabled: isSpaceBuiltinFieldEnabled(spaceId, 'product_type', 'create'),
    teamOpts: bulkGetOptionList(spaceId, 'team'),
    productTypeOpts: bulkGetOptionList(spaceId, 'product_type'),
    memberEmails: new Set(members.map(function (m) { return (m.email || '').toLowerCase(); }).filter(Boolean)),
    sprints: getIssueFormSprints(spaceId).map(function (sp) { return { id: sp.id, name: sp.name || '' }; })
  };
}

// ── Modal open/close/reset ─────────────────────────────────────────────────
function openBulkIssueModal() {
  var spaceId = $('issueSpaceId') ? $('issueSpaceId').value : '';
  if (!spaceId) { toast('Select a Space on the Create Issue form first', 'error'); return; }
  _bulkIssueSpaceId = spaceId;
  _bulkIssueValidRows = [];
  _bulkIssueParsedCount = 0;
  _bulkIssueBusy = false;
  var space = getSpace(spaceId);
  var nameEl = $('bulkIssueSpaceName');
  if (nameEl) nameEl.textContent = space ? (space.name + ' (' + space.key + ')') : '';
  var fileInput = $('bulkIssueFile');
  if (fileInput) fileInput.value = '';
  $('bulkIssuePreview').innerHTML = '';
  $('bulkIssuePreview').hidden = true;
  $('bulkIssueResult').innerHTML = '';
  $('bulkIssueResult').hidden = true;
  $('bulkIssueUploadStep').hidden = false;
  var confirmBtn = $('bulkIssueConfirmBtn');
  if (confirmBtn) { confirmBtn.hidden = true; confirmBtn.disabled = true; }
  var doneBtn = $('bulkIssueDoneBtn');
  if (doneBtn) doneBtn.hidden = true;
  openModal('modal-bulk-issue');
}
window.openBulkIssueModal = openBulkIssueModal;

function closeBulkIssueModal() {
  if (_bulkIssueBusy) return; // "no other action from the user" while creating
  closeModal('modal-bulk-issue');
}
window.closeBulkIssueModal = closeBulkIssueModal;

// ── File selection -> parse -> validate -> render preview ─────────────────
async function handleBulkIssueFileChange(input) {
  var file = input.files && input.files[0];
  input.value = ''; // so re-selecting the same file (after fixing it) fires change again
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    toast('Please choose a .csv file', 'error');
    return;
  }
  if (file.size > BULK_ISSUE_MAX_FILE_BYTES) {
    toast('That file is too large (max 2 MB) — split it into smaller batches', 'error');
    return;
  }
  var text;
  try { text = await file.text(); }
  catch (e) { toast('Could not read that file — ' + errorReason(e), 'error'); return; }

  var mapped = mapCsvToBulkRows(text);
  if (mapped.headerError) {
    toast(mapped.headerError, 'error');
    return;
  }
  if (!mapped.rows.length) {
    toast('That CSV has a header row but no data rows', 'error');
    return;
  }
  if (mapped.rows.length > BULK_ISSUE_MAX_ROWS) {
    toast('That CSV has ' + mapped.rows.length + ' rows — the limit is ' + BULK_ISSUE_MAX_ROWS + ' per import. Split it into smaller batches.', 'error');
    return;
  }

  var ctx = buildBulkValidationContext(_bulkIssueSpaceId);
  var results = mapped.rows.map(function (row, i) {
    var v = validateBulkRow(row, _bulkIssueSpaceId, ctx);
    return { rowNum: i + 2, errors: v.errors, resolved: v.resolved }; // +2: header is row 1, data starts at row 2
  });
  _bulkIssueParsedCount = results.length;
  _bulkIssueValidRows = results.filter(function (r) { return !r.errors.length; }).map(function (r) { return r.resolved; });
  renderBulkIssuePreview(results);
}
window.handleBulkIssueFileChange = handleBulkIssueFileChange;

function renderBulkIssuePreview(results) {
  var validCount = _bulkIssueValidRows.length;
  var invalidCount = results.length - validCount;
  var summary = el('div', { class: 'bulk-issue-summary' });
  summary.appendChild(el('strong', { text: validCount + ' of ' + results.length + ' row' + (results.length === 1 ? '' : 's') + ' ready to create' }));
  if (invalidCount) {
    summary.appendChild(el('div', {
      class: 'bulk-issue-summary-warn',
      text: invalidCount + ' row' + (invalidCount === 1 ? '' : 's') + ' will be SKIPPED due to the errors below. Fix them in the CSV and re-import if you want those included too.'
    }));
  }

  var list = el('div', { class: 'bulk-issue-row-list' });
  results.forEach(function (r) {
    var item = el('div', { class: 'bulk-issue-row-item ' + (r.errors.length ? 'is-invalid' : 'is-valid') });
    var head = el('div', { class: 'bulk-issue-row-head' });
    head.appendChild(el('span', { class: 'bulk-issue-row-num', text: 'Row ' + r.rowNum }));
    head.appendChild(el('span', { class: 'bulk-issue-row-title', text: r.resolved.title || '(no title)' }));
    head.appendChild(el('span', { class: 'bulk-issue-row-badge', text: r.errors.length ? 'Will be skipped' : 'Ready' }));
    item.appendChild(head);
    if (r.errors.length) {
      var errList = el('ul', { class: 'bulk-issue-row-errors' });
      r.errors.forEach(function (msg) { errList.appendChild(el('li', { text: msg })); });
      item.appendChild(errList);
    }
    list.appendChild(item);
  });

  var preview = $('bulkIssuePreview');
  preview.innerHTML = '';
  preview.appendChild(summary);
  preview.appendChild(list);
  preview.hidden = false;

  var confirmBtn = $('bulkIssueConfirmBtn');
  if (confirmBtn) {
    confirmBtn.hidden = false;
    confirmBtn.disabled = validCount === 0;
    confirmBtn.textContent = validCount ? ('Create ' + validCount + ' Ticket' + (validCount === 1 ? '' : 's')) : 'No valid rows to create';
  }
}

// Small DOM-builder so every value here goes through textContent, never a
// concatenated HTML string -- CSV cells are exactly the kind of "one person's
// input, rendered for others" content the rest of this app had to retrofit
// escaping onto, so this file starts safe rather than needing the same fix
// later.
function el(tag, opts) {
  var e = document.createElement(tag);
  opts = opts || {};
  if (opts.class) e.className = opts.class;
  if (opts.text != null) e.textContent = opts.text;
  return e;
}

// ── Confirm: send the batch, lock the modal, show the outcome ─────────────
async function confirmBulkIssueCreate() {
  if (_bulkIssueBusy || !_bulkIssueValidRows.length) return;
  _bulkIssueBusy = true;
  var confirmBtn = $('bulkIssueConfirmBtn');
  var cancelBtn = $('bulkIssueCancelBtn');
  var closeBtn = $('bulkIssueCloseBtn');
  var fileInput = $('bulkIssueFile');
  [confirmBtn, cancelBtn, closeBtn, fileInput].forEach(function (b) { if (b) b.disabled = true; });
  if (confirmBtn) confirmBtn.textContent = 'Creating ' + _bulkIssueValidRows.length + ' ticket' + (_bulkIssueValidRows.length === 1 ? '' : 's') + '… please wait';

  try {
    var res = await api('/api/issues/bulk-import', 'POST', {
      space_id: _bulkIssueSpaceId,
      rows: _bulkIssueValidRows
    }, { silent: true });
    renderBulkIssueResult(res);
    refreshData();
  } catch (e) {
    toast('Bulk import failed — ' + errorReason(e), 'error');
    [confirmBtn, cancelBtn, closeBtn, fileInput].forEach(function (b) { if (b) b.disabled = false; });
    if (confirmBtn) confirmBtn.textContent = 'Create ' + _bulkIssueValidRows.length + ' Tickets';
  } finally {
    _bulkIssueBusy = false;
  }
}
window.confirmBulkIssueCreate = confirmBulkIssueCreate;

function renderBulkIssueResult(res) {
  $('bulkIssueUploadStep').hidden = true;
  $('bulkIssuePreview').hidden = true;
  var confirmBtn = $('bulkIssueConfirmBtn');
  if (confirmBtn) confirmBtn.hidden = true;
  var cancelBtn = $('bulkIssueCancelBtn');
  if (cancelBtn) cancelBtn.hidden = true;

  var created = res.created || [];
  var failed = res.failed || [];
  var wrap = el('div', { class: 'bulk-issue-result' });
  wrap.appendChild(el('div', {
    class: 'bulk-issue-result-summary',
    text: 'Created ' + created.length + ' of ' + res.total + ' ticket' + (res.total === 1 ? '' : 's') + (failed.length ? ', ' + failed.length + ' failed' : '') + '.'
  }));
  if (created.length) {
    var createdList = el('div', { class: 'bulk-issue-result-keys' });
    created.forEach(function (c) {
      var link = el('a', { class: 'bulk-issue-result-key', text: c.key });
      link.href = '#';
      link.onclick = (function (issueId) { return function (e) { e.preventDefault(); closeBulkIssueModal(); closeModal('modal-issue'); openIssuePage(issueId); }; })(c.id);
      createdList.appendChild(link);
    });
    wrap.appendChild(createdList);
  }
  if (failed.length) {
    var failHead = el('div', { class: 'bulk-issue-summary-warn', text: 'These rows were not created:' });
    wrap.appendChild(failHead);
    var failList = el('div', { class: 'bulk-issue-row-list' });
    failed.forEach(function (f) {
      var item = el('div', { class: 'bulk-issue-row-item is-invalid' });
      var head = el('div', { class: 'bulk-issue-row-head' });
      head.appendChild(el('span', { class: 'bulk-issue-row-num', text: 'Row ' + f.row }));
      head.appendChild(el('span', { class: 'bulk-issue-row-title', text: f.title }));
      item.appendChild(head);
      var errList = el('ul', { class: 'bulk-issue-row-errors' });
      (f.errors || []).forEach(function (msg) { errList.appendChild(el('li', { text: msg })); });
      item.appendChild(errList);
      failList.appendChild(item);
    });
    wrap.appendChild(failList);
  }
  var resultEl = $('bulkIssueResult');
  resultEl.innerHTML = '';
  resultEl.appendChild(wrap);
  resultEl.hidden = false;

  var doneBtn = $('bulkIssueDoneBtn');
  if (doneBtn) { doneBtn.hidden = false; doneBtn.disabled = false; }
  var closeBtn = $('bulkIssueCloseBtn');
  if (closeBtn) closeBtn.disabled = false;

  toast(created.length + ' ticket' + (created.length === 1 ? '' : 's') + ' created' + (failed.length ? (', ' + failed.length + ' failed') : ''), failed.length && !created.length ? 'error' : 'success');
}

function finishBulkIssueImport() {
  closeModal('modal-bulk-issue');
  closeModal('modal-issue');
}
window.finishBulkIssueImport = finishBulkIssueImport;
