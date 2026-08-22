
// ═══════════════════════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════════════════════
var _adminSection = 'org-general';

async function renderAdminSettings(section) {
  _adminSection = section || _adminSection;
  var view = $('view-settings');
  if (!view) return;
  var me = S.currentUserObj || {};
  var isAdmin = me.role === 'admin' || me.role === 'owner';
  if (!isAdmin) {
    view.innerHTML = '<div style="padding:40px;text-align:center"><h2>Access Denied</h2><p style="color:var(--muted)">Only admins can access settings.</p></div>';
    return;
  }

  // Update active nav
  qsa('.admin-nav-item').forEach(function(a) {
    a.classList.toggle('active', a.dataset.section === _adminSection);
  });

  var content = $('adminSettingsContent');
  if (!content) return;
  content.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading...</div>';

  switch (_adminSection) {
    case 'org-general':    await renderAdminOrgGeneral(content); break;
    case 'org-security':   renderAdminSecurity(content); break;
    case 'org-notifications': renderAdminNotifications(content); break;
    case 'user-management': await renderAdminUsers(content); break;
    case 'roles-permissions': renderAdminRoles(content); break;
    case 'all-spaces':     await renderAdminSpaces(content); break;
    case 'global-custom-fields': await renderAdminCustomFields(content); break;
    case 'email-settings': await renderAdminEmailSettings(content); break;
    case 'audit-log':      await renderAdminAuditLog(content); break;
    case 'deleted-tickets': await renderDeletedTickets(content); break;
    default: content.innerHTML = '';
  }
}
window.renderAdminSettings = renderAdminSettings;

// Wire up nav clicks after DOM ready
document.addEventListener('click', function(e) {
  // Filter chip click — handle first before nav check
  var chip = e.target.closest('.um-filter-chip');
  if (chip) {
    e.stopPropagation();
    var filter = chip.getAttribute('data-filter');
    document.querySelectorAll('.um-filter-chip').forEach(function(c) {
      c.style.border = c.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
      c.style.opacity = c.getAttribute('data-filter') === filter ? '1' : '0.8';
    });
    document.querySelectorAll('tr[data-um-status]').forEach(function(row) {
      row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
    });
    document.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
      row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
    });
    return;
  }

  var item = e.target.closest('.admin-nav-item');
  if (!item || !item.dataset.section) return;
  renderAdminSettings(item.dataset.section);
  syncAppUrl();
});

// ── Org General ──────────────────────────────────────────
async function renderAdminOrgGeneral(el) {
  // Fetch fresh org data from DB
  var org = {};
  try { org = await api('/api/org') || {}; if (S.data) S.data.org = org; } catch(e) {}
  var users = (S.data && S.data.users) || [];
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });
  var issues = (S.data && S.data.issues) || [];
  var activeUsers = users.filter(function(u){ return u.is_active !== false; }).length;

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🏢 Organization Settings</h2>' +
    '<p>Manage your organization profile and workspace configuration.</p>' +
    '</div>' +

    '<div class="admin-stat-grid">' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + users.length + '</div><div class="admin-stat-label">Total Users</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + activeUsers + '</div><div class="admin-stat-label">Active Users</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + spaces.length + '</div><div class="admin-stat-label">Active Spaces</div></div>' +
    '<div class="admin-stat-card"><div class="admin-stat-num">' + issues.length + '</div><div class="admin-stat-label">Total Issues</div></div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Organization Profile</h3>' +
    '<form id="orgEditForm">' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Organization Name</div><div class="admin-field-desc">Displayed across the workspace</div></div>' +
    '<input id="orgNameInput" class="input input-sm" style="width:220px" value="' + esc(org.name || '') + '">' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Slug</div><div class="admin-field-desc">URL identifier for the workspace</div></div>' +
    '<input id="orgSlugInput" class="input input-sm" style="width:220px" value="' + esc(org.slug || '') + '">' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Plan</div><div class="admin-field-desc">Current subscription tier</div></div>' +
    '<span class="badge" style="background:rgba(77,144,224,0.15);color:var(--accent);padding:5px 12px">Enterprise</span>' +
    '</div>' +
    '<div style="margin-top:16px">' +
    '<button type="submit" class="btn btn-primary btn-sm">Save Changes</button>' +
    '</div>' +
    '</form>' +
    '</div>';

  // Save org settings to DB
  var form = $('orgEditForm');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = $('orgNameInput').value.trim();
      var slug = $('orgSlugInput').value.trim();
      if (!name) { toast('Organization name is required', 'error'); return; }
      try {
        var updated = await api('/api/org', 'PUT', { name: name, slug: slug });
        if (S.data) S.data.org = updated;
        popupAlert('Settings Saved', 'Organization profile updated successfully.', 'success');
      } catch(e) {}
    });
  }
}

// ── Security ─────────────────────────────────────────────
function renderAdminSecurity(el) {
  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔒 Security</h2>' +
    '<p>Manage authentication, sessions, and access control settings.</p>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Authentication</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Password Hashing</div><div class="admin-field-desc">Algorithm used for password storage</div></div>' +
    '<code style="font-size:12px;background:var(--bg3);padding:3px 8px;border-radius:4px">scrypt (Node.js built-in)</code>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Session Duration</div><div class="admin-field-desc">How long login sessions remain valid</div></div>' +
    '<span style="font-size:13px;color:var(--text)">7 days</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Session Tokens</div><div class="admin-field-desc">Random 256-bit tokens stored in database</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Password Policy</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Minimum Length</div><div class="admin-field-desc">Minimum number of characters required</div></div>' +
    '<span style="font-size:13px;color:var(--text)">6 characters</span>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Access Control</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Invite-Only Registration</div><div class="admin-field-desc">New users can only join via admin invite</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Admin User Creation</div><div class="admin-field-desc">Only admins and owners can create users</div></div>' +
    '<span class="badge badge-success">Enabled</span>' +
    '</div>' +
    '</div>';
}

// ── Notifications ────────────────────────────────────────
// Load/save notification preferences from localStorage
function _getNotifPrefs() {
  try { return JSON.parse(localStorage.getItem('sb_notif_prefs') || '{}'); } catch { return {}; }
}
function _saveNotifPrefs(prefs) {
  localStorage.setItem('sb_notif_prefs', JSON.stringify(prefs));
}
function _notifPrefEnabled(type) {
  var prefs = _getNotifPrefs();
  return prefs[type] !== false; // default ON if not set
}

function renderAdminNotifications(el) {
  var prefs = _getNotifPrefs();
  var chk = function(key) { return prefs[key] !== false ? 'checked' : ''; };

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔔 Notifications</h2>' +
    '<p>Configure workspace-wide notification preferences.</p>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>In-App Notifications</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Issue Assigned</div><div class="admin-field-desc">Notify when an issue is assigned to a user</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefAssigned" ' + chk('issue_assigned') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Issue Status Changed</div><div class="admin-field-desc">Notify when issue status is updated</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefStatus" ' + chk('status_changed') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Comment Added</div><div class="admin-field-desc">Notify on new comments</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefComment" ' + chk('comment_added') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">@Mentions</div><div class="admin-field-desc">Notify when someone mentions you in a comment</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefMention" ' + chk('mention') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Priority Changed</div><div class="admin-field-desc">Notify assignee when issue priority is updated</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefPriority" ' + chk('priority_changed') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Sprint Started / Completed</div><div class="admin-field-desc">Notify on sprint lifecycle events</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" id="notifPrefSprint" ' + chk('sprint_started') + '><span class="toggle-slider"></span></label>' +
    '</div>' +
    '</div>' +

    '<div class="admin-card">' +
    '<h3>Email Notifications</h3>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">SMTP Server</div><div class="admin-field-desc">Email service not yet configured</div></div>' +
    '<span class="badge badge-muted">Not configured</span>' +
    '</div>' +
    '<div class="admin-field-row">' +
    '<div><div class="admin-field-label">Invite Emails</div><div class="admin-field-desc">Send invite links via email (requires SMTP)</div></div>' +
    '<label class="toggle-switch"><input type="checkbox" disabled><span class="toggle-slider"></span></label>' +
    '</div>' +
    '</div>';

  // Wire toggles to save prefs
  function wireToggle(elId, prefKey, linked) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.onchange = function() {
      var p = _getNotifPrefs();
      p[prefKey] = el.checked;
      if (linked) linked.forEach(function(k) { p[k] = el.checked; });
      _saveNotifPrefs(p);
      toast((el.checked ? 'Enabled: ' : 'Disabled: ') + el.closest('.admin-field-row').querySelector('.admin-field-label').textContent);
    };
  }
  wireToggle('notifPrefAssigned', 'issue_assigned');
  wireToggle('notifPrefStatus',   'status_changed');
  wireToggle('notifPrefComment',  'comment_added');
  wireToggle('notifPrefMention',  'mention');
  wireToggle('notifPrefPriority', 'priority_changed');
  wireToggle('notifPrefSprint',   'sprint_started', ['sprint_completed']);
}

// ── Users (Admin) ─────────────────────────────────────────
async function renderAdminUsers(el) {
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:18px;">
    <div style="position:relative;width:56px;height:56px;">
      <svg viewBox="0 0 56 56" style="width:56px;height:56px;animation:um-spin 1s linear infinite;">
        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" stroke-width="4"/>
        <circle cx="28" cy="28" r="22" fill="none" stroke="#0129AC" stroke-width="4" stroke-dasharray="80 60" stroke-linecap="round"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0129AC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
    </div>
    <div style="font-size:15px;font-weight:600;color:var(--text1)">Loading Users</div>
    <div style="font-size:13px;color:var(--text3)">Fetching team members&hellip;</div>
  </div>
  <style>@keyframes um-spin{to{transform:rotate(360deg)}}</style>`;
  // Refresh with timeout guard — don't block forever
  try {
    await Promise.race([
      refreshData(),
      new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('timeout')); }, 5000); })
    ]);
  } catch(e) { /* use cached S.data on timeout or error */ }
  var me = S.currentUserObj || {};
  var users = (S.data && S.data.users) || [];
  var invites = [];
  try { invites = await api('/api/auth/invitations'); } catch(e) { invites = []; }

  if (!users.length) {
    el.innerHTML = '<div class="admin-section-header"><h2>User Management</h2><p>Manage all users, roles and access.</p></div>' +
      '<div class="admin-card" style="padding:24px;text-align:center;color:var(--text3)">No users found. Try refreshing the page.</div>';
    return;
  }

  // Only show pending invites whose email isn't already a registered user
  var registeredEmails = users.map(function(u){ return u.email.toLowerCase(); });
  var pendingInvites = invites.filter(function(inv){
    return inv.status === 'pending' && !registeredEmails.includes(inv.email.toLowerCase());
  });

  var userRows = users.map(function(u) {
    var isActive = u.is_active !== false;
    var sb = isActive ? '<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px">Active</span>' : '<span style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px">Inactive</span>';
    var ll = u.last_login ? relativeTime(u.last_login) : 'Never';
    var av = '<div style="width:38px;height:38px;border-radius:50%;background:' + (u.color||'#0129AC') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:13px;flex-shrink:0">' + initials(u.name) + '</div>';
    var info = '<div><div style="font-weight:600;font-size:14px;color:var(--text)">' + esc(u.name) + '</div><div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(u.email) + '</div></div>';
    var orgRole = (u.role === 'owner' || u.role === 'admin') ? 'admin' : 'member';
    var rolesel = '<select class="input input-sm um-role-sel" data-uid="' + u.id + '" style="font-size:13px;height:30px;border-radius:6px;padding:0 8px;min-width:110px"' + (u.id===me.id?' disabled':'') + '>' +
      '<option value="admin"' + (orgRole === 'admin' ? ' selected' : '') + '>Admin</option>' +
      '<option value="member"' + (orgRole === 'member' ? ' selected' : '') + '>Member</option>' +
      '</select>';
    var toggleBtn = u.id!==me.id ? '<button class="btn btn-sm um-toggle-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" data-active="'+u.is_active+'" style="font-size:12px;padding:5px 12px;border-radius:6px;cursor:pointer;color:#fff;border:none;background:'+(isActive?'#ef4444':'#22c55e')+'">'+(isActive?'Deactivate':'Activate')+'</button>' : '';
    var pwdBtn = '<button class="btn btn-sm um-pwd-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" style="font-size:12px;padding:5px 12px;border-radius:6px;border:none;background:#0129AC;cursor:pointer;color:#fff">Reset PW</button>';
    var delBtn = u.id!==me.id ? '<button class="btn btn-sm um-delete-user-btn" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" data-email="'+esc(u.email)+'" style="font-size:12px;padding:5px 12px;border-radius:6px;border:none;background:#dc2626;cursor:pointer;color:#fff">Delete</button>' : '';
    return '<tr data-um-status="' + (isActive ? 'active' : 'inactive') + '" style="border-bottom:1px solid var(--border)" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">' +
      '<td style="padding:14px 16px"><div style="display:flex;align-items:center;gap:12px">' + av + info + '</div></td>' +
      '<td style="padding:14px 16px">' + rolesel + '</td>' +
      '<td style="padding:14px 16px">' + sb + '</td>' +
      '<td style="padding:14px 16px;font-size:13px;color:var(--text2)">' + ll + '</td>' +
      '<td style="padding:14px 16px"><div style="display:flex;gap:6px;flex-wrap:wrap">' + toggleBtn + pwdBtn + delBtn + '</div></td></tr>';
  }).join('');

  var inviteRows = pendingInvites.map(function(inv) {
    var expiresStr = new Date(inv.expires_at) < new Date()
      ? '<span style="color:#ef4444;font-size:11px">Expired</span>'
      : '<span style="font-size:11px;color:var(--text3)">Expires ' + relativeTime(inv.expires_at) + '</span>';
    return '<tr data-um-invite="1" style="opacity:0.85">' +
      '<td><div style="display:flex;align-items:center;gap:10px">' +
      '<div class="user-avatar-sm" style="background:#64748b;font-size:10px">?</div>' +
      '<div><div style="font-weight:600;font-size:13px;color:var(--text2)">(Pending)</div>' +
      '<div style="font-size:11px;color:var(--text3)">' + esc(inv.email) + '</div></div></div></td>' +
      '<td><span style="font-size:12px;color:var(--text3)">' + cap(inv.role||'member') + '</span></td>' +
      '<td><span class="badge" style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44">✉️ Invited</span></td>' +
      '<td>' + expiresStr + '</td>' +
      '<td style="padding:8px 16px;white-space:nowrap">' +
      '<button class="btn btn-sm um-resend-invite-btn" data-invite-id="'+inv.id+'" data-email="'+esc(inv.email)+'" style="font-size:11px;padding:4px 10px;border:none;border-radius:3px;background:#f59e0b;cursor:pointer;color:#fff;margin-right:4px">↺ Resend</button>' +
      '<button class="btn btn-sm um-cancel-invite-btn" data-invite-id="'+inv.id+'" data-email="'+esc(inv.email)+'" style="font-size:11px;padding:4px 10px;border:none;border-radius:3px;background:#ef4444;cursor:pointer;color:#fff">✕ Delete</button>' +
      '</td>' +
      '</tr>';
  }).join('');

  var totalActive = users.filter(function(u){ return u.is_active!==false; }).length;

  // Define filter BEFORE setting innerHTML so onclick can find it immediately
  window._umFilter = function(filter) {
    document.querySelectorAll('.um-filter-chip').forEach(function(chip) {
      chip.style.border = chip.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
      chip.style.opacity = chip.getAttribute('data-filter') === filter ? '1' : '0.8';
    });
    document.querySelectorAll('tr[data-um-status]').forEach(function(row) {
      row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
    });
    document.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
      row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
    });
  };

  el.innerHTML =
    '<div style="padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:12px">' +
    '<h2 style="margin:0;font-size:22px;font-weight:700;color:var(--text)">User Management</h2>' +
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<input type="text" id="userSearchInput" placeholder="Search users..." oninput="window._filterUsers(this.value)" style="padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-size:13px;width:220px;outline:none">' +
    '<button onclick="openInviteUserModal()" style="background:#0129AC;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">+ Invite User</button>' +
    '</div>' +
    '</div>' +
    '<div id="umFilterBar" style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 20px">' +
    '<div class="um-filter-chip" data-filter="all" style="display:flex;align-items:center;gap:6px;background:var(--bg3);color:var(--text);font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid #0129AC">' + users.length + ' Registered</div>' +
    '<div class="um-filter-chip" data-filter="active" style="display:flex;align-items:center;gap:6px;background:#dcfce7;color:#166534;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + totalActive + ' Active</div>' +
    '<div class="um-filter-chip" data-filter="inactive" style="display:flex;align-items:center;gap:6px;background:#f1f5f9;color:#64748b;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + (users.length - totalActive) + ' Inactive</div>' +
    (pendingInvites.length ? '<div class="um-filter-chip" data-filter="pending" style="display:flex;align-items:center;gap:6px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;border:2px solid transparent">' + pendingInvites.length + ' Pending Invites</div>' : '') +
    '</div>' +
    '<div style="background:#fff;border:1px solid #dfe1e6;border-radius:8px;overflow-x:auto;box-shadow:0 1px 4px rgba(0,0,0,0.06);-webkit-overflow-scrolling:touch">' +
    '<table style="width:100%;border-collapse:collapse;table-layout:auto">' +
    '<thead><tr style="background:#f4f5f7;border-bottom:2px solid #dfe1e6">' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:220px">User</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:130px">Role</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:90px">Status</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:120px">Last Login</th>' +
    '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#6b778c;text-transform:uppercase;min-width:220px">Actions</th>' +
    '</tr></thead><tbody>' + userRows + inviteRows + '</tbody></table></div></div>';

  // Bind filter chips via addEventListener (avoids inline onclick quoting issues)
  el.querySelectorAll('.um-filter-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var filter = chip.getAttribute('data-filter');
      el.querySelectorAll('.um-filter-chip').forEach(function(c) {
        c.style.border = c.getAttribute('data-filter') === filter ? '2px solid #0129AC' : '2px solid transparent';
        c.style.opacity = c.getAttribute('data-filter') === filter ? '1' : '0.8';
      });
      el.querySelectorAll('tr[data-um-status]').forEach(function(row) {
        row.style.display = (filter === 'all' || row.getAttribute('data-um-status') === filter) ? '' : 'none';
      });
      el.querySelectorAll('tr[data-um-invite]').forEach(function(row) {
        row.style.display = (filter === 'all' || filter === 'pending') ? '' : 'none';
      });
    });
  });

  qsa('.um-role-sel').forEach(function(sel) {
    sel.addEventListener('change', async function() {
      try {
        await api('/api/users/'+sel.dataset.uid, 'PUT', { role: sel.value });
        popupAlert('Role Updated', 'User role changed to ' + formatOrgRoleLabel(sel.value) + ' successfully.', 'success');
      } catch(e) {}
    });
  });
  qsa('.um-toggle-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var isActive = btn.dataset.active !== 'false';
      var name = btn.dataset.uname || 'User';
      var ok = await confirmDialog((isActive ? 'Deactivate' : 'Activate') + ' ' + name + '?');
      if (!ok) return;
      try {
        await api('/api/users/'+btn.dataset.uid, 'PUT', { is_active: !isActive });
        popupAlert(isActive ? 'User Deactivated' : 'User Activated',
          name + ' has been ' + (isActive ? 'deactivated' : 'activated') + '.', isActive ? 'warning' : 'success');
        renderAdminSettings('user-management');
      } catch(e) {}
    });
  });
  qsa('.um-pwd-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openResetPasswordModal(btn.dataset.uid, btn.dataset.uname); });
  });
  qsa('.um-delete-user-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var name = btn.dataset.uname || 'this user';
      var email = btn.dataset.email || '';
      var uid = btn.dataset.uid;
      var av = initials(name);
      // Rich delete confirmation popup
      var ok = await new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        overlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center;animation:popIn 0.2s ease">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px">🗑️</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Delete User</h2>' +
          '<div style="display:flex;align-items:center;gap:12px;background:#f8fafc;border-radius:10px;padding:12px 16px;margin:16px 0;text-align:left">' +
          '<div style="width:40px;height:40px;border-radius:50%;background:#0129AC;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0">' + av + '</div>' +
          '<div><div style="font-weight:600;font-size:14px;color:#1e293b">' + esc(name) + '</div><div style="font-size:12px;color:#64748b;margin-top:2px">' + esc(email) + '</div></div>' +
          '</div>' +
          '<p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6">This will <strong style="color:#dc2626">permanently delete</strong> this user and all their data. This action <strong>cannot be undone</strong>.</p>' +
          '<div style="display:flex;gap:10px;justify-content:center">' +
          '<button id="_delCancelBtn" style="flex:1;padding:10px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;font-size:14px;font-weight:600;cursor:pointer">Cancel</button>' +
          '<button id="_delConfirmBtn" style="flex:1;padding:10px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Delete User</button>' +
          '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#_delCancelBtn').onclick = function() { document.body.removeChild(overlay); resolve(false); };
        overlay.querySelector('#_delConfirmBtn').onclick = function() { document.body.removeChild(overlay); resolve(true); };
        overlay.onclick = function(e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(false); } };
      });
      if (!ok) return;
      try {
        await api('/api/users/' + uid, 'DELETE');
        // Remove from local cache so stale data never re-appears on re-render
        if (S.data && S.data.users) S.data.users = S.data.users.filter(function(u){ return u.id !== uid; });
        // Remove row immediately from table
        var delBtn2 = document.querySelector('.um-delete-user-btn[data-uid="' + uid + '"]');
        if (delBtn2) { var delRow = delBtn2.closest('tr'); if (delRow) delRow.remove(); }
        // Rich success popup
        var successOverlay = document.createElement('div');
        successOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        successOverlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:36px 32px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center">' +
          '<div style="width:68px;height:68px;border-radius:50%;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">✅</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">User Deleted</h2>' +
          '<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1e293b">' + esc(name) + '</p>' +
          '<p style="margin:0 0 24px;font-size:13px;color:#64748b">This user has been permanently removed from the system.</p>' +
          '<button id="_delSuccessClose" style="padding:10px 32px;border:none;border-radius:8px;background:#0129AC;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Done</button>' +
          '</div>';
        document.body.appendChild(successOverlay);
        var closeSuccess = function() { if (document.body.contains(successOverlay)) document.body.removeChild(successOverlay); renderAdminSettings('user-management'); };
        successOverlay.querySelector('#_delSuccessClose').onclick = closeSuccess;
        successOverlay.onclick = function(e) { if (e.target === successOverlay) closeSuccess(); };
        setTimeout(closeSuccess, 3000);
      } catch(e) {
        var errOverlay = document.createElement('div');
        errOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
        errOverlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:36px 32px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center">' +
          '<div style="width:68px;height:68px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">❌</div>' +
          '<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#dc2626">Delete Failed</h2>' +
          '<p style="margin:0 0 24px;font-size:13px;color:#64748b">' + esc(e.message || 'Could not delete user. Please try again.') + '</p>' +
          '<button id="_delErrClose" style="padding:10px 32px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Close</button>' +
          '</div>';
        document.body.appendChild(errOverlay);
        errOverlay.querySelector('#_delErrClose').onclick = function() { document.body.removeChild(errOverlay); };
        errOverlay.onclick = function(e) { if (e.target === errOverlay) document.body.removeChild(errOverlay); };
      }
    });
  });
  qsa('.um-resend-invite-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var email = btn.dataset.email;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        var data = await api('/api/auth/invitations/' + btn.dataset.inviteId + '/resend', 'POST');
        if (data.email_sent) {
          popupAlert('Invitation Resent', 'A new invitation email has been sent to ' + email + '.', 'success');
        } else {
          popupAlert('Invitation Resent', 'Invite link renewed for ' + email + '. Email not sent: ' + (data.email_reason || 'SMTP not configured') + '<br><small style="word-break:break-all">' + (data.invite_url||'') + '</small>', 'info');
        }
        renderAdminSettings('user-management');
      } catch(e) {
        popupAlert('Error', 'Could not resend invitation.', 'error');
        btn.disabled = false;
        btn.textContent = 'Resend';
      }
    });
  });
  qsa('.um-cancel-invite-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var email = btn.dataset.email;
      var ok = await confirmDialog('Cancel the invitation for ' + email + '?');
      if (!ok) return;
      try {
        await api('/api/auth/invitations/' + btn.dataset.inviteId, 'DELETE');
        popupAlert('Invitation Cancelled', 'The invitation to ' + email + ' has been cancelled.', 'warning');
        renderAdminSettings('user-management');
      } catch(e) {
        popupAlert('Error', 'Could not cancel invitation.', 'error');
      }
    });
  });
}

// ── Roles & Permissions ───────────────────────────────────
function renderAdminRoles(el) {
  var perms = [
    { action: 'Create Space',            orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Delete Space',            orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Assign Space Admin',      orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Manage Space Members',    orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Invite Org Users',        orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Manage Org User Roles',   orgAdmin: true,  spaceAdmin: false, member: false },
    { action: 'Create / Edit Issue',     orgAdmin: true,  spaceAdmin: true,  member: true  },
    { action: 'Delete Issue',            orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Create / Manage Sprint',  orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'View Space Reports',      orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Space Settings',          orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Manage Custom Fields',    orgAdmin: true,  spaceAdmin: true,  member: false },
    { action: 'Add Comments & Log Work', orgAdmin: true,  spaceAdmin: true,  member: true  },
    { action: 'Org Admin Settings',      orgAdmin: true,  spaceAdmin: false, member: false },
  ];

  var rows = perms.map(function(p) {
    return '<tr>' +
      '<td style="font-size:13px">' + p.action + '</td>' +
      '<td class="' + (p.orgAdmin ? 'perm-check' : 'perm-cross') + '">' + (p.orgAdmin ? '✓' : '—') + '</td>' +
      '<td class="' + (p.spaceAdmin ? 'perm-check' : 'perm-cross') + '">' + (p.spaceAdmin ? '✓' : '—') + '</td>' +
      '<td class="' + (p.member ? 'perm-check' : 'perm-cross') + '">' + (p.member ? '✓' : '—') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🛡️ Roles &amp; Permissions</h2>' +
    '<p>Three-tier access: Org Admin, Space Admin (per space), and Member.</p>' +
    '</div>' +

    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    '<table class="perm-table"><thead><tr>' +
    '<th style="width:55%">Permission</th>' +
    '<th style="width:15%;text-align:center">Admin</th>' +
    '<th style="width:15%;text-align:center">Space Admin</th>' +
    '<th style="width:15%;text-align:center">Member</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '</div>' +

    '<div class="admin-card" style="margin-top:16px">' +
    '<h3>Role Descriptions</h3>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">🛡️ Admin</div><div class="admin-field-desc">Full organization control — create spaces, assign org admins and space admins, manage all users and settings.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">📁 Space Admin</div><div class="admin-field-desc">Manages assigned space(s): sprints, members (member role only), settings, reports, and custom fields. One user can be space admin on multiple spaces.</div></div></div>' +
    '<div class="admin-field-row"><div><div class="admin-field-label">👤 Member</div><div class="admin-field-desc">Works on issues in assigned spaces — create/edit tickets, comments, and work logs. No sprints, reports, or settings access.</div></div></div>' +
    '</div>';
}

// ── All Spaces ────────────────────────────────────────────
async function renderAdminSpaces(el) {
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });
  var members = (S.data && S.data.space_members) || [];
  var issues = (S.data && S.data.issues) || [];

  var rows = spaces.map(function(sp) {
    var mCount = members.filter(function(m){ return m.space_id===sp.id; }).length;
    var iCount = issues.filter(function(i){ return i.space_id===sp.id; }).length;
    return '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:10px">' +
      '<div style="width:30px;height:30px;border-radius:6px;background:' + (sp.color||'#6366f1') + ';display:flex;align-items:center;justify-content:center;font-size:14px">' + (sp.icon||'📦') + '</div>' +
      '<div><div style="font-weight:600;font-size:13px">' + esc(sp.name) + '</div>' +
      '<div style="font-size:11px;color:var(--text3)">' + esc(sp.key) + ' · ' + cap(sp.space_type||'scrum') + '</div></div></div></td>' +
      '<td style="font-size:13px">' + mCount + ' members</td>' +
      '<td style="font-size:13px">' + iCount + ' issues</td>' +
      '<td><span class="badge badge-muted">' + visLabel(sp.visibility) + '</span></td>' +
      '<td><button class="btn btn-sm btn-outline" onclick="navigateToSpace(\'' + sp.id + '\',\'space-settings\')">Settings</button></td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>📦 All Spaces</h2>' +
    '<p>Overview of all active spaces in the organization.</p>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<div style="font-size:13px;color:var(--text3)">' + spaces.length + ' active spaces</div>' +
    '<button class="btn btn-primary btn-sm" onclick="openSpaceModal()">+ New Space</button>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    '<table class="data-table"><thead><tr>' +
    '<th>Space</th><th>Members</th><th>Issues</th><th>Visibility</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── Global Custom Fields ──────────────────────────────────
async function renderAdminCustomFields(el) {
  var allCF = (S.data && S.data.custom_fields) || [];
  var spaces = ((S.data && S.data.spaces) || []).filter(function(s){ return !s.is_archived; });

  var rows = allCF.map(function(cf) {
    var sp = spaces.find(function(s){ return s.id===cf.space_id; });
    return '<tr>' +
      '<td style="font-size:13px;font-weight:600">' + esc(cf.name) + '</td>' +
      '<td><span class="badge badge-muted">' + esc(cf.field_type) + '</span></td>' +
      '<td style="font-size:12px;color:var(--text3)">' + (sp ? sp.icon+' '+sp.name : '—') + '</td>' +
      '<td>' + (cf.is_required ? '<span class="badge badge-success">Required</span>' : '<span class="badge badge-muted">Optional</span>') + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>🔧 Custom Fields</h2>' +
    '<p>All custom fields defined across spaces.</p>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    (rows ? '<table class="data-table"><thead><tr><th>Field Name</th><th>Type</th><th>Space</th><th>Required</th></tr></thead><tbody>' + rows + '</tbody></table>' :
    '<div style="padding:32px;text-align:center;color:var(--text3)">No custom fields defined yet. Add them from each Space → Settings → Custom Fields.</div>') +
    '</div>' +
    '<p style="font-size:12px;color:var(--text3);margin-top:12px">To add or edit custom fields, navigate to the specific space → Settings → Custom Fields tab.</p>';
}

// ── Email / SMTP Settings ─────────────────────────────────
var _smtpProviders = {
  gmail:    { label: 'Gmail',              host: 'smtp.gmail.com',          port: 587, note: 'Requires an App Password. Go to myaccount.google.com → Security → 2-Step Verification → App Passwords.' },
  o365:     { label: 'Outlook / Office 365', host: 'smtp.office365.com',    port: 587, note: 'Use your Microsoft account email and password. If MFA is enabled, create an App Password in your Microsoft account security settings.' },
  outlook:  { label: 'Hotmail / Outlook Personal', host: 'smtp-mail.outlook.com', port: 587, note: 'Use your Hotmail/Outlook email and password. If MFA is enabled, create an App Password in your Microsoft account.' },
  custom:   { label: 'Custom SMTP',        host: '',                         port: 587, note: 'Enter your mail server host and credentials manually.' }
};

async function renderAdminEmailSettings(el) {
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading...</div>';
  var cfg = {};
  try { cfg = await api('/api/admin/email-settings'); } catch(e) { cfg = {}; }

  // Detect current provider from host
  var currentProvider = 'custom';
  if ((cfg.smtp_host||'').includes('gmail'))        currentProvider = 'gmail';
  else if ((cfg.smtp_host||'').includes('office365')) currentProvider = 'o365';
  else if ((cfg.smtp_host||'').includes('outlook') || (cfg.smtp_host||'').includes('hotmail')) currentProvider = 'outlook';

  var providerBtns = Object.keys(_smtpProviders).map(function(k) {
    var active = k === currentProvider;
    return '<button class="btn btn-sm smtp-provider-btn ' + (active ? 'btn-primary' : 'btn-outline') + '" data-provider="'+k+'" style="flex:1">'+_smtpProviders[k].label+'</button>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>✉️ Email / SMTP</h2>' +
    '<p>Configure outbound email for invitations and all user notifications.</p>' +
    '</div>' +

    (cfg.env_active ? '<div class="admin-card" style="background:#f0fdf4;border:1px solid #86efac;margin-bottom:16px">' +
      '<p style="margin:0;color:#16a34a;font-weight:600">✅ Email active via .env — sending from <strong>' + esc(cfg.env_user||'') + '</strong></p>' +
      '<p style="margin:4px 0 0;font-size:12px;color:#15803d">Emails will be delivered. Save settings below to override.</p>' +
      '</div>' : '') +

    '<div class="admin-card">' +
    '<h3 style="margin-top:0">Select Email Provider</h3>' +
    '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">' + providerBtns + '</div>' +

    '<div id="smtpProviderNote" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;font-size:12px;color:#1d4ed8;margin-bottom:16px">' +
      _smtpProviders[currentProvider].note +
    '</div>' +

    '<div class="admin-field-row">' +
      '<label class="admin-field-label">SMTP Host</label>' +
      '<input id="smtpHost" class="input" placeholder="smtp.gmail.com" value="'+(cfg.smtp_host||_smtpProviders[currentProvider].host)+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Port</label>' +
      '<input id="smtpPort" class="input" type="number" placeholder="587" value="'+(cfg.smtp_port||587)+'" style="width:100px">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Email Address</label>' +
      '<input id="smtpUser" class="input" placeholder="your@email.com" value="'+(cfg.smtp_user||'')+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">Password / App Password</label>' +
      '<input id="smtpPass" class="input" type="password" placeholder="Password or App Password" value="'+(cfg.smtp_pass||'')+'">' +
    '</div>' +
    '<div class="admin-field-row">' +
      '<label class="admin-field-label">From Name (optional)</label>' +
      '<input id="smtpFrom" class="input" placeholder="Neutara SprintBoard <your@email.com>" value="'+(cfg.smtp_from||'')+'">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-top:20px">' +
      '<button class="btn btn-primary" id="saveSmtpBtn">Save Settings</button>' +
      '<button class="btn btn-outline" id="testSmtpBtn">Send Test Email to Me</button>' +
    '</div>' +
    '</div>';

  // Provider selector
  qsa('.smtp-provider-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      qsa('.smtp-provider-btn').forEach(function(b){ b.className = b.className.replace('btn-primary','btn-outline'); });
      btn.className = btn.className.replace('btn-outline','btn-primary');
      var p = _smtpProviders[btn.dataset.provider];
      if (p.host) {
        qs('#smtpHost').value = p.host;
        qs('#smtpPort').value = p.port;
      }
      qs('#smtpProviderNote').textContent = p.note;
    });
  });

  qs('#saveSmtpBtn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api('/api/admin/email-settings', 'PUT', {
        smtp_host: qs('#smtpHost').value.trim(),
        smtp_port: qs('#smtpPort').value,
        smtp_user: qs('#smtpUser').value.trim(),
        smtp_pass: qs('#smtpPass').value,
        smtp_from: qs('#smtpFrom').value.trim()
      });
      popupAlert('Email Settings Saved', 'SMTP configuration saved. Click "Send Test Email" to verify.', 'success');
    } catch(e) { popupAlert('Error', 'Could not save settings.', 'error'); }
    btn.disabled = false; btn.textContent = 'Save Settings';
  });

  qs('#testSmtpBtn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      var r = await api('/api/admin/email-test', 'POST');
      if (r.sent) {
        popupAlert('Test Email Sent', 'Check your inbox — test email was delivered successfully!', 'success');
      } else {
        popupAlert('Test Failed', (r.reason || 'Could not send.') + ' Check your credentials and try again.', 'error');
      }
    } catch(e) { popupAlert('Error', 'Test email failed.', 'error'); }
    btn.disabled = false; btn.textContent = 'Send Test Email to Me';
  });
}

// ── Audit Log ─────────────────────────────────────────────
async function renderAdminAuditLog(el) {
  el.innerHTML = '<div style="padding:20px;color:var(--text3)">Loading audit log...</div>';
  var users = (S.data && S.data.users) || [];
  var issues = (S.data && S.data.issues) || [];

  // Fetch real issue_history from DB
  var history = [];
  try { history = await api('/api/admin/audit-log'); } catch(e) { history = []; }

  var fieldLabel = { title:'Title', status:'Status', priority:'Priority', assignee_id:'Assignee',
    reporter_id:'Reporter', sprint_id:'Sprint', labels:'Labels', story_points:'Story Points',
    start_date:'Start Date', due_date:'Due Date', description:'Description' };

  var rows = history.map(function(h) {
    var u = users.find(function(u){ return u.id===h.user_id; });
    var issue = issues.find(function(i){ return i.id===h.issue_id; });
    var fl = fieldLabel[h.field_name] || h.field_name;
    var action = 'Changed <strong>' + esc(fl) + '</strong>';
    if (h.old_value && h.new_value) action += ' from <span style="text-decoration:line-through;color:var(--text3)">' + esc(h.old_value) + '</span> → <strong>' + esc(h.new_value) + '</strong>';
    else if (h.new_value) action += ' to <strong>' + esc(h.new_value) + '</strong>';
    return '<tr>' +
      '<td style="font-size:12px;color:var(--text3);white-space:nowrap">' + fmtDateTime(h.created_at) + '</td>' +
      '<td><div style="display:flex;align-items:center;gap:8px">' +
      (u ? '<div class="user-avatar-sm" style="background:'+(u.color||'#6366f1')+';width:22px;height:22px;font-size:9px">'+initials(u.name)+'</div>' : '') +
      '<span style="font-size:12px">' + (u ? esc(u.name) : (h.user_name || 'Unknown')) + '</span></div></td>' +
      '<td style="font-size:12px">' + action + '</td>' +
      '<td style="font-size:12px">' +
      (issue ? '<a onclick="openIssuePage(\''+issue.id+'\')" style="color:var(--accent);cursor:pointer">['+esc(issue.key||'#')+'] '+esc(issue.title)+'</a>' : (h.issue_key ? '['+esc(h.issue_key)+']' : '—')) +
      '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    '<div class="admin-section-header">' +
    '<h2>📋 Audit Log</h2>' +
    '<p>All field changes, status updates, and actions across the organization.</p>' +
    '</div>' +
    '<div class="admin-card" style="padding:0;overflow:hidden">' +
    (rows ? '<table class="data-table"><thead><tr><th>Date & Time</th><th>User</th><th>Change</th><th>Issue</th></tr></thead><tbody>' + rows + '</tbody></table>' :
    '<div style="padding:32px;text-align:center;color:var(--text3)">No audit history yet. Changes to issues will appear here.</div>') +
    '</div>';
}

// ── Normalize pasted text in description editors ───────────
// Contenteditable fields paste the source page's full HTML by default (Word,
// Google Docs, browser pages all carry their own margins/empty paragraphs),
// which shows up here as large gaps between lines. Paste as plain text
// instead — line breaks are kept, but the source's own spacing is dropped.
// Every rich-text field in the app carries .jira-editor-body or .rte-content, so
// matching on the class covers the comment box too (it was missing from the old
// id list, so a Teams paste there went in as raw markup) and any field added later.
var PLAIN_PASTE_IDS = ['drawerDesc', 'drawerFixDesc', 'issueDescContent', 'drawerCommentInput'];
function isPlainTextPasteTarget(el) {
  if (!el) return false;
  if (PLAIN_PASTE_IDS.indexOf(el.id) !== -1) return true;
  return !!(el.classList &&
    (el.classList.contains('jira-editor-body') || el.classList.contains('rte-content')));
}
// Whitelist-based cleanup for pasted text/html -- keeps real formatting
// (bold/italic/headings/lists/links) but throws away everything that made the
// old plain-text-only paste necessary in the first place: Word/Google Docs'
// own inline styles/margins/font tags/classes, and any <script>/<style>/etc.
// Unknown or disallowed tags are unwrapped (their content kept, the tag
// dropped) rather than deleted outright, so nothing the user pasted vanishes.
var PASTE_ALLOWED_TAGS = {
  B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1,
  H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
  UL: 1, OL: 1, LI: 1, BR: 1, P: 1, A: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1
};
function sanitizeRichPasteHtml(rawHtml) {
  var source = document.createElement('div');
  source.innerHTML = rawHtml;
  source.querySelectorAll('script,style,meta,link,head,title,object,embed,iframe,img,svg').forEach(function (n) { n.remove(); });

  function clean(node) {
    var out = document.createDocumentFragment();
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) { out.appendChild(child.cloneNode()); return; }
      if (child.nodeType !== 1) return; // drop comments (incl. Word's <!--[if]-->) and the rest
      var tag = child.tagName;
      // DIV/SPAN/FONT and anything else not on the whitelist: unwrap, keeping
      // its text/children but dropping the wrapper and whatever inline
      // style/class/font it carried -- this is what used to cause the giant
      // gaps between pasted lines that the old plain-text-only paste was
      // written to avoid.
      if (!PASTE_ALLOWED_TAGS[tag]) { out.appendChild(clean(child)); return; }
      var el = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        var href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      el.appendChild(clean(child));
      out.appendChild(el);
    });
    return out;
  }

  var wrap = document.createElement('div');
  wrap.appendChild(clean(source));
  // Collapse the empty-paragraph runs Word/Docs use for spacing (an empty <p>
  // that survived cleaning contributes nothing but a blank line).
  wrap.querySelectorAll('p').forEach(function (p) {
    if (!p.textContent.trim() && !p.querySelector('br')) p.remove();
  });
  return wrap.innerHTML;
}

document.addEventListener('paste', function(e) {
  var active = document.activeElement;
  if (!isPlainTextPasteTarget(active)) return;
  var cd = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
  if (!cd) return;
  var items = cd.items || [];
  for (var i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) return; } // image handler above

  var htmlSource = cd.getData('text/html');
  if (htmlSource) {
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitizeRichPasteHtml(htmlSource));
    return;
  }

  // No text/html on the clipboard (plain-text copy, or a source that only
  // offers text/plain) -- keep line breaks as before, but no longer flatten
  // real formatting that WAS on the clipboard, since that case is now handled
  // above.
  var text = cd.getData('text/plain');
  if (text === '' || text == null) return;
  e.preventDefault();
  var html = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse runs of blank lines down to one
    .split('\n')
    .map(function(line) { return esc(line); })
    .join('<br>');
  document.execCommand('insertHTML', false, html);
});

window._openAttachmentPreviewFromDataUrl = function (dataUrl) {
  var lb = document.createElement('div');
  lb.className = 'image-lightbox';
  lb.innerHTML = '<button type="button" class="image-lightbox-close" aria-label="Close">×</button>' +
    '<img src="' + dataUrl + '" alt="Preview">';
  function closeLb() {
    document.removeEventListener('keydown', onKey);
    if (lb.parentNode) lb.parentNode.removeChild(lb);
  }
  function onKey(ev) { if (ev.key === 'Escape') closeLb(); }
  lb.querySelector('.image-lightbox-close').onclick = function (ev) { ev.stopPropagation(); closeLb(); };
  lb.querySelector('img').onclick = function (ev) { ev.stopPropagation(); };
  lb.onclick = closeLb;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(lb);
};

// The clickable issue-type badge lives in bindDrawerEdits() (search "_typeMenu").
// A second, duplicate document-level picker used to live here and rendered its own
// competing menu on the same click. Its save path called window._drawerAutoSave,
// which is never defined, so it fell through to fetch(PATCH /api/issues/:id) — a
// route the server does not have. fetch() does not reject on 404, so the .then()
// still fired "Type updated" while nothing was saved. Removed; the surviving
// picker saves through autoSave() -> PUT /api/issues/:id.

// ── All Work inline edit functions ─────────────────────────
// Which cell/button opened the current inline menu, so re-clicking it can
// toggle the menu shut. `_awMenuSeq` invalidates the pending outside-click
// registration below whenever the menu is torn down, so a timer left over
// from a closed menu can't close the next one that opens.
var _awMenuOwner = null;
var _awMenuDocHandler = null;
var _awMenuSeq = 0;

// Resolve the click to its owning cell so clicking anywhere in the same cell
// counts as the same trigger. Uses e.target rather than e.currentTarget
// because awInlineAssignee opens its menu after an async members fetch, by
// which point currentTarget has been cleared.
function _awMenuOwnerFor(e) {
  var t = e && e.target;
  if (!t) return null;
  return (t.closest && t.closest('td,button')) || t;
}

function _awRemoveMenu() {
  var m = document.getElementById('_awInlineMenu');
  if (m) m.remove();
  if (_awMenuDocHandler) {
    document.removeEventListener('click', _awMenuDocHandler);
    _awMenuDocHandler = null;
  }
  _awMenuOwner = null;
  _awMenuSeq++;
}

// Keep the menu inside the viewport: cap its height to the space available,
// flip it above the trigger when it won't fit below, and pull it back in
// horizontally. Without this, clicking a row near the bottom of the list
// pushed the last options off-screen where they couldn't be reached.
function _awPositionMenu(menu, anchorEl, clickX, clickY) {
  var GAP = 4, MARGIN = 8;
  var vw = window.innerWidth, vh = window.innerHeight;
  var rect = anchorEl && anchorEl.getBoundingClientRect
    ? anchorEl.getBoundingClientRect()
    : { top: clickY, bottom: clickY, left: clickX, right: clickX };

  var spaceBelow = vh - rect.bottom - GAP - MARGIN;
  var spaceAbove = rect.top - GAP - MARGIN;
  var flipUp = spaceBelow < 140 && spaceAbove > spaceBelow;

  menu.style.maxHeight = Math.max(120, Math.min(300, flipUp ? spaceAbove : spaceBelow)) + 'px';

  var h = menu.offsetHeight;
  menu.style.top = (flipUp
    ? Math.max(MARGIN, rect.top - GAP - h)
    : Math.min(rect.bottom + GAP, vh - MARGIN - h)) + 'px';

  var w = menu.offsetWidth;
  menu.style.left = Math.max(MARGIN, Math.min(rect.left, vw - MARGIN - w)) + 'px';
}

function _awShowMenu(e, items, onSelect) {
  var owner = _awMenuOwnerFor(e);
  // Second click on the same trigger closes instead of rebuilding. The
  // trigger stops propagation, so the outside-click handler never fires for
  // this click and can't do it for us.
  if (document.getElementById('_awInlineMenu') && _awMenuOwner && _awMenuOwner === owner) {
    _awRemoveMenu();
    return;
  }
  _awRemoveMenu();
  _awMenuOwner = owner;
  var mySeq = _awMenuSeq;
  var menu = document.createElement('div');
  menu.id = '_awInlineMenu';
  menu.style.cssText = 'position:fixed;top:-9999px;left:-9999px;background:#ffffff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 8px 16px rgba(9,30,66,0.25);z-index:9999;min-width:240px;padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:300px;overflow-y:auto;';
  items.forEach(function(item) {
    var div = document.createElement('div');
    div.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:14px;border-radius:0;display:flex;align-items:center;gap:4px;color:#172b4d;border-left:3px solid transparent;';
    div.innerHTML = item.html;
    div.onmouseover = function(){ this.style.background='#f4f5f7'; this.style.borderLeftColor='#0052cc'; };
    div.onmouseout = function(){ this.style.background=''; this.style.borderLeftColor='transparent'; };
    div.onclick = function(ev) { ev.stopPropagation(); _awRemoveMenu(); onSelect(item.value); };
    menu.appendChild(div);
  });
  document.body.appendChild(menu);
  _awPositionMenu(menu, owner, e.clientX, e.clientY);
  setTimeout(function() {
    if (mySeq !== _awMenuSeq) return; // this menu was already closed/replaced
    _awMenuDocHandler = function () { _awRemoveMenu(); };
    document.addEventListener('click', _awMenuDocHandler);
  }, 100);
}

function awInlineAssignee(e, issueId, current) {
  e.stopPropagation();
  function showAssigneeMenu(members) {
    members = members.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var items = [{ value: '', html: '<span style="font-size:14px;color:#172b4d;flex:1">Unassigned</span>' + (!current?'<span style="color:#0052cc;font-weight:700">&#10003;</span>':'') }].concat(
      members.map(function(m) {
        var check = String(m.id) === String(current) ? '<span style="color:#0052cc;font-weight:700">&#10003;</span>' : '';
        return { value: m.id, html: avatarHtml(m,24) + '<span style="font-size:14px;color:#172b4d;margin-left:8px;flex:1">' + esc(m.name) + '</span>' + check };
      })
    );
    _awShowMenu(e, items, function(val) {
      api('/api/issues/' + issueId, 'PUT', { assignee_id: val || null }).then(function() {
        refreshData().then(renderAllWork);
        toast('Assignee updated');
      });
    });
  }
  // Try S.data.users first
  var members = (window.S && S.data && S.data.users) || [];
  if (members.length) {
    showAssigneeMenu(members);
  } else {
    // Fetch directly from API
    api('/api/data').then(function(data) {
      if (data && data.users) {
        S.data = S.data || {};
        S.data.users = data.users;
        showAssigneeMenu(data.users);
      } else {
        showAssigneeMenu([]);
      }
    });
  }
}

// ── Jira-like status button ─────────────────────────────────
var STATUS_BTN_STYLES = {
  'To Do':      'background:#dfe1e6;color:#42526e',
  'In Progress':'background:#0052cc;color:#ffffff',
  'In Review':  'background:#ff991f;color:#ffffff',
  'Done':       'background:#00875a;color:#ffffff',
  'Blocked':    'background:#dc2626;color:#ffffff'
};

function updateStatusBtn(status) {
  var btn = document.getElementById('drawerStatusBtn');
  var lbl = document.getElementById('drawerStatusLabel');
  if (!btn || !lbl) return;
  lbl.textContent = status || 'To Do';
  var s = STATUS_BTN_STYLES[status] || STATUS_BTN_STYLES['To Do'];
  var parts = s.split(';');
  parts.forEach(function(p) {
    var kv = p.split(':');
    if (kv.length === 2) btn.style[kv[0].trim()] = kv[1].trim();
  });
}

function toggleStatusDropdown() {
  var statuses = ISSUE_STATUSES;
  var current = document.getElementById('drawerStatus').value;
  var btn = document.getElementById('drawerStatusBtn');
  var old = document.getElementById('_statusBtnMenu');
  if (old) { old.remove(); return; }
  var rect = btn.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.id = '_statusBtnMenu';
  menu.style.cssText = 'position:fixed;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px;background:#fff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 8px 16px rgba(9,30,66,0.25);z-index:9999;min-width:200px;padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
  statuses.forEach(function(s) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:14px;color:#172b4d;display:flex;align-items:center;justify-content:space-between;border-left:3px solid transparent;';
    item.innerHTML = '<span>' + s + '</span>' + (s === current ? '<span style="color:#0052cc;font-weight:700">✓</span>' : '');
    item.onmouseover = function(){ this.style.background='#f4f5f7'; this.style.borderLeftColor='#0052cc'; };
    item.onmouseout = function(){ this.style.background=''; this.style.borderLeftColor='transparent'; };
    item.onclick = function() {
      menu.remove();
      var sel = document.getElementById('drawerStatus');
      sel.value = s;
      sel.dispatchEvent(new Event('change'));
      // Paint from the select's value AFTER the change handler, not from `s`.
      // A blocked Done transition reverts sel.value inside the handler; passing
      // `s` here repainted the button "DONE" anyway, so the UI showed Done while
      // nothing was saved and a refresh snapped it back to the real status.
      updateStatusBtn(sel.value);
    };
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function h(ev) {
      if (!menu.contains(ev.target) && ev.target.id !== 'drawerStatusBtn') {
        menu.remove(); document.removeEventListener('click', h);
      }
    });
  }, 100);
}

function awInlineStatus(e, issueId, current) {
  e.stopPropagation();
  var statuses = ISSUE_STATUSES;
  var items = statuses.map(function(s) {
    var check = s === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: s, html: '<span style="font-size:14px;color:#172b4d;flex:1">' + s + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    if (val === 'Done') {
      var cached = (S.data.issues || []).find(function (iss) { return iss.id === issueId; });
      if (!canTransitionIssueToDone(cached || issueId, current)) return;
    }
    api('/api/issues/' + issueId, 'PUT', { status: val }).then(function (updated) {
      afterIssueFieldUpdate(issueId, {
        status: val,
        updated_at: (updated && updated.updated_at) || new Date().toISOString()
      });
      toast('Status updated');
    }).catch(function () { toast('Failed to update status', 'error'); });
  });
}

function awInlinePriority(e, issueId, current) {
  e.stopPropagation();
  // This issue's own space's configured Priority list, not the fixed 5 --
  // an admin-added priority value was previously unreachable from this menu.
  var _iss = (S.data.issues || []).find(function (x) { return x.id == issueId; });
  var priorities = getIssuePriorityOptionsForSpace(_iss ? _iss.space_id : S.currentSpace).map(function (o) { return o.v; });
  var items = priorities.map(function(p) {
    var check = p === current ? '<span style="color:#0052cc;font-weight:700;margin-left:auto">&#10003;</span>' : '';
    return { value: p, html: '<span style="font-size:14px;color:#172b4d;flex:1;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">' + cap(p) + '</span>' + check };
  });
  _awShowMenu(e, items, function(val) {
    api('/api/issues/' + issueId, 'PUT', { priority: val }).then(function (updated) {
      afterIssueFieldUpdate(issueId, {
        priority: val,
        updated_at: (updated && updated.updated_at) || new Date().toISOString()
      });
      toast('Priority updated');
    }).catch(function () { toast('Failed to update priority', 'error'); });
  });
}

// ── Jira-style editor toolbar show/hide ─────────────────
var _jiraEditorPairs = [
  { body: 'drawerDesc',         toolbar: 'drawerDescToolbar' },
  { body: 'drawerFixDesc',      toolbar: 'drawerFixDescToolbar' },
  { body: 'drawerCommentInput', toolbar: 'drawerCommentToolbar' }
];

document.addEventListener('focusin', function(e) {
  _jiraEditorPairs.forEach(function(p) {
    if (e.target.id === p.body) {
      var tb = document.getElementById(p.toolbar);
      if (tb) tb.classList.add('active');
    }
  });
});

document.addEventListener('focusout', function(e) {
  _jiraEditorPairs.forEach(function(p) {
    if (e.target.id === p.body) {
      setTimeout(function() {
        var tb = document.getElementById(p.toolbar);
        var body = document.getElementById(p.body);
        if (tb && body && !tb.contains(document.activeElement) && document.activeElement !== body) {
          tb.classList.remove('active');
        }
      }, 150);
    }
  });
});

// Update toolbar button active states on selection change
document.addEventListener('selectionchange', function() {
  _jiraEditorPairs.forEach(function(p) {
    var tb = document.getElementById(p.toolbar);
    if (!tb || !tb.classList.contains('active')) return;
    tb.querySelectorAll('.jira-tb-btn[title]').forEach(function(btn) {
      var cmd = { 'Bold': 'bold', 'Italic': 'italic', 'Underline': 'underline', 'Strikethrough': 'strikeThrough' }[btn.title];
      if (cmd) {
        try { btn.classList.toggle('active-fmt', document.queryCommandState(cmd)); } catch(e) {}
      }
    });
  });
});

function richFormatBlock(tag, elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.focus();
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p') {
    document.execCommand('formatBlock', false, tag);
  }
}

function richIndent(elId, dir) {
  document.getElementById(elId) && document.getElementById(elId).focus();
  document.execCommand(dir === 'indent' ? 'indent' : 'outdent');
}

function richInsertLink(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var selectedText = sel && sel.toString() ? sel.toString() : '';
  var url = prompt('Enter URL:', 'https://');
  if (!url) return;
  if (selectedText) {
    document.execCommand('createLink', false, url);
  } else {
    var text = prompt('Link text:', url) || url;
    document.execCommand('insertHTML', false, '<a href="' + url + '" target="_blank">' + text + '</a>');
  }
}

function richInsertCode(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var text = sel && sel.toString() ? sel.toString() : 'code';
  document.execCommand('insertHTML', false, '<code>' + text + '</code>');
}

function richInsertCodeBlock(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  var sel = window.getSelection();
  var text = sel && sel.toString() ? sel.toString() : 'Enter code here';
  document.execCommand('insertHTML', false, '<pre>' + text + '</pre><p><br></p>');
}

function richInsertQuote(elId) {
  var el = document.getElementById(elId);
  if (el) el.focus();
  document.execCommand('formatBlock', false, 'blockquote');
}

function richInsertImage(elId) {
  var url = prompt('Enter image URL:');
  if (url) document.execCommand('insertImage', false, url);
}

// ── Copy issue link ─────────────────────────────────────
// Shared by the drawer's own copy-link button and the "created while another
// ticket was open" toast, which offers a copy-link action for the NEW ticket
// (a different key than whatever is currently open, so it can't just reuse
// copyDrawerLink's window._currentIssueKey).
function copyIssueLinkByKey(issueKey) {
  var url = window.location.origin + '/?issue=' + encodeURIComponent(issueKey);
  function fallbackCopy() {
    var el = document.createElement('input');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('Link copied!');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() { toast('Link copied!'); }).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}

function copyDrawerLink() {
  // Use current issue key saved when drawer opened
  var issueKey = window._currentIssueKey || (window.S && S.drawerIssueId);
  copyIssueLinkByKey(issueKey);
}

// history.back() only QUEUES a navigation -- it doesn't wait for the
// resulting popstate. Two back-trigger clicks fired before that popstate
// lands (a real, easy-to-hit case: click the drawer's "Back" button, see no
// instant visual change while the event settles, click it again) both
// call history.back(), and browsers do not coalesce them -- the second one
// consumes a SECOND history entry, skipping past the intended destination
// entirely. This guard makes a second back-trigger click a no-op until the
// first one's popstate has actually been handled.
function _goBackOnce() {
  if (window._backPending) return;
  window._backPending = true;
  window.history.back();
}

// ── Browser back button support ─────────────────────────
// _navigatingBack used to be set true only around the last one or two
// statements, with the reset scheduled via a trailing setTimeout(fn, 0) --
// if ANYTHING earlier in this handler threw (closing the drawer, resolving
// the target space/tab, etc.), that setTimeout line was never reached and
// the flag stayed stuck true forever. Every popstate after that (including
// the browser's own native Back button, which doesn't go through
// _goBackOnce at all) hit the early-return at the top and did nothing --
// exactly a "first click does nothing" symptom, until something else
// happened to flip the flag back. try/finally guarantees the reset runs no
// matter which line throws.
window.addEventListener('popstate', function () {
  window._backPending = false;
  if (window._navigatingBack) return;
  window._navigatingBack = true;
  try {
    var issueKey = new URLSearchParams(window.location.search).get('issue');

    if (!issueKey && (S.drawerIssueId || document.body.classList.contains('issue-page'))) {
      stopDrawerLiveSync();
      window._drawerPending = {};
      _closeIssueDrawer();
    }

    if (issueKey) {
      var issueByKey = (S.data && S.data.issues || []).find(function (i) { return i.key === issueKey || i.id === issueKey; });
      openIssuePage(issueByKey ? issueByKey.id : issueKey, { skipHistory: true });
    } else {
      applyRouteFromUrl({ replaceUrl: true });
    }
  } finally {
    setTimeout(function () { window._navigatingBack = false; }, 0);
  }
});

// Same destination-resolving logic as goBackFromIssue's fallback branch, but
// never calls window.history.back() / relies on popstate at all -- see the
// comment on this button's onclick wiring in openIssuePage.
function closeIssueFromAllWork() {
  stopDrawerLiveSync();
  window._drawerPending = {};
  _closeIssueDrawer();
  var returnSpace = S._prevSpace || window._issueReturnSpace || S.currentSpace;
  window._issueReturnTab = null;
  window._issueReturnSpace = null;
  if (returnSpace) {
    navigateToSpace(returnSpace, 'allwork', { replaceUrl: true });
  } else {
    navigateTo('home', { replaceUrl: true });
  }
}
window.closeIssueFromAllWork = closeIssueFromAllWork;

// Copy issue URL and number to clipboard
window._copyIssueUrl = function() {
  var issueKey = $('drawerKey') && $('drawerKey').textContent;
  if (!issueKey) return;
  var url = window.location.origin + '/?issue=' + encodeURIComponent(issueKey);
  navigator.clipboard.writeText(url).then(function() {
    toast('Copied: ' + issueKey);
  }).catch(function(err) {
    alert('Failed to copy');
  });
};


// Show/hide description toolbars on focus
(function() {
  function initDescToolbars() {
    var fields = [
      { field: 'drawerDesc', toolbar: 'drawerDescToolbar' },
      { field: 'drawerFixDesc', toolbar: 'drawerFixDescToolbar' }
    ];
    fields.forEach(function(item) {
      var el = document.getElementById(item.field); if(!el) return;
      var tb = document.getElementById(item.toolbar);
      el._tbInit = true;
      if(tb) tb.classList.remove('active');
      el.addEventListener('focus', function() { if(tb) tb.classList.add('active'); }); el.addEventListener('blur', function() { setTimeout(function(){ if(tb) tb.classList.remove('active'); }, 200); });
    });
  }
  var origOpen = window.openDrawer;
  window.openDrawer = function(id) {
    origOpen && origOpen(id);
    setTimeout(initDescToolbars, 500);
  };
  document.addEventListener('DOMContentLoaded', function() { setTimeout(initDescToolbars, 500); });
})();
// Auto-linkify URLs
(function(){
  // Only bare URLs sitting in plain text become links. Deliberately DOM-based:
  // the previous version ran a regex over el.innerHTML, which matched URLs inside
  // attribute values too — a pasted Teams/Outlook anchor carries
  // title="https://…", so it produced title="<a href="…">…</a>", the quote closed
  // the attribute early, and every remaining attribute (id, rel, class="fui-Link
  // ___1q1shib …") spilled out as visible text. Worse, it compounded: each blur
  // re-ran over the already-broken markup. Walking text nodes and building the
  // anchor with createElement/textContent makes that class of bug impossible —
  // a URL can never be re-parsed as markup.
  var URL_RE = /https?:\/\/[^\s<>"']+/g;

  function linkifyTextNodes(root) {
    var doc = root.ownerDocument || document;
    var pending = [];
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node.nodeValue || node.nodeValue.indexOf('http') === -1) continue;
      // Never touch text that is already inside a link — that is what created
      // nested <a> tags and the mangling that followed.
      var inAnchor = false;
      for (var p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (p.nodeName === 'A') { inAnchor = true; break; }
      }
      if (!inAnchor) pending.push(node);
    }

    var changed = false;
    pending.forEach(function (node) {
      var text = node.nodeValue;
      URL_RE.lastIndex = 0;
      var frag = doc.createDocumentFragment();
      var last = 0, m;
      while ((m = URL_RE.exec(text)) !== null) {
        var url = m[0];
        // Don't swallow punctuation that merely follows the URL in a sentence.
        var trimmed = url.replace(/[.,;:!?)\]}'"]+$/, '');
        var start = m.index;
        if (start > last) frag.appendChild(doc.createTextNode(text.slice(last, start)));
        var a = doc.createElement('a');
        a.href = trimmed;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'color:#0129AC;text-decoration:underline;cursor:pointer';
        a.textContent = trimmed;      // never parsed as HTML
        frag.appendChild(a);
        last = start + trimmed.length;
        URL_RE.lastIndex = last;
        changed = true;
      }
      if (!changed && last === 0) return;
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return changed;
  }
  window._linkifyTextNodes = linkifyTextNodes;   // exported for tests

  function linkify(el,field){
    if(!el||el._lf)return;
    el._lf=true;
    el.addEventListener("blur",function(){
      if (linkifyTextNodes(el)) markDrawerDescDirty(el.id);
    });
  }
  function init(){
    linkify(document.getElementById("drawerDesc"),"description");
    linkify(document.getElementById("drawerFixDesc"),"fix_description");
  }
  var o=window.openDrawer;
  window.openDrawer=function(id){o&&o(id);setTimeout(init,700);};
  document.addEventListener("DOMContentLoaded",function(){setTimeout(init,700);});
})();

