
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
// Every field the space has configured to show on Create gets a CSV column:
// the fixed issues-row fields below (Title, Type, Priority, Assignee,
// Reporter, Sprint, Story Points, Team, Product Type, dates, Description),
// PLUS one column per remaining field the space shows on Create — the
// builtin Combination field and any genuinely custom field (text, number,
// date, select, multi_select, checkbox, user) alike — named after that
// field, generated fresh per space by buildBulkSampleCsv/bulkGetDynamicFields
// below. Only attachments are not supported via CSV (a spreadsheet cell
// cannot hold a file) — add those to the ticket after creating it.

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
function mapCsvToBulkRows(csvText, spaceId) {
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
  // Dynamic (per-space) fields — matched by the field's own name, using the
  // same case/whitespace-tolerant normalization as the fixed columns above.
  var dynamicFields = spaceId ? bulkGetDynamicFields(spaceId) : [];
  var dynamicColIndex = {};
  dynamicFields.forEach(function (field) {
    var target = normalizeCsvHeaderCell(field.name);
    for (var i = 0; i < header.length; i++) {
      if (header[i] === target) { dynamicColIndex[field.id] = i; break; }
    }
  });

  var dataRows = table.slice(1).filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  var rows = dataRows.map(function (r) {
    var obj = {};
    BULK_ISSUE_COLUMNS.forEach(function (col) {
      var idx = colIndex[col.key];
      obj[col.key] = idx != null ? (r[idx] != null ? String(r[idx]) : '') : '';
    });
    obj._dynamic = {};
    dynamicFields.forEach(function (field) {
      var idx = dynamicColIndex[field.id];
      if (idx != null) obj._dynamic[field.id] = r[idx] != null ? String(r[idx]) : '';
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

// The builtin fields that live directly on the issues table row, each with
// its own fixed CSV column above. Everything else the space shows on Create
// -- the builtin Combination field included -- is a "dynamic" field: a
// separate custom_fields row, keyed by its own id, whose value is stored via
// issue_field_values after the ticket is created (see bulkGetDynamicFields).
var BULK_ISSUES_ROW_FIELD_KEYS = ['title', 'type', 'priority', 'assignee', 'reporter', 'sprint', 'story_points', 'team', 'product_type', 'start_date', 'due_date', 'description'];

// Every OTHER field this space shows on Create, in a stable order (position,
// same as the real form) so the generated header does not reshuffle between
// downloads. A same-named field would collide as a CSV header, so a later
// duplicate name is skipped defensively -- custom field creation already
// enforces unique names per space, so this should never actually trigger.
function bulkGetDynamicFields(spaceId) {
  var seen = {};
  return getSpaceFieldRows(spaceId)
    .filter(function (f) {
      if (f.is_builtin && BULK_ISSUES_ROW_FIELD_KEYS.indexOf(f.field_key) !== -1) return false;
      if (!customFieldShowsIn(f, 'create')) return false;
      var key = (f.name || '').toLowerCase().trim();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
}

// A useful example value for the sample CSV's first data row. Select-type
// fields get a real configured option (so the shape is obvious); anything
// else (text, number, date, checkbox, user, or a genuinely custom field with
// unpredictable content) is left blank, same as Assignee/Reporter/Sprint
// already are -- guessing free-form content risks the user keeping the
// placeholder by accident.
function bulkDynamicFieldExample(field) {
  if (isCombinationField(field)) {
    var flat = getCustomFieldOptions(field);
    return flat[0] || '';
  }
  if (field.field_type === 'select') return getCustomFieldOptions(field)[0] || '';
  if (field.field_type === 'multi_select') return getCustomFieldOptions(field).slice(0, 2).join(';');
  return '';
}

function bulkSlugForFilename(s) {
  return String(s || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildBulkSampleCsv(spaceId) {
  var typeOpts = bulkGetOptionList(spaceId, 'type');
  var priorityOpts = bulkGetOptionList(spaceId, 'priority');
  var teamEnabled = isSpaceBuiltinFieldEnabled(spaceId, 'team', 'create');
  var productTypeEnabled = isSpaceBuiltinFieldEnabled(spaceId, 'product_type', 'create');
  var teamOpts = teamEnabled ? bulkGetOptionList(spaceId, 'team') : [];
  var productTypeOpts = productTypeEnabled ? bulkGetOptionList(spaceId, 'product_type') : [];
  var todayIso = fmtDateISO(new Date());
  var dynamicFields = bulkGetDynamicFields(spaceId);

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
  var fixedHeader = columns.map(function (c) { return headerLabels[c.key]; });
  var dynamicHeader = dynamicFields.map(function (f) { return f.name; });
  var lines = [csvRowToLine(fixedHeader.concat(dynamicHeader))];

  function sampleRow(overrides, dynamicOverrides) {
    var base = {
      title: '', type: typeOpts[0] || '', priority: priorityOpts[0] || '',
      assignee_email: '', reporter_email: '', sprint: '', story_points: '',
      team: teamOpts[0] || '', product_type: productTypeOpts[0] || '',
      start_date: todayIso, due_date: '', description: ''
    };
    Object.assign(base, overrides);
    var fixedCells = columns.map(function (c) { return base[c.key]; });
    var dynamicCells = dynamicFields.map(function (f) {
      return (dynamicOverrides && Object.prototype.hasOwnProperty.call(dynamicOverrides, f.id))
        ? dynamicOverrides[f.id] : bulkDynamicFieldExample(f);
    });
    return fixedCells.concat(dynamicCells);
  }

  lines.push(csvRowToLine(sampleRow({
    title: 'Example: fix the login redirect loop',
    story_points: '3',
    description: 'Plain text only -- formatting typed in a spreadsheet cell is not preserved.'
  })));
  var blankDynamic = {};
  dynamicFields.forEach(function (f) { blankDynamic[f.id] = ''; });
  lines.push(csvRowToLine(sampleRow({
    title: 'Example: leave a cell blank to skip that field',
    type: typeOpts[1] || typeOpts[0] || '',
    priority: priorityOpts[priorityOpts.length - 1] || '',
    team: '', product_type: '', story_points: '', start_date: '', description: ''
  }, blankDynamic)));

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
  // Named after the space itself (name + key), not a generic "sample", so a
  // user juggling several spaces' CSVs can tell them apart in their Downloads
  // folder without opening each one.
  a.download = 'bulk-issues-' + (space ? (bulkSlugForFilename(space.name) + '-' + space.key) : 'sample') + '.csv';
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

// Date.parse (and the JS Date constructor generally) does not reject an
// out-of-range calendar date -- it silently rolls it forward, so
// Date.parse('2026-02-30T00:00:00Z') "succeeds" as March 2. A round trip
// through Date.UTC and back is the only way to actually catch that: if the
// year/month/day we asked for don't match what comes back, the input
// overflowed and must be rejected, not silently corrected.
function isRealCalendarDate(year, month, day) {
  var dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// Mirrors bulkNormalizeDate in src/server/routes/issues.js -- keep both in
// step. Excel silently reformats a typed date into the system's regional
// format when the CSV is saved (09-12-2003, 09/12/2003, ...), so a strict
// YYYY-MM-DD-only check rejects perfectly good dates with a message that does
// not explain why. This also accepts DD-MM-YYYY / DD/MM/YYYY -- always
// day-first, never guessed by magnitude -- since that is this org's own
// convention and a magnitude-based guess (e.g. treating "12-25-2026" as
// month-first only because 25 can't be a month) would be a second implicit
// rule nobody asked for. A day-first value that is not a real calendar date
// (month or day out of range) is still rejected, not silently reinterpreted.
function bulkParseDateForValidation(raw, label, errors) {
  var s = String(raw || '').trim();
  if (!s) return null;

  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (iso) {
    var isoYear = parseInt(iso[1], 10), isoMonth = parseInt(iso[2], 10), isoDay = parseInt(iso[3], 10);
    if (isoMonth < 1 || isoMonth > 12 || isoDay < 1 || isoDay > 31 || !isRealCalendarDate(isoYear, isoMonth, isoDay)) {
      errors.push(label + ' is not a real date: "' + s + '"');
      return undefined;
    }
    return iso[1] + '-' + iso[2] + '-' + iso[3];
  }

  var dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmy) {
    var day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10), year = parseInt(dmy[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || !isRealCalendarDate(year, month, day)) {
      errors.push(label + ' is not a valid date (read as day-first, DD-MM-YYYY): "' + s + '"');
      return undefined;
    }
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  errors.push(label + ' is not a valid date (expected YYYY-MM-DD or DD-MM-YYYY): "' + s + '". ' +
    'Tip: if you are editing this in Excel, format the column as Text before typing dates, ' +
    'otherwise Excel may rewrite them into your regional date format when you save.');
  return undefined;
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
  if (ctx.productTypeEnabled && String(row.product_type || '').trim() && ctx.productTypeOpts.indexOf(String(row.product_type).trim()) === -1) {
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

  var dueOk0 = errors.length;
  var startDate = bulkParseDateForValidation(row.start_date, 'Start Date', errors);
  var dueDate = bulkParseDateForValidation(row.due_date, 'Due Date', errors);
  if (errors.length === dueOk0 && startDate && dueDate && startDate > dueDate) {
    errors.push('Due Date (' + dueDate + ') is before Start Date (' + startDate + ')');
  }

  // Required-field rules for the fixed issues-row fields (Settings -> Custom
  // Fields), applied to the type this row resolves to.
  var fieldRows = getSpaceFieldRows(spaceId);
  fieldRows.forEach(function (field) {
    if (!field.is_builtin || BULK_ISSUES_ROW_FIELD_KEYS.indexOf(field.field_key) === -1) return;
    if (!fieldRequiredForType(field, typeVal)) return;
    if (!customFieldShowsIn(field, 'create')) return;
    if (field.field_key === 'title') return; // already checked above unconditionally
    var csvKey = field.field_key === 'assignee' ? 'assignee_email' : field.field_key === 'reporter' ? 'reporter_email' : field.field_key;
    if (!String(row[csvKey] || '').trim()) {
      errors.push('"' + esc(field.name) + '" is required for issue type "' + esc(typeVal) + '" in this space');
    }
  });

  // Every OTHER field this space shows on Create -- the builtin Combination
  // field and any genuinely custom field alike -- gets its value from its own
  // dynamic CSV column (matched by field name in mapCsvToBulkRows) and is
  // resolved/validated here by its actual field_type. A resolved value goes
  // into customFieldValues, keyed by field id, and is stored via
  // issue_field_values after the ticket is created — exactly like the normal
  // Create Issue form already does for these fields.
  var customFieldValues = {};
  bulkGetDynamicFields(spaceId).forEach(function (field) {
    var raw = (row._dynamic && row._dynamic[field.id] != null) ? String(row._dynamic[field.id]) : '';
    var trimmed = raw.trim();
    if (!trimmed) {
      if (fieldRequiredForType(field, typeVal)) {
        errors.push('"' + esc(field.name) + '" is required for issue type "' + esc(typeVal) + '" in this space');
      }
      return;
    }

    if (isCombinationField(field)) {
      var comboOpts = getCustomFieldOptions(field);
      var comboMatch = comboOpts.filter(function (o) { return String(o).toLowerCase() === trimmed.toLowerCase(); })[0];
      if (!comboMatch) {
        errors.push('"' + esc(field.name) + '" value "' + trimmed + '" is not one of this space\'s configured combinations');
        return;
      }
      // If this field carries per-Product-Type groups and a Product Type was
      // given, the chosen combination must actually belong to that group —
      // otherwise a combination valid only for "Content" could silently
      // attach itself to a "Message" ticket.
      var parsed = (typeof parseCombinationFieldOptions === 'function') ? parseCombinationFieldOptions(field) : null;
      var ptVal = ctx.productTypeEnabled ? String(row.product_type || '').trim() : '';
      if (parsed && parsed.groups && ptVal && parsed.groups[ptVal] && parsed.groups[ptVal].length &&
          parsed.groups[ptVal].map(function (o) { return String(o).toLowerCase(); }).indexOf(comboMatch.toLowerCase()) === -1) {
        errors.push('"' + esc(field.name) + '" value "' + comboMatch + '" is not available for Product Type "' + esc(ptVal) + '"');
        return;
      }
      customFieldValues[field.id] = comboMatch;
      return;
    }

    var ftype = field.field_type;
    if (ftype === 'select' || ftype === 'multi_select') {
      var opts = getCustomFieldOptions(field);
      var tokens = ftype === 'multi_select' ? trimmed.split(';').map(function (s) { return s.trim(); }).filter(Boolean) : [trimmed];
      var resolvedTokens = [], badTokens = [];
      tokens.forEach(function (t) {
        var m = opts.filter(function (o) { return String(o).toLowerCase() === t.toLowerCase(); })[0];
        if (m) resolvedTokens.push(m); else badTokens.push(t);
      });
      if (badTokens.length) {
        errors.push('"' + esc(field.name) + '" value "' + badTokens.join('", "') + '" not configured for this field. Valid: ' + opts.join(', '));
        return;
      }
      customFieldValues[field.id] = resolvedTokens.join(',');
    } else if (ftype === 'number') {
      var n2 = Number(trimmed);
      if (!Number.isFinite(n2)) { errors.push('"' + esc(field.name) + '" must be a number: "' + trimmed + '"'); return; }
      customFieldValues[field.id] = String(n2);
    } else if (ftype === 'date') {
      var dErrs = [];
      var dVal = bulkParseDateForValidation(trimmed, field.name, dErrs);
      if (dErrs.length) { errors.push.apply(errors, dErrs); return; }
      if (dVal) customFieldValues[field.id] = dVal;
    } else if (ftype === 'checkbox') {
      var boolStr = trimmed.toLowerCase();
      if (['true', 'yes', '1'].indexOf(boolStr) !== -1) {
        customFieldValues[field.id] = 'true';
      } else if (['false', 'no', '0'].indexOf(boolStr) === -1) {
        errors.push('"' + esc(field.name) + '" must be true/false, yes/no, or 1/0: "' + trimmed + '"');
      }
      // false/no/0 -> leave unset, matching how an unchecked box on the real form never sets a value
    } else if (ftype === 'user') {
      var email = trimmed.toLowerCase();
      if (!ctx.memberEmails.has(email)) {
        errors.push('"' + esc(field.name) + '" value "' + trimmed + '" is not a member of this space (match by email)');
        return;
      }
      customFieldValues[field.id] = email; // resolved to a user id server-side, same as Assignee/Reporter
    } else {
      // text / textarea, and any future type this file has not special-cased
      customFieldValues[field.id] = trimmed;
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
      description: String(row.description || ''),
      custom_field_values: Object.keys(customFieldValues).length ? customFieldValues : undefined
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

  var mapped = mapCsvToBulkRows(text, _bulkIssueSpaceId);
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
