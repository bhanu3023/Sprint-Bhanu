
// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const visLabel = (v) => ({ private: 'Private', team: 'Team', org: 'Organization' }[v] || cap(v || 'private'));
const esc = (str) => {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
};

// esc() goes through textContent -> innerHTML, which escapes & < > but NOT
// quotes — safe for element text, NOT safe inside an HTML attribute. Use this
// whenever a value is interpolated into attr="..." or attr='...', or a title
// containing a quote silently terminates the attribute.
const escAttr = (str) => esc(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function stripHtmlForDisplay(html) {
  if (!html) return '';
  var s = String(html);
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  var d = document.createElement('div');
  d.innerHTML = s;
  return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
}

function truncateForHistory(text, max) {
  max = max || 120;
  if (!text) return text;
  var s = String(text);
  if (s.length <= max) return s;
  return s.substring(0, max).trim() + '…';
}

function htmlFieldIsEmpty(html) {
  return !stripHtmlForDisplay(html);
}

function normalizeRichTextForCompare(html) {
  if (!html) return '';
  var d = document.createElement('div');
  d.innerHTML = String(html);
  d.querySelectorAll('br').forEach(function (br) {
    br.replaceWith(document.createTextNode('\n'));
  });
  ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'].forEach(function (tag) {
    d.querySelectorAll(tag).forEach(function (el) {
      el.appendChild(document.createTextNode('\n'));
    });
  });
  var text = (d.textContent || d.innerText || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
  var lines = text.split('\n').map(function (line) {
    return line.replace(/\s+/g, ' ').trim();
  });
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines.join('\n');
}

function richTextMediaSignature(html) {
  if (!html) return '';
  var d = document.createElement('div');
  d.innerHTML = String(html);
  var parts = [];
  d.querySelectorAll('img[src]').forEach(function (img) {
    parts.push('img:' + (img.getAttribute('src') || ''));
  });
  d.querySelectorAll('a[href]').forEach(function (a) {
    parts.push('a:' + (a.getAttribute('href') || '') + '|' + (a.textContent || '').trim());
  });
  return parts.join(';');
}

// Tag-name sequence only (no attributes/styles) -- a change here means pure
// formatting changed (bold/bullet-list/heading applied to the same words)
// even though normalizeRichTextForCompare's plain-text view sees no
// difference at all. Without this, reformatting existing text and clicking
// Save was a silent no-op: the button stayed clickable, the click handler's
// own richTextHasMeaningfulChange re-check said "nothing changed", and the
// old, unformatted text just stayed in the database.
function richTextTagSignature(html) {
  if (!html) return '';
  var d = document.createElement('div');
  d.innerHTML = String(html);
  var tags = [];
  d.querySelectorAll('*').forEach(function (el) { tags.push(el.tagName); });
  return tags.join(',');
}

// ── Scoped undo/redo for rich-text editors ──────────────────
// Native Ctrl+Z on contenteditable is not reliably scoped per element in
// Chromium/Edge — with several contenteditable regions on one page (here:
// Description, Fix Description, the comment box), the browser's own undo
// history can be shared across all of them, so undoing inside the comment
// box could pop a change from an entirely different field that was edited
// (and already saved) earlier — reported as "Ctrl+Z in the comment box
// reverts the description". Each field gets its own real, self-contained
// undo/redo stack instead, and native undo/redo is blocked for these fields
// entirely so the browser's shared history can never be reached from them.
// Call again (safe/cheap) whenever an editor's content is freshly set (drawer
// opened for a different issue, comment edit box (re)built) to reset the
// stack to that content — the event bindings themselves attach only once.
function attachScopedUndo(el) {
  if (!el) return;
  el._undoStack = [el.innerHTML];
  el._redoStack = [];
  if (el._scopedUndoBound) return;
  el._scopedUndoBound = true;
  function snapshot() {
    var last = el._undoStack[el._undoStack.length - 1];
    if (el.innerHTML === last) return;
    el._undoStack.push(el.innerHTML);
    if (el._undoStack.length > 50) el._undoStack.shift();
    el._redoStack = [];
  }
  function placeCaretAtEnd() {
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  el.addEventListener('input', function () {
    clearTimeout(el._undoTimer);
    el._undoTimer = setTimeout(snapshot, 350);
  });
  el.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = e.key.toLowerCase();
    var isUndo = key === 'z' && !e.shiftKey;
    var isRedo = (key === 'z' && e.shiftKey) || key === 'y';
    if (!isUndo && !isRedo) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(el._undoTimer);
    snapshot(); // capture whatever was typed right before undo, so it isn't lost
    if (isRedo) {
      if (!el._redoStack.length) return;
      el._undoStack.push(el._redoStack.pop());
    } else {
      if (el._undoStack.length <= 1) return;
      el._redoStack.push(el._undoStack.pop());
    }
    el.innerHTML = el._undoStack[el._undoStack.length - 1];
    placeCaretAtEnd();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function richTextHasMeaningfulChange(originalHtml, currentHtml) {
  if (normalizeRichTextForCompare(originalHtml) !== normalizeRichTextForCompare(currentHtml)) return true;
  if (richTextTagSignature(originalHtml) !== richTextTagSignature(currentHtml)) return true;
  return richTextMediaSignature(originalHtml) !== richTextMediaSignature(currentHtml);
}

function updateDrawerDescEditorState(editorId, originalHtml) {
  var map = {
    drawerDesc: { btns: 'drawerDescBtns', save: 'drawerDescSave' },
    drawerFixDesc: { btns: 'drawerFixDescBtns', save: 'drawerFixDescSave' }
  };
  var cfg = map[editorId];
  if (!cfg) return;
  var el = $(editorId);
  var btns = $(cfg.btns);
  var saveBtn = $(cfg.save);
  if (!el || !btns || !saveBtn) return;
  var changed = richTextHasMeaningfulChange(originalHtml || '', el.innerHTML);
  btns.style.display = 'flex';
  // Dimmed look only — never the native `disabled` attribute. A browser never
  // dispatches click on a disabled button at all, so if this recompute (fired
  // from onfocus/oninput/a blur-triggered auto-linkify pass) landed disabled=true
  // in the same gesture as a click on Save, that click would be silently
  // swallowed before the handler below ever ran — no error, no save, the only
  // visible effect being the description losing focus. The click handler
  // re-checks richTextHasMeaningfulChange itself, so it stays a correct no-op
  // when there is truly nothing to save; it just can never be a SILENT one.
  saveBtn.style.opacity = changed ? '1' : '0.45';
  saveBtn.style.cursor = changed ? 'pointer' : 'not-allowed';
}

function markDrawerDescDirty(editorId) {
  var origKey = editorId === 'drawerDesc' ? '_drawerDescOriginalHtml' : '_drawerFixDescOriginalHtml';
  updateDrawerDescEditorState(editorId, window[origKey] || '');
}

// Maps a built-in field_key to how to read its value in the drawer and on a
// plain issue record, so the Done check can be driven by the space's configured
// required fields instead of a fixed list.
var DONE_BUILTIN_READERS = {
  title:           { el: 'drawerTitle',       issue: 'title' },
  type:            { el: 'drawerType',        issue: 'type' },
  priority:        { el: 'drawerPriority',    issue: 'priority' },
  assignee:        { el: 'drawerAssignee',    issue: 'assignee_id' },
  reporter:        { el: 'drawerReporter',    issue: 'reporter_id' },
  sprint:          { el: 'drawerSprint',      issue: 'sprint_id' },
  story_points:    { el: 'drawerPoints',      issue: 'story_points', numeric: true },
  team:            { el: 'drawerTeam',        issue: 'team' },
  product_type:    { el: 'drawerProductType', issue: 'product_type' },
  start_date:      { el: 'drawerStartDate',   issue: 'start_date' },
  due_date:        { el: 'drawerDueDate',     issue: 'due_date' },
  description:     { el: 'drawerDesc',        issue: 'description',     html: true },
  fix_description: { el: 'drawerFixDesc',     issue: 'fix_description', html: true }
};

// A custom field's saved value for an issue, from whichever cache has it.
function doneCustomFieldStoredValue(issueId, fieldId) {
  var d = window._drawerIssueData;
  if (d && String(d.id) === String(issueId) && Array.isArray(d.custom_field_values)) {
    var hit = d.custom_field_values.find(function (v) { return String(v.field_id) === String(fieldId); });
    if (hit) return hit.value;
  }
  var bulk = (S.data.issue_field_values || []).find(function (v) {
    return String(v.issue_id) === String(issueId) && String(v.field_id) === String(fieldId);
  });
  return bulk ? bulk.value : '';
}

function validateIssueForDone(issueOrId) {
  var issue = (issueOrId && typeof issueOrId === 'object') ? issueOrId : null;
  var issueId = issue ? issue.id : issueOrId;
  var missing = [];
  var useDrawer = issueId && S.drawerIssueId === issueId && $('drawerDesc') && $('drawerFixDesc');

  var type = ((issue && issue.type) || (window._drawerIssueData && window._drawerIssueData.type) || 'task').toLowerCase();
  var spaceId = (issue && issue.space_id) || (window._drawerIssueData && window._drawerIssueData.space_id) || S.currentSpace;
  var comboMode = productTypeMode(spaceId, 'drawer') === 'combo';

  // Driven by Settings → Custom Fields, exactly like the create form: a field
  // blocks Done when it is Required, applies to THIS issue type, and is shown in
  // the Issue drawer. Replaces the old fixed list (Description, Fix Description,
  // Sprint, Team, Assignee, Story Points), which no admin could change and which
  // demanded Story Points on bugs.
  getSpaceFieldRows(spaceId).forEach(function (field) {
    if (!fieldRequiredForType(field, type)) return;
    if (!customFieldShowsIn(field, 'drawer')) return;
    if (isCombinationField(field)) return;               // handled by the combo block below
    // In combo mode the plain Product Type control is hidden and the picker owns
    // the value, so let the combo block check it — reading the hidden select here
    // would always look empty and block Done.
    if (field.field_key === 'product_type' && comboMode) return;

    if (field.is_builtin) {
      var r = DONE_BUILTIN_READERS[field.field_key];
      if (!r) return;                                    // nothing readable → never block
      // The stored value, from whichever record we have.
      var fromRecord = function () {
        if (issue && issue[r.issue] !== undefined) return issue[r.issue];
        var d = window._drawerIssueData;
        return d ? d[r.issue] : undefined;
      };
      var raw;
      if (useDrawer && $(r.el)) {
        var ctl = $(r.el);
        raw = r.html ? ctl.innerHTML : ctl.value;
        // Not every drawer field is a form control — Type is a <span> badge, so
        // .value is undefined. Reading that as "empty" made Done complain that
        // Type was missing on a ticket that plainly had a type. Fall back to the
        // record whenever the element has no value to give.
        if (!r.html && raw === undefined) raw = fromRecord();
      } else {
        raw = fromRecord();
      }
      var empty;
      if (r.html) empty = htmlFieldIsEmpty(raw);
      // 0 is a legitimate estimate (a trivial change, or a spike that carries no
      // points), so only a BLANK box counts as unfilled. The old rule used
      // Number(raw) <= 0, which rejected 0 here while the create form accepted it
      // — the same ticket could be created but never closed.
      else if (r.numeric) {
        var n = String(raw == null ? '' : raw).trim();
        empty = (n === '' || !isFinite(Number(n)));
      }
      else empty = !raw;
      if (empty) missing.push(field.name || field.field_key);
      return;
    }

    // Custom field: read the drawer input, else the cached issue_field_values.
    var val = '';
    if (useDrawer) {
      var input = document.querySelector('#drawerCustomFields [data-cf-id="' + field.id + '"]');
      if (input) val = input.type === 'checkbox' ? (input.checked ? '1' : '') : (input.value || '');
      else val = doneCustomFieldStoredValue(issueId, field.id);
    } else {
      val = doneCustomFieldStoredValue(issueId, field.id);
    }
    if (!String(val == null ? '' : val).trim()) missing.push(field.name);
  });

  // Only spaces using the COMBINED picker have a Product Type + Combination
  // requirement for Done. Deliberately not extended to plain-dropdown spaces:
  // Product Type is seeded into every space, so keying off that would suddenly
  // block Done on boards that never had this rule. Keeping it on combo mode
  // leaves today's behaviour intact and also stops a Product_Team space whose
  // Combination field was removed from being unable to reach Done at all
  // (the old check read an empty picker and always reported Product Type missing).
  if (comboMode) {
    var meta = findCombinationFieldMeta(spaceId);
    var comboVal = null;
    if (!useDrawer && issue && meta && meta.id) {
      var cfv = (S.data.issue_field_values || []).find(function (v) {
        return String(v.issue_id) === String(issue.id) && String(v.field_id) === String(meta.id);
      });
      comboVal = cfv ? cfv.value : null;
    }
    var sel = useDrawer
      ? (_drawerPtComboSel || readPtComboSelectionFromContainer($('drawerCombinationField')))
      : parsePtComboSelection(issue && issue.product_type, comboVal);
    if (!sel || !sel.productTypes || !sel.productTypes.length) {
      missing.push('Product Type');
    } else {
      // A type only REQUIRES picking a combination if this space actually has
      // at least one configured for it -- every type has its own group now
      // (see getCombinationsForProductType), and one an admin hasn't filled
      // in yet has nothing valid to select, so it shouldn't block Done on a
      // field with no real options.
      var needsCombo = sel.productTypes.some(function (t) {
        return getCombinationsForProductType(t, meta).length > 0;
      });
      if (needsCombo && (!sel.combinations || !sel.combinations.length)) missing.push('Combination');
    }
  }

  return missing;
}

function canTransitionIssueToDone(issueOrId, previousStatus) {
  var missing = validateIssueForDone(issueOrId);
  if (!missing.length) return true;
  toast('Fill required fields before marking Done: ' + missing.join(', '), 'error');
  if (S.drawerIssueId && $('drawerStatus')) {
    var revert = previousStatus
      || (window._drawerIssueData && window._drawerIssueData.status)
      || 'To Do';
    $('drawerStatus').value = revert;
    updateStatusBtn(revert);
  }
  return false;
}

function isMentionBoundaryChar(ch) {
  return !ch || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u00a0';
}

function findActiveMentionAt(textBefore) {
  if (!textBefore) return null;
  for (var i = textBefore.length - 1; i >= 0; i--) {
    if (textBefore[i] !== '@') continue;
    if (i > 0 && !isMentionBoundaryChar(textBefore[i - 1])) continue;
    var query = textBefore.substring(i + 1);
    if (/[\n\r]/.test(query)) continue;
    if (query.split(/\s+/).filter(Boolean).length > 4) continue;
    return { atIdx: i, query: query };
  }
  return null;
}

function collectMentionUserIds(commentEl, plainBody) {
  var ids = [];
  if (commentEl && commentEl.querySelectorAll) {
    commentEl.querySelectorAll('.mention-chip[data-user-id]').forEach(function (chip) {
      var uid = chip.getAttribute('data-user-id');
      if (uid && ids.indexOf(uid) < 0) ids.push(uid);
    });
  }
  if (plainBody) {
    var members = (window._drawerMembers || S.data.users || []).slice().sort(function (a, b) {
      return (b.name || '').length - (a.name || '').length;
    });
    members.forEach(function (m) {
      if (!m.name || !m.id) return;
      if (plainBody.indexOf('@' + m.name) !== -1 && ids.indexOf(m.id) < 0) ids.push(m.id);
    });
  }
  return ids;
}

function highlightMentionsInCommentBody(body) {
  var html = esc(body);
  var members = (window._drawerMembers || S.data.users || []).slice().sort(function (a, b) {
    return (b.name || '').length - (a.name || '').length;
  });
  members.forEach(function (m) {
    if (!m.name) return;
    var escapedName = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('@' + escapedName, 'g'),
      '<span style="color:#0052cc;font-weight:600">@' + esc(m.name) + '</span>');
  });
  return html;
}

// Renders a stored comment body for the EDIT box, as opposed to bodyHtml()'s
// read-only render further down. A pasted screenshot becomes a plain <img> with
// nothing after it to inherit a style from — bodyHtml()'s version wraps the
// same image in a small-gray-text caption block meant for display only, and
// pre-filling the edit box with that (as _editComment used to) left the caret
// sitting right after that caption, so anything typed next came out in the
// same small gray text.
function commentBodyToEditableHtml(body) {
  if (!body) return '';
  if (/<[a-z][\s\S]*>/i.test(body)) {
    var safe = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Images in a stored HTML body are bare /api/files/<id> src's (no token --
    // see _saveComment's stripFileAuthTokensFromHtml). bodyHtml()'s read-only
    // render calls augmentFileUrlsInHtml for the same reason; without it here
    // the <img> in the edit box 401s and shows broken, even though Save/Cancel
    // (which never touch src) work fine.
    return augmentFileUrlsInHtml(safe);
  }
  var html = highlightMentionsInCommentBody(body);
  html = html.replace(/\[img:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
    return '<img class="desc-inline-img" src="' + esc(fileApiUrl(url)) + '" alt="' + esc(fname) + '"><br>';
  });
  html = html.replace(/\[file:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
    return '<a href="' + esc(fileApiUrl(url)) + '" target="_blank">' + esc(fname) + '</a>';
  });
  return html;
}

// The Product Type + Combination picker stores BOTH selections in one custom
// field's value ({v:2, productTypes:[...], combinations:[...]}) named
// "Combination" -- so a pure product-type-only edit still writes a history
// row against that field, and reporting it by the field's own name says
// "updated Combination" even when only Product Type actually changed.
// Diffing old vs new tells the caller which part(s) actually moved.
function diffCombinationFieldChange(oldValue, newValue) {
  function parse(v) {
    if (!v) return { productTypes: [], combinations: [] };
    try {
      var p = JSON.parse(v);
      return { productTypes: (p && p.productTypes) || [], combinations: (p && p.combinations) || [] };
    } catch (e) { return { productTypes: [], combinations: [] }; }
  }
  var o = parse(oldValue), n = parse(newValue);
  var ptChanged = o.productTypes.slice().sort().join(',') !== n.productTypes.slice().sort().join(',');
  var comboChanged = o.combinations.slice().sort().join(',') !== n.combinations.slice().sort().join(',');
  if (ptChanged && comboChanged) return 'product type and combination';
  if (ptChanged) return 'product type';
  if (comboChanged) return 'combination';
  return null;
}

// Server text that is written for a machine, not a person, mapped to a clause
// that reads inside "<what> failed — <reason>". Anything not listed passes
// through unchanged: most API errors already carry a sentence meant for the
// user (permissions, validation, lifecycle guards) and rewriting those would
// lose detail. Keys are matched exactly against the thrown message, which is
// `err.error` from the JSON body or the raw HTTP statusText (services/api.js).
var RAW_ERROR_REASONS = {
  'Internal server error': 'something went wrong on the server',
  'Unauthorized': 'your session has expired — sign in again',
  'Forbidden': 'you do not have permission',
  'Not Found': 'it no longer exists',
  'Payload Too Large': 'the request is too large',
  'Unsupported Media Type': 'that file type is not accepted',
  'Too Many Requests': 'too many requests — wait a moment and retry',
  'Bad Gateway': 'the server is unreachable',
  'Service Unavailable': 'the server is unavailable',
  'Gateway Timeout': 'the server took too long to respond',
  'Request Timeout': 'the request timed out'
};

// Never returns '' — a bare `toast(e.message)` renders an empty or
// "undefined" toast when the error carries no message.
function errorReason(e, fallback) {
  // A raw fetch() that never got a response throws TypeError with a
  // browser-internal message ("Failed to fetch"). api() already converts
  // those before throwing, but the upload handlers call fetch() directly,
  // so handle it here too rather than at each of them.
  if (e instanceof TypeError && typeof friendlyFetchErrorMessage === 'function') {
    return friendlyFetchErrorMessage(e, fallback || 'reason unknown');
  }
  var m = (e && e.message != null) ? String(e.message).trim() : '';
  if (!m || m === 'undefined' || m === 'null') return fallback || 'reason unknown';
  return RAW_ERROR_REASONS[m] || m;
}

// Lower-case field names, for use mid-sentence ("ENG-12 due date updated").
// The History tab keeps its own Title-Case map because it renders the field as
// a standalone label ("Updated Due Date from … to …") rather than in a clause.
var ISSUE_FIELD_LABELS = {
  title: 'title', status: 'status', priority: 'priority',
  assignee_id: 'assignee', reporter_id: 'reporter', sprint_id: 'sprint',
  labels: 'labels', story_points: 'story points', type: 'type',
  start_date: 'start date', due_date: 'due date',
  description: 'description', fix_description: 'fix description',
  team: 'team', product_type: 'product type',
  original_estimate: 'original estimate', time_spent: 'time spent',
  parent_id: 'parent', position: 'position', attachment: 'attachment'
};

// The key a user recognises an issue by ("ENG-12"), read from the cache the
// view was already rendered from. Returns '' when the issue is not cached, so
// callers fall back to a generic message rather than printing a raw uuid.
function cachedIssueKey(issueId) {
  if (!issueId) return '';
  var iss = ((S.data && S.data.issues) || []).find(function (i) {
    return String(i.id) === String(issueId);
  });
  return (iss && iss.key) ? iss.key : '';
}

// openDrawer() accepts either an issue id or an issue key, so a load failure
// has to cope with both. A key is usable as-is; an id is only useful if the
// issue is cached, otherwise fall back to a phrase rather than print a uuid.
function issueLabelFor(issueIdOrKey) {
  var s = String(issueIdOrKey || '');
  if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(s)) return s.toUpperCase();
  return cachedIssueKey(s) || 'that issue';
}

// "ENG-12 linked to ENG-15" -- both ends are in hand at the call site (the
// open drawer's issue and the target picked in the dialog), so the message can
// say what was linked to what instead of just that something was linked.
function linkedPairText(sourceId, targetId) {
  var a = cachedIssueKey(sourceId);
  var b = cachedIssueKey(targetId);
  if (a && b) return a + ' linked to ' + b;
  if (b) return 'Linked to ' + b;
  return 'Issue linked';
}

// A sprint's name from the already-loaded cache, for the messages that only
// have its id in hand. '' when it is not cached, so callers stay generic.
function sprintName(sprintId) {
  if (!sprintId) return '';
  var sp = ((S.data && S.data.sprints) || []).find(function (s) {
    return String(s.id) === String(sprintId);
  });
  return (sp && sp.name) ? sp.name : '';
}

// One phrasing for "this issue changed sprint", shared by the drawer's inline
// Sprint picker and the backlog's drag-and-drop, so the same action does not
// describe itself two different ways depending on where it was performed.
function issueSprintMoveText(label, sprintId) {
  if (!sprintId) return label + ' moved to the backlog';
  var sp = ((S.data && S.data.sprints) || []).find(function (s) {
    return String(s.id) === String(sprintId);
  });
  return label + ' moved to ' + (sp ? sp.name : 'the selected sprint');
}

function issueFieldLabel(field) {
  if (!field) return 'field';
  return ISSUE_FIELD_LABELS[field] ||
    String(field).replace(/_id$/, '').replace(/_/g, ' ');
}

function fmtMins(mins) {
  if (!mins || mins <= 0) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + 'h';
  return m + 'm';
}

function fmtDate(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '\u2014';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '\u2014';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDateShort(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Calendar date as YYYY-MM-DD, for input[type=date] values.
//
// Postgres DATE columns come back from node-pg as a Date at LOCAL midnight, and
// JSON then serialises that to UTC — so 2026-03-01 in IST arrives as
// "2026-02-28T18:30:00.000Z". Reading that back with toISOString() returned
// 2026-02-28, i.e. every sprint and issue date displayed a day early for any
// timezone ahead of UTC. Local getters resolve it back to the intended day.
// Bare 'YYYY-MM-DD' strings are already calendar dates and are passed through
// untouched, so they can't be shifted in the other direction.
function fmtDateISO(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const dateOnly = d.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnly) return dateOnly[1];
  }
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.getFullYear() + '-' +
    String(dt.getMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getDate()).padStart(2, '0');
}

// Moving a ticket into a sprint adopts that sprint's dates. Returns the changes
// to apply given the ticket's current values, so the caller only writes what
// actually differs (avoids a pointless save when the dates already match).
//   → { sprint, start, end, changes: [{field, value, label}] }
// A null/empty sprintId means "backlog": no sprint dates exist to copy, so no
// changes are produced and the ticket keeps whatever dates it had.
function sprintDateChanges(sprintId, currentStart, currentDue, sprints) {
  var out = { sprint: null, start: '', end: '', changes: [] };
  if (!sprintId) return out;
  var list = sprints || (S.data && S.data.sprints) || [];
  var sprint = list.find(function (sp) { return sp.id === sprintId; });
  if (!sprint) return out;
  out.sprint = sprint;
  // A planning sprint may have no dates yet — only copy the ones that exist.
  out.start = fmtDateISO(sprint.start_date);
  out.end = fmtDateISO(sprint.end_date);
  if (out.start && fmtDateISO(currentStart) !== out.start) {
    out.changes.push({ field: 'start_date', value: out.start, label: 'start ' + out.start });
  }
  if (out.end && fmtDateISO(currentDue) !== out.end) {
    out.changes.push({ field: 'due_date', value: out.end, label: 'due ' + out.end });
  }
  return out;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
}

function relativeTime(d) {
  if (!d) return '';
  var diff = Date.now() - new Date(d).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return fmtDate(d);
}

function parseEstimate(str) {
  if (!str) return 0;
  var total = 0;
  var hMatch = str.match(/(\d+)\s*h/i);
  var mMatch = str.match(/(\d+)\s*m/i);
  if (hMatch) total += parseInt(hMatch[1], 10) * 60;
  if (mMatch) total += parseInt(mMatch[1], 10);
  if (!hMatch && !mMatch) {
    var n = parseFloat(str);
    if (!isNaN(n)) total = Math.round(n * 60);
  }
  return total;
}
