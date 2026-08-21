
// ═══════════════════════════════════════════════════════════
// YOUR WORK VIEW
// ═══════════════════════════════════════════════════════════
var _ywCache = null; // { assigned, reported, recent }

var YW_FILTER_DEFS = {
  // status is a true fixed workflow (issue-state-machine.md) -- type/priority
  // are NOT: they're per-space configurable (migration 016), and Your Work
  // spans every space the user belongs to, so there's no single space to read
  // an option list from. Same "distinct values actually on tickets" approach
  // used for the All Work filters — see _ywGetTypeOrPriorityOpts below.
  status: {
    opts: [
      { v: 'To Do', l: 'To Do' }, { v: 'In Progress', l: 'In Progress' },
      { v: 'In Review', l: 'In Review' }, { v: 'Done', l: 'Done' }, { v: 'Blocked', l: 'Blocked' }
    ]
  }
};

function _ywGetTypeOrPriorityOpts(key, issues) {
  var seen = {};
  var opts = [];
  (issues || []).forEach(function (iss) {
    var v = iss[key];
    if (!v || seen[v]) return;
    seen[v] = true;
    opts.push({ v: v, l: cap(v) });
  });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

function _ywGetSpaceOpts(issues) {
  var seen = {};
  var opts = [];
  (issues || []).forEach(function (iss) {
    var id = iss.space_id;
    if (!id || seen[id]) return;
    seen[id] = true;
    opts.push({ v: id, l: iss.space_name || id });
  });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

// The project-key prefix of an issue key ("ENG-13" → "ENG"). Prefers the
// project_key the API joins in; falls back to trimming the trailing -N off the
// key itself for rows that don't carry it (e.g. locally-enriched
// recently-viewed entries).
function _ywIssueKeyPrefix(iss) {
  if (iss && iss.project_key) return String(iss.project_key).toUpperCase();
  var k = String(issueKeyStr(iss) || '');
  var m = k.match(/^(.+)-\d+$/);
  return (m ? m[1] : k).toUpperCase();
}

// Every space the user belongs to gets an option, whether or not they
// currently have a ticket in it — a member of 3 spaces with tickets in only 2
// still sees all 3 keys. Prefixes found on the issues themselves are unioned
// in afterwards so a visible row can never end up unfilterable (e.g. an
// admin assigned a ticket in a space they aren't a member of).
function _ywGetKeyOpts(issues) {
  var seen = {};
  var opts = [];
  var add = function (prefix, label) {
    if (!prefix || seen[prefix]) return;
    seen[prefix] = true;
    opts.push({ v: prefix, l: label || prefix });
  };
  getMyVisibleSpaceIds().forEach(function (sid) {
    var sp = getSpace(sid);
    if (!sp || sp.is_archived || !sp.key) return;
    add(String(sp.key).toUpperCase(), String(sp.key).toUpperCase());
  });
  (issues || []).forEach(function (iss) { add(_ywIssueKeyPrefix(iss)); });
  opts.sort(function (a, b) { return a.l.localeCompare(b.l); });
  return opts;
}

function _ywGetFilterOpts(key, issues) {
  if (key === 'space') return _ywGetSpaceOpts(issues);
  if (key === 'key') return _ywGetKeyOpts(issues);
  if (key === 'type' || key === 'priority') return _ywGetTypeOrPriorityOpts(key, issues);
  return (YW_FILTER_DEFS[key] && YW_FILTER_DEFS[key].opts) || [];
}

function _ywApplyFilters(issues) {
  var f = S.ywFilters || {};
  var search = ($('ywSearch') && $('ywSearch').value || '').toLowerCase().trim();
  var out = (issues || []).slice();
  if (search) {
    out = out.filter(function (i) {
      return (i.title || '').toLowerCase().indexOf(search) >= 0 ||
        String(issueKeyStr(i) || '').toLowerCase().indexOf(search) >= 0;
    });
  }
  if (f.key && f.key.length) {
    out = out.filter(function (i) { return f.key.indexOf(_ywIssueKeyPrefix(i)) >= 0; });
  }
  if (f.type && f.type.length) {
    out = out.filter(function (i) { return f.type.indexOf(i.type) >= 0; });
  }
  if (f.status && f.status.length) {
    out = out.filter(function (i) { return f.status.indexOf(i.status) >= 0; });
  }
  if (f.priority && f.priority.length) {
    out = out.filter(function (i) { return f.priority.indexOf(i.priority) >= 0; });
  }
  if (f.space && f.space.length) {
    out = out.filter(function (i) { return f.space.indexOf(i.space_id) >= 0; });
  }
  if (S.ywExcludeDone) {
    out = out.filter(function (i) { return i.status !== 'Done'; });
  }
  return out;
}

function _ywAnyFilterActive() {
  var f = S.ywFilters || {};
  return !!(
    S.ywExcludeDone ||
    ($('ywSearch') && $('ywSearch').value.trim()) ||
    (f.key && f.key.length) ||
    (f.type && f.type.length) || (f.status && f.status.length) ||
    (f.priority && f.priority.length) || (f.space && f.space.length)
  );
}

function _ywBuildFilterTh(key, label, issues) {
  var sel = (S.ywFilters[key] || []);
  var active = sel.length > 0 || (key === 'status' && S.ywExcludeDone);
  var opts = _ywGetFilterOpts(key, issues);
  var panel = opts.map(function (o) {
    var chk = sel.indexOf(o.v) >= 0 ? ' checked' : '';
    return '<label class="yw-filter-opt"><input type="checkbox" value="' + esc(String(o.v)) + '"' + chk +
      ' onchange="window._ywFilterCheck(\'' + key + '\',this)"> ' + esc(o.l) + '</label>';
  }).join('');
  if (!panel) panel = '<div class="yw-filter-opt" style="color:var(--text3);cursor:default">No options</div>';
  return '<th class="yw-th-filter">' +
    '<div class="yw-th-filter-wrap">' +
      '<span>' + esc(label) + '</span>' +
      '<button type="button" class="yw-filter-trigger' + (active ? ' active' : '') + '" onclick="window._ywToggleFilter(\'' + key + '\',event)" aria-label="Filter ' + esc(label) + '">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>' +
      '<div class="yw-filter-panel" id="yw-filter-' + key + '" hidden onclick="event.stopPropagation()">' + panel + '</div>' +
    '</div></th>';
}

window._ywToggleFilter = function (key, ev) {
  if (ev) ev.stopPropagation();
  var panel = $('yw-filter-' + key);
  if (!panel) return;
  var open = panel.hidden;
  document.querySelectorAll('.yw-filter-panel').forEach(function (p) { p.hidden = true; });
  panel.hidden = !open;
};

window._ywFilterCheck = function (key, cb) {
  var arr = S.ywFilters[key] || (S.ywFilters[key] = []);
  if (cb.checked) { if (arr.indexOf(cb.value) < 0) arr.push(cb.value); }
  else { var idx = arr.indexOf(cb.value); if (idx >= 0) arr.splice(idx, 1); }
  if (key === 'status') S.ywExcludeDone = false;
  var btn = document.querySelector('#yw-filter-' + key)?.closest('.yw-th-filter-wrap')?.querySelector('.yw-filter-trigger');
  if (btn) btn.classList.toggle('active', arr.length > 0 || (key === 'status' && S.ywExcludeDone));
  if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
  else renderYourWorkContent(_ywCache);
  if (S.currentView === 'yourwork' && S.yourWorkTab === 'assigned') syncAppUrl({ replace: true });
};

function _renderYourWorkTable(issues, rawIssues, lastColLabel) {
  lastColLabel = lastColLabel || 'Updated';
  if (lastColLabel === 'Viewed') {
    issues.sort(function (a, b) { return new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0); });
  } else {
    issues.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
  }
  var toolbarHtml = _ywAnyFilterActive()
    ? '<div class="yw-table-toolbar">' +
        '<button type="button" class="btn btn-outline btn-sm yw-clear-all-btn" onclick="window._ywClearFilters()">&#10005; Clear all</button>' +
      '</div>'
    : '';
  var html = '<div class="yw-table-wrap">' + toolbarHtml +
    '<table class="yw-table"><thead><tr>' +
    _ywBuildFilterTh('key', 'Key', rawIssues) +
    '<th>Title</th>' +
    _ywBuildFilterTh('type', 'Type', rawIssues) +
    _ywBuildFilterTh('status', 'Status', rawIssues) +
    _ywBuildFilterTh('priority', 'Priority', rawIssues) +
    _ywBuildFilterTh('space', 'Space', rawIssues) +
    '<th>' + esc(lastColLabel) + '</th>' +
    '</tr></thead><tbody>';
  if (!issues.length) {
    html += '<tr><td colspan="7" class="yw-empty-row">' +
      'No issues match your filters. ' +
      '<button type="button" class="btn btn-link btn-sm" onclick="window._ywClearFilters()">Clear filters</button>' +
      '</td></tr>';
  } else {
    for (var i = 0; i < issues.length; i++) {
      var iss = issues[i];
      var iid = iss.id;
      var timeVal = lastColLabel === 'Viewed' ? (iss.viewedAt || iss.updated_at) : iss.updated_at;
      html += '<tr onclick="openIssuePage(\'' + iid + '\')">' +
        '<td class="yw-key">' + esc(issueKeyStr(iss)) + '</td>' +
        '<td class="yw-title-cell">' + esc(iss.title) + '</td>' +
        '<td><span class="type-cell">' + typeIcon(iss.type) + '<span class="type-cell-label">' + cap(iss.type || '') + '</span></span></td>' +
        '<td onclick="event.stopPropagation();awInlineStatus(event,\'' + iid + '\',\'' + (iss.status||'') + '\')" style="cursor:pointer">' + statusBadge(iss.status) + '</td>' +
        '<td onclick="event.stopPropagation();awInlinePriority(event,\'' + iid + '\',\'' + (iss.priority||'') + '\')" style="cursor:pointer">' + priorityBadge(iss.priority) + '</td>' +
        '<td class="yw-space-cell">' + esc(iss.space_name || '') + '</td>' +
        '<td class="yw-time-cell">' + relativeTime(timeVal) + '</td></tr>';
    }
  }
  html += '</tbody></table></div>';
  return html;
}

function _updateYourWorkTabBadges(data) {
  if (!data) return;
  qsa('[data-yw-count]').forEach(function (el) {
    var key = el.dataset.ywCount;
    var n = key === 'assigned' ? (data.assigned || []).length
      : key === 'reported' ? (data.reported || []).length
      : 0;
    if (n > 0) {
      el.textContent = n;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  });
}

function renderYourWork() {
  if (!S.yourWorkTab) S.yourWorkTab = 'assigned';
  var tabs = qsa('.yw-tab');
  tabs.forEach(function (t) {
    var tab = t.dataset.yourworkTab;
    t.classList.toggle('active', tab === S.yourWorkTab);
    if (t.tagName === 'A' && tab) t.setAttribute('href', yourWorkPath(tab));
    t.onclick = function (e) {
      e.preventDefault();
      navigateToYourWork(t.dataset.yourworkTab);
    };
  });
  var staleRecentBadge = document.querySelector('.yw-tab[data-yourwork-tab="recent"] .yw-tab-badge');
  if (staleRecentBadge) staleRecentBadge.remove();
  $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
  if (S.yourWorkTab === 'recent') {
    if (_ywCache) _updateYourWorkTabBadges(_ywCache);
    renderYourWorkContent(_ywCache);
    return;
  }
  if (_ywCache) {
    _updateYourWorkTabBadges(_ywCache);
    renderYourWorkContent(_ywCache);
  }
  api('/api/my-issues').then(function (data) {
    _ywCache = data;
    _updateYourWorkTabBadges(data);
    renderYourWorkContent(data);
  }).catch(function (e) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>' +
      '<h3>Could not load issues</h3><p>Please refresh the page or restart the server.</p></div>';
  });
}

function renderYourWorkContent(data) {
  if (S.yourWorkTab === 'recent') {
    renderRecentlyViewedContent();
    return;
  }
  if (!data) {
    $('yourWorkContent').innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
    return;
  }
  var rawIssues;
  if (S.yourWorkTab === 'assigned') rawIssues = (data.assigned || []).slice();
  else if (S.yourWorkTab === 'reported') rawIssues = (data.reported || []).slice();
  else rawIssues = [];
  var issues = _ywApplyFilters(rawIssues);

  if (!rawIssues.length) {
    var emptyMsg = S.yourWorkTab === 'assigned'
      ? ['No issues assigned to you', 'Issues assigned to you will appear here.']
      : S.yourWorkTab === 'reported'
      ? ['No issues reported by you', 'Issues you create will appear here.']
      : ['No recent activity', 'Recently updated issues will appear here.'];
    $('yourWorkContent').innerHTML =
      '<div class="yw-empty">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>' +
      '<h3>' + emptyMsg[0] + '</h3><p>' + emptyMsg[1] + '</p></div>';
    return;
  }

  if (!issues.length) {
    $('yourWorkContent').innerHTML = _renderYourWorkTable([], rawIssues, 'Updated');
    return;
  }

  $('yourWorkContent').innerHTML = _renderYourWorkTable(issues, rawIssues, 'Updated');
}

function renderRecentlyViewedContent() {
  var container = $('yourWorkContent');
  if (!container) return;
  container.innerHTML = '<div class="yw-empty"><p>Loading…</p></div>';
  enrichRecentlyViewedIssues().then(function (rawIssues) {
    var issues = _ywApplyFilters(rawIssues);
    if (!rawIssues.length) {
      container.innerHTML =
        '<div class="yw-empty">' +
        '<svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>' +
        '<h3>No recently viewed issues</h3><p>Open any ticket from a space you belong to — it will appear here.</p></div>';
      return;
    }
    container.innerHTML = _renderYourWorkTable(issues, rawIssues, 'Viewed');
  });
}

window._ywClearFilters = function () {
  clearYourWorkFilters();
  if (S.yourWorkTab === 'recent') renderRecentlyViewedContent();
  else renderYourWorkContent(_ywCache);
  if (S.currentView === 'yourwork' && S.yourWorkTab === 'assigned') syncAppUrl({ replace: true });
};
