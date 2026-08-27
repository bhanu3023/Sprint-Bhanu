// Capture Team and Product Type
// ═══════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
(function() {
  var _gsTimer = null;
  var _gsActive = false;

  function gsInit() {
    var input = $('globalSearchInput');
    var drop = $('globalSearchDrop');
    if (!input || !drop) return;

    // Open on focus
    input.addEventListener('focus', function() {
      _gsActive = true;
      if (input.value.trim().length >= 1) gsSearch(input.value.trim());
      else gsShowRecent();
    });

    input.addEventListener('input', function() {
      clearTimeout(_gsTimer);
      var q = input.value.trim();
      if (!q) { gsShowRecent(); return; }
      _gsTimer = setTimeout(function() { gsSearch(q); }, 180);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { gsClose(); input.blur(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); gsFocusItem(0); }
    });

    // Keyboard shortcut: press / to focus search
    document.addEventListener('keydown', function(e) {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.activeElement.isContentEditable) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Close on outside click
    document.addEventListener('mousedown', function(e) {
      var wrap = $('globalSearchWrap');
      if (wrap && !wrap.contains(e.target)) gsClose();
    });
  }

  function gsClose() {
    var drop = $('globalSearchDrop');
    if (drop) drop.setAttribute('hidden', '');
    _gsActive = false;
  }

  // The search box lives in the top bar, outside every swapped view, so its
  // typed text otherwise survives every navigateTo()/navigateToSpace() call
  // (sidebar links, breadcrumbs, etc.) -- unlike picking a result, which
  // already clears it. Called from navigation.js on every navigation.
  window._gsReset = function() {
    var input = $('globalSearchInput');
    if (input) input.value = '';
    gsClose();
  };

  function gsShowRecent() {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    var issues = getVisibleIssues()
      .slice().sort(function(a,b){ return new Date(b.updated_at)-new Date(a.updated_at); })
      .slice(0, 8);
    if (!issues.length) { drop.setAttribute('hidden',''); return; }
    drop.innerHTML = '<div class="gs-section-label">Recent Issues</div>' + issues.map(gsItemHtml).join('');
    drop.removeAttribute('hidden');
    gsBindItems();
  }

  function gsSearch(q) {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    var lower = q.toLowerCase();
    var issues = getVisibleIssues().filter(function(i) {
      return (issueKeyStr(i) || '').toLowerCase().indexOf(lower) !== -1 ||
             (i.title || '').toLowerCase().indexOf(lower) !== -1 ||
             (i.status || '').toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 12);
    if (!issues.length) {
      drop.innerHTML = '<div class="gs-empty">No issues found for "' + esc(q) + '"</div>';
      drop.removeAttribute('hidden');
      return;
    }
    drop.innerHTML = '<div class="gs-section-label">Issues</div>' + issues.map(function(i){ return gsItemHtml(i, q); }).join('');
    drop.removeAttribute('hidden');
    gsBindItems();
  }

  function gsItemHtml(issue) {
    var key = esc(issueKeyStr(issue));
    var title = esc(issue.title || '');
    var space = esc(issue.space_name || '');
    var statCol = STATUS_COLORS[issue.status] || '#6b7280';
    return '<div class="gs-item" data-issue-id="' + issue.id + '">' +
      '<span class="gs-item-key">' + key + '</span>' +
      '<span class="gs-item-title">' + title + '</span>' +
      '<span class="gs-item-meta" style="display:flex;align-items:center;gap:5px">' +
        '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + statCol + '"></span>' +
        space +
      '</span>' +
    '</div>';
  }

  function gsBindItems() {
    var drop = $('globalSearchDrop');
    if (!drop) return;
    drop.querySelectorAll('.gs-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var id = el.dataset.issueId;
        var issue = (S.data && S.data.issues || []).find(function(i){ return String(i.id) === String(id); });
        gsClose();
        $('globalSearchInput').value = '';
        if (issue) openIssuePage(issue.id);
      });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') el.dispatchEvent(new MouseEvent('mousedown'));
        if (e.key === 'ArrowDown') { e.preventDefault(); var n = el.nextElementSibling; if (n && n.classList.contains('gs-item')) n.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); var p = el.previousElementSibling; if (p && p.classList.contains('gs-item')) p.focus(); else $('globalSearchInput').focus(); }
      });
      el.setAttribute('tabindex', '0');
    });
  }

  function gsFocusItem(idx) {
    var drop = $('globalSearchDrop');
    if (!drop || drop.hasAttribute('hidden')) return;
    var items = drop.querySelectorAll('.gs-item');
    if (items[idx]) items[idx].focus();
  }

  document.addEventListener('DOMContentLoaded', gsInit);
  setTimeout(function(){ gsInit(); }, 1200);
})();

// Delete bin. Org admin sees every space and is the only role that can Restore or
// Permanently delete. A space admin sees their own spaces' items read-only, so the
// action column is omitted entirely rather than shown-then-rejected.
// `opts.spaceId` renders the space-scoped view used by Space Settings → Deleted items.
async function renderDeletedTickets(el, opts) {
  opts = opts || {};
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading deleted items…</div>';
  var res;
  try {
    res = await api('/api/issues/deleted', 'GET', null, { silent: true });
  } catch (err) {
    // 403 here means "not an admin of any space" — show the reason, not a red error.
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:14px">' +
      esc(err.message || 'You do not have permission to view the deleted items bin.') + '</div>';
    return;
  }
  // Tolerate both the current {can_restore, items} shape and a bare array.
  var canRestore = Array.isArray(res) ? isOrgAdminUser() : !!(res && res.can_restore);
  var tickets = Array.isArray(res) ? res : ((res && res.items) || []);
  if (opts.spaceId) tickets = tickets.filter(function (t) { return t.space_id === opts.spaceId; });

  if (!tickets.length) {
    el.innerHTML = '<div style="padding:24px;color:var(--text3);text-align:center;font-size:14px">Nothing in the bin.</div>';
    return;
  }

  var TYPE_LABEL = { ticket: 'Ticket', sprint: 'Sprint', space: 'Space' };
  var TYPE_COLOR = { ticket: 'var(--accent)', sprint: '#8b5cf6', space: '#0891b2' };
  var counts = tickets.reduce(function (a, t) {
    var k = t.entity_type || 'ticket'; a[k] = (a[k] || 0) + 1; return a;
  }, {});
  var summary = Object.keys(counts).map(function (k) {
    return counts[k] + ' ' + (TYPE_LABEL[k] || k).toLowerCase() + (counts[k] === 1 ? '' : 's');
  }).join(' · ');

  var days = (res && res.retention_days) || binRetentionDays();
  // A bin row must ALWAYS have a name to show and to type. `label` is what the
  // current API sends; `key`/`name`/`title` cover an older or partial response so
  // the confirm dialog can never end up asking you to "type" an empty string.
  tickets.forEach(function (t) {
    t.entity_type = t.entity_type || 'ticket';
    t.label = t.label || t.key || t.name || t.title || t.id;
  });
  var byId = {};
  tickets.forEach(function (t) { byId[t.id] = t; });

  // "What exactly am I destroying?" — only non-zero facts, so the list stays short.
  function purgeDetails(t) {
    var out = [];
    if (t.entity_type === 'sprint') {
      out.push('Sprint record and its history are removed');
      out.push('Its tickets are already in the backlog and are NOT affected');
      return out;
    }
    if (t.title) out.push('Title: ' + t.title);
    if (t.space_name) out.push('Space: ' + t.space_name);
    if (t.status) out.push('Status when deleted: ' + t.status);
    if (t.assignee_name) out.push('Assignee: ' + t.assignee_name);
    if (t.comment_count) out.push(t.comment_count + ' comment' + (t.comment_count === 1 ? '' : 's') + ' will be destroyed');
    if (t.worklog_count) {
      out.push(t.worklog_count + ' work log' + (t.worklog_count === 1 ? '' : 's') +
        (t.logged_minutes ? ' (' + fmtMins(t.logged_minutes) + ' logged)' : '') + ' will be destroyed');
    }
    if (t.attachment_count) out.push(t.attachment_count + ' attachment' + (t.attachment_count === 1 ? '' : 's') + ' will be deleted from disk');
    if (t.subtask_count) out.push(t.subtask_count + ' subtask' + (t.subtask_count === 1 ? '' : 's') + ' will be detached (not deleted)');
    if (!t.comment_count && !t.worklog_count && !t.attachment_count) {
      out.push('No comments, work logs or attachments attached');
    }
    return out;
  }

  var html = '<div style="padding:0 0 16px">' +
    '<h3 style="margin:0 0 4px;font-size:16px">Deleted Items</h3>' +
    '<p style="color:var(--text3);font-size:13px;margin:0">' + (summary || '0 items') + ' in the bin · ' +
    'tickets and sprints are deleted permanently ' + days + ' days after they were binned' +
    (canRestore ? '' : ' · read-only — only an org admin can restore or permanently delete') + '</p></div>';

  // Bulk bar — org admin only, since it is a purge control.
  if (canRestore) {
    html += '<div class="bin-bulkbar">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="binSelectAll"> Select all' +
      '</label>' +
      '<span id="binSelCount" style="color:var(--text3)">None selected</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-outline" id="binBulkRestore" disabled>Restore selected</button>' +
      '<button class="btn btn-sm btn-outline text-danger" id="binBulkPurge" disabled>Delete forever</button>' +
    '</div>';
  }

  html += '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow-x:auto">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--bg3);color:var(--text2)">' +
    (canRestore ? '<th style="padding:10px 12px;width:28px"></th>' : '') +
    '<th style="padding:10px 12px;text-align:left">Type</th>' +
    '<th style="padding:10px 12px;text-align:left">Name</th>' +
    '<th style="padding:10px 12px;text-align:left">Details</th>' +
    '<th style="padding:10px 12px;text-align:left">Space</th>' +
    '<th style="padding:10px 12px;text-align:left">Deleted</th>' +
    '<th style="padding:10px 12px;text-align:left">By</th>' +
    '<th style="padding:10px 12px;text-align:left">Auto-deletes</th>' +
    (canRestore ? '<th style="padding:10px 12px;text-align:left">Actions</th>' : '') +
    '</tr></thead><tbody>';
  tickets.forEach(function (t) {
    var ty = t.entity_type || 'ticket';
    // Spaces are archived rather than tombstoned, so purging them is refused by
    // the API — don't offer a button that can only fail.
    var canPurge = canRestore && ty !== 'space';
    var dl = t.days_left;
    var expiry = ty === 'space'
      ? '<span style="color:var(--text3)">never</span>'
      : (dl == null ? '—'
        : dl <= 0 ? '<span class="bin-expiry-soon">any moment</span>'
        : dl <= 3 ? '<span class="bin-expiry-soon">in ' + dl + ' day' + (dl === 1 ? '' : 's') + '</span>'
        : 'in ' + dl + ' days');
    html += '<tr style="border-bottom:1px solid var(--border)">' +
      (canRestore
        ? '<td style="padding:10px 12px">' +
            '<input type="checkbox" class="bin-check" data-id="' + escAttr(t.id) + '"' +
            (canPurge ? '' : ' data-nopurge="1"') + '>' +
          '</td>'
        : '') +
      '<td style="padding:10px 12px"><span class="badge badge-muted">' + esc(TYPE_LABEL[ty] || ty) + '</span></td>' +
      '<td style="padding:10px 12px;font-weight:700;color:' + TYPE_COLOR[ty] + '">' + esc(t.label || '') + '</td>' +
      '<td style="padding:10px 12px">' + esc(t.title || '—') +
        (ty === 'sprint' && t.restorable_issues
          ? '<div style="color:var(--text3);font-size:12px;margin-top:2px">' +
            t.restorable_issues + ' ticket' + (t.restorable_issues === 1 ? '' : 's') + ' will come back with it</div>'
          : '') +
      '</td>' +
      '<td style="padding:10px 12px;color:var(--text3)">' + esc(t.space_name || '—') + '</td>' +
      '<td style="padding:10px 12px;color:var(--text3);font-size:12px">' + fmtDateTime(t.deleted_at) + '</td>' +
      '<td style="padding:10px 12px;color:var(--text3);font-size:12px">' + esc(t.deleted_by_name || '—') + '</td>' +
      '<td style="padding:10px 12px;font-size:12px">' + expiry + '</td>' +
      (canRestore
        ? '<td style="padding:10px 12px;white-space:nowrap">' +
            '<button class="btn btn-sm btn-outline bin-restore-btn" data-type="' + escAttr(ty) + '" data-id="' + escAttr(t.id) + '" data-key="' + escAttr(t.label || '') + '">Restore</button>' +
            (canPurge
              ? ' <button class="btn btn-sm btn-outline text-danger bin-purge-btn" data-type="' + escAttr(ty) + '" data-id="' + escAttr(t.id) + '" data-key="' + escAttr(t.label || '') + '">Delete forever</button>'
              : '') +
          '</td>'
        : '') +
      '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<p style="font-size:12px;color:var(--text3);margin-top:10px">' +
    'Restoring a sprint also brings back the tickets that went to the backlog with it — except any you have since moved into another sprint, which stay where you put them. ' +
    'Archived spaces can be restored but are never permanently deleted, by hand or automatically.' +
    (canRestore ? '' : ' To restore something, ask an org admin.') + '</p>';
  el.innerHTML = html;

  if (!canRestore) return;   // no handlers to bind for the read-only view

  // ── selection ────────────────────────────────────────────
  var checks = Array.prototype.slice.call(el.querySelectorAll('.bin-check'));
  var selAll = el.querySelector('#binSelectAll');
  var countEl = el.querySelector('#binSelCount');
  var bulkRestore = el.querySelector('#binBulkRestore');
  var bulkPurge = el.querySelector('#binBulkPurge');
  function selected() {
    return checks.filter(function (c) { return c.checked; }).map(function (c) { return byId[c.dataset.id]; }).filter(Boolean);
  }
  function syncSel() {
    var sel = selected();
    var purgeable = sel.filter(function (t) { return t.entity_type !== 'space'; });
    countEl.textContent = sel.length ? sel.length + ' selected' : 'None selected';
    bulkRestore.disabled = !sel.length;
    bulkPurge.disabled = !purgeable.length;
    // The purge button counts only what CAN be purged, so the number on the button
    // is the number of things that will actually be destroyed.
    bulkPurge.textContent = purgeable.length ? 'Delete forever (' + purgeable.length + ')' : 'Delete forever';
    selAll.checked = checks.length > 0 && sel.length === checks.length;
  }
  checks.forEach(function (c) { c.addEventListener('change', syncSel); });
  if (selAll) selAll.addEventListener('change', function () {
    checks.forEach(function (c) { c.checked = selAll.checked; });
    syncSel();
  });
  syncSel();

  // ── single restore ───────────────────────────────────────
  el.querySelectorAll('.bin-restore-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true; btn.textContent = 'Restoring…';
      try {
        var out = await api('/api/bin/' + btn.dataset.type + '/' + btn.dataset.id + '/restore', 'POST', null, { silent: true });
        var n = out && out.restored_issues;
        toast(btn.dataset.key + ' restored' + (n ? ' with ' + n + ' issue' + (n === 1 ? '' : 's') : ''), 'success');
        await refreshData();
        renderDeletedTickets(el, opts);
      } catch (e) {
        toast('Restore failed — ' + errorReason(e), 'error');
        btn.disabled = false; btn.textContent = 'Restore';
      }
    });
  });

  // ── single permanent delete ──────────────────────────────
  el.querySelectorAll('.bin-purge-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var item = byId[btn.dataset.id] || {};
      var key = item.label || btn.dataset.key || btn.dataset.id;
      var isSprint = btn.dataset.type === 'sprint';
      var ok = await typedConfirmDialog({
        title: 'Permanently delete ' + key + '?',
        intro: isSprint
          ? 'This destroys the sprint record for good.'
          : 'This destroys the ticket and everything attached to it:',
        details: purgeDetails(item),
        warn: 'This cannot be undone. There is no second bin.',
        phrase: key,
        phraseHint: isSprint ? 'To confirm, type the sprint name' : 'To confirm, type the issue key',
        confirmLabel: 'Delete forever'
      });
      if (!ok) return;
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        await api('/api/bin/' + btn.dataset.type + '/' + btn.dataset.id, 'DELETE', null, { silent: true });
        toast(key + ' permanently deleted', 'success');
        await refreshData();
        renderDeletedTickets(el, opts);
      } catch (e) {
        toast('Permanent delete failed — ' + errorReason(e), 'error');
        btn.disabled = false; btn.textContent = 'Delete forever';
      }
    });
  });

  // ── bulk restore ─────────────────────────────────────────
  bulkRestore.addEventListener('click', async function () {
    var sel = selected();
    if (!sel.length) return;
    var ok = await confirmDialog('Restore ' + sel.length + ' item(s) from the bin?');
    if (!ok) return;
    bulkRestore.disabled = true;
    var done = 0, failed = 0;
    for (var i = 0; i < sel.length; i++) {
      try {
        await api('/api/bin/' + sel[i].entity_type + '/' + sel[i].id + '/restore', 'POST', null, { silent: true });
        done++;
      } catch (e) { failed++; }
    }
    await refreshData();
    toast(failed
      ? done + ' of ' + (done + failed) + ' items restored — ' + failed + ' failed'
      : done + ' item' + (done === 1 ? '' : 's') + ' restored', failed ? 'error' : 'success');
    renderDeletedTickets(el, opts);
  });

  // ── bulk permanent delete ────────────────────────────────
  bulkPurge.addEventListener('click', async function () {
    var sel = selected();
    var purgeable = sel.filter(function (t) { return t.entity_type !== 'space'; });
    if (!purgeable.length) return;
    var skippedSpaces = sel.length - purgeable.length;
    var single = purgeable.length === 1;
    var ok = await typedConfirmDialog({
      title: single
        ? 'Permanently delete ' + purgeable[0].label + '?'
        : 'Permanently delete ' + purgeable.length + ' items?',
      intro: single
        ? 'This destroys the item and everything attached to it:'
        : 'These ' + purgeable.length + ' items will be destroyed for good:',
      details: single
        ? purgeDetails(purgeable[0])
        : purgeable.slice(0, 10).map(function (t) {
            var extra = [];
            if (t.comment_count) extra.push(t.comment_count + ' comment' + (t.comment_count === 1 ? '' : 's'));
            if (t.worklog_count) extra.push(t.worklog_count + ' work log' + (t.worklog_count === 1 ? '' : 's'));
            if (t.attachment_count) extra.push(t.attachment_count + ' attachment' + (t.attachment_count === 1 ? '' : 's'));
            return (t.entity_type === 'sprint' ? 'Sprint ' : '') + t.label +
              (t.title ? ' — ' + t.title : '') + (extra.length ? ' (' + extra.join(', ') + ')' : '');
          })
          .concat(purgeable.length > 10 ? ['…and ' + (purgeable.length - 10) + ' more'] : [])
          .concat(skippedSpaces
            ? [skippedSpaces + ' archived space(s) in your selection will be SKIPPED — spaces cannot be permanently deleted']
            : []),
      warn: 'This cannot be undone. Comments, work logs, attachments and history are destroyed with each ticket.',
      phrase: single ? purgeable[0].label : 'delete all',
      phraseHint: single
        ? (purgeable[0].entity_type === 'sprint' ? 'To confirm, type the sprint name' : 'To confirm, type the ticket number')
        : 'To confirm, type',
      confirmLabel: single ? 'Delete forever' : 'Delete ' + purgeable.length + ' forever'
    });
    if (!ok) return;
    bulkPurge.disabled = true; bulkPurge.textContent = 'Deleting…';
    try {
      var out = await api('/api/bin/purge', 'POST', {
        items: purgeable.map(function (t) { return { type: t.entity_type, id: t.id }; })
      }, { silent: true });
      toast((out.purged || 0) + ' item(s) permanently deleted' +
        (out.skipped ? ', ' + out.skipped + ' already gone' : ''), 'success');
      await refreshData();
      renderDeletedTickets(el, opts);
    } catch (e) {
      toast('Permanent delete failed — ' + errorReason(e), 'error');
      syncSel();
    }
  });
}

window._filterUsers = function(query) {
  var q = (query||'').trim().toLowerCase();
  var tables = document.querySelectorAll('table');
  var found = false;
  tables.forEach(function(table) {
    var rows = table.querySelectorAll('tbody tr');
    if (rows.length === 0) return;
    rows.forEach(function(row) {
      var text = row.textContent.toLowerCase();
      var show = q === '' || text.includes(q);
      row.style.display = show ? '' : 'none';
      if (show) found = true;
    });
    // Show no results message
    var noRes = table.parentNode.querySelector('.user-no-results');
    if (q && !found) {
      if (!noRes) {
        noRes = document.createElement('div');
        noRes.className = 'user-no-results';
        noRes.style.cssText = 'padding:32px;text-align:center;color:var(--text3);font-size:14px';
        noRes.textContent = 'No users found for "' + query + '"';
        table.parentNode.appendChild(noRes);
      } else {
        noRes.style.display = '';
        noRes.textContent = 'No users found for "' + query + '"';
      }
    } else if (noRes) {
      noRes.style.display = 'none';
    }
  });
};

// ── Rich Text Editor helpers (Create Issue description) ──────
window.rteCmd = function(cmd) {
  var el = document.getElementById('issueDescContent');
  if (el) el.focus();
  document.execCommand(cmd, false, null);
};
window.rteLink = function() {
  var url = prompt('Enter URL:');
  if (url) {
    var el = document.getElementById('issueDescContent');
    if (el) el.focus();
    document.execCommand('createLink', false, url);
  }
};
