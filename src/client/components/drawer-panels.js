
// ═══════════════════════════════════════════════════════════
// LINKED ITEMS (Jira-style)
// ═══════════════════════════════════════════════════════════
// `selectable: false` = still rendered and removable for rows that already
// exist, but not offered for new links. Issue hierarchy lives on
// issues.parent_id (the Subtasks panel); a parallel is_child_of link was a
// second, unsynchronised source of truth — such a "child" never showed under
// Subtasks, never blocked the parent from going Done and never rolled up in
// reports. Keep in sync with LINK_TYPE_INVERSE in server.js.
var LINK_TYPES = [
  { value: 'blocks', label: 'blocks', inverse: 'is blocked by' },
  { value: 'is_blocked_by', label: 'is blocked by', inverse: 'blocks' },
  { value: 'clones', label: 'clones', inverse: 'is cloned by' },
  { value: 'is_cloned_by', label: 'is cloned by', inverse: 'clones' },
  { value: 'duplicates', label: 'duplicates', inverse: 'is duplicated by' },
  { value: 'is_duplicated_by', label: 'is duplicated by', inverse: 'duplicates' },
  { value: 'relates_to', label: 'relates to', inverse: 'relates to' },
  { value: 'is_child_of', label: 'is child of', inverse: 'is parent of', selectable: false },
  { value: 'is_parent_of', label: 'is parent of', inverse: 'is child of', selectable: false },
];

function linkTypeLabel(type) {
  var found = LINK_TYPES.find(function(t){ return t.value === type; });
  return found ? found.label : String(type || '').replace(/_/g, ' ');
}

// space_id of the issue whose drawer is open — links are space-local
var _linkDialogSpaceId = null;

function copyTextToClipboard(text) {
  var fallback = function () {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    toast('Link copied', 'success');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function () { toast('Link copied', 'success'); })
      .catch(fallback);
  } else {
    fallback();
  }
}

// Accept issue key, full URL, or partial URL (?issue=KEY) — same format as copy link
function parseIssueLinkReference(input) {
  if (!input) return '';
  var s = String(input).trim();
  if (!s) return '';
  var qMatch = s.match(/[?&]issue=([^&#\s]+)/i);
  if (qMatch) {
    try { return decodeURIComponent(qMatch[1]).trim(); } catch (_) { return qMatch[1].trim(); }
  }
  try {
    if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') {
      var u = new URL(s, window.location.origin);
      var q = u.searchParams.get('issue');
      if (q) return q.trim();
    }
  } catch (_) {}
  return s;
}

function renderLinkSearchResults(matches) {
  var results = $('linkSearchResults');
  if (!results) return;
  if (!matches.length) {
    results.innerHTML = '<p class="text-muted text-xs" style="padding:6px 4px">No matching issues found</p>';
    return;
  }
  // Identity travels in data-* attributes and the handler is attached in JS.
  // Interpolating the title into an inline onclick meant any title containing
  // a double quote terminated the attribute and broke the row.
  var html = '';
  for (var mi = 0; mi < matches.length; mi++) {
    var m = matches[mi];
    html += '<div class="link-search-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:12px" ' +
      'data-link-pick-id="' + escAttr(m.id) + '" data-link-pick-key="' + escAttr(m.key) + '" data-link-pick-title="' + escAttr(m.title) + '">' +
      '<span style="font-size:11px">' + typeIcon(m.type) + '</span>' +
      '<span style="font-weight:700;color:var(--accent);min-width:48px">' + esc(m.key) + '</span>' +
      '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.title) + '</span>' +
      statusBadge(m.status, true) +
      '</div>';
  }
  results.innerHTML = html;

  results.querySelectorAll('[data-link-pick-id]').forEach(function (row) {
    row.addEventListener('mouseenter', function () { row.style.background = 'var(--bg4)'; });
    row.addEventListener('mouseleave', function () { row.style.background = ''; });
    row.addEventListener('click', function () {
      window._selectLinkIssue(row.dataset.linkPickId, row.dataset.linkPickKey, row.dataset.linkPickTitle);
    });
  });
}

function renderDrawerLinks(issue) {
  var c = $('drawerLinks');
  var links = issue.links || [];
  var html = '';
  // The server only allows links within one space, so remember which space the
  // open issue belongs to and offer nothing else in the picker.
  _linkDialogSpaceId = issue.space_id || null;

  if (links.length) {
    // Group by link type
    var grouped = {};
    for (var li = 0; li < links.length; li++) {
      var lnk = links[li];
      var lt = lnk.link_type || 'relates_to';
      // Determine if this issue is source or target to show correct direction
      var isSource = lnk.source_id === issue.id;
      var displayType = isSource ? linkTypeLabel(lt) : (LINK_TYPES.find(function(t){ return t.value === lt; }) || {}).inverse || linkTypeLabel(lt);
      var targetId = isSource ? lnk.target_id : lnk.source_id;
      var targetKey = lnk.target_key || targetId;
      var targetTitle = lnk.target_title || '';
      var targetStatus = lnk.target_status || '';
      var targetType = lnk.target_type || 'task';
      if (!grouped[displayType]) grouped[displayType] = [];
      grouped[displayType].push({ id: targetId, key: targetKey, title: targetTitle, status: targetStatus, type: targetType, linkId: lnk.id });
    }

    for (var gtype in grouped) {
      html += '<div class="link-group" style="margin-bottom:10px">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:capitalize;margin-bottom:4px">' + esc(gtype) + '</div>';
      var items = grouped[gtype];
      for (var gi = 0; gi < items.length; gi++) {
        var it = items[gi];
        html += '<div class="link-item" data-link-row-id="' + escAttr(it.id) + '" data-link-row-key="' + escAttr(it.key) + '" data-link-row-link="' + escAttr(it.linkId) + '" ' +
          'style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;border:1px solid var(--border);margin-bottom:4px;background:var(--bg3);cursor:pointer">' +
          '<span style="font-size:12px">' + typeIcon(it.type) + '</span>' +
          '<span style="font-size:11px;font-weight:700;color:var(--accent)">' + esc(it.key) + '</span>' +
          '<span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</span>' +
          statusBadge(it.status, true) +
          '<button class="btn-icon link-copy-btn" style="width:22px;height:22px;flex-shrink:0;opacity:0.55;padding:2px" title="Copy link"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
          '<button class="btn-icon link-remove-btn" style="width:18px;height:18px;font-size:10px;opacity:0.4;flex-shrink:0" title="Remove link">\u2715</button>' +
          '</div>';
      }
      html += '</div>';
    }
  } else {
    html += '<p class="text-muted text-sm" style="margin-bottom:4px">No linked items</p>';
  }

  // Add link button
  html += '<button class="btn btn-outline btn-sm" style="margin-top:6px;gap:4px" onclick="window._showLinkDialog()">\uD83D\uDD17 Link an issue</button>';

  // Inline link dialog (hidden by default)
  html += '<div id="linkDialogInline" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2)">' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:8px">Link an issue</div>' +
    '<div style="margin-bottom:8px">' +
    '<label class="form-label">Link type</label>' +
    '<select id="linkTypeSelect" class="input input-sm" style="width:100%">';
  for (var lti = 0; lti < LINK_TYPES.length; lti++) {
    if (LINK_TYPES[lti].selectable === false) continue;
    html += '<option value="' + escAttr(LINK_TYPES[lti].value) + '">' + esc(LINK_TYPES[lti].label) + '</option>';
  }
  html += '</select></div>' +
    '<div style="margin-bottom:8px">' +
    '<label class="form-label">Search for an issue</label>' +
    '<input type="text" id="linkSearchInput" class="input input-sm" placeholder="Paste issue URL or search by key (e.g. ENG-5)" oninput="window._searchLinkIssues(this.value)" style="width:100%">' +
    '</div>' +
    '<div id="linkSearchResults" style="max-height:160px;overflow-y:auto;margin-bottom:8px"></div>' +
    '<div id="linkSelectedIssue" style="display:none;padding:6px 8px;border:1px solid var(--accent);border-radius:4px;background:var(--accent-bg);margin-bottom:8px;align-items:center;gap:6px"></div>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end">' +
    '<button class="btn btn-outline btn-sm" onclick="window._hideLinkDialog()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" id="linkSubmitBtn" disabled onclick="window._submitLink()">Link</button>' +
    '</div></div>';

  c.innerHTML = html;

  // Row behaviour bound here rather than inline, so keys/titles never have to
  // survive being interpolated into an attribute.
  c.querySelectorAll('[data-link-row-id]').forEach(function (row) {
    var issueId = row.dataset.linkRowId;
    var issueKey = row.dataset.linkRowKey;
    var linkId = row.dataset.linkRowLink;
    row.addEventListener('mouseenter', function () { row.style.borderColor = 'var(--accent)'; });
    row.addEventListener('mouseleave', function () { row.style.borderColor = 'var(--border)'; });
    row.addEventListener('click', function () { openIssuePage(issueId); });
    var copyBtn = row.querySelector('.link-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      copyTextToClipboard(window.location.origin + '/?issue=' + encodeURIComponent(issueKey));
    });
    var rmBtn = row.querySelector('.link-remove-btn');
    if (rmBtn) rmBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window._removeLink(linkId);
    });
  });
}

window._showLinkDialog = function() {
  var dlg = $('linkDialogInline');
  if (dlg) {
    dlg.style.display = '';
    $('linkSearchInput').value = '';
    var sel = $('linkSelectedIssue');
    sel.style.display = 'none';
    sel.dataset.issueId = '';
    sel.innerHTML = '';
    $('linkSubmitBtn').disabled = true;
    // Reset the type back to the default instead of keeping the last pick
    var typeSel = $('linkTypeSelect');
    if (typeSel) typeSel.value = 'relates_to';
    // Show recent issues immediately on open
    window._searchLinkIssues('');
    setTimeout(function(){ $('linkSearchInput').focus(); }, 50);
  }
};

window._hideLinkDialog = function() {
  var dlg = $('linkDialogInline');
  if (dlg) dlg.style.display = 'none';
};

window._searchLinkIssues = function(term) {
  var results = $('linkSearchResults');
  if (!results) return;
  var currentIssueId = S.drawerIssueId;
  var spaceId = _linkDialogSpaceId;
  var searchTerm = parseIssueLinkReference(term) || (term || '').trim();
  var lower = searchTerm.toLowerCase();
  var msg = function (text) {
    results.innerHTML = '<p class="text-muted text-xs" style="padding:6px 4px">' + esc(text) + '</p>';
  };

  // Only same-space issues are linkable (POST /api/links enforces it). Offering
  // other spaces meant picking one failed with a bare "Invalid issue link" —
  // S.data.issues spans every space when the drawer is opened from Home or
  // My Work, so this filter is what keeps the picker honest.
  var candidates = (S.data.issues || []).filter(function (i) {
    if (i.id === currentIssueId) return false;
    return !spaceId || i.space_id === spaceId;
  });

  if (searchTerm) {
    var exact = candidates.find(function (i) {
      return i.key && i.key.toLowerCase() === lower;
    });
    if (exact) { renderLinkSearchResults([exact]); return; }
  }

  var matches = candidates.filter(function (i) {
    if (!searchTerm) return true;
    return (i.key && i.key.toLowerCase().indexOf(lower) >= 0) ||
           (i.title && i.title.toLowerCase().indexOf(lower) >= 0);
  }).slice(0, 10);

  if (matches.length) { renderLinkSearchResults(matches); return; }
  if (!searchTerm) { msg('No other issues in this space to link'); return; }

  // Not in the local cache — the key may belong to an issue this client hasn't
  // loaded. Resolve it, but still refuse anything outside the current space so
  // the failure is explained here rather than as a 400 after clicking Link.
  msg('Looking up issue…');
  api('/api/issues/' + encodeURIComponent(searchTerm), 'GET', null, { silent: true }).then(function (iss) {
    if (!iss || !iss.id || iss.id === currentIssueId) { msg('No matching issues found'); return; }
    if (spaceId && iss.space_id !== spaceId) {
      msg(issueKeyStr(iss) + ' is in another space — issues can only be linked within the same space');
      return;
    }
    S.data.issues = S.data.issues || [];
    if (!S.data.issues.some(function (i) { return i.id == iss.id; })) S.data.issues.push(iss);
    renderLinkSearchResults([iss]);
  }).catch(function () {
    msg('No matching issues found');
  });
};

window._selectLinkIssue = function(id, key, title) {
  $('linkSearchResults').innerHTML = '';
  $('linkSearchInput').value = '';
  var sel = $('linkSelectedIssue');
  sel.style.display = 'flex';
  sel.dataset.issueId = id;
  sel.innerHTML = '<span style="font-size:11px;font-weight:700;color:var(--accent)">' + esc(key) + '</span>' +
    '<span style="flex:1;font-size:12px">' + esc(title) + '</span>' +
    '<button class="btn-icon" style="width:18px;height:18px;font-size:10px" onclick="event.stopPropagation();window._clearLinkSelection()">\u2715</button>';
  $('linkSubmitBtn').disabled = false;
};

window._clearLinkSelection = function() {
  var sel = $('linkSelectedIssue');
  sel.style.display = 'none';
  sel.dataset.issueId = '';
  sel.innerHTML = '';
  $('linkSubmitBtn').disabled = true;
};

// Re-read the open issue and repaint just the links section. Guarded on the
// drawer still showing the same issue, so a slow response can't paint one
// issue's links into another's drawer.
async function _refreshDrawerLinks() {
  var issueId = S.drawerIssueId;
  if (!issueId) return;
  try {
    var issue = await api('/api/issues/' + issueId, 'GET', null, { silent: true });
    if (issue && S.drawerIssueId === issueId) renderDrawerLinks(issue);
  } catch (_) { /* leave the current list in place */ }
}

window._submitLink = async function() {
  var btn = $('linkSubmitBtn');
  var targetId = $('linkSelectedIssue').dataset.issueId;
  var linkType = $('linkTypeSelect').value;
  if (!targetId) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Linking…'; }
  try {
    // silent: the server's 409/400 text ("already linked that way",
    // "conflicting link…") is more useful than api()'s generic toast, and
    // without this both would fire.
    await api('/api/links', 'POST', {
      source_id: S.drawerIssueId,
      target_id: targetId,
      link_type: linkType
    }, { silent: true });
    toast(linkedPairText(S.drawerIssueId, targetId), 'success');
    window._hideLinkDialog();
    await _refreshDrawerLinks();
  } catch(e) {
    toast('Link failed — ' + errorReason(e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
  }
};

window._removeLink = async function(linkId) {
  var ok = await confirmDialog('Remove this link?');
  if (!ok) return;
  try {
    await api('/api/links/' + linkId, 'DELETE', null, { silent: true });
    toast('Link removed', 'success');
    await _refreshDrawerLinks();
  } catch(e) { toast('Link removal failed — ' + errorReason(e), 'error'); }
};

// Store current issue data for tab switching
var _drawerIssueData = null;

function renderDrawerActivity(issue) {
  // Support legacy call with just comments array
  if (Array.isArray(issue)) issue = { comments: issue, history: [], worklogs: [] };
  _drawerIssueData = issue;
  var activeTab = (document.querySelector('.drawer-atab.active') || {}).dataset && document.querySelector('.drawer-atab.active').dataset.activityTab || 'comments';
  _renderActivityTab(activeTab, issue);
}

function _renderActivityTab(tab, issue) {
  var c = $('drawerActivity');
  issue = issue || _drawerIssueData || {};
  var comments = issue.comments || [];
  var history  = issue.history  || [];
  var worklogs = issue.worklogs || [];

  function commentHtml(cm) {
    var user = findUser(cm.user_id);
    var name = user ? user.name : (cm.user_name || 'Unknown');
    var color = (user && user.color) || cm.user_color || '#6b7280';
    var btnStyle = 'background:none;border:none;cursor:pointer;font-size:11px;color:var(--text3);padding:2px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px';
    var actionBtns = '<span style="margin-left:auto;display:inline-flex;gap:4px">' +
      '<button onclick="window._editComment(\'' + cm.id + '\')" style="' + btnStyle + '" title="Edit"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>Edit</button>' +
      '<button onclick="window._deleteComment(\'' + cm.id + '\')" style="' + btnStyle + ';color:#dc2626" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>Delete</button>' +
      '</span>';
    var bodyHtml = (function(body) {
      if (/<[a-z][\s\S]*>/i.test(body)) {
        var safe = body.replace(/<script[\s\S]*?<\/script>/gi, '');
        // A comment that has been through the rich-edit-and-save cycle below
        // stores its images as real <img src="/api/files/id"> (no token, by
        // design — see _saveComment) rather than the [img:name|url] markup the
        // bracket branch below handles. Without this, those images would never
        // get a token at all, on any render, ever.
        return augmentFileUrlsInHtml(safe);
      }
      var html = highlightMentionsInCommentBody(body);
      // fname is an UPLOADED FILENAME -- user-controlled -- and was
      // interpolated raw into a title="..." attribute and into element text.
      // A filename containing a double quote broke out of the attribute, and
      // one containing markup was parsed as markup: the same defect as the
      // toast renderer (blind spot 17), in a different renderer. escAttr for
      // the attribute (it escapes quotes, which esc does not), esc for text.
      // alt is added at the same time so the image has an accessible name.
      html = html.replace(/\[img:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:8px"><img src="' + fileApiUrl(url) + '" alt="' + escAttr(fname) + '" style="max-width:300px;max-height:200px;border-radius:6px;border:1px solid #dfe1e6;cursor:pointer;display:block" onclick="window.open(this.src)" title="' + escAttr(fname) + '"><div style="font-size:11px;color:#6b778c;margin-top:2px">📷 ' + esc(fname) + '</div></div>';
      });
      html = html.replace(/\[file:([^|\]]+)\|([^\]]+)\]/g, function(m, fname, url) {
        return '<div style="margin-top:6px"><a href="' + fileApiUrl(url) + '" target="_blank" style="color:#0052cc;text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #dfe1e6;border-radius:4px;font-size:13px;background:#f4f5f7">📎 ' + esc(fname) + '</a></div>';
      });
      return html;
    })(cm.body);

    // Rich editor toolbar (same as main comment editor)
    var richToolbar = '<div class="jira-comment-toolbar" style="border-radius:6px 6px 0 0">' +
      '<select class="jira-tb-select" onchange="richFormatBlock(this.value,\'edit-rich-' + cm.id + '\');this.value=\'\'" title="Text style"><option value="">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="p">Normal text</option></select>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'bold\')" title="Bold"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'italic\')" title="Italic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'underline\')" title="Underline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'strikeThrough\')" title="Strikethrough"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.3 4.9c-2.3-.6-4.4-1-6.2-.9-2.7 0-5.3.7-5.3 3.6 0 1.5 1.1 2.4 3.2 3.1H3"/><path d="M11.1 20.4c2.8 0 5.2-.7 5.2-3.8 0-1.6-1.1-2.5-3.3-3.4H21"/><line x1="3" y1="12" x2="21" y2="12"/></svg></button>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'insertUnorderedList\')" title="Bullet list"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg></button>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'insertOrderedList\')" title="Numbered list"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg></button>' +
      '<span class="jira-tb-sep"></span>' +
      '<button type="button" class="jira-tb-btn" onmousedown="event.preventDefault();document.execCommand(\'removeFormat\')" title="Clear formatting"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4l-8 16"/><line x1="17" y1="11" x2="22" y2="16"/><line x1="22" y1="11" x2="17" y2="16"/></svg></button>' +
      '</div>';

    var editArea = '<div class="comment-edit-area-' + cm.id + '" style="display:none;margin-top:8px;border:1px solid var(--border);border-radius:6px;overflow:hidden">' +
      richToolbar +
      '<div id="edit-rich-' + cm.id + '" class="jira-editor-body" contenteditable="true" style="min-height:80px;padding:10px 12px;font-size:13px;outline:none"></div>' +
      '<div style="display:flex;gap:8px;padding:8px 10px;background:var(--bg2);border-top:1px solid var(--border)">' +
      '<button onclick="window._saveComment(\'' + cm.id + '\')" style="background:#0052cc;color:#fff;border:none;border-radius:4px;padding:5px 16px;font-size:12px;cursor:pointer;font-weight:600">Save</button>' +
      '<button onclick="window._cancelEditComment(\'' + cm.id + '\')" style="background:none;border:1px solid var(--border);border-radius:4px;padding:5px 14px;font-size:12px;cursor:pointer">Cancel</button>' +
      '</div></div>';

    return '<div class="drawer-comment-item" id="comment-' + cm.id + '" style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div class="drawer-comment-avatar-sm" style="background:' + color + ';width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(cm.created_at) + '</span>' +
      '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--bg3);color:var(--text3)">Comment</span>' +
      actionBtns +
      '</div>' +
      '<div class="comment-body-' + cm.id + '" style="font-size:13px;line-height:1.5;color:var(--text1)">' + bodyHtml + '</div>' +
      editArea +
      '</div></div>';
  }

  window._editComment = function(id) {
    var editArea = document.querySelector('.comment-edit-area-' + id);
    var richEl = document.getElementById('edit-rich-' + id);
    var bodyDiv = document.querySelector('.comment-body-' + id);
    if (!editArea || !richEl) return;
    // Hide the read-only render while editing — it used to stay visible the
    // whole time, so opening Edit just added a second copy of the comment
    // (text + screenshot) below the original instead of replacing it in place.
    if (bodyDiv) bodyDiv.style.display = 'none';
    // Pre-fill from the RAW stored body, not bodyDiv.innerHTML. The read-only
    // render wraps a pasted screenshot in a styled caption block (small gray
    // "📷 filename" text) meant only for display — copying that HTML in put the
    // caret right after that block, so anything typed next inherited its small
    // gray style instead of normal text. commentBodyToEditableHtml renders the
    // same image as a plain <img> (like the description editor does), which
    // leaves nothing after it for typed text to inherit.
    var cm = ((_drawerIssueData && _drawerIssueData.comments) || []).find(function(c) { return c.id === id; });
    richEl.innerHTML = cm ? commentBodyToEditableHtml(cm.body) : (bodyDiv ? bodyDiv.innerHTML : '');
    attachScopedUndo(richEl);
    editArea.style.display = '';
    // The edit box is a fresh element each time the activity list re-renders,
    // but re-opening Edit on the SAME comment without a re-render in between
    // reuses this exact node -- both binders below no-op on a repeat call via
    // their own bind-once guards, so this is safe to call every time.
    bindMentionAutocomplete(richEl);
    bindCommentEditImagePaste(richEl);
    richEl.focus();
    // Move cursor to end
    var range = document.createRange();
    range.selectNodeContents(richEl);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  window._cancelEditComment = function(id) {
    var editArea = document.querySelector('.comment-edit-area-' + id);
    var bodyDiv = document.querySelector('.comment-body-' + id);
    if (editArea) editArea.style.display = 'none';
    if (bodyDiv) bodyDiv.style.display = '';
  };

  window._deleteComment = function(id) {
    if (!confirm('Delete this comment?')) return;
    api('/api/comments/' + id, 'DELETE', null, { silent: true }).then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          renderDrawerActivity(fresh);
        }).catch(function(){});
      }
    }).catch(function(e) { toast('Comment delete failed — ' + errorReason(e), 'error'); });
  };

  window._saveComment = function(id) {
    var richEl = document.getElementById('edit-rich-' + id);
    if (!richEl) return;
    // richEl was pre-filled from the rendered comment body in _editComment,
    // which means any pasted screenshot's <img> now carries today's live
    // session token (bodyHtml embeds it for display). Strip it before saving
    // — same bug and same fix as the drawer description save handlers: saving
    // the token verbatim bakes today's token in permanently.
    var newBody = stripFileAuthTokensFromHtml(richEl.innerHTML.trim());
    if (!newBody || newBody === '<br>') return;
    api('/api/comments/' + id, 'PUT', { body: newBody }, { silent: true }).then(function() {
      var issueId = S.drawerIssueId;
      if (issueId) {
        api('/api/issues/' + issueId).then(function(fresh) {
          renderDrawerActivity(fresh);
        }).catch(function(){});
      }
    }).catch(function(e) { toast('Comment save failed — ' + errorReason(e), 'error'); });
  };

  function historyHtml(h) {
    var user = findUser(h.user_id);
    var name = user ? user.name : (h.user_name || 'Unknown');
    var color = (user && user.color) || h.user_color || '#6b7280';
    var fieldLabel = { title:'Title', status:'Status', priority:'Priority', assignee_id:'Assignee', reporter_id:'Reporter', sprint_id:'Sprint', labels:'Labels', story_points:'Story Points', start_date:'Start Date', due_date:'Due Date', description:'Description', attachment:'Attachment' }[h.field_name] || h.field_name;
    if ((h.field_name || '').indexOf('custom_field_') === 0) {
      if (h.custom_field_key === 'combination') {
        var comboWhat = diffCombinationFieldChange(h.old_value, h.new_value);
        fieldLabel = comboWhat ? cap(comboWhat) : (h.custom_field_name || fieldLabel);
      } else {
        fieldLabel = h.custom_field_name || fieldLabel;
      }
    }
    function resolveVal(field, val) {
      if (!val || val === '—') return val || '—';
      if (field === 'sprint_id') {
        var sp = (S.data.sprints || []).find(function(s){ return s.id === val; });
        return sp ? sp.name : 'None';
      }
      if (field === 'assignee_id' || field === 'reporter_id') {
        var u = findUser(val);
        return u ? u.name : val;
      }
      return val;
    }
    function formatHistoryValue(field, val) {
      var resolved = resolveVal(field, val) || '—';
      if (resolved === '—') return resolved;
      if (field === 'description' || field === 'fix_description' || /<[a-z][\s\S]*>/i.test(resolved)) {
        resolved = stripHtmlForDisplay(resolved);
      }
      if (field === 'product_type' || field === 'team') {
        resolved = String(resolved).replace(/,/g, ', ');
      }
      if (resolved.charAt(0) === '{' || resolved.charAt(0) === '[') {
        try {
          var parsed = JSON.parse(resolved);
          if (parsed && parsed.combinations) {
            resolved = (parsed.combinations || []).join(', ') || resolved;
          } else if (Array.isArray(parsed)) {
            resolved = parsed.join(', ');
          }
        } catch (_) {}
      }
      return truncateForHistory(resolved, 120);
    }
    var oldVal = formatHistoryValue(h.field_name, h.old_value);
    var newVal = formatHistoryValue(h.field_name, h.new_value);
    var isAttach = h.field_name === 'attachment';
    var actionLine;
    if (isAttach && !h.old_value) {
      actionLine = 'Added attachment <strong>📎 ' + esc(h.new_value) + '</strong>';
    } else if (isAttach && !h.new_value) {
      actionLine = 'Removed attachment <span style="text-decoration:line-through;color:var(--text3)">📎 ' + esc(h.old_value) + '</span>';
    } else {
      actionLine = 'Updated <strong>' + esc(fieldLabel) + '</strong> from <span style="text-decoration:line-through;color:var(--text3)">' + esc(oldVal) + '</span> → <strong>' + esc(newVal) + '</strong>';
    }
    var badge = isAttach
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#fef9c3;color:#854d0e">Attachment</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dbeafe;color:#1e40af">Changed</span>';
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(h.created_at) + '</span>' +
      badge +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2)">' + actionLine + '</div>' +
      '</div></div>';
  }

  function worklogHtml(w) {
    var user = findUser(w.user_id);
    var name = user ? user.name : (w.user_name || 'Unknown');
    var color = (user && user.color) || w.user_color || '#6b7280';
    var mins = w.time_spent || 0;
    var timeStr = fmtMins(mins);
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(name) + '</div>' +
      '<div style="flex:1">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
      '<span style="font-weight:600;font-size:13px">' + esc(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text3)">' + fmtDateTime(w.created_at || w.work_date) + '</span>' +
      '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:#dcfce7;color:#166534">Work log</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2)">' +
      'Logged <strong>' + timeStr + '</strong>' + (w.description ? ' — ' + esc(w.description) : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:2px">Date: ' + fmtDate(w.work_date || w.created_at) + (w.is_billable ? ' · Billable' : '') + '</div>' +
      '</div></div>';
  }

  // Comment box: show only on Comments tab
  var commentBox = document.querySelector('.drawer-comment-box');
  if (commentBox) commentBox.style.display = (tab === 'comments') ? '' : 'none';

  // Helper: merge items into sorted timeline
  function buildTimeline(items) {
    return items.sort(function(a, b) { return b.date - a.date; });
  }

  var html = '';
  if (tab === 'comments') {
    // Comments only + comment box (shown above)
    if (!comments.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No comments yet.</p>'; return; }
    comments.slice().sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);})
      .forEach(function(cm){ html += commentHtml(cm); });

  } else if (tab === 'history') {
    // Full audit trail: field changes + comments + worklogs — all with date/time, no comment box
    var all = [];
    comments.forEach(function(x){ all.push({ type:'comment', date: new Date(x.created_at), data:x }); });
    history.forEach(function(x){ all.push({ type:'history', date: new Date(x.created_at), data:x }); });
    worklogs.forEach(function(x){ all.push({ type:'worklog', date: new Date(x.created_at||x.work_date), data:x }); });
    buildTimeline(all);
    if (!all.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No history yet.</p>'; return; }
    all.forEach(function(item){
      if (item.type==='comment') html += commentHtml(item.data);
      else if (item.type==='history') html += historyHtml(item.data);
      else html += worklogHtml(item.data);
    });

  } else if (tab === 'worklog') {
    // Worklogs only, no comment box
    if (!worklogs.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No time logged yet. Click "+ Log Time" to add.</p>'; return; }
    worklogs.forEach(function(w){ html += worklogHtml(w); });

  } else {
    // ALL: everything merged, with comment box (shown above)
    var all = [];
    comments.forEach(function(x){ all.push({ type:'comment', date: new Date(x.created_at), data:x }); });
    history.forEach(function(x){ all.push({ type:'history', date: new Date(x.created_at), data:x }); });
    worklogs.forEach(function(x){ all.push({ type:'worklog', date: new Date(x.created_at||x.work_date), data:x }); });
    buildTimeline(all);
    if (!all.length) { c.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No activity yet.</p>'; return; }
    all.forEach(function(item){
      if (item.type==='comment') html += commentHtml(item.data);
      else if (item.type==='history') html += historyHtml(item.data);
      else html += worklogHtml(item.data);
    });
  }
  c.innerHTML = html || '<p class="text-muted text-sm" style="padding:12px 0">No activity yet.</p>';
}

function renderDrawerAttachments(attachments) {
  var c = $('drawerAttachments');
  if (!c) return;
  if (!attachments || !attachments.length) {
    c.innerHTML = '<p class="text-muted text-sm" style="padding:8px 0">No attachments yet.</p>';
    return;
  }
  function fileIcon(mime) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf')) return '📕';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('excel') || mime.includes('sheet')) return '📊';
    if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
    if (mime.includes('video/')) return '🎬';
    return '📄';
  }
  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }
  var html = '';
  attachments.forEach(function(a) {
    var canDelete = S.currentUser === a.uploaded_by || ((S.currentUserObj||{}).role === 'admin') || ((S.currentUserObj||{}).role === 'owner');
    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:18px">' + fileIcon(a.mime_type) + '</span>' +
      '<div style="flex:1;min-width:0">' +
      '<a href="' + esc(fileApiUrl(a.filename)) + '" target="_blank" style="font-size:13px;color:var(--accent);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Click to open">' + esc(a.original_name) + '</a>' +
      '<div style="font-size:11px;color:var(--text3)">' + fmtSize(a.size) + (a.uploader_name ? ' · ' + esc(a.uploader_name) : '') + ' · ' + fmtDateTime(a.created_at) + '</div>' +
      '</div>' +
      '<a href="' + esc(fileApiUrl(a.filename)) + '" download="' + esc(a.original_name) + '" title="Download" style="color:var(--text3);font-size:15px;text-decoration:none;padding:2px 4px;border-radius:4px;line-height:1" onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">⬇</a>' +
      '<button title="Rename" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--text3);padding:2px 4px;border-radius:4px" onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'" onclick="renameAttachment(\'' + a.id + '\',\'' + esc(a.original_name).replace(/'/g,"&#39;") + '\')">✏</button>' +
      (canDelete ? '<button class="btn btn-sm btn-outline text-danger" style="padding:2px 8px;font-size:11px" onclick="deleteAttachment(\'' + a.id + '\')">✕</button>' : '') +
      '</div>';
  });
  c.innerHTML = html;
}

window.renameAttachment = async function(id, currentName) {
  var newName = prompt('Rename attachment:', currentName);
  if (!newName || newName.trim() === currentName.trim()) return;
  try {
    await api('/api/attachments/' + id, 'PATCH', { original_name: newName.trim() });
    var issue = await api('/api/issues/' + S.drawerIssueId);
    if (issue) renderDrawerAttachments(issue.attachments || []);
    toast('Attachment renamed');
  } catch(e) { toast('Attachment rename failed — ' + errorReason(e), 'error'); }
};

window.deleteAttachment = async function(id) {
  var ok = await confirmDialog('Delete this attachment?');
  if (!ok) return;
  try {
    await api('/api/attachments/' + id, 'DELETE');
    var issue = await api('/api/issues/' + S.drawerIssueId);
    if (issue) renderDrawerAttachments(issue.attachments || []);
    toast('Attachment deleted');
  } catch(e) {}
};

// Close any open custom-field select dropdown when clicking outside it.
// Bound once at script load (not inside renderDrawerCustomFields, which can
// re-run many times per drawer session via live-sync) — previously this was
// added fresh on every render, stacking a new document-level listener each
// time and leaking a growing pile of stale closures over a session.
document.addEventListener('click', function(e) {
  if (e.target.closest('.cf-select-wrap')) return;
  qsa('.cf-select-dropdown').forEach(function(d) {
    d.style.display = 'none';
    resetCFDropdownPosition(d);
  });
  if (!e.target.closest('.combo-box')) {
    qsa('.combo-dropdown').forEach(function (d) {
      d.hidden = true;
      var box = d.closest('.combo-box');
      if (box) box.classList.remove('combo-open');
    });
  }
});
window.addEventListener('resize', function () {
  qsa('.cf-select-dropdown').forEach(function (d) {
    if (d.style.display !== 'none') {
      var wrap = d.closest('.cf-select-wrap');
      if (wrap) positionCFDropdown(wrap);
    }
  });
  qsa('.combo-box.combo-open').forEach(function (el) {
    positionComboDropdown(el);
  });
});

// ── Custom field select / multi-select (shared: drawer + create modal) ──
function getProductTeamSpaceId() {
  var sp = (S.data.spaces || []).find(function (s) {
    return s.name === 'Product_Team' || s.key === 'PTM';
  });
  return sp ? sp.id : null;
}

// ── Product Type / Combination visibility ─────────────────
// Driven by what the space actually has in Settings → Custom Fields, not by
// whether the space happens to be Product_Team:
//   has Combination (+ Product Type)  → the combined Product Type + Combinations
//                                       picker, exactly what Product_Team shows
//   has Product Type only             → the plain Product Type dropdown
//   has neither                       → nothing
// Previously both surfaces gated on `spaceId === Product_Team`, so every other
// space got nothing on create even with Product Type enabled in its settings —
// and the standalone dropdown was hard-hidden for ALL spaces, Product_Team
// included, which is why ticking the field in Custom Fields did nothing.
function spaceHasCombinationField(spaceId, place) {
  var meta = findCombinationFieldMeta(spaceId);
  if (!meta) return false;
  return customFieldShowsIn(meta, place);
}
function spaceHasProductTypeField(spaceId, place) {
  return isSpaceBuiltinFieldEnabled(spaceId, 'product_type', place);
}
// 'combo' | 'plain' | 'none' — the single decision both surfaces follow.
function productTypeMode(spaceId, place) {
  if (!spaceId) return 'none';
  var hasPt = spaceHasProductTypeField(spaceId, place);
  if (spaceHasCombinationField(spaceId, place) && hasPt) return 'combo';
  return hasPt ? 'plain' : 'none';
}

function getIssueFormTeam() {
  return $('issueTeam') ? $('issueTeam').value : '';
}

function findCombinationFieldMeta(spaceId) {
  if (!spaceId) return null;
  return (S.data.custom_fields || []).find(function (f) {
    return f.space_id === spaceId && isCombinationField(f);
  }) || null;
}

async function ensureCombinationFieldMeta(spaceId) {
  var meta = findCombinationFieldMeta(spaceId);
  if (meta && meta.id) return meta;
  // Used to bail out for anything that wasn't Product_Team, so a space with its
  // own Combination field could never load its options. Any space may have one now.
  if (!spaceId) return null;
  try {
    var data = await api('/api/data?space_id=' + encodeURIComponent(spaceId));
    if (data && data.custom_fields && data.custom_fields.length) {
      S.data.custom_fields = (S.data.custom_fields || [])
        .filter(function (f) { return f.space_id !== spaceId; })
        .concat(data.custom_fields);
      meta = findCombinationFieldMeta(spaceId);
      if (meta && meta.id) return meta;
    }
    var cfs = await api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId));
    if (Array.isArray(cfs) && cfs.length) {
      S.data.custom_fields = (S.data.custom_fields || [])
        .filter(function (f) { return f.space_id !== spaceId; })
        .concat(cfs);
      return findCombinationFieldMeta(spaceId);
    }
  } catch (_) {}
  return null;
}

function renderIssueProductTypeSets(spaceId) {
  var group = $('issueCombinationGroup');
  var container = $('issueCombinationField');
  var productTypeGroup = $('issueProductTypeGroup');

  if (!group || !container) return Promise.resolve();

  var team = getIssueFormTeam();
  var mode = productTypeMode(spaceId, 'create');

  if (mode === 'none') {
    if (productTypeGroup) productTypeGroup.hidden = true;
    group.hidden = true;
    container.innerHTML = '';
    _issuePtComboSel = null;
    if ($('issueProductType')) $('issueProductType').value = '';
    return Promise.resolve();
  }

  if (mode === 'plain') {
    // Product Type on its own — the plain dropdown, no Combinations picker.
    group.hidden = true;
    container.innerHTML = '';
    _issuePtComboSel = null;
    if (productTypeGroup) productTypeGroup.hidden = false;
    return Promise.resolve();
  }

  // mode === 'combo'
  if (productTypeGroup) productTypeGroup.hidden = true;
  group.hidden = false;
  // No outer label — the picker carries its own "Product Type" / "Combinations"
  // section headings, so a wrapper label just repeated them.

  if (!_issuePtComboSel) _issuePtComboSel = emptyPtComboSelection();

  // The space's OWN combination field, so a non-Product_Team space uses its own
  // configured options rather than borrowing Product_Team's.
  return ensureCombinationFieldMeta(spaceId).then(function (meta) {
    if (!meta || !meta.id) {
      // Combination is configured but its options failed to load — fall back to
      // the plain dropdown rather than showing an empty box.
      group.hidden = true;
      container.innerHTML = '';
      if (productTypeGroup) productTypeGroup.hidden = !spaceHasProductTypeField(spaceId, 'create');
      return;
    }
    container.innerHTML = buildProductTypeComboPickerHtml(_issuePtComboSel, meta, spaceId);
    bindProductTypeComboPicker(container, meta, { stateKey: '_issuePtComboSel' });
  });
}

function renderIssueCombinationField(spaceId) {
  return renderIssueProductTypeSets(spaceId);
}

async function renderDrawerProductTypeSets(issueId, spaceId, cfValues, productType) {
  var row = $('drawerCombinationRow');
  var container = $('drawerCombinationField');
  var ptRow = $('drawerProductTypeRow');

  if (!row || !container) return;

  var team = $('drawerTeam') ? $('drawerTeam').value : '';
  var mode = productTypeMode(spaceId, 'drawer');

  if (mode === 'none') {
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow) ptRow.hidden = true;
    return;
  }

  if (mode === 'plain') {
    // Plain Product Type row; its own onchange already saves product_type.
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow) {
      ptRow.hidden = false;
      if ($('drawerProductType')) $('drawerProductType').value = productType || '';
    }
    return;
  }

  // mode === 'combo'
  if (ptRow) ptRow.hidden = true;
  row.hidden = false;
  // The row is a single full-width cell now; the picker supplies its own
  // section headings, so there is no .dfl label to fill in.

  var meta = await ensureCombinationFieldMeta(spaceId);
  if (!meta || !meta.id) {
    // Same fallback as the create form: show the plain row rather than an
    // "unavailable" dead end, so the user can still set a product type.
    row.hidden = true;
    container.innerHTML = '';
    if (ptRow && spaceHasProductTypeField(spaceId, 'drawer')) {
      ptRow.hidden = false;
      if ($('drawerProductType')) $('drawerProductType').value = productType || '';
    }
    return;
  }

  var combinationVal = '';
  (cfValues || []).forEach(function (v) {
    if (v.field_id === meta.id) combinationVal = v.value;
    else if ((v.field_name || '').toLowerCase() === 'combination') combinationVal = v.value;
  });
  if (!combinationVal) {
    var bulk = (S.data.issue_field_values || []).find(function (v) {
      return v.issue_id == issueId && v.field_id == meta.id;
    });
    if (bulk) combinationVal = bulk.value;
  }

  _drawerPtComboSel = parsePtComboSelection(productType, combinationVal);
  container.innerHTML = buildProductTypeComboPickerHtml(_drawerPtComboSel, meta, spaceId);
  bindProductTypeComboPicker(container, meta, {
    stateKey: '_drawerPtComboSel',
    onChange: function (sel) {
      if (issueId) saveDrawerPtComboSelection(issueId, sel, meta);
    }
  });
}

async function renderDrawerCombinationField(issueId, spaceId, cfValues, productType) {
  return renderDrawerProductTypeSets(issueId, spaceId, cfValues, productType);
}

function buildCombinationComboboxHtml(fieldId, selectedVal) {
  selectedVal = selectedVal || '';
  return '<div class="combo-box" data-cf-id="' + esc(fieldId) + '" data-value="' + esc(selectedVal) + '">' +
    '<div class="combo-input-wrap">' +
      '<svg class="combo-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input type="text" class="combo-input" placeholder="Search source e.g. Box, SharePoint" value="' + esc(selectedVal) + '" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="combo-clear" title="Clear"' + (selectedVal ? '' : ' hidden') + '>×</button>' +
      '<span class="combo-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>' +
    '</div>' +
    '<div class="combo-dropdown" hidden>' +
      '<div class="combo-list"></div>' +
      '<div class="combo-empty" hidden>No combinations match your search</div>' +
    '</div>' +
  '</div>';
}

function bindCombinationCombobox(el, config) {
  config = config || {};
  if (!el || el._comboBound) return;
  el._comboBound = true;
  var fieldId = el.dataset.cfId;
  var input = el.querySelector('.combo-input');
  var dropdown = el.querySelector('.combo-dropdown');
  var listEl = el.querySelector('.combo-list');
  var emptyEl = el.querySelector('.combo-empty');
  var clearBtn = el.querySelector('.combo-clear');
  var chevron = el.querySelector('.combo-chevron');

  function resolveOptions() {
    if (typeof config.getOptions === 'function') return config.getOptions() || [];
    if (config.options && config.options.length) return config.options.slice();
    return getCombinationOptionsList();
  }

  var options = resolveOptions();
  var selectedVal = el.dataset.value || '';
  if (selectedVal && typeof normalizeCombinationLabel === 'function') {
    selectedVal = normalizeCombinationLabel(selectedVal);
    el.dataset.value = selectedVal;
    input.value = selectedVal;
  }
  var highlightIdx = -1;

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(selectedVal);
  }

  function setValue(val) {
    selectedVal = val ? (typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(val) : val) : '';
    el.dataset.value = selectedVal;
    input.value = selectedVal;
    if (clearBtn) clearBtn.hidden = !selectedVal;
    closeDropdown();
    notify();
  }

  function renderList(filter) {
    options = resolveOptions();
    var matches = options.filter(function (o) {
      return matchCombinationSearch(o, filter);
    });
    highlightIdx = matches.length ? 0 : -1;
    listEl.innerHTML = matches.map(function (o, i) {
      var active = o === selectedVal;
      var hi = i === highlightIdx;
      return '<button type="button" class="combo-option' + (active ? ' is-selected' : '') + (hi ? ' is-highlighted' : '') + '" data-val="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
    emptyEl.hidden = matches.length > 0;
    listEl.hidden = matches.length === 0;
  }

  function openDropdown() {
    qsa('.combo-dropdown').forEach(function (d) {
      if (d !== dropdown) d.hidden = true;
    });
    dropdown.hidden = false;
    el.classList.add('combo-open');
    renderList(input.value);
    positionComboDropdown(el);
  }

  function closeDropdown() {
    dropdown.hidden = true;
    el.classList.remove('combo-open');
    highlightIdx = -1;
    if (selectedVal) input.value = selectedVal;
  }

  function selectHighlighted() {
    var hi = listEl.querySelector('.combo-option.is-highlighted');
    if (hi) setValue(hi.dataset.val);
  }

  input.addEventListener('focus', function () { openDropdown(); });
  input.addEventListener('input', function () {
    openDropdown();
    renderList(input.value);
  });
  input.addEventListener('keydown', function (ev) {
    var opts = listEl.querySelectorAll('.combo-option');
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (dropdown.hidden) openDropdown();
      highlightIdx = Math.min(highlightIdx + 1, opts.length - 1);
      opts.forEach(function (o, i) { o.classList.toggle('is-highlighted', i === highlightIdx); });
      if (opts[highlightIdx]) opts[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      opts.forEach(function (o, i) { o.classList.toggle('is-highlighted', i === highlightIdx); });
      if (opts[highlightIdx]) opts[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      selectHighlighted();
    } else if (ev.key === 'Escape') {
      closeDropdown();
      input.blur();
    }
  });

  listEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.combo-option');
    if (btn) setValue(btn.dataset.val);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      setValue('');
      input.focus();
      openDropdown();
    });
  }

  if (chevron) {
    chevron.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (dropdown.hidden) { input.focus(); openDropdown(); }
      else closeDropdown();
    });
  }

  el.addEventListener('click', function (ev) { ev.stopPropagation(); });
}

function positionComboDropdown(el) {
  var dropdown = el.querySelector('.combo-dropdown');
  var wrap = el.querySelector('.combo-input-wrap');
  if (!dropdown || !wrap || dropdown.hidden) return;
  var rect = wrap.getBoundingClientRect();
  var maxH = Math.min(280, window.innerHeight - rect.bottom - 12);
  if (maxH < 140 && rect.top > 160) {
    dropdown.style.top = '';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(280, rect.top - 12) + 'px';
  } else {
    dropdown.style.bottom = '';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = maxH + 'px';
  }
  dropdown.style.position = 'fixed';
  dropdown.style.left = Math.max(8, rect.left) + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.style.zIndex = '10050';
}

function repositionOpenFloatingDropdowns() {
  qsa('.combo-box.combo-open').forEach(positionComboDropdown);
  qsa('.cf-select-dropdown').forEach(function (d) {
    if (d.style.display !== 'none') {
      var wrap = d.closest('.cf-select-wrap');
      if (wrap) positionCFDropdown(wrap);
    }
  });
}

(function bindFloatingDropdownScrollReposition() {
  if (window._floatDropScrollBound) return;
  window._floatDropScrollBound = true;
  document.addEventListener('DOMContentLoaded', function () {
    var modalBody = document.querySelector('#modal-issue .modal-body');
    if (modalBody) modalBody.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true });
    qsa('.drawer-sidebar').forEach(function (el) {
      el.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true });
    });
  });
  document.addEventListener('scroll', repositionOpenFloatingDropdowns, { passive: true, capture: true });
})();

var _issuePtComboSel = null;
var _drawerPtComboSel = null;

var PRODUCT_TYPE_CHECKBOX_OPTIONS = [
  { v: 'Message', l: 'Message Type' },
  { v: 'Email', l: 'Mail Type' },
  { v: 'Content', l: 'Content Type' },
  { v: 'Manage', l: 'Manage' },
  { v: 'Infra', l: 'Infra' }
];

function emptyPtComboSelection() {
  return { productTypes: [], combinations: [] };
}

function parsePtComboSelection(productType, combinationValue) {
  var sel = emptyPtComboSelection();
  if (combinationValue && String(combinationValue).trim().charAt(0) === '{') {
    try {
      var parsed = JSON.parse(combinationValue);
      if (parsed && parsed.v === 2) {
        sel.productTypes = (parsed.productTypes || []).slice();
        sel.combinations = (parsed.combinations || []).slice();
        return sel;
      }
      if (parsed && parsed.v === 1 && Array.isArray(parsed.sets)) {
        parsed.sets.forEach(function (s) {
          if (s.productType && sel.productTypes.indexOf(s.productType) < 0) sel.productTypes.push(s.productType);
          (s.combinations || []).forEach(function (c) {
            if (sel.combinations.indexOf(c) < 0) sel.combinations.push(c);
          });
        });
        return sel;
      }
    } catch (_) {}
  }
  var pt = (productType || '').trim();
  if (pt.indexOf(',') >= 0) {
    sel.productTypes = pt.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  } else if (pt) {
    sel.productTypes = [pt];
  }
  if (combinationValue && String(combinationValue).trim() && String(combinationValue).trim().charAt(0) !== '{') {
    sel.combinations = String(combinationValue).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (sel.combinations.length === 1 && typeof normalizeCombinationLabel === 'function') {
      sel.combinations[0] = normalizeCombinationLabel(sel.combinations[0]);
    }
  }
  return sel;
}

// Plain-text render of a Combination field's raw stored value, for contexts
// (the All Work table) that just print a custom field's value as text rather
// than driving the combo-box picker UI. Existing rows saved before the
// serializePtComboSelection fix above can still carry the old
// {"v":2,"productTypes":[...],"combinations":[]} JSON form, so this has to
// handle that regardless of what gets newly saved going forward.
//
// Deliberately does NOT fall back to showing productTypes when there are no
// real combinations: that would put the same values in both the Combination
// and Product Type columns, which is exactly the "one field showing as
// another" mixing this whole fix exists to undo. No combination selected
// means the cell is genuinely empty -- the table already renders '' as the
// dash, so returning '' here is correct, not a missing case.
function formatCombinationFieldDisplayValue(rawValue) {
  if (!rawValue) return '';
  var trimmed = String(rawValue).trim();
  if (trimmed.charAt(0) !== '{') return rawValue; // already a plain combination string
  var sel = parsePtComboSelection('', rawValue);
  if (sel.combinations.length) {
    return sel.combinations.map(function (c) {
      return typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(c) : c;
    }).join(', ');
  }
  return '';
}

function serializePtComboSelection(sel) {
  sel = sel || emptyPtComboSelection();
  var types = (sel.productTypes || []).filter(Boolean);
  var combos = (sel.combinations || []).filter(Boolean);
  // Product Type and Combination are two different fields (issues.product_type
  // vs. the "Combination" custom field's own value) and should stay that way.
  // This used to JSON-encode {productTypes, combinations:[]} into the
  // COMBINATION field even when zero combinations were selected -- e.g. two
  // product types picked with no specific combination -- so the All Work
  // table's Combination column showed a raw {"v":2,"productTypes":[...]}
  // blob for rows that had no combination at all. That encoding was also
  // never necessary: product_type below already fully captures a multi-type
  // selection on its own, and parsePtComboSelection's non-JSON fallback path
  // reconstructs it from that plain string when combinationValue is empty.
  // The JSON form is only actually needed when there's more than one REAL
  // combination to store, or exactly one combination that needs to say which
  // of several product types it belongs to.
  var combinationValue = null;
  if (combos.length > 1 || (combos.length === 1 && types.length > 1)) {
    combinationValue = JSON.stringify({ v: 2, productTypes: types, combinations: combos });
  } else if (combos.length === 1) {
    combinationValue = combos[0];
  }
  return {
    product_type: types.length ? types.join(',') : null,
    combination: combinationValue
  };
}

// Every selected product type now participates in combinations -- there's no
// more fixed subset of "types that get grouped combinations" vs "types that
// see everything" vs "types that get nothing" (that used to be exactly
// Message/Email/Content, plus Manage/Infra hardcoded by literal name here).
// A type with no combinations configured for it yet just has an empty list.
function getComboTypesFromSelection(types) {
  return (types || []).slice();
}

function pruneCombinationsForTypes(sel, meta) {
  var allowed = {};
  getComboTypesFromSelection(sel.productTypes).forEach(function (t) {
    getCombinationsForProductType(t, meta).forEach(function (c) { allowed[c] = true; });
  });
  sel.combinations = (sel.combinations || []).filter(function (c) { return allowed[c]; });
}

function buildProductTypeCheckboxListHtml(selectedTypes, ptOptions) {
  ptOptions = ptOptions || PRODUCT_TYPE_CHECKBOX_OPTIONS;
  return ptOptions.map(function (t) {
    var val = t.v != null ? t.v : t;
    var label = t.l != null ? t.l : getProductTypeLabel(val);
    var checked = selectedTypes.indexOf(val) >= 0;
    return '<label class="pt-combo-check" title="' + escAttr(label) + '">' +
      '<input type="checkbox" class="pt-combo-cb-input pt-type-cb" value="' + esc(val) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="pt-combo-check-label">' + esc(label) + '</span></label>';
  }).join('');
}

function getProductTypeOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'product_type') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = PRODUCT_TYPE_CHECKBOX_OPTIONS.map(function (o) { return o.v; });
  return vals.map(function (v) {
    return { v: v, l: getProductTypeLabel(v) };
  });
}

// Type/priority equivalent of getProductTypeOptionsForSpace — order is the
// order configured in Settings, which for priority IS the severity order
// (index 0 = most severe) per the admin-facing convention documented on the
// Combination-group editor's sibling: what's typed in Options is what shows,
// in that order, everywhere the field is picked.
function getIssueTypeOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'type') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = BUILTIN_SELECT_FALLBACKS.type;
  return vals.map(function (v) { return { v: v, l: cap(v) }; });
}
function getIssuePriorityOptionsForSpace(spaceId) {
  var field = spaceId ? findSpaceFieldByKey(spaceId, 'priority') : null;
  var vals = field ? normalizeCFOptions(field.options) : [];
  if (!vals.length) vals = BUILTIN_SELECT_FALLBACKS.priority;
  return vals.map(function (v) { return { v: v, l: cap(v) }; });
}

function buildCombinationCheckboxListHtml(selectedTypes, selectedCombos, meta, filter) {
  filter = (filter || '').trim();
  var comboTypes = getComboTypesFromSelection(selectedTypes);
  if (!comboTypes.length) {
    return '<p class="pt-combo-hint">Select a product type above to see combinations.</p>';
  }
  var html = '';
  comboTypes.forEach(function (type) {
    var combos = getCombinationsForProductType(type, meta).filter(function (c) {
      return matchCombinationFilter(c, filter);
    });
    if (!combos.length) return;
    html += '<div class="pt-combo-group" data-type="' + esc(type) + '">' +
      '<div class="pt-combo-group-title">' + esc(getProductTypeLabel(type)) + '</div>';
    html += combos.map(function (c) {
      var checked = selectedCombos.indexOf(c) >= 0;
      // title carries the full value — labels are single-line with an ellipsis.
      return '<label class="pt-combo-check" title="' + escAttr(c) + '">' +
        '<input type="checkbox" class="pt-combo-cb-input pt-combo-cb" value="' + esc(c) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="pt-combo-check-label">' + esc(c) + '</span></label>';
    }).join('');
    html += '</div>';
  });
  if (!html) {
    return '<p class="pt-combo-hint">' + (filter ? 'No combinations match “' + esc(filter) + '”.' : 'No combinations available.') + '</p>';
  }
  return html;
}

function buildProductTypeComboPickerHtml(sel, meta, spaceId) {
  var fieldId = meta && meta.id ? meta.id : '';
  sel = sel || emptyPtComboSelection();
  var ptOptions = getProductTypeOptionsForSpace(spaceId || (meta && meta.space_id));
  return '<div class="pt-combo-picker" data-field-id="' + esc(fieldId) + '">' +
    '<div class="pt-combo-section">' +
      '<div class="pt-combo-section-title">Product Type</div>' +
      '<div class="pt-combo-panel pt-combo-panel-types">' +
        '<div class="pt-combo-checklist pt-type-list">' + buildProductTypeCheckboxListHtml(sel.productTypes, ptOptions) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="pt-combo-section">' +
      '<div class="pt-combo-section-title">Combinations</div>' +
      '<div class="pt-combo-panel">' +
        '<div class="pt-combo-panel-toolbar">' +
          '<div class="pt-combo-search-wrap">' +
            '<svg class="pt-combo-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" class="pt-combo-search" placeholder="Search…" autocomplete="off" spellcheck="false">' +
          '</div>' +
        '</div>' +
        '<div class="pt-combo-checklist pt-combo-list">' +
          buildCombinationCheckboxListHtml(sel.productTypes, sel.combinations, meta, '') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function bindProductTypeComboPicker(container, meta, config) {
  config = config || {};
  var stateKey = config.stateKey || '_issuePtComboSel';
  var sel = window[stateKey] || emptyPtComboSelection();
  window[stateKey] = sel;

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(sel);
  }

  function readTypeCheckboxes() {
    sel.productTypes = [];
    container.querySelectorAll('.pt-type-cb:checked').forEach(function (cb) {
      sel.productTypes.push(cb.value);
    });
    pruneCombinationsForTypes(sel, meta);
    refreshComboList();
    notify();
  }

  function readComboCheckboxes(ev) {
    var target = ev && ev.target;
    if (target && target.classList.contains('pt-combo-cb')) {
      var val = target.value;
      var idx = sel.combinations.indexOf(val);
      if (target.checked && idx < 0) sel.combinations.push(val);
      else if (!target.checked && idx >= 0) sel.combinations.splice(idx, 1);
    } else {
      var merged = sel.combinations.slice();
      container.querySelectorAll('.pt-combo-cb:checked').forEach(function (cb) {
        if (merged.indexOf(cb.value) < 0) merged.push(cb.value);
      });
      container.querySelectorAll('.pt-combo-cb:not(:checked)').forEach(function (cb) {
        var i = merged.indexOf(cb.value);
        if (i >= 0) merged.splice(i, 1);
      });
      sel.combinations = merged;
    }
    notify();
  }

  function refreshComboList() {
    var list = container.querySelector('.pt-combo-list');
    var search = container.querySelector('.pt-combo-search');
    if (!list) return;
    var filter = search ? search.value : '';
    list.innerHTML = buildCombinationCheckboxListHtml(sel.productTypes, sel.combinations, meta, filter);
    list.querySelectorAll('.pt-combo-cb').forEach(function (cb) {
      cb.addEventListener('change', readComboCheckboxes);
    });
  }

  container.querySelectorAll('.pt-type-cb').forEach(function (cb) {
    cb.addEventListener('change', readTypeCheckboxes);
  });

  var search = container.querySelector('.pt-combo-search');
  if (search) {
    search.addEventListener('input', refreshComboList);
    search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        search.value = '';
        refreshComboList();
        search.blur();
      }
    });
  }

  container.querySelectorAll('.pt-combo-cb').forEach(function (cb) {
    cb.addEventListener('change', readComboCheckboxes);
  });
}

function readPtComboSelectionFromContainer(container) {
  var sel = emptyPtComboSelection();
  if (!container) return sel;
  container.querySelectorAll('.pt-type-cb:checked').forEach(function (cb) {
    sel.productTypes.push(cb.value);
  });
  container.querySelectorAll('.pt-combo-cb:checked').forEach(function (cb) {
    sel.combinations.push(cb.value);
  });
  return sel;
}

function getProductTypeSetsFieldValue() {
  var spaceId = ($('issueSpaceId') && $('issueSpaceId').value) || S.currentSpace || '';
  // Read the combined picker whenever THIS space is in combo mode — was gated on
  // spaceId === Product_Team, so another space's picker would have been ignored
  // on submit and its combination silently dropped.
  if (productTypeMode(spaceId, 'create') === 'combo') {
    var container = $('issueCombinationField');
    var sel = _issuePtComboSel || readPtComboSelectionFromContainer(container);
    if (!sel.productTypes.length && !sel.combinations.length && container) {
      sel = readPtComboSelectionFromContainer(container);
    }
    var meta = findCombinationFieldMeta(spaceId);
    var serialized = serializePtComboSelection(sel);
    return {
      product_type: serialized.product_type,
      combination: serialized.combination,
      fieldId: meta ? meta.id : null
    };
  }
  var pt = $('issueProductType') ? $('issueProductType').value : '';
  return pt ? { product_type: pt, combination: null, fieldId: null } : null;
}

function saveDrawerPtComboSelection(issueId, sel, meta) {
  if (!window._drawerPtComboSaveTimer) window._drawerPtComboSaveTimer = null;
  clearTimeout(window._drawerPtComboSaveTimer);
  window._drawerPtComboSaveTimer = setTimeout(function () {
    var serialized = serializePtComboSelection(sel || emptyPtComboSelection());
    api('/api/issues/' + issueId, 'PUT', { product_type: serialized.product_type }).catch(function () {
      toast('Failed to save product type', 'error');
    });
    if (meta && meta.id) {
      api('/api/issues/' + issueId + '/field-values/' + meta.id, 'PUT', { value: serialized.combination || '' })
        .catch(function () { toast('Failed to save combinations', 'error'); });
    }
  }, 350);
}

function getCombinationFieldValue() {
  var ptPayload = getProductTypeSetsFieldValue();
  if (ptPayload && ptPayload.fieldId && ptPayload.combination) {
    return { fieldId: ptPayload.fieldId, value: ptPayload.combination };
  }
  var container = $('issueCombinationField');
  if (!container) return null;
  var box = container.querySelector('.combo-box');
  if (!box) {
    return ptPayload && ptPayload.combination && ptPayload.fieldId
      ? { fieldId: ptPayload.fieldId, value: ptPayload.combination }
      : null;
  }
  var val = box.dataset.value || '';
  var fieldId = box.dataset.cfId;
  if (!fieldId || !val) return null;
  return { fieldId: fieldId, value: val };
}

function normalizeCFOptions(opts) {
  if (!opts) return [];
  var arr = Array.isArray(opts) ? opts : (typeof opts === 'string' ? (function () { try { return JSON.parse(opts); } catch (_) { return []; } })() : []);
  return arr.map(function (o) {
    if (o && typeof o === 'object') return String(o.value != null ? o.value : (o.label != null ? o.label : o));
    return String(o);
  });
}

// Builds <option> HTML for the builtin Team / Product Type <select>s from
// whatever the space's own custom_fields.options actually says right now --
// index.html used to hardcode a fixed 5-option list for each, so editing a
// space's Team/Product Type options in Custom Field settings never showed up
// in Create Issue or the drawer at all. currentValue is kept as a visible
// option even if it's since been removed from the configured list (labeled
// "(removed)"), so a ticket that already has that value doesn't look like it
// silently lost it -- but it isn't offered as a fresh choice for anything
// else, since it no longer appears in the space's real option list.
var BUILTIN_SELECT_FALLBACKS = {
  type: ['epic', 'story', 'task', 'bug', 'subtask'],
  priority: ['highest', 'high', 'medium', 'low', 'lowest']
};

function buildBuiltinSelectOptionsHtml(fieldKey, spaceId, currentValue, placeholderLabel) {
  var field = (S.data.custom_fields || []).find(function (f) {
    return f.space_id == spaceId && f.field_key === fieldKey;
  });
  var opts = field ? getCustomFieldOptions(field) : [];
  // Every space is seeded with a real type/priority custom_fields row (see
  // seedBuiltinIssueFields), so this only fires before that data has loaded —
  // still needed so the dropdown isn't empty during that window.
  if (!opts.length && BUILTIN_SELECT_FALLBACKS[fieldKey]) opts = BUILTIN_SELECT_FALLBACKS[fieldKey];
  var label = function (v) {
    if (fieldKey === 'product_type') return getProductTypeLabel(v);
    if (fieldKey === 'type' || fieldKey === 'priority') return cap(v);
    return v;
  };
  var html = placeholderLabel ? ('<option value="">' + esc(placeholderLabel) + '</option>') : '';
  var found = false;
  opts.forEach(function (o) {
    if (String(o) === String(currentValue)) found = true;
    html += '<option value="' + escAttr(o) + '">' + esc(label(o)) + '</option>';
  });
  if (currentValue && !found) {
    html += '<option value="' + escAttr(currentValue) + '">' + esc(label(currentValue)) + ' (removed)</option>';
  }
  return html;
}

// Just the configured value itself -- used to map PRODUCT_TYPE_LABELS
// (combination-options.js), a fixed {Message: 'Message Type', ...} override
// that didn't cover every value (Manage/Infra passed through unchanged) and
// disagreed with the plain value shown everywhere else a Product Type is
// displayed (dropdowns, badges, filters). Removed for consistency.
function getProductTypeLabel(value) {
  return value || '';
}

// Any group key, not just the original fixed Message/Email/Content trio --
// groups now has one entry per Product Type option the space actually has
// configured (see renderCombinationGroupEditors), which can be any name.
function flattenCombinationGroups(groups) {
  var out = [];
  var seen = {};
  if (!groups) return out;
  Object.keys(groups).forEach(function (k) {
    (groups[k] || []).forEach(function (o) {
      var key = String(o).toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(o); }
    });
  });
  return out.sort(function (a, b) { return a.localeCompare(b); });
}

function parseCombinationFieldOptions(field) {
  var raw = field && field.options !== undefined ? field.options : field;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  if (raw && raw.v === 2 && raw.groups) {
    return {
      groups: raw.groups,
      flat: raw.flat || flattenCombinationGroups(raw.groups)
    };
  }
  // No groups info at all (a bare flat array, or nothing usable) -- there is
  // no per-type breakdown to recover here, so this is just the flat list with
  // an empty groups map, rather than guessing a category for each entry.
  var flat = Array.isArray(raw) ? raw.slice() : getCombinationOptionsList();
  return { groups: {}, flat: flat };
}

// Every Product Type gets its own group, keyed by whatever that type's real
// value is -- no more special-casing specific type names to see "all"
// combinations or none. A type with nothing configured for it yet correctly
// returns [], which the picker already renders as "No combinations available".
function getCombinationsForProductType(productType, fieldMeta) {
  var parsed = fieldMeta ? parseCombinationFieldOptions(fieldMeta) : null;
  if (parsed && parsed.groups && parsed.groups[productType]) {
    return parsed.groups[productType].slice();
  }
  return [];
}

function getCombinationOptionsList(fieldMeta) {
  if (fieldMeta) {
    var parsed = parseCombinationFieldOptions(fieldMeta);
    if (parsed.flat && parsed.flat.length) return parsed.flat.slice();
  }
  return (typeof COMBINATION_OPTIONS !== 'undefined' ? COMBINATION_OPTIONS : (window.COMBINATION_OPTIONS || [])).slice();
}

/** Source label = text before " - " (e.g. "Box" from "Box - SharePoint"). */
function getCombinationSourceLabel(option) {
  if (!option) return '';
  var idx = String(option).indexOf(' - ');
  return idx >= 0 ? String(option).slice(0, idx).trim() : String(option).trim();
}

/** Match query against source only, from the start — not destination/middle. */
function matchCombinationSearch(option, query) {
  if (!query || !String(query).trim()) return true;
  var q = String(query).trim().toLowerCase();
  return getCombinationSourceLabel(option).toLowerCase().startsWith(q);
}

/** Full-text filter for checkbox lists — matches source, destination, or anywhere in label. */
function matchCombinationFilter(option, query) {
  if (!query || !String(query).trim()) return true;
  var q = String(query).trim().toLowerCase();
  var full = String(option || '').toLowerCase();
  if (full.indexOf(q) >= 0) return true;
  var parts = String(option || '').split(' - ');
  var src = (parts[0] || '').trim().toLowerCase();
  var dst = (parts[1] || parts[0] || '').trim().toLowerCase();
  if (src.indexOf(q) >= 0 || dst.indexOf(q) >= 0) return true;
  return q.split(/\s+/).every(function (word) {
    return word && full.indexOf(word) >= 0;
  });
}

function getCustomFieldOptions(field) {
  if (isCombinationField(field)) return getCombinationOptionsList(field);
  return normalizeCFOptions(field.options);
}

function getCustomFieldRenderType(field) {
  // Combination uses searchable single-select UI (matches production)
  if (isCombinationField(field)) return 'select';
  return field.field_type || 'text';
}

function buildCFSelectWrapInnerHtml(fid, ftype, opts, val, searchPlaceholder, isCombination) {
  var isMultiSel = ftype === 'multi_select';
  var selected = val ? String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var displayVal = selected.length ? esc(selected.join(', ')) : '';
  var filterPh = searchPlaceholder || (isCombination ? 'Search source e.g. Box…' : 'Search…');
  var comboClass = isCombination ? ' cf-combination-select' : '';
  return '<div class="cf-select-wrap' + comboClass + '" data-cf-id="' + fid + '" data-multi="' + (isMultiSel ? '1' : '0') + '"' + (isCombination ? ' data-combination="1"' : '') + '">' +
    '<div class="cf-select-trigger">' +
      '<input class="cf-sel-search" type="text" value="' + displayVal + '" placeholder="' + (isMultiSel ? 'Select options…' : '— Select —') + '" readonly autocomplete="off">' +
      (selected.length ? '<span class="cf-sel-clear" title="Clear">×</span>' : '') +
      '<span class="cf-sel-arrow">⌄</span>' +
    '</div>' +
    '<div class="cf-select-dropdown" style="display:none">' +
      '<div class="cf-sel-search-wrap">' +
        '<svg class="cf-sel-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input class="cf-sel-filter" type="text" placeholder="' + esc(filterPh) + '" autocomplete="off">' +
      '</div>' +
      '<div class="cf-sel-list">' +
      opts.map(function (o) {
        var sel = selected.indexOf(o) >= 0;
        var checkboxHtml = isMultiSel
          ? '<input type="checkbox" class="cf-sel-opt-checkbox" style="pointer-events:none;margin-right:8px" tabindex="-1"' + (sel ? ' checked' : '') + '>'
          : '';
        return '<div class="cf-sel-opt' + (sel ? ' cf-sel-opt-active' : '') + '" data-val="' + esc(o) + '">' + checkboxHtml + esc(o) + '</div>';
      }).join('') +
      '</div>' +
      (isCombination ? '<div class="cf-sel-empty" style="display:none">No combinations match your search</div>' : '') +
    '</div>' +
  '</div>';
}

function positionCFDropdown(wrapEl) {
  var dropdown = wrapEl.querySelector('.cf-select-dropdown');
  var trigger = wrapEl.querySelector('.cf-select-trigger');
  if (!dropdown || !trigger) return;
  if (!wrapEl.closest('#modal-issue') && !wrapEl.dataset.combination) return;
  var rect = trigger.getBoundingClientRect();
  var maxH = Math.min(320, window.innerHeight - rect.bottom - 16);
  if (maxH < 120) maxH = Math.min(320, rect.top - 16);
  dropdown.style.position = 'fixed';
  dropdown.style.left = Math.max(8, rect.left) + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.style.right = 'auto';
  dropdown.style.zIndex = '10050';
  dropdown.style.maxHeight = maxH + 'px';
  if (rect.bottom + maxH > window.innerHeight - 8 && rect.top > maxH + 8) {
    dropdown.style.top = Math.max(8, rect.top - maxH - 4) + 'px';
  } else {
    dropdown.style.top = (rect.bottom + 4) + 'px';
  }
}

function resetCFDropdownPosition(dropdown) {
  if (!dropdown) return;
  dropdown.style.position = '';
  dropdown.style.left = '';
  dropdown.style.top = '';
  dropdown.style.width = '';
  dropdown.style.right = '';
  dropdown.style.zIndex = '';
  dropdown.style.maxHeight = '';
}

function bindCFSelectWrap(el, config) {
  config = config || {};
  var isMulti = el.dataset.multi === '1';
  var isCombination = el.dataset.combination === '1';
  var selArr = Array.from(el.querySelectorAll('.cf-sel-opt-active')).map(function (o) { return o.dataset.val; });
  var trigger = el.querySelector('.cf-select-trigger');
  var dropdown = el.querySelector('.cf-select-dropdown');
  var searchInput = el.querySelector('.cf-sel-search');
  var filterInput = el.querySelector('.cf-sel-filter');

  function notify() {
    if (typeof config.onChange === 'function') config.onChange(selArr.join(','), selArr);
  }

  function refreshTrigger() {
    searchInput.value = selArr.length ? selArr.join(', ') : '';
    searchInput.placeholder = isMulti ? 'Select options…' : '— Select —';
    var clearBtn = trigger.querySelector('.cf-sel-clear');
    if (selArr.length && !clearBtn) {
      var c = document.createElement('span');
      c.className = 'cf-sel-clear'; c.title = 'Clear'; c.textContent = '×';
      trigger.insertBefore(c, trigger.querySelector('.cf-sel-arrow'));
    } else if (!selArr.length && clearBtn) {
      clearBtn.remove();
    }
  }

  function refreshOpts(filter) {
    var visible = 0;
    el.querySelectorAll('.cf-sel-opt').forEach(function (opt) {
      var v = opt.dataset.val;
      var active = selArr.indexOf(v) >= 0;
      opt.classList.toggle('cf-sel-opt-active', active);
      var cb = opt.querySelector('.cf-sel-opt-checkbox');
      if (cb) cb.checked = active;
      var show = !filter || (isCombination
        ? matchCombinationSearch(v, filter)
        : v.toLowerCase().indexOf(filter.toLowerCase()) >= 0);
      opt.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var emptyEl = el.querySelector('.cf-sel-empty');
    if (emptyEl) emptyEl.style.display = (filter && visible === 0) ? 'block' : 'none';
  }

  function openDropdown() {
    qsa('.cf-select-dropdown').forEach(function (d) {
      if (d !== dropdown) {
        d.style.display = 'none';
        resetCFDropdownPosition(d);
      }
    });
    dropdown.style.display = 'block';
    positionCFDropdown(el);
    if (filterInput) {
      filterInput.value = '';
      refreshOpts('');
      setTimeout(function () { filterInput.focus(); }, 0);
    }
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    resetCFDropdownPosition(dropdown);
    if (filterInput) filterInput.value = '';
    refreshOpts('');
  }

  trigger.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (ev.target.classList.contains('cf-sel-clear')) {
      selArr = []; refreshTrigger(); refreshOpts(''); notify();
      return;
    }
    var isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  if (filterInput) {
    filterInput.addEventListener('input', function (ev) {
      ev.stopPropagation();
      refreshOpts(filterInput.value);
    });
    filterInput.addEventListener('click', function (ev) { ev.stopPropagation(); });
    filterInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeDropdown(); ev.preventDefault(); }
      if (ev.key === 'Enter') {
        var first = el.querySelector('.cf-sel-opt:not([style*="display: none"])') || el.querySelector('.cf-sel-opt');
        var vis = Array.from(el.querySelectorAll('.cf-sel-opt')).filter(function (o) { return o.style.display !== 'none'; });
        if (vis.length) {
          vis[0].click();
          ev.preventDefault();
        }
      }
    });
  }

  el.querySelectorAll('.cf-sel-opt').forEach(function (opt) {
    opt.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var v = opt.dataset.val;
      if (isMulti) {
        var idx = selArr.indexOf(v);
        if (idx >= 0) selArr.splice(idx, 1); else selArr.push(v);
      } else {
        selArr = [v];
        closeDropdown();
      }
      refreshTrigger(); refreshOpts(filterInput ? filterInput.value : '');
      notify();
    });
  });
}

function bindCreateModalCustomFields(container) {
  if (!container) return;
  container.querySelectorAll('.cf-select-wrap[data-cf-id]').forEach(function (el) {
    bindCFSelectWrap(el);
  });
}

function getCreateModalCustomFieldValues() {
  var cfs = {};
  var container = $('issueCustomFieldsContainer');
  if (!container) return cfs;
  container.querySelectorAll('[data-cf-id]').forEach(function (el) {
    var id = el.dataset.cfId;
    if (!id) return;
    if (el.classList.contains('cf-select-wrap')) {
      var sel = Array.from(el.querySelectorAll('.cf-sel-opt-active')).map(function (o) { return o.dataset.val; });
      if (sel.length) cfs[id] = sel.join(',');
    } else if (el.classList.contains('cf-field')) {
      if (el.tagName === 'SELECT' && el.multiple) {
        var mv = Array.from(el.selectedOptions).map(function (o) { return o.value; }).join(',');
        if (mv) cfs[id] = mv;
      } else if (el.type === 'checkbox') {
        // The input carries a literal value="true", so reading .value would
        // save "true" for an unchecked box — read .checked instead.
        if (el.checked) cfs[id] = 'true';
      } else if (el.value) cfs[id] = el.value;
    }
  });
  return cfs;
}

async function renderDrawerCustomFields(cfValues, issueId, spaceId) {
  var c = $('drawerCustomFields');
  if (!c) return;

  // Any space may own a Combination field now, so preload its options whenever
  // one is configured rather than only for Product_Team.
  if (spaceId && findCombinationFieldMeta(spaceId)) {
    await ensureCombinationFieldMeta(spaceId);
  }

  // Get ALL custom fields defined for this space
  var spaceFields = (S.data.custom_fields || []).filter(function(f) { return f.space_id == spaceId; });

  // Fallback: fetch from API if local cache doesn't have this space's fields
  if (!spaceFields.length && spaceId) {
    try {
      var fetched = await api('/api/custom-fields?space_id=' + encodeURIComponent(spaceId), 'GET', null, { silent: true });
      if (fetched && fetched.length) {
        spaceFields = fetched;
        S.data.custom_fields = (S.data.custom_fields || [])
          .filter(function (f) { return f.space_id != spaceId; })
          .concat(fetched);
      }
    } catch (e) {
      // Was catch(e) {} followed by rendering nothing, so a failed fetch looked
      // exactly like a space with no custom fields -- the fields were simply
      // missing from the drawer with no way to tell why.
      toast('Could not load custom fields — ' + errorReason(e), 'error');
      c.innerHTML = '<p class="text-muted text-sm">Custom fields could not be loaded.</p>';
      return;
    }
  }

  if (!spaceFields.length) { c.innerHTML = ''; return; }

  // Build a lookup map of existing values: field_id → value
  // Merge: prefer live cfValues passed in, fallback to bulk-loaded S.data.issue_field_values
  var valueMap = {};
  var bulkVals = (S.data.issue_field_values || []).filter(function(v) { return v.issue_id == issueId; });
  bulkVals.forEach(function(v) { valueMap[v.field_id] = v.value; });
  (cfValues || []).forEach(function(v) { valueMap[v.field_id] = v.value; }); // live values override

  // Fields that are already rendered as built-in drawer fields — skip to avoid duplicates.
  // Also covers custom fields that collide with the built-in Story Points
  // column: without this, editing such a field silently writes to
  // issue_field_values instead of issues.story_points, which reports (Burn
  // Chart, Sprint Summary, etc.) never read — the edit looks like it saved
  // but the real story_points value never changes.
  var _builtinFields = ['team', 'product type', 'story points', 'story_points', 'storypoints', 'points', 'sp'];
  var html = '';
  spaceFields.forEach(function(field) {
    if (field.is_builtin) return;
    if (_builtinFields.indexOf((field.name || '').toLowerCase().trim()) !== -1) return;
    if (isCombinationField(field)) return;
    if (!customFieldShowsIn(field, 'drawer')) return;
    var fid = field.id;
    var fname = esc(field.name);
    var ftype = field.field_type || 'text';
    var val = valueMap[fid] !== undefined ? valueMap[fid] : '';
    var req = field.is_required ? ' <span style="color:var(--red);font-size:11px">*</span>' : '';
    var inputHtml = '';

    if (ftype === 'text') {
      inputHtml = '<input type="text" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '" placeholder="—">';
    } else if (ftype === 'textarea') {
      inputHtml = '<textarea class="input input-sm" data-cf-id="' + fid + '" rows="8" placeholder="—">' + esc(val) + '</textarea>';
    } else if (ftype === 'number') {
      inputHtml = '<input type="number" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '" placeholder="—">';
    } else if (ftype === 'date') {
      inputHtml = '<input type="date" class="input input-sm" data-cf-id="' + fid + '" value="' + esc(val) + '">';
    } else if (ftype === 'checkbox') {
      inputHtml = '<input type="checkbox" data-cf-id="' + fid + '" ' + (val === 'true' ? 'checked' : '') + '>';
    } else if (ftype === 'select' || ftype === 'multi_select') {
      if (isCombinationField(field)) {
        var comboVal = val && typeof normalizeCombinationLabel === 'function' ? normalizeCombinationLabel(val) : val;
        inputHtml = buildCombinationComboboxHtml(fid, comboVal);
      } else {
        var mopts = getCustomFieldOptions(field);
        var renderType = getCustomFieldRenderType(field);
        inputHtml = buildCFSelectWrapInnerHtml(fid, renderType, mopts, val, 'Search…', false);
      }
    } else if (ftype === 'user') {
      var uopts = (S.data.users || [])
        .map(function(u) { return '<option value="' + u.id + '"' + (u.id == val ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');
      inputHtml = '<select class="input input-sm" data-cf-id="' + fid + '"><option value="">—</option>' + uopts + '</select>';
    }

    html += '<tr><td class="dfl">' + fname + req + '</td><td class="dfv">' + inputHtml + '</td></tr>';
  });

  c.innerHTML = html;

  // Bind save-on-change for all inputs
  c.querySelectorAll('[data-cf-id]').forEach(function(el) {
    var fieldId = el.dataset.cfId;
    var isSelectWrap = el.classList.contains('cf-select-wrap');
    var saveTimer = null;

    function saveValue(value) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        api('/api/issues/' + issueId + '/field-values/' + fieldId, 'PUT', { value: value })
          .catch(function() { toast('Failed to save field', 'error'); });
      }, 400);
    }

    if (isSelectWrap) {
      bindCFSelectWrap(el, {
        onChange: function (value) { saveValue(value); }
      });
    } else if (el.classList.contains('combo-box')) {
      bindCombinationCombobox(el, {
        onChange: function (value) { saveValue(value); }
      });
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', function() { saveValue(el.checked ? 'true' : 'false'); });
    } else {
      el.addEventListener('change', function() { saveValue(el.value); });
      el.addEventListener('input', function() { saveValue(el.value); });
    }
  });
}
