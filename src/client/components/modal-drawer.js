
// ═══════════════════════════════════════════════════════════
// MODAL / DRAWER HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  var el = $(id);
  if (el) el.removeAttribute('hidden');
}

function closeModal(id) {
  var el = $(id);
  if (el) el.setAttribute('hidden', '');
  if (id === 'modal-confirm' && _confirmResolve) {
    _confirmResolve(false);
    _confirmResolve = null;
  }
}
window.openModal = openModal;
window.closeModal = closeModal;

var _drawerSyncTimer = null;
function stopDrawerLiveSync() {
  if (_drawerSyncTimer) { clearInterval(_drawerSyncTimer); _drawerSyncTimer = null; }
}

function closeDrawer() {
  stopDrawerLiveSync();
  window._drawerPending = {};
  if (window.history.length > 1 && (S.drawerIssueId || document.body.classList.contains('issue-page'))) {
    _goBackOnce();
    return;
  }
  _closeIssueDrawer();
  var returnUrl = S._issueReturnUrl || appPathForView(S._prevView || 'home');
  window.history.replaceState({}, '', returnUrl);
  if (S._prevTab && S._prevSpace) {
    S.currentSpace = S._prevSpace;
    navigateToSpace(S._prevSpace, S._prevTab, { skipUrlUpdate: true, replaceUrl: true });
  } else if (S._prevView) {
    if (S._prevView === 'yourwork') {
      if (S._prevYourWorkTab) S.yourWorkTab = S._prevYourWorkTab;
      if (S._prevYwOpen) applyYourWorkOpenFilter();
      else clearYourWorkFilters();
    }
    navigateTo(S._prevView, { skipUrlUpdate: true, replaceUrl: true });
  }
  S._prevView = null; S._prevTab = null; S._prevSpace = null; S._prevYourWorkTab = null; S._prevYwOpen = false;
  refreshRecentViewedUI();
}
window.closeDrawer = closeDrawer;

function goBackToSavedPage() {
  window.history.replaceState({}, "", "/");
  stopDrawerLiveSync();
  $('issueDrawer').setAttribute('hidden', '');
  document.body.classList.remove('issue-page');
  S.drawerIssueId = null;
  window._drawerPending = {};
  var pTab   = S._prevTab;
  var pSpace = S._prevSpace;
  var pView  = S._prevView;
  var pYourWorkTab = S._prevYourWorkTab;
  S._prevView = null; S._prevTab = null; S._prevSpace = null; S._prevYourWorkTab = null;
  if (pTab && pSpace) {
    S.currentSpace = pSpace;
    navigateToSpace(pSpace, pTab);
    refreshRecentViewedUI();
  } else if (pView && pView !== 'home') {
    if (pView === 'yourwork') {
      if (pYourWorkTab) S.yourWorkTab = pYourWorkTab;
      if (S._prevYwOpen) applyYourWorkOpenFilter();
      else clearYourWorkFilters();
    }
    navigateTo(pView, { replaceUrl: true });
    refreshRecentViewedUI();
  } else if (window.history.length > 1) {
    window.history.back();
  } else if (S.currentSpace) {
    navigateToSpace(S.currentSpace, 'backlog');
  } else {
    var firstSpace = S.data && S.data.spaces && S.data.spaces[0];
    if (firstSpace) navigateToSpace(firstSpace.id, 'backlog');
    else navigateTo('home');
  }
}
window.goBackToSavedPage = goBackToSavedPage;

function goBackFromIssue() {
  stopDrawerLiveSync();
  window._drawerPending = {};
  if (window.history.length > 1) {
    _goBackOnce();
    return;
  }
  _closeIssueDrawer();
  var pView = S._prevView;
  var pYourWorkTab = S._prevYourWorkTab;
  var returnTab = S._prevTab || window._issueReturnTab || 'backlog';
  var returnSpace = S._prevSpace || window._issueReturnSpace || S.currentSpace;
  window._issueReturnTab = null;
  window._issueReturnSpace = null;
  if (returnSpace) {
    navigateToSpace(returnSpace, returnTab, { replaceUrl: true });
  } else if (pView === 'yourwork') {
    if (pYourWorkTab) S.yourWorkTab = pYourWorkTab;
    if (S._prevYwOpen) applyYourWorkOpenFilter();
    else clearYourWorkFilters();
    navigateTo('yourwork', { replaceUrl: true });
  } else {
    navigateTo('home', { replaceUrl: true });
  }
}

// Opens an issue in a new browser tab
function openIssuePage(issueId, opts) {
  opts = opts || {};
  if (!opts.skipHistory) {
    S._prevView = S.currentView;
    S._prevTab = S.currentTab;
    S._prevSpace = S.currentSpace;
    S._prevYourWorkTab = S.yourWorkTab;
    S._prevYwOpen = S.ywExcludeDone && S.yourWorkTab === 'assigned';
    S._prevScrollY = window.scrollY;
    S._issueReturnUrl = window.location.pathname + window.location.search;
  }
  // goBackFromIssue() relies on window.history.back()/popstate, which has an
  // unresolved intermittent issue reported specifically for tickets opened
  // from All Work (not reproducible in automated testing so far). For that
  // one entry point, this button is rewired to navigate straight back to
  // All Work directly -- no history.back(), no popstate, so whatever that
  // issue is, it can't apply. (The ✕ close button isn't a usable fallback
  // here: body.issue-page .drawer-close-btn is CSS-hidden by design in this
  // full-page ticket view, this button is the only in-app way out.)
  var backBtn = $('drawerBackBtn');
  if (backBtn) {
    if (S._prevTab === 'allwork') {
      backBtn.onclick = function () { closeIssueFromAllWork(); };
    } else {
      backBtn.onclick = function () { goBackFromIssue(); };
    }
  }
  var issueObj = (S.data.issues || []).find(function(i){ return i.id == issueId; });
  var issueKey = issueObj ? issueObj.key : issueId;
  // Leave the sidebar's expanded space submenu as it is rather than collapsing
  // it (used to call collapseSpaceSubnav() here unconditionally) -- if we
  // already know this issue's space, make sure THAT space's menu is the one
  // showing; openDrawer does the same once the full issue loads, for the case
  // where the issue wasn't in the local cache yet.
  if (issueObj && issueObj.space_id) mountSpaceSubnav(issueObj.space_id, S.currentTab);
  if (!opts.skipHistory) {
    // &from=<tab-slug> so a hard refresh on this ticket page can still recover
    // which tab it was opened from (S._prevTab/currentTab are in-memory JS
    // state, gone on reload) -- without it, the boot deep-link path had no way
    // to know the real origin and always assumed Backlog, so "Back" after a
    // refresh sent an All-Work-opened ticket to Backlog & Sprints instead.
    var fromSlug = (S.currentView === 'space' && S.currentTab) ? (SPACE_TAB_TO_SLUG[S.currentTab] || '') : '';
    var issueUrl = '/?issue=' + encodeURIComponent(issueKey) + (fromSlug ? '&from=' + fromSlug : '');
    window.history.pushState({ issueId: issueId, returnUrl: S._issueReturnUrl }, '', issueUrl);
  }
  document.body.classList.add('issue-page');
  openDrawer(issueId);
}
window.openIssuePage = openIssuePage;

// Save all pending drawer changes to DB
async function saveDrawerChanges() {
  // No-op — fields now auto-save via bindDrawerEdits autoSave()
}
window.saveDrawerChanges = saveDrawerChanges;
