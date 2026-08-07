/**
 * Central permission + safe SQL update helpers for server.js
 *
 * Role model (3 tiers):
 *   Org Admin  — users.role owner|admin — full org control, create spaces, assign Space Admins
 *   Space Admin — space_members.role site_admin — manage space, sprints, members (member only)
 *   Member     — space_members.role member — issues, comments, work; no sprints/reports/settings
 *
 * Legacy DB values manager/owner/viewer are normalized at check time.
 */

const ALLOWED_SPACE_ROLES = ['member', 'site_admin'];

const SPACE_ROLE_RANK = {
  member: 1,
  site_admin: 2
};

/** Minimum space role required per action (org admin bypasses). */
const ACTION_MIN_ROLE = {
  'issue.read': 'member',
  'issue.create': 'member',
  'issue.update': 'member',
  'issue.delete': 'site_admin',
  'issue.move': 'member',
  'issue.bulk': 'site_admin',
  'sprint.read': 'member',
  'sprint.manage': 'site_admin',
  'comment.create': 'member',
  'comment.update': 'member',
  'comment.delete': 'site_admin',
  'worklog.read': 'member',
  'worklog.create': 'member',
  'link.manage': 'member',
  'attachment.read': 'member',
  'attachment.upload': 'member',
  'custom_field.read': 'member',
  'custom_field.manage': 'site_admin',
  'filter.read': 'member',
  'filter.manage': 'member',
  'space_member.read': 'member',
  'space_member.manage': 'site_admin',
  'space.settings': 'site_admin',
  'report.view': 'site_admin',
  'roadmap.manage': 'member',
  'notification.read': 'member'
};

const UPDATE_WHITELIST = {
  spaces: ['name', 'key', 'description', 'icon', 'color', 'space_type', 'visibility', 'owner_id', 'is_archived', 'issue_counter'],
  spaces_space_admin: ['name', 'description', 'icon', 'color'],
  sprints: ['name', 'goal', 'start_date', 'end_date', 'status', 'velocity', 'position', 'developer_ids', 'qa_ids', 'public_holidays', 'developer_leaves'],
  issues: [
    'title', 'description', 'fix_description', 'type', 'status', 'priority', 'assignee_id', 'reporter_id',
    'sprint_id', 'parent_id', 'story_points', 'labels', 'start_date', 'due_date', 'original_estimate',
    'time_spent', 'team', 'product_type', 'position'
  ],
  roadmap_items: [
    'title', 'description', 'status', 'start_date', 'end_date', 'space_id', 'issue_id', 'color',
    'priority', 'assigned_to', 'group_name', 'category', 'milestone'
  ],
  custom_fields: ['name', 'field_type', 'options', 'is_required', 'position', 'show_in'],
  saved_filters: ['name', 'conditions', 'is_shared'],
  users_self: ['name', 'theme', 'color', 'avatar_url'],
  users_admin: ['name', 'email', 'role', 'is_active', 'theme', 'color', 'avatar_url']
};

/** Map legacy space roles to member | site_admin */
function normalizeSpaceRole(role) {
  if (!role) return 'member';
  const r = String(role).toLowerCase();
  if (r === 'site_admin' || r === 'manager' || r === 'owner' || r === 'admin') return 'site_admin';
  return 'member';
}

function isOrgAdmin(role) {
  return role === 'owner' || role === 'admin';
}

function pickAllowed(body, allowed) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

/** Build SET clause from whitelisted body keys only (values parameterized). */
function buildDynamicUpdate(tableKey, body, startParamIndex) {
  const allowed = UPDATE_WHITELIST[tableKey];
  if (!allowed) return null;
  const picked = pickAllowed(body, allowed);
  const keys = Object.keys(picked);
  if (!keys.length) return null;
  startParamIndex = startParamIndex || 2;
  const parts = [];
  const vals = [];
  keys.forEach(function (k, i) {
    if (k === 'options' && tableKey === 'custom_fields') {
      parts.push('options=$' + (startParamIndex + i) + '::jsonb');
      vals.push(JSON.stringify(Array.isArray(picked[k]) ? picked[k] : picked[k]));
    } else if (k === 'developer_leaves' && tableKey === 'sprints') {
      parts.push('developer_leaves=$' + (startParamIndex + i) + '::jsonb');
      vals.push(JSON.stringify(picked[k] && typeof picked[k] === 'object' ? picked[k] : {}));
    } else {
      parts.push(k + '=$' + (startParamIndex + i));
      vals.push(picked[k]);
    }
  });
  return { set: parts.join(','), vals: vals, keys: keys };
}

async function getSpaceMembership(q, userId, spaceId) {
  if (!spaceId || !userId) return null;
  const r = await q('SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, userId]);
  return r.rows[0]?.role || null;
}

async function getSpaceMemberRole(q, userId, spaceId) {
  const raw = await getSpaceMembership(q, userId, spaceId);
  return raw ? normalizeSpaceRole(raw) : null;
}

async function canActInSpace(q, user, spaceId, action) {
  if (!user || !spaceId) return false;
  if (isOrgAdmin(user.role)) return true;
  const minRole = ACTION_MIN_ROLE[action];
  if (!minRole) return false;
  const userId = user.id || user.user_id;
  const spaceRole = await getSpaceMemberRole(q, userId, spaceId);
  if (!spaceRole) return false;
  const have = SPACE_ROLE_RANK[spaceRole] ?? -1;
  const need = SPACE_ROLE_RANK[minRole] ?? 99;
  return have >= need;
}

/**
 * Validate role assignment for space_members POST/PUT.
 * Org admin: member or site_admin.
 * Space admin: member only (cannot create another space admin).
 */
async function validateSpaceRoleAssignment(q, user, spaceId, requestedRole) {
  const role = normalizeSpaceRole(requestedRole);
  if (!ALLOWED_SPACE_ROLES.includes(role)) {
    return { ok: false, error: 'Invalid space role. Use member or site_admin.' };
  }
  if (isOrgAdmin(user.role)) {
    return { ok: true, role: role };
  }
  const userId = user.id || user.user_id;
  const actorRole = await getSpaceMemberRole(q, userId, spaceId);
  if (actorRole !== 'site_admin') {
    return { ok: false, error: 'Forbidden' };
  }
  if (role === 'site_admin') {
    return { ok: false, error: 'Space admins cannot assign the Space Admin role. Ask an org admin.' };
  }
  return { ok: true, role: 'member' };
}

async function getIssueSpaceId(q, issueId) {
  const r = await q('SELECT space_id FROM issues WHERE id = $1 AND deleted_at IS NULL', [issueId]);
  return r.rows[0]?.space_id || null;
}

async function getSprintSpaceId(q, sprintId) {
  const r = await q('SELECT space_id FROM sprints WHERE id = $1', [sprintId]);
  return r.rows[0]?.space_id || null;
}

async function getCommentIssueSpaceId(q, commentId) {
  const r = await q(
    `SELECT i.space_id FROM comments c JOIN issues i ON i.id = c.issue_id WHERE c.id = $1`,
    [commentId]
  );
  return r.rows[0]?.space_id || null;
}

async function getCustomFieldSpaceId(q, fieldId) {
  const r = await q('SELECT space_id FROM custom_fields WHERE id = $1', [fieldId]);
  return r.rows[0]?.space_id || null;
}

async function getFilterSpaceId(q, filterId) {
  const r = await q('SELECT space_id FROM saved_filters WHERE id = $1', [filterId]);
  return r.rows[0]?.space_id || null;
}

async function getSpaceMemberRecord(q, memberId) {
  const r = await q('SELECT space_id, user_id, role FROM space_members WHERE id = $1', [memberId]);
  return r.rows[0] || null;
}

/** Space IDs the user is a member of (dashboard / activity feeds). */
async function getMemberSpaceIds(q, user) {
  if (!user) return [];
  const userId = user.id || user.user_id;
  const r = await q('SELECT space_id FROM space_members WHERE user_id=$1', [userId]);
  return r.rows.map(function (row) { return row.space_id; });
}

/** Space IDs the user may access (org admin → all active spaces). */
async function getVisibleSpaceIds(q, user) {
  if (!user) return [];
  if (isOrgAdmin(user.role)) {
    const r = await q('SELECT id FROM spaces WHERE is_archived=false');
    return r.rows.map(function (row) { return row.id; });
  }
  return getMemberSpaceIds(q, user);
}

function requireOrgAdmin(user, res) {
  if (!user || !isOrgAdmin(user.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

/** Express helper — returns false if denied (response already sent). */
async function denyUnlessCanAct(q, user, res, spaceId, action) {
  if (!spaceId) {
    res.status(400).json({ error: 'Space context required' });
    return false;
  }
  const ok = await canActInSpace(q, user, spaceId, action);
  if (!ok) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

module.exports = {
  ACTION_MIN_ROLE,
  ALLOWED_SPACE_ROLES,
  SPACE_ROLE_RANK,
  UPDATE_WHITELIST,
  isOrgAdmin,
  normalizeSpaceRole,
  pickAllowed,
  buildDynamicUpdate,
  getSpaceMembership,
  getSpaceMemberRole,
  canActInSpace,
  validateSpaceRoleAssignment,
  getIssueSpaceId,
  getSprintSpaceId,
  getCommentIssueSpaceId,
  getCustomFieldSpaceId,
  getFilterSpaceId,
  getSpaceMemberRecord,
  getMemberSpaceIds,
  getVisibleSpaceIds,
  requireOrgAdmin,
  denyUnlessCanAct
};

