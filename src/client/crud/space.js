
// ═══════════════════════════════════════════════════════════
// SPACE CRUD
// ═══════════════════════════════════════════════════════════
function canCreateSpace() {
  return isOrgAdminUser();
}

function getMySpaceRole(spaceId) {
  if (!spaceId) return null;
  var sm = (S.data.space_members || []).find(function(m) {
    return m.space_id === spaceId && m.user_id === S.currentUser;
  });
  return sm ? (sm.role || 'member') : null;
}

function isSpaceAdmin(spaceId) {
  if (!spaceId) return false;
  if (isOrgAdminUser()) return true;
  return normalizeSpaceRole(getMySpaceRole(spaceId)) === 'site_admin';
}

function isSpaceMemberOnly(spaceId) {
  if (!spaceId) return false;
  if (isOrgAdminUser()) return false;
  var role = getMySpaceRole(spaceId);
  return !!role && normalizeSpaceRole(role) === 'member';
}

// Space settings, reports, sprints, people — org admin or space admin (requires space)
function canManageSpace(spaceId) {
  return isSpaceAdmin(spaceId);
}

function canCreateSprint(spaceId) {
  return canManageSpace(spaceId);
}

function isSpaceAdminAnywhere() {
  if (isOrgAdminUser()) return true;
  return (S.data.space_members || []).some(function(m) {
    return m.user_id === S.currentUser && normalizeSpaceRole(m.role) === 'site_admin';
  });
}

function canViewReports() {
  return isOrgAdminUser() || isSpaceAdminAnywhere();
}

// Mirrors the backend's ACTION_MIN_ROLE — 'issue.delete' and 'issue.bulk' both
// need site_admin in the space. Org admins pass everywhere. Keep these in step
// with lib/permissions.js: a UI check that is stricter than the server hides a
// button the user is actually allowed to press.
function canDeleteIssue(spaceId) {
  return isSpaceAdmin(spaceId);
}
// Restore and permanent delete are org-admin only, by design: a space admin can
// put things in the bin but not empty it or pull things back out. The bin itself
// reads the server's `can_restore` flag rather than re-deriving that here, so the
// button set can never disagree with what the API will allow.
function canDeleteSpace() {
  return isOrgAdminUser();
}

function updateRoleBasedUI() {
  var createSprintBtn = $('createSprintBtn');
  if (createSprintBtn) {
    var showSprint = S.currentTab === 'backlog' && !!S.currentSpace && canCreateSprint(S.currentSpace);
    createSprintBtn.style.display = showSprint ? '' : 'none';
  }
}

function isSpaceOwner(spaceId) {
  return canManageSpace(spaceId);
}

function openSpaceModal(space) {
  // Members can only edit, not create
  if (!space && !canCreateSpace()) {
    toast('Only admins can create spaces.', 'error');
    return;
  }
  if (space && space.id) {
    $('spaceId').value = space.id;
    $('spaceName_input').value = space.name || '';
    $('spaceKey_input').value = space.key || '';
    $('spaceDesc').value = space.description || '';
    $('spaceIconInput').value = space.icon || '';
    $('spaceColor').value = space.color || '#2563eb';
    $('spaceType').value = space.space_type || 'scrum';
    $('spaceVisibility').value = space.visibility || 'private';
    $('spaceModalTitle').textContent = 'Edit Space';
  } else {
    $('spaceId').value = '';
    $('spaceName_input').value = '';
    $('spaceKey_input').value = '';
    $('spaceDesc').value = '';
    $('spaceIconInput').value = '';
    $('spaceColor').value = '#2563eb';
    $('spaceType').value = 'scrum';
    $('spaceVisibility').value = 'private';
    $('spaceModalTitle').textContent = 'Create Space';
  }
  updateVisibilityHint($('spaceVisibility').value);
  openModal('modal-space');
}
window.openSpaceModal = openSpaceModal;

window.updateVisibilityHint = function(val) {
  var el = $('visibilityHint');
  if (!el) return;
  var hints = {
    private: '🔒 Only users you explicitly add as members can see this space.',
    team: '👥 All members of your organization can view this space.',
    org: '🌐 Visible across the entire organization, including viewers and guests.'
  };
  el.textContent = hints[val] || '';
};

async function handleSpaceSubmit(e) {
  e.preventDefault();
  var id = $('spaceId').value;
  var spaceName = $('spaceName_input').value;
  var spaceKey = $('spaceKey_input').value.trim().toUpperCase();

  // Fail fast on a key that is visibly taken, so the user is told before the
  // round-trip. The server repeats this check and is the real gate — it also
  // sees ARCHIVED spaces, which /api/data filters out, so a clash this misses
  // still comes back as a 409 and lands in the popup below.
  var keyClash = (S.data.spaces || []).find(function (sp) {
    return sp.id !== id && String(sp.key || '').toUpperCase() === spaceKey;
  });
  if (keyClash) {
    popupAlert('Key already in use',
      'The key "' + spaceKey + '" belongs to the space "' + keyClash.name + '". Space keys must be unique — pick a different one.',
      'error');
    return;
  }

  var payload = {
    name: spaceName,
    key: spaceKey,
    description: $('spaceDesc').value,
    icon: $('spaceIconInput').value,
    color: $('spaceColor').value,
    space_type: $('spaceType').value,
    visibility: $('spaceVisibility').value,
    owner_id: S.currentUser
  };

  try {
    if (id) {
      await api('/api/spaces/' + id, 'PUT', payload);
      closeModal('modal-space');
      await refreshData();
      renderSidebar();
      if (S.currentSpace) { var sp = getSpace(S.currentSpace); if (sp) renderSpaceHeader(sp); }
      popupAlert('Space Updated', '"' + spaceName + '" has been updated successfully.', 'success');
    } else {
      var newSpace = await api('/api/spaces', 'POST', payload);
      closeModal('modal-space');
      await refreshData();
      renderSidebar();
      popupAlert('Space Created', '"' + spaceName + '" space has been created successfully.', 'success');
      if (newSpace && newSpace.id) navigateToSpace(newSpace.id, 'summary');
    }
  } catch (err) {
    popupAlert('Error', err.message || 'Could not save space. Please try again.', 'error');
  }
}
