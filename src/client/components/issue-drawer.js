
// ═══════════════════════════════════════════════════════════
// ISSUE DRAWER (open)
// ═══════════════════════════════════════════════════════════
function stripTitleNewlines(raw) {
  return String(raw || '').replace(/[\r\n\u2028\u2029]+/g, ' ');
}

function finalizeIssueTitle(raw) {
  return stripTitleNewlines(raw).replace(/\s+/g, ' ').trim();
}

function resizeDrawerTitleField() {
  var el = $('drawerTitle');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 28) + 'px';
}

function setDrawerTitleValue(title) {
  var el = $('drawerTitle');
  if (!el) return;
  el.value = finalizeIssueTitle(title);
  resizeDrawerTitleField();
}

function getDrawerTitleValue() {
  var el = $('drawerTitle');
  return el ? finalizeIssueTitle(el.value) : '';
}

// #drawerTitle is static markup that outlives every drawer open, so its listeners
// are bound once (rebinding stacked duplicates). It therefore must NOT capture an
// autoSave: the closure it captured on the first open kept saving to that first
// ticket, so editing any later ticket's title silently overwrote the first one's
// — and patched the wrong row in the local cache too. Resolve the save target at
// typing time instead, via _activeDrawerAutoSave.
function bindDrawerTitleField() {
  var el = $('drawerTitle');
  if (!el || el._titleBound) return;
  el._titleBound = true;
  var autoSave = function (field, value) {
    if (_activeDrawerAutoSave) _activeDrawerAutoSave(field, value);
  };

  el.addEventListener('input', function () {
    var noBreaks = stripTitleNewlines(el.value);
    if (el.value !== noBreaks) {
      var pos = el.selectionStart || 0;
      el.value = noBreaks;
      el.selectionStart = el.selectionEnd = Math.min(pos, noBreaks.length);
    }
    resizeDrawerTitleField();
    if (noBreaks.trim()) autoSave('title', noBreaks);
  });

  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });

  el.addEventListener('paste', function (e) {
    e.preventDefault();
    var text = finalizeIssueTitle((e.clipboardData || window.clipboardData).getData('text/plain'));
    if (!text) return;
    var start = el.selectionStart || 0;
    var end = el.selectionEnd || 0;
    var val = el.value;
    el.value = val.slice(0, start) + text + val.slice(end);
    var caret = start + text.length;
    el.selectionStart = el.selectionEnd = caret;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  el.addEventListener('blur', function () {
    var clean = finalizeIssueTitle(el.value);
    if (el.value !== clean) el.value = clean;
    resizeDrawerTitleField();
    if (clean) autoSave('title', clean);
  });
}

async function openDrawer(issueId) {
  // Navigating from one open ticket straight to another (parent breadcrumb,
  // a linked issue, etc.) previously left the PREVIOUS ticket's rendered
  // content on screen, fully visible and interactive, for the whole fetch --
  // only the drawer's very first open (while it's still `hidden`) had no
  // stale content to show. Cover it the moment a switch is detected, drop
  // the cover once the new issue has actually finished rendering (every
  // early-return path below clears it too, so a failed or superseded fetch
  // never leaves the spinner stuck).
  var drawerEl = $('issueDrawer');
  var loadingOverlay = $('drawerLoadingOverlay');
  var switchingTickets = drawerEl && !drawerEl.hasAttribute('hidden') && S.drawerIssueId !== issueId;
  if (switchingTickets && loadingOverlay) loadingOverlay.removeAttribute('hidden');

  // Save current location for back button - detect allwork from URL/view
  var currentTab = S.currentTab;
  if (!currentTab) {
    // Try to detect from active nav item
    var activeNav = document.querySelector('.nav-item.active[data-tab]');
    if (activeNav) currentTab = activeNav.dataset.tab;
  }
  if (!currentTab && document.getElementById('view-allwork') && !document.getElementById('view-allwork').hidden) {
    currentTab = 'allwork';
  }
  window._issueReturnTab = currentTab || 'allwork';
  window._issueReturnSpace = S.currentSpace;
  S.drawerIssueId = issueId;
  // Reset comment file attachments for the new issue
  _commentFiles = [];
  _renderCommentFileList();
  var issue;
  try {
    issue = await api('/api/issues/' + issueId, 'GET', null, { silent: true });
  } catch (e) {
    // Only drop the cover if THIS request is still the current one -- a
    // slower-to-fail request from an earlier click must never clobber a
    // newer request's still-loading overlay.
    if (S.drawerIssueId === issueId && loadingOverlay) loadingOverlay.setAttribute('hidden', '');
    toast('Could not load ' + issueLabelFor(issueId) + ' — ' + errorReason(e), 'error');
    return;
  }

  if (!issue) {
    if (S.drawerIssueId === issueId && loadingOverlay) loadingOverlay.setAttribute('hidden', '');
    toast('Could not load ' + issueLabelFor(issueId) + ' — it no longer exists', 'error'); return;
  }
  // The fetch above is async — if the user hit Back (popstate → _closeIssueDrawer
  // clears drawerIssueId) or opened a different issue while it was in flight,
  // this response is stale. Rendering it anyway re-opens a drawer the user just
  // closed and stomps the URL popstate just restored, which is why Back
  // sometimes looked like it needed two clicks: the first click's popstate ran
  // correctly, then this exact code below undid it a moment later.
  // (The loading overlay is deliberately left alone here -- whichever request
  // IS current owns hiding it, at its own success or failure point below.)
  if (S.drawerIssueId !== issueId) return;
  // Fallback for openIssuePage's same mount call — only needed when the issue
  // wasn't already in the local cache at click time, so its space_id wasn't
  // known synchronously yet.
  if (issue.space_id && !document.querySelector('.space-item[data-space-id="' + issue.space_id + '"] + .space-subnav')) {
    mountSpaceSubnav(issue.space_id, S.currentTab);
  }
  trackRecentIssueView(issue);
  updateDrawerStarBtn(issue.id);
  var starBtn = $('drawerStarBtn');
  if (starBtn && !starBtn._starBound) {
    starBtn._starBound = true;
    starBtn.onclick = function (e) {
      e.stopPropagation();
      toggleIssueFavorite(S.drawerIssueId);
    };
  }
  if (issue.key) {
    // Preserve an existing &from=<tab> query param rather than rebuilding the
    // URL bare -- this used to silently drop it, so a hard refresh landed back
    // on the boot path's hardcoded 'backlog' assumption every time regardless
    // of what openIssuePage had just encoded.
    var existingFrom = new URLSearchParams(window.location.search).get('from');
    var replaceUrl = '/?issue=' + encodeURIComponent(issue.key) + (existingFrom ? '&from=' + existingFrom : '');
    history.replaceState({ issueId: issueId }, '', replaceUrl);
    window._currentIssueKey = issue.key;
  }
  document.body.classList.add('issue-page'); void document.body.offsetHeight; var dp = document.querySelector('.drawer-panel'); if(dp){ dp.style.position='fixed'; dp.style.inset='0'; dp.style.width='100vw'; dp.style.maxWidth='100vw'; dp.style.height='100vh'; dp.style.zIndex='99999'; dp.style.display='flex'; dp.style.flexDirection='column'; } $('issueDrawer').removeAttribute('hidden');

  // Parent breadcrumb for subtasks
  var parentCrumb = $('drawerParentBreadcrumb');
  if (issue.parent_id && issue.parent_key) {
    parentCrumb.innerHTML = '<span class="drawer-crumb-icon">' + typeIcon(issue.parent_type || 'task') + '</span>' +
      '<a class="drawer-crumb-link" onclick="openIssuePage(\'' + issue.parent_id + '\')">' + esc(issue.parent_key) + '</a>' +
      ' <span class="drawer-crumb-sep">/</span> ' +
      '<span class="drawer-crumb-icon">' + typeIcon(issue.type) + '</span>' +
      '<span>' + esc(issue.key) + '</span>';
    parentCrumb.style.display = '';
    if ($('drawerKey')) $('drawerKey').style.display = 'none';
  } else {
    parentCrumb.style.display = 'none';
    parentCrumb.innerHTML = '';
    if ($('drawerKey')) $('drawerKey').style.display = '';
  }

  $('drawerKey').textContent = issue.key || (issue.project_key ? issue.project_key + '-?' : '#' + issue.id);
  $('drawerType').textContent = typeLabel(issue.type);
  applyTypeBadgeStyle($('drawerType'), issue.type || 'task');
  setDrawerTitleValue(issue.title || '');
  // Render description - convert plain text to HTML safely
  var descText = issue.description || '';
  var fixDescText = issue.fix_description || '';
  // If content has no HTML tags, convert newlines to <br>
  function renderDesc(text) {
    if (!text) return '';
    var linkStyle = 'color:#0129AC;text-decoration:underline;cursor:pointer';
    if (/<[a-z][\s\S]*>/i.test(text)) {
      // Sanitise the STORED body first, then let the link fixing and linkify
      // below add the app's own trusted markup on top. Sanitising the finished
      // string instead would strip the inline `style` this function itself puts
      // on every anchor it generates, so links would lose their styling.
      var clean = sanitiseStoredHtml(text);
      // Fix broken <a href=""> by using the link text as the href
      var fixed = clean.replace(/<a\s[^>]*href=["']["'][^>]*>(https?:\/\/[^<]+)<\/a>/gi, function(m, url) {
        return '<a href="' + url.trim() + '" style="' + linkStyle + '" target="_blank">' + url.trim() + '</a>';
      });
      // Linkify bare URLs not already inside an <a> tag
      fixed = fixed.replace(/(<a\s[^>]*>[\s\S]*?<\/a>)|(https?:\/\/[^\s<"]+)/g, function(m, anchor, url) {
        if (anchor) return anchor;
        return '<a href="' + url + '" style="' + linkStyle + '" target="_blank">' + url + '</a>';
      });
      return augmentFileUrlsInHtml(fixed
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/(<br\s*\/?>){3,}/gi, '<br>')
        .replace(/&nbsp;/gi, ' ')
        .trim());
    }
    var p = text.replace(/\n{3,}/g,'\n\n').replace(/\n/g,'<br>');
    var d = p.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    // That decode turns stored `&lt;img onerror=...&gt;` back into live markup,
    // so a payload that was safely escaped at rest got re-armed on render — and
    // it reached this branch precisely BECAUSE it contained no literal '<'.
    // Sanitise after the decode and before the linkify, for the same reason as
    // the branch above: the anchors added below carry app-generated styling.
    d = sanitiseStoredHtml(d);
    return d.replace(/(https?:\/\/[^\s<"]+)/g,'<a href="$1" style="' + linkStyle + '" target="_blank">$1</a>');
  }
  $('drawerDesc').innerHTML = renderDesc(descText);
  $('drawerFixDesc').innerHTML = renderDesc(fixDescText);
  // Before bindDrawerEdits() captures its dirty-state baseline, so converting old
  // tray markup does not make an untouched description look edited.
  normalizeDescInlineImages($('drawerDesc'));
  normalizeDescInlineImages($('drawerFixDesc'));
  var descBtns = $('drawerDescBtns'); if (descBtns) descBtns.style.display = 'none';
  var fixBtns = $('drawerFixDescBtns'); if (fixBtns) fixBtns.style.display = 'none';

  $('drawerStatus').value = issue.status || 'To Do';
  // Rebuilt from this issue's own space's Priority custom field — same reason
  // as Team/Product Type below: index.html's old fixed 5-option list never
  // reflected an admin's actual configured priority values for the space.
  $('drawerPriority').innerHTML = buildBuiltinSelectOptionsHtml('priority', issue.space_id, issue.priority, null);
  $('drawerPriority').value = issue.priority || 'medium';

  var spaceId = issue.space_id || S.currentSpace;
  // Always fetch fresh members from DB so newly-added members show immediately
  // Build member list: fetch fresh from DB, fall back to cached
  var freshMembers = [];
  try {
    var fetchedMembers = await api('/api/spaces/' + spaceId + '/members');
    if (fetchedMembers && fetchedMembers.length) {
      freshMembers = fetchedMembers.map(function(m) {
        return { id: m.user_id, name: m.name, email: m.email, color: m.color, avatar_url: m.avatar_url };
      });
    }
  } catch(_) {}
  if (!freshMembers.length) freshMembers = getSpaceMembers(spaceId);
  if (!freshMembers.length) freshMembers = S.data.users || [];

  // Always include current assignee + reporter + current user so they always appear
  var allUsers = S.data.users || [];
  [issue.assignee_id, issue.reporter_id, S.currentUser].forEach(function(uid) {
    if (!uid) return;
    var already = freshMembers.some(function(m) { return m.id == uid; });
    if (!already) {
      var u = allUsers.find(function(u) { return u.id == uid; });
      if (u) freshMembers.push(u);
    }
  });

  // Store for live sync repopulation
  window._drawerMembers = freshMembers;

  populateUserSelect($('drawerAssignee'), freshMembers, issue.assignee_id);
  // If no reporter set, default to current user and save to DB
  var reporterId = issue.reporter_id || S.currentUser;
  populateUserSelect($('drawerReporter'), freshMembers, reporterId);
  if (!issue.reporter_id && S.currentUser) {
    api('/api/issues/' + issue.id, 'PUT', { reporter_id: S.currentUser }).catch(function(){});
  }

  // Completed sprints aren't offered — you shouldn't be able to move a ticket
  // into a sprint that's already closed. The ticket's CURRENT sprint is kept
  // even if completed, otherwise the select would fall back to "None" and the
  // next save would silently rip the ticket out of its sprint.
  // Deliberately not getIssueFormSprints() here: that also restricts to sprints
  // the user is rostered on, which would leave most members with no options at
  // all in the drawer.
  var sprints = (S.data.sprints || []).filter(function (sp) {
    if (sp.space_id != spaceId) return false;
    if (sp.id === issue.sprint_id) return true;
    return sp.status !== 'completed';
  });
  populateSprintSelect($('drawerSprint'), sprints, issue.sprint_id);

  $('drawerPoints').value = issue.story_points != null ? issue.story_points : '';
  $('drawerStartDate').value = fmtDateISO(issue.start_date);
  $('drawerDueDate').value = fmtDateISO(issue.due_date);
  // Rebuilt from this issue's own space's custom_fields.options every render
  // -- see buildBuiltinSelectOptionsHtml -- rather than the fixed HTML option
  // list index.html used to carry, which never reflected an admin's actual
  // Team/Product Type configuration for the space.
  if ($('drawerTeam')) {
    $('drawerTeam').innerHTML = buildBuiltinSelectOptionsHtml('team', issue.space_id, issue.team, '— None —');
    $('drawerTeam').value = issue.team || '';
  }
  if ($('drawerProductType')) {
    $('drawerProductType').innerHTML = buildBuiltinSelectOptionsHtml('product_type', issue.space_id, issue.product_type, '— None —');
    $('drawerProductType').value = issue.product_type || '';
  }
  // Estimate field removed

  var totalSpent = 0;
  var worklogs = issue.worklogs || [];
  for (var w = 0; w < worklogs.length; w++) totalSpent += (worklogs[w].time_spent || 0);
  $('drawerTimeSpent').textContent = fmtMins(totalSpent);

  // Set current user avatar in comment box
  var curUser = findUser(S.currentUser);
  if (curUser) {
    $('drawerCommentAvatar').innerHTML = '';
    $('drawerCommentAvatar').style.background = curUser.color || '#6b7280';
    $('drawerCommentAvatar').textContent = initials(curUser.name);
    $('drawerCommentAvatar').style.color = '#fff';
    $('drawerCommentAvatar').style.display = 'flex';
    $('drawerCommentAvatar').style.alignItems = 'center';
    $('drawerCommentAvatar').style.justifyContent = 'center';
    $('drawerCommentAvatar').style.fontSize = '11px';
    $('drawerCommentAvatar').style.fontWeight = '700';
  }

  // Render linked issues
  renderDrawerLinks(issue);

  renderDrawerSubtasks(issue.subtasks || []);
  // Reset to "Comments" tab on open, sync data-active-tab attribute
  document.querySelectorAll('[data-activity-tab]').forEach(function(t){
    t.classList.toggle('active', t.dataset.activityTab === 'comments');
  });
  var actBody = $('activitySectionBody');
  if (actBody) actBody.dataset.activeTab = 'comments';
  renderDrawerActivity(issue);
  await ensureSpaceFieldsLoaded(issue.space_id || S.currentSpace);
  await renderDrawerCustomFields(issue.custom_field_values || [], issue.id, issue.space_id || S.currentSpace);
  await renderDrawerCombinationField(issue.id, issue.space_id || S.currentSpace, issue.custom_field_values || [], issue.product_type || '');
  applyBuiltinFieldVisibility(issue.space_id || S.currentSpace, $('issueDrawer'), 'drawer');
  renderDrawerAttachments(issue.attachments || []);

  $('drawerCreated').textContent = fmtDateTime(issue.created_at);
  $('drawerUpdated').textContent = fmtDateTime(issue.updated_at);

  bindDrawerEdits(issue);
  startDrawerLiveSync(issueId);
  // Reached only when this request is still the current one (the stale-response
  // check above already returned otherwise) -- the new issue is fully rendered,
  // safe to drop the cover now.
  if (loadingOverlay) loadingOverlay.setAttribute('hidden', '');
}

// Live sync: poll DB every 15s and update drawer if data changed
function startDrawerLiveSync(issueId) {
  stopDrawerLiveSync();
  _drawerSyncTimer = setInterval(async function () {
    // Don't overwrite while user has pending edits
    if (window._drawerPending && Object.keys(window._drawerPending).length) return;
    if (S.drawerIssueId !== issueId) return stopDrawerLiveSync();
    try {
      var fresh = await api('/api/issues/' + issueId);
      // Fetch custom field values separately if not included
      if (fresh && !fresh.custom_field_values) {
        var cfVals = await api('/api/issues/' + issueId + '/field-values');
        fresh.custom_field_values = cfVals || [];
      }
      if (!fresh) return;
      // Update right-side fields silently (only if not focused by user)
      var activeId = document.activeElement && document.activeElement.id;
      if (activeId !== 'drawerStatus')    $('drawerStatus').value    = fresh.status    || '';
      if (activeId !== 'drawerPriority') {
        $('drawerPriority').innerHTML = buildBuiltinSelectOptionsHtml('priority', fresh.space_id, fresh.priority, null);
        $('drawerPriority').value = fresh.priority || '';
      }
      if (activeId !== 'drawerAssignee') {
        // Ensure the new assignee is in the dropdown options before setting value
        var members = window._drawerMembers || [];
        if (fresh.assignee_id && !members.some(function(m){return m.id==fresh.assignee_id;})) {
          var u = (S.data.users||[]).find(function(u){return u.id==fresh.assignee_id;});
          if (u) { members.push(u); window._drawerMembers = members; populateUserSelect($('drawerAssignee'), members, fresh.assignee_id); }
        }
        $('drawerAssignee').value = fresh.assignee_id || '';
      }
      if (activeId !== 'drawerReporter') {
        var members2 = window._drawerMembers || [];
        if (fresh.reporter_id && !members2.some(function(m){return m.id==fresh.reporter_id;})) {
          var u2 = (S.data.users||[]).find(function(u){return u.id==fresh.reporter_id;});
          if (u2) { members2.push(u2); window._drawerMembers = members2; populateUserSelect($('drawerReporter'), members2, fresh.reporter_id); }
        }
        $('drawerReporter').value = fresh.reporter_id || '';
      }
      if (activeId !== 'drawerSprint')      $('drawerSprint').value      = fresh.sprint_id   || '';
      if (activeId !== 'drawerPoints')      $('drawerPoints').value      = fresh.story_points != null ? fresh.story_points : '';
      if (activeId !== 'drawerStartDate')   $('drawerStartDate').value   = fresh.start_date  ? fresh.start_date.slice(0,10) : '';
      if (activeId !== 'drawerDueDate')     $('drawerDueDate').value     = fresh.due_date    ? fresh.due_date.slice(0,10)   : '';
      if (activeId !== 'drawerTeam'        && $('drawerTeam')) {
        $('drawerTeam').innerHTML = buildBuiltinSelectOptionsHtml('team', fresh.space_id, fresh.team, '— None —');
        $('drawerTeam').value = fresh.team || '';
      }
      if (activeId !== 'drawerProductType' && $('drawerProductType')) {
        $('drawerProductType').innerHTML = buildBuiltinSelectOptionsHtml('product_type', fresh.space_id, fresh.product_type, '— None —');
        $('drawerProductType').value = fresh.product_type || '';
      }
      if (activeId !== 'drawerTitle') setDrawerTitleValue(fresh.title || '');
      // Update time tracking, attachments, activity
      // Sum from fresh.worklogs, matching the initial drawer-open computation
      // above (not fresh.time_spent, the cached column) — self-heals if that
      // column and the worklog rows ever drift apart.
      var timeSpentEl = $('drawerTimeSpent');
      if (timeSpentEl) {
        var freshWorklogs = fresh.worklogs || [];
        var freshTotalSpent = 0;
        for (var fw = 0; fw < freshWorklogs.length; fw++) freshTotalSpent += (freshWorklogs[fw].time_spent || 0);
        timeSpentEl.textContent = fmtMins(freshTotalSpent);
      }
      renderDrawerAttachments(fresh.attachments || []);
      $('drawerUpdated').textContent = fmtDateTime(fresh.updated_at);
      // Refresh custom fields silently (only if no input is focused inside them)
      var cfSection = $('drawerCustomFields');
      var cfFocused = cfSection && cfSection.contains(document.activeElement);
      var comboFocused = $('drawerCombinationField') && $('drawerCombinationField').contains(document.activeElement);
      if (!cfFocused && !comboFocused) {
        await renderDrawerCustomFields(fresh.custom_field_values || [], issueId, fresh.space_id || S.currentSpace);
        await renderDrawerCombinationField(issueId, fresh.space_id || S.currentSpace, fresh.custom_field_values || [], fresh.product_type || '');
      }
      // Refresh worklog tab if it is currently active
      var actBody = $('activitySectionBody');
      if (actBody && actBody.dataset.activeTab === 'worklog') _renderActivityTab('worklog', fresh);
      _drawerIssueData = fresh;
    } catch(_) {}
  }, 15000);
}
window.openDrawer = openDrawer;

// The autoSave closure belonging to the drawer that is open RIGHT NOW.
// Handlers bound once to persistent drawer markup (the title textarea) must call
// through this rather than capturing an autoSave, or they keep saving to the
// first ticket ever opened. See bindDrawerTitleField.
var _activeDrawerAutoSave = null;

// ── @mention autocomplete ──────────────────────────────────
// Parameterized on `el` (rather than closing over one hardcoded element) so it
// can bind to both the comment-compose box (drawerCommentInput) AND each
// dynamically-created comment EDIT box (edit-rich-<id>) -- previously this was
// wired to drawerCommentInput only, so typing "@" while editing an existing
// comment silently did nothing; there was no autocomplete listening on that
// element at all. Guarded per-element the same way the original was guarded
// per-drawer-open, since an edit box's DOM node persists (just hidden) across
// repeated Edit/Cancel clicks on the same comment without a full re-render.
function bindMentionAutocomplete(el) {
  if (!el || el._mentionBound) return;
  el._mentionBound = true;
  var dropdown = $('mentionDropdown');
  var activeMentionCharIdx = -1;

  function getMembers() {
    return window._drawerMembers || S.data.users || [];
  }

  function closeMention() {
    dropdown.style.display = 'none';
    activeMentionCharIdx = -1;
  }

  // #mentionDropdown is one shared element, sitting in the markup right after
  // drawerCommentInput. That was harmless when only drawerCommentInput ever
  // opened it, but a comment EDIT box lives elsewhere in the activity list --
  // anchoring the dropdown with a plain `top` offset (relative to whatever
  // ancestor happens to be positioned) would show it pinned near the compose
  // box instead of under whichever editor is actually active. Same fix as
  // positionComboDropdown/positionCFDropdown elsewhere in this file: switch to
  // position:fixed and place it from el's own live viewport coordinates.
  function positionMentionDropdown() {
    dropdown._activeEl = el;
    var elRect = el.getBoundingClientRect();
    // Anchor on the CARET, not el's own bottom edge. el.getBoundingClientRect()
    // covers the whole editor box -- fine for a short single-line compose box,
    // where "bottom of the box" and "bottom of the visible content" are the
    // same thing. An edit box with an embedded image (or just a few lines of
    // text) is much taller, so its bottom edge can sit far below the caret --
    // even off the bottom of the viewport entirely -- which is exactly why
    // typing "@" while editing an existing comment looked like nothing
    // happened: the dropdown WAS opening, just positioned off-screen.
    var rect = elRect;
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var caretRects = sel.getRangeAt(0).cloneRange().getClientRects();
      if (caretRects && caretRects.length) rect = caretRects[caretRects.length - 1];
    }
    dropdown.style.position = 'fixed';
    dropdown.style.left = elRect.left + 'px';
    dropdown.style.width = elRect.width + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.right = 'auto';
  }

  // Keeps the dropdown glued to el while its scroll container moves (the
  // activity list, a modal body, etc.) -- position:fixed coordinates are only
  // ever right at the instant they're set otherwise. dropdown._activeEl guards
  // this so only the element that's actually open right now repositions it;
  // this listener is added once per el thanks to the _mentionBound guard above.
  document.addEventListener('scroll', function () {
    if (dropdown._activeEl === el && dropdown.style.display !== 'none') positionMentionDropdown();
  }, { passive: true, capture: true });

  // Returns all text before the caret inside a contenteditable element
  function getTextBeforeCaret(node) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return '';
    var r = sel.getRangeAt(0).cloneRange();
    r.selectNodeContents(node);
    r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return r.toString();
  }

  function insertMentionAtCaret(name, userId) {
    // e.preventDefault() on mousedown keeps focus so caret is still valid
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    var caretRange = sel.getRangeAt(0);
    var endNode = caretRange.endContainer;
    var endOffset = caretRange.endOffset;

    // Find the @ in the current text node (most common case)
    var atPos = -1;
    var atNode = null;
    if (endNode.nodeType === 3) {
      var textUpToCaret = endNode.textContent.substring(0, endOffset);
      var idx = textUpToCaret.lastIndexOf('@');
      if (idx !== -1) {
        atPos = idx;
        atNode = endNode;
      }
    }

    // If @ wasn't found in the same text node, walk backwards
    if (atNode === null) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      // build full text before caret
      var fullText = getTextBeforeCaret(el);
      var atIdx2 = activeMentionCharIdx;
      if (atIdx2 < 0) {
        var active = findActiveMentionAt(fullText);
        if (!active) return;
        atIdx2 = active.atIdx;
      }
      // count chars to find the node containing @
      var charCount = 0;
      for (var ni = 0; ni < nodes.length; ni++) {
        var nodeLen = nodes[ni] === endNode ? endOffset : nodes[ni].textContent.length;
        if (charCount + nodeLen > atIdx2) {
          atNode = nodes[ni];
          atPos = atIdx2 - charCount;
          break;
        }
        charCount += nodeLen;
      }
    }

    if (!atNode) return;

    // Select from @ to current caret position and delete it
    var delRange = document.createRange();
    delRange.setStart(atNode, atPos);
    if (atNode === endNode) {
      delRange.setEnd(endNode, endOffset);
    } else {
      delRange.setEnd(endNode, endOffset);
    }
    sel.removeAllRanges();
    sel.addRange(delRange);
    document.execCommand('delete', false, null);

    // Insert mention chip + non-breaking space
    var chip = '<span class="mention-chip" data-user-id="' + (userId || '') + '" contenteditable="false">@' + esc(name) + '</span> ';
    document.execCommand('insertHTML', false, chip);
  }

  function showMention(query) {
    var members = getMembers().filter(function(m) {
      return !query || m.name.toLowerCase().indexOf(query.toLowerCase()) !== -1;
    });
    if (!members.length) { closeMention(); return; }

    positionMentionDropdown();
    dropdown.style.display = 'block';
    dropdown.innerHTML = members.map(function(m) {
      return '<div class="mention-item" data-id="' + esc(m.id) + '" data-name="' + escAttr(m.name) + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;"' +
        'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'">' +
        '<div style="width:26px;height:26px;border-radius:50%;background:' + (m.color || '#6b7280') + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">' +
        initials(m.name) + '</div>' +
        '<div><div style="font-size:13px;font-weight:600">' + esc(m.name) + '</div>' +
        (m.email ? '<div style="font-size:11px;color:var(--text2)">' + esc(m.email) + '</div>' : '') +
        '</div></div>';
    }).join('');

    dropdown.querySelectorAll('.mention-item').forEach(function(item) {
      item.addEventListener('mousedown', function(e) {
        e.preventDefault(); // keeps focus in el so selection is intact
        var name = item.dataset.name;
        var id = item.dataset.id;
        if (el.contentEditable === 'true') {
          insertMentionAtCaret(name, id);
        } else {
          var val = el.value;
          var before = val.substring(0, activeMentionCharIdx);
          var after = val.substring(el.selectionStart);
          el.value = before + '@' + name + ' ' + after;
          var pos = activeMentionCharIdx + name.length + 2;
          el.setSelectionRange(pos, pos);
          el.focus();
        }
        closeMention();
        activeMentionCharIdx = -1;
      });
    });
  }

  el.addEventListener('input', function() {
    var isContentEditable = el.contentEditable === 'true';
    var textBefore;
    if (isContentEditable) {
      textBefore = getTextBeforeCaret(el);
    } else {
      textBefore = el.value.substring(0, el.selectionStart);
    }
    var active = findActiveMentionAt(textBefore);
    if (!active) { closeMention(); return; }
    activeMentionCharIdx = active.atIdx;
    showMention(active.query);
  });

  el.addEventListener('keydown', function(e) {
    if (dropdown.style.display === 'none') return;
    var items = dropdown.querySelectorAll('.mention-item');
    var active = dropdown.querySelector('.mention-item.focused');
    var idx = Array.prototype.indexOf.call(items, active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('focused');
      var next = items[idx + 1] || items[0];
      next.classList.add('focused');
      next.style.background = 'var(--bg3)';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('focused');
      var prev = items[idx - 1] || items[items.length - 1];
      prev.classList.add('focused');
      prev.style.background = 'var(--bg3)';
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.click();
    } else if (e.key === 'Escape') {
      closeMention();
    }
  });

  // Guarded per-element for the same reason as the handlers above.
  if (!el._mentionOutsideBound) {
    el._mentionOutsideBound = true;
    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== el) closeMention();
    });
  }
}

// A comment EDIT box (edit-rich-<id>) had no image-paste handling at all --
// unlike the compose box's own _commentFiles flow, or the description
// editors' document-level delegated listener (which only covers the static
// DESC_EDITOR_IDS list, not a dynamically-created id like this one). Pasting
// a screenshot there fell through to the browser's raw default paste,
// inserting an unbounded base64 data: URI directly into the comment body
// instead of uploading it. Routes through the exact same handleDescImagePaste
// the description fields use -- it already uploads via /api/comments/upload,
// which comments and descriptions share.
function bindCommentEditImagePaste(el) {
  if (!el || el._commentEditPasteBound) return;
  el._commentEditPasteBound = true;
  el.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items || !items.length) return;
    var imageFiles = _dedupePasteFiles(items).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
    if (!imageFiles.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (el._pasteBusy) return;
    el._pasteBusy = true;
    handleDescImagePaste(el, imageFiles[0], 'comment').finally(function () {
      setTimeout(function () { el._pasteBusy = false; }, 500);
    });
  });
}

function bindDrawerEdits(issue) {
  var issueId = issue.id;
  // Captured once per drawer: the key is what the user recognises the issue
  // by, and it cannot change under an inline edit (key is not editable).
  var issueKey = issueKeyStr(issue);
  var pending = {};
  var _saveTimer = null;

  function autoSave(field, value) {
    pending[field] = value;
    window._drawerPending = pending;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async function () {
      if (!Object.keys(pending).length) return;
      var toSave = Object.assign({}, pending);
      try {
        // silent: api() toasts the raw thrown message itself, which for a 500
        // is the literal "Internal server error" and for a body-less response
        // is the HTTP statusText. This path renders its own message naming the
        // issue and the reason, so letting the wrapper toast too stacked two
        // error toasts for one failure -- the technical one on top.
        await api('/api/issues/' + issueId, 'PUT', toSave, { silent: true });
        Object.keys(toSave).forEach(function(k) { delete pending[k]; });
        window._drawerPending = pending;
        var updated = await api('/api/issues/' + issueId, 'GET', null, { silent: true });
        if (updated) {
          $('drawerUpdated').textContent = fmtDateTime(updated.updated_at);
          var patch = Object.assign({}, toSave);
          if (updated.updated_at) patch.updated_at = updated.updated_at;
          afterIssueFieldUpdate(issueId, patch);
        }
        refreshData();
        toast(issueChangeSummary(issueKey, toSave));
      } catch(e) {
        toast(issueKey + ' update failed — ' + errorReason(e), 'error');
      }
    }, 800);
  }
  // Point the once-bound handlers at THIS drawer's save.
  _activeDrawerAutoSave = autoSave;

  async function saveFieldNow(field, value) {
    try {
      var payload = {};
      payload[field] = value;
      // silent: see autoSave above -- this path renders its own error message.
      await api('/api/issues/' + issueId, 'PUT', payload, { silent: true });
      var updated = await api('/api/issues/' + issueId, 'GET', null, { silent: true });
      if (updated) {
        $('drawerUpdated').textContent = fmtDateTime(updated.updated_at);
        var patch = Object.assign({}, payload);
        if (updated.updated_at) patch.updated_at = updated.updated_at;
        afterIssueFieldUpdate(issueId, patch);
        if (window._drawerIssueData) window._drawerIssueData[field] = value;
      }
      refreshData();
      toast(issueChangeSummary(issueKey, payload));
    } catch (e) {
      toast(issueKey + ' ' + issueFieldLabel(field) + ' update failed — ' + errorReason(e), 'error');
      throw e;
    }
  }


  var _drawerStatusPrevious = issue.status || 'To Do';
  $('drawerStatus').onchange = function () {
    var newStatus = $('drawerStatus').value;
    if (newStatus === 'Done' && !canTransitionIssueToDone(issueId, _drawerStatusPrevious)) return;
    autoSave('status', newStatus);
    updateStatusBtn(newStatus);
    _drawerStatusPrevious = newStatus;
    if (window._drawerIssueData) window._drawerIssueData.status = newStatus;
  };
  updateStatusBtn($('drawerStatus').value);
  $('drawerPriority').onchange  = function () { autoSave('priority',     $('drawerPriority').value); };
  $('drawerAssignee').onchange  = function () { autoSave('assignee_id',  $('drawerAssignee').value || null); };
  $('drawerReporter').onchange  = function () { autoSave('reporter_id',  $('drawerReporter').value || null); };
  // ── Clickable type badge dropdown (Jira-like) ──
  var typeEl = $('drawerType');
  if (typeEl) {
    typeEl.style.cursor = 'pointer';
    typeEl.onclick = function(e) {
      e.stopPropagation();
      var old = document.getElementById('_typeMenu');
      if (old) { old.remove(); return; }
      // This issue's own space's configured Type list, not the fixed 5 --
      // an admin-added type was previously unreachable from this picker.
      var types = getIssueTypeOptionsForSpace(issue.space_id).map(function (o) { return o.v; });
      var rect = typeEl.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = '_typeMenu';
      menu.style.cssText = 'position:fixed;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px;background:#fff;border:1px solid #dfe1e6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:9999;min-width:160px;padding:4px;';
      types.forEach(function(t) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:13px;border-radius:4px;display:flex;align-items:center;gap:8px;';
        // Use the shared TYPE_ICONS set rather than a local emoji list, so this
        // menu can't drift from the icons shown on boards, tables and drawers.
        item.innerHTML = '<span style="display:inline-flex;align-items:center">'+ typeIcon(t) +'</span><span>'+esc(cap(t))+'</span>';
        item.onmouseover = function(){ this.style.background='#f4f5f7'; };
        item.onmouseout = function(){ this.style.background='';};
        item.onclick = function(){
          menu.remove();
          typeEl.textContent = cap(t);
          applyTypeBadgeStyle(typeEl, t);
          autoSave('type',t);
        };
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      setTimeout(function(){
        document.addEventListener('click',function h(ev){ if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',h);} });
      },100);
    };
  }
  $('drawerSprint').onchange = function () {
    var sprintId = $('drawerSprint').value;
    autoSave('sprint_id', sprintId || null);
    // Moving a ticket into a sprint adopts that sprint's dates — whether it came
    // from the backlog or from another sprint. This replaces the old behaviour of
    // only clearing a due date that overshot the sprint end, which left the start
    // date pointing at the previous sprint.
    // Clearing the sprint (→ backlog) leaves the dates alone: there are no sprint
    // dates to copy, and wiping them would lose information.
    var plan = sprintDateChanges(sprintId, $('drawerStartDate').value, $('drawerDueDate').value);
    if (!plan.sprint) return;
    plan.changes.forEach(function (ch) {
      $(ch.field === 'start_date' ? 'drawerStartDate' : 'drawerDueDate').value = ch.value;
      autoSave(ch.field, ch.value);
    });
    if (plan.changes.length) {
      toast('Dates set from ' + (plan.sprint.name || 'sprint') + ': ' +
        plan.changes.map(function (c) { return c.label; }).join(', '));
    } else if (!plan.start && !plan.end) {
      toast((plan.sprint.name || 'That sprint') + ' has no dates set, so the issue dates were left as they are.', 'warning');
    }
  };
  $('drawerPoints').oninput     = function () {
    autoSave('story_points', $('drawerPoints').value ? parseInt($('drawerPoints').value, 10) : null);
  };
  if ($('drawerTeam')) {
    $('drawerTeam').onchange = function () {
      autoSave('team', $('drawerTeam').value || null);
      if (window._drawerIssueData) {
        renderDrawerProductTypeSets(
          window._drawerIssueData.id,
          window._drawerIssueData.space_id || S.currentSpace,
          window._drawerIssueData.custom_field_values || [],
          window._drawerIssueData.product_type || ''
        );
      }
    };
  }
  if ($('drawerProductType')) {
    $('drawerProductType').onchange = function () {
      var dSpace = (_drawerIssueData && _drawerIssueData.space_id) || S.currentSpace;
      // Skip only when the combined picker owns this field for this space — it
      // saves product_type together with the combination. Was gated on
      // "is Product_Team", which meant a Product_Team space WITHOUT a combination
      // field could never save a product type, and any other space with one
      // would have saved it twice.
      if (productTypeMode(dSpace, 'drawer') === 'combo') return;
      autoSave('product_type', $('drawerProductType').value || null);
    };
  }
  $('drawerStartDate').onchange = function () {
    var val = $('drawerStartDate').value;
    autoSave('start_date', val || null);
  };
  $('drawerDueDate').onchange = function () {
    var val = $('drawerDueDate').value;
    if (val) {
      var sprintId = $('drawerSprint').value;
      if (sprintId) {
        var sprint = (S.data.sprints || []).find(function(sp){ return sp.id === sprintId; });
        if (sprint && sprint.end_date) {
          var sprintEnd = new Date(sprint.end_date.slice(0,10) + 'T00:00:00');
          var picked    = new Date(val + 'T00:00:00');
          if (picked > sprintEnd) {
            toast('Due date cannot exceed sprint end date (' + sprint.end_date.slice(0,10) + ')', 'error');
            $('drawerDueDate').value = '';
            return;
          }
        }
      }
    }
    autoSave('due_date', val || null);
  };

  bindDrawerTitleField();

  var _drawerDescOriginal = $('drawerDesc') ? $('drawerDesc').innerHTML : (issue.description || '');
  window._drawerDescOriginalHtml = _drawerDescOriginal;
  attachScopedUndo($('drawerDesc'));
  // Deliberately NOT re-snapshotting _drawerDescOriginal here — it's already
  // the correct pre-edit baseline (set once above, then again only after a
  // successful save). Re-capturing "current == current" on every focus meant
  // that clicking away mid-edit (e.g. to review) and clicking back in before
  // hitting Save silently rebaselined to the ALREADY-EDITED text, disabling
  // Save with no error and no visible cause — reported as "editing the
  // description doesn't save".
  $('drawerDesc').onfocus = function() {
    updateDrawerDescEditorState('drawerDesc', _drawerDescOriginal);
  };

  // Open links inside contenteditable description.
  // Bound ONCE per element, like the paste handler below: #drawerDesc is static
  // markup and bindDrawerEdits() runs on every drawer open, so an unguarded
  // addEventListener stacked another pair each time — after opening N issues, a
  // click on a description link fired window.open N times and spawned N tabs.
  (function () {
    var descEl = $('drawerDesc');
    if (!descEl || descEl._linkOpenBound) return;
    descEl._linkOpenBound = true;
    var openLink = function (e) {
      var a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); e.stopPropagation(); window.open(a.href, '_blank', 'noopener'); }
    };
    descEl.addEventListener('mousedown', openLink);
    descEl.addEventListener('click', openLink);
  })();
  var drawerDescSaveBtn = $('drawerDescSave');
  var drawerDescCancelBtn = $('drawerDescCancel');
  if(drawerDescSaveBtn) drawerDescSaveBtn.onclick = async function(e) {
    e.preventDefault(); e.stopPropagation();
    var descEl = $('drawerDesc');
    if (!richTextHasMeaningfulChange(_drawerDescOriginal, descEl.innerHTML)) return;
    drawerDescSaveBtn.disabled = true;
    drawerDescSaveBtn.textContent = 'Saving...';
    try {
      var imgs = descEl.querySelectorAll('img[src^="data:"],img[src^="blob:"]');
      for (var i = 0; i < imgs.length; i++) {
        try {
          var resp = await fetch(imgs[i].src);
          var blob = await resp.blob();
          var fd = new FormData();
          fd.append('files', blob, 'desc-img-' + Date.now() + '.png');
          var up = await fetch('/api/upload-temp', { method:'POST', headers:{'Authorization':'Bearer '+getAuthToken()}, body:fd });
          var upJson = await up.json();
          if (upJson && upJson.files && upJson.files[0]) imgs[i].src = upJson.files[0].url;
        } catch(ex) { console.error('img upload failed', ex); }
      }
      // descEl.innerHTML still carries the LIVE session token baked into every
      // desc-inline-img src (fileApiUrl() puts it there so the image is visible
      // while editing) — stripping it here mirrors getDescriptionHtmlForSave(),
      // which the Create Issue path already uses. Without this, the stored
      // description keeps today's token forever; augmentFileUrlsInHtml() then
      // appends a SECOND ?t=... on every later render (its regex stops at the
      // first "?", so it can't tell the URL already has one), producing a
      // malformed src that always 401s — the exact "screenshot goes broken
      // after saving" bug, and re-pasting the same image then reports it as
      // already attached because the broken <img> is still sitting in the DOM.
      await saveFieldNow('description', stripFileAuthTokensFromHtml(descEl.innerHTML.trim()));
      _drawerDescOriginal = descEl.innerHTML;
      window._drawerDescOriginalHtml = _drawerDescOriginal;
      var b = $('drawerDescBtns'); if(b) b.style.display='none';
    } finally {
      drawerDescSaveBtn.disabled = false;
      drawerDescSaveBtn.textContent = 'Save';
      drawerDescSaveBtn.style.opacity = '1';
      drawerDescSaveBtn.style.cursor = 'pointer';
    }
  };
  if(drawerDescCancelBtn) drawerDescCancelBtn.onclick = function() {
    $('drawerDesc').innerHTML = _drawerDescOriginal;
    window._drawerDescOriginalHtml = _drawerDescOriginal;
    var b = $('drawerDescBtns'); if(b) b.style.display='none';
  };
  $('drawerDesc').oninput = function () {
    updateDrawerDescEditorState('drawerDesc', _drawerDescOriginal);
  };
  var _drawerFixDescOriginal = $('drawerFixDesc') ? $('drawerFixDesc').innerHTML : (issue.fix_description || '');
  window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
  attachScopedUndo($('drawerFixDesc'));
  // Same fix as drawerDesc above — don't rebaseline the "original" snapshot
  // on every focus, only on drawer-open and after a successful save.
  $('drawerFixDesc').onfocus = function() {
    updateDrawerDescEditorState('drawerFixDesc', _drawerFixDescOriginal);
  };
  var fixSaveBtn = $('drawerFixDescSave');
  var fixCancelBtn = $('drawerFixDescCancel');
  if(fixSaveBtn) fixSaveBtn.onclick = async function(e) {
    e.preventDefault(); e.stopPropagation();
    var fixEl = $('drawerFixDesc');
    if (!richTextHasMeaningfulChange(_drawerFixDescOriginal, fixEl.innerHTML)) return;
    fixSaveBtn.disabled = true;
    fixSaveBtn.textContent = 'Saving...';
    try {
      // Same token-stripping fix as the description save above.
      await saveFieldNow('fix_description', stripFileAuthTokensFromHtml(fixEl.innerHTML.trim()));
      _drawerFixDescOriginal = fixEl.innerHTML;
      window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
      var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
    } finally {
      fixSaveBtn.disabled = false;
      fixSaveBtn.textContent = 'Save';
      fixSaveBtn.style.opacity = '1';
      fixSaveBtn.style.cursor = 'pointer';
    }
  };
  if(fixCancelBtn) fixCancelBtn.onclick = function() {
    $('drawerFixDesc').innerHTML = _drawerFixDescOriginal;
    window._drawerFixDescOriginalHtml = _drawerFixDescOriginal;
    var b = $('drawerFixDescBtns'); if(b) b.style.display='none';
  };
  $('drawerFixDesc').oninput = function () {
    updateDrawerDescEditorState('drawerFixDesc', _drawerFixDescOriginal);
  };

  // Expose pending to the global save handler (fallback)
  window._drawerPending = pending;

  bindMentionAutocomplete($('drawerCommentInput'));
  attachScopedUndo($('drawerCommentInput'));

  // Paste image support for comment box — bind ONCE per drawer element, not per click.
  // (Previously this was registered inside the onclick handler below, so every
  // "Comment" click added another listener; a later paste would then fire all of
  // them and push the same image into _commentFiles multiple times, producing
  // duplicate uploaded images and eventually failing once the server's file-count
  // limit was exceeded.)
  (function () {
    var _commentPasteEl = $('drawerCommentInput');
    if (!_commentPasteEl || _commentPasteEl._pasteBound) return;
    _commentPasteEl._pasteBound = true;
    _commentPasteEl.addEventListener('paste', function(e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var file = items[i].getAsFile();
          if (!file) continue;
          _commentFiles.push(file);
          _renderCommentFileList();
          toast('Image pasted — click Comment to post');
          break;
        }
      }
    });
  })();

  $('drawerCommentSubmit').onclick = async function () {
    var _ci = $('drawerCommentInput');
    var body;
    // Whether this comment's body is rich HTML (real <b>/<ul> from the
    // toolbar) or plain text -- decides which shape file-attachment refs get
    // appended in below, since bodyHtml()'s render function only expands
    // [img:...]/[file:...] bracket markup in its PLAIN-TEXT branch; appending
    // that bracket syntax onto an HTML body would show as literal text.
    var bodyIsRich = !!(_ci && _ci.value === undefined);
    if (!_ci) { body = ''; }
    else if (!bodyIsRich) {
      body = _ci.value.trim();
    } else {
      // contenteditable: convert mention chips to plain @Name text, keep the
      // rest of the markup as-is -- this used to flatten to .textContent,
      // which is what silently discarded every bold/bullet-list the toolbar
      // had just produced.
      var _clone = _ci.cloneNode(true);
      _clone.querySelectorAll('.mention-chip').forEach(function(chip) {
        chip.replaceWith('@' + chip.textContent.replace(/^@/, ''));
      });
      body = _clone.innerHTML.trim();
      if (body === '<br>') body = '';
    }
    var commentBody = body;
    if (!body && !_commentFiles.length) return;
    // Disable button to prevent duplicate submissions
    var submitBtn = $('drawerCommentSubmit');
    if (submitBtn._submitting) return;
    submitBtn._submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';
    var commentBody = body;

    // Upload attached files to comment-specific endpoint. On failure the files
    // are kept in _commentFiles (not cleared) so the user can just hit Comment
    // again instead of re-picking or re-pasting them — and the button is reset
    // and the whole submit is aborted here, rather than falling through to post
    // a comment silently missing the attachment the user thought was included
    // (or, for an image-only comment, posting nothing at all).
    if (_commentFiles.length) {
      var fd = new FormData();
      fd.append('issue_id', issueId);
      _commentFiles.forEach(function(f) { fd.append('files', f); });
      var uploadFailed = false;
      try {
        toast(_commentFiles.length === 1 ? 'Uploading ' + (_commentFiles[0].name || 'file') + '…' : 'Uploading ' + _commentFiles.length + ' files…');
        var uploadRes = await fetch('/api/comments/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getAuthToken() },
          body: fd
        });
        var uploadData = await uploadRes.json().catch(function () { return {}; });
        if (!uploadRes.ok) {
          toast('Attachment upload failed — ' + errorReason({ message: uploadData.error }, 'the server rejected the upload'), 'error');
          uploadFailed = true;
        } else if (uploadData.files && uploadData.files.length) {
          if (bodyIsRich) {
            // Real tags, not [img:...]/[file:...] bracket markup -- bodyHtml()'s
            // render function only expands that bracket syntax in its plain-text
            // branch, so appending it onto an HTML body would show as literal
            // text. fileApiUrl()'s token gets stripped before saving below (same
            // as the rest of this body), then re-added fresh on every render by
            // augmentFileUrlsInHtml -- same convention _saveComment already uses.
            var fileRefsHtml = uploadData.files.map(function(f) {
              var isImg = f.type && f.type.startsWith('image/');
              var url = fileApiUrl(f.url);
              return isImg
                ? '<div style="margin-top:8px"><img class="desc-inline-img" src="' + esc(url) + '" alt="' + escAttr(f.name) + '"></div>'
                : '<div style="margin-top:6px"><a href="' + esc(url) + '" target="_blank">' + esc(f.name) + '</a></div>';
            }).join('');
            commentBody = commentBody + fileRefsHtml;
          } else {
            var fileRefs = uploadData.files.map(function(f) {
              var isImg = f.type && f.type.startsWith('image/');
              return (isImg ? '[img:' : '[file:') + f.name + '|' + f.url + ']';
            }).join('\n');
            commentBody = commentBody ? commentBody + '\n' + fileRefs : fileRefs;
          }
        }
      } catch(e) {
        toast('Attachment upload failed — ' + errorReason(e, 'the upload failed'), 'error');
        uploadFailed = true;
      }
      if (uploadFailed) {
        submitBtn._submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
        return;
      }
      _commentFiles = [];
      _renderCommentFileList();
    }
    // Strip the live session token the image ref above just embedded -- it's
    // only good for today; augmentFileUrlsInHtml adds a fresh one on every
    // future render instead. Same rule as description/fix-description saves.
    if (bodyIsRich) commentBody = stripFileAuthTokensFromHtml(commentBody);

    if (commentBody) {
      var mentionedUserIds = collectMentionUserIds(_ci, commentBody);
      // Optimistic UI - show comment instantly before API response
      var me = S.currentUserObj || {};
      var tempComment = {
        id: 'temp-' + Date.now(),
        user_id: S.currentUser,
        body: commentBody,
        created_at: new Date().toISOString(),
        user_name: me.name || '',
        user_color: me.color || '#666',
        user_avatar_url: me.avatar_url || null
      };
      if (_drawerIssueData) {
        _drawerIssueData.comments = (_drawerIssueData.comments || []).concat([tempComment]);
        renderDrawerActivity(_drawerIssueData);
      }
      var _ci2 = $('drawerCommentInput'); if (_ci2) { if (_ci2.value !== undefined) _ci2.value = ''; else _ci2.innerHTML = ''; }
      // Post the real comment — button stays disabled until this actually finishes,
      // so a fast repeat click can't slip through while the first request is in flight.
      await api('/api/comments', 'POST', {
        issue_id: issueId,
        user_id: S.currentUser,
        body: commentBody,
        mentioned_user_ids: mentionedUserIds
      });
    } else {
      var _ci3 = $('drawerCommentInput'); if (_ci3) { if (_ci3.value !== undefined) _ci3.value = ''; else _ci3.innerHTML = ''; }
    }
    submitBtn._submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Comment';
    // Refresh in background to get real comment ID
    api('/api/issues/' + issueId).then(function(updated) {
      if (updated) {
        _drawerIssueData = updated;
        renderDrawerActivity(updated);
      }
    });
    if (commentBody) toast('Comment added');
  };

  $('drawerLogTimeBtn').onclick = function () {
    $('worklogIssueId').value = issueId;
    $('worklogDate').value = fmtDateISO(new Date());
    $('worklogHours').value = 0;
    $('worklogMinutes').value = 0;
    $('worklogDesc').value = '';
    $('worklogBillable').checked = true;
    openModal('modal-worklog');
  };

  // Delete ticket — a direct control rather than a ⋯ menu. The button is only
  // rendered for someone the API would actually let through (canDeleteIssue ->
  // space admin or org admin), so nobody is offered an action that then fails.
  // This replaces a dropdown whose handler was gated on an `isOwner` variable
  // that was never declared: the ReferenceError killed the handler mid-run, so
  // the item bound no click AND the outside-click listener below it never
  // registered — the menu was inert and would not dismiss.
  var deleteBtn = $('drawerDeleteBtn');
  if (deleteBtn) {
    deleteBtn.style.display = canDeleteIssue(issue.space_id) ? '' : 'none';
    deleteBtn.onclick = async function (e) {
      e.stopPropagation();
      // Re-checked at click time, not just at render: the drawer stays open
      // across a refreshData(), so the role behind it can change underneath.
      if (!canDeleteIssue(issue.space_id)) {
        toast('Only a space admin can delete issues. Ask a space admin or an org admin.', 'error');
        return;
      }
      var key = issueKeyStr(issue) || issueId;
      var ok = await typedConfirmDialog({
        title: 'Delete ' + key + '?',
        intro: issue.title || '',
        note: softDeleteNote(),
        phrase: key,
        phraseHint: 'To confirm, type the issue key',
        confirmLabel: 'Delete issue'
      });
      if (!ok) return;
      try {
        await api('/api/issues/' + issueId, 'DELETE', null, { silent: true });
        toast(key + ' moved to Deleted Items', 'success');
        var drawer = document.getElementById('issueDrawer');
        if (drawer) drawer.setAttribute('hidden', '');
        S.drawerIssueId = null;
        window.history.replaceState({}, '', '/');
        await refreshData();
        renderCurrentView();
      } catch (err) {
        toast(key + ' delete failed — ' + errorReason(err), 'error');
      }
    };
  }
}

function renderDrawerSubtasks(subtasks) {
  var c = $('drawerSubtasks');
  var html = '';
  if (subtasks && subtasks.length) {
    // Progress bar
    var done = subtasks.filter(function(s){ return s.status === 'Done'; }).length;
    var pct = Math.round(done / subtasks.length * 100);
    html += '<div class="subtask-progress" style="margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:3px">' +
      '<span>' + done + ' of ' + subtasks.length + ' done</span><span>' + pct + '%</span></div>' +
      '<div style="height:4px;background:var(--bg4);border-radius:2px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--success);border-radius:2px;transition:width .3s"></div></div></div>';
    for (var i = 0; i < subtasks.length; i++) {
      var st = subtasks[i];
      var isDone = st.status === 'Done';
      html += '<div class="subtask-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;border-bottom:1px solid var(--border)" ' +
        'onmouseenter="this.style.background=\'var(--bg3)\'" onmouseleave="this.style.background=\'\'">' +
        '<span class="subtask-key" style="font-size:11px;font-weight:700;color:var(--accent);min-width:48px;cursor:pointer" onclick="event.stopPropagation();openIssuePage(\'' + st.id + '\')">' + esc(st.key || '') + '</span>' +
        '<span style="flex:1;font-size:13px;' + (isDone ? 'text-decoration:line-through;color:var(--text3)' : '') + '" onclick="openIssuePage(\'' + st.id + '\')">' + esc(st.title) + '</span>' +
        statusBadge(st.status, true) +
        '</div>';
    }
  } else {
    html += '<p class="text-muted text-sm" style="margin-bottom:4px">No subtasks yet</p>';
  }
  // Inline create form
  html += '<div id="subtaskCreateArea" style="margin-top:8px">' +
    '<button class="btn btn-outline btn-sm" id="subtaskAddBtn" onclick="window._showSubtaskInput()" style="gap:4px">\uD83D\uDCCC + Add subtask</button>' +
    '<div id="subtaskInputRow" style="display:none;gap:8px;align-items:center;margin-top:6px">' +
    '<input type="text" id="subtaskTitleInput" placeholder="What needs to be done?" class="input" style="flex:1;font-size:12px;padding:6px 8px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window._submitSubtask()}">' +
    '<button class="btn btn-primary btn-sm" onclick="window._submitSubtask()">Create</button>' +
    '<button class="btn btn-outline btn-sm" onclick="window._hideSubtaskInput()">Cancel</button>' +
    '</div></div>';
  c.innerHTML = html;
}

window._showSubtaskInput = function() {
  // Open full Create Issue modal pre-configured as subtask linked to parent
  var parentId = S.drawerIssueId;
  var parentIssue = parentId && S.data.issues && S.data.issues.find(function(i){ return i.id === parentId; });
  var spaceId = parentIssue ? parentIssue.space_id : S.currentSpace;

  resetIssueForm();
  $('issueSpaceId').value = spaceId;
  $('issueParentId').value = parentId || '';
  $('issueType').value = 'subtask';
  $('issuePriority').value = 'medium';
  $('issueModalTitle').textContent = 'Create Subtask' + (parentIssue ? ' — linked to ' + (parentIssue.key || parentIssue.id) : '');
  var parentSprintId = parentIssue && parentIssue.sprint_id;
  populateIssueFormSelects({ includeSprintId: parentSprintId });
  if (window._onIssueSpaceChange) window._onIssueSpaceChange(spaceId || '', parentSprintId);
  // Pre-fill sprint and assignee from parent
  if (parentIssue) {
    if (parentSprintId) {
      $('issueSprint').value = parentSprintId;
      applySprintDatesToIssueForm(parentSprintId);
    }
    if (parentIssue.assignee_id) $('issueAssignee').value = parentIssue.assignee_id;
  }
  openModal('modal-issue');
};

window._hideSubtaskInput = function() {
  $('subtaskAddBtn').style.display = '';
  $('subtaskInputRow').style.display = 'none';
  $('subtaskTitleInput').value = '';
};

window._submitSubtask = async function() {
  var title = $('subtaskTitleInput').value.trim();
  if (!title) return;
  var parentId = S.drawerIssueId;
  var parentIssue = S.data.issues.find(function(i){ return i.id === parentId; });
  var spaceId = parentIssue ? parentIssue.space_id : S.currentSpace;
  try {
    // silent: the catch renders 'Subtask creation failed — <reason>' itself
    var createdSub = await api('/api/issues', 'POST', {
      space_id: spaceId,
      parent_id: parentId,
      sprint_id: parentIssue ? parentIssue.sprint_id : null,
      title: title,
      type: 'subtask',
      priority: 'medium',
      reporter_id: S.currentUser,
      assignee_id: parentIssue ? parentIssue.assignee_id : null,
      start_date: fmtDateISO(new Date()),
      status: 'To Do'
    }, { silent: true });
    toast(issueKeyStr(createdSub) + ' created as a subtask');
    $('subtaskTitleInput').value = '';
    // Refresh drawer
    var issue = await api('/api/issues/' + parentId);
    renderDrawerSubtasks(issue.subtasks || []);
    await refreshData();
  } catch(e) { toast('Subtask creation failed — ' + errorReason(e), 'error'); }
};
