# Permission Matrix

## Org-Level Roles
`owner` > `admin` > `member`
Stored in `users.role`.

## Space-Level Roles
`site_admin` > `manager` > `member` > `viewer`
Stored in `space_members.role` for the specific space.

---

## What Each Role Can Do

### Spaces (Projects)
| Action | owner | admin | manager | member | viewer |
|--------|-------|-------|---------|--------|--------|
| Create space | ✅ | ✅ | ❌ | ❌ | ❌ |
| Archive space | ✅ | ✅ | ✅ | ❌ | ❌ |
| Update space settings | ✅ | ✅ | ✅ | ❌ | ❌ |
| View space | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add/remove members | ✅ | ✅ | ✅ | ❌ | ❌ |

### Issues
| Action | owner | admin | manager | member | viewer |
|--------|-------|-------|---------|--------|--------|
| Create issue | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit any issue | ✅ | ✅ | ✅ | ✅* | ❌ |
| Delete (soft) issue | ✅ | ✅ | ✅ | own only | ❌ |
| Assign/reassign | ✅ | ✅ | ✅ | ✅ | ❌ |
| Change status | ✅ | ✅ | ✅ | ✅ | ❌ |
| View issues | ✅ | ✅ | ✅ | ✅ | ✅ |

*members can edit issues but cannot change `reporter_id`

### Sprints
| Action | owner | admin | manager | member | viewer |
|--------|-------|-------|---------|--------|--------|
| Create sprint | ✅ | ✅ | ✅ | ❌ | ❌ |
| Start sprint | ✅ | ✅ | ✅ | ❌ | ❌ |
| Complete sprint | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete sprint | ✅ | ✅ | ✅ | ❌ | ❌ |
| Move issues to sprint | ✅ | ✅ | ✅ | ✅ | ❌ |

### Comments
| Action | owner | admin | manager | member | viewer |
|--------|-------|-------|---------|--------|--------|
| Add comment | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit comment | ✅ | ✅ | own only | own only | ❌ |
| Delete comment | ✅ | ✅ | ✅ | own only | ❌ |

### Worklogs
| Action | owner | admin | manager | member | viewer |
|--------|-------|-------|---------|--------|--------|
| Log time | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit own worklog | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit others' worklog | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete own worklog | ✅ | ✅ | ✅ | ✅ | ❌ |
| Delete others' worklog | ✅ | ✅ | ❌ | ❌ | ❌ |

### Users & Invitations (Org-level, uses users.role)
| Action | owner | admin | member |
|--------|-------|-------|--------|
| Invite user | ✅ | ✅ | ❌ |
| Change user role | ✅ | ✅ | ❌ |
| Deactivate user | ✅ | ✅ | ❌ |
| Delete user | ✅ | ❌ | ❌ |
| Cancel invitation | ✅ | ✅ | ❌ |

## Permission Check Pattern in server.js
```js
// Org-level admin check
if (req.user.role !== 'admin' && req.user.role !== 'owner') {
  return res.status(403).json({ error: 'Forbidden' })
}

// Space membership check (for space-scoped data)
const member = await pool.query(
  'SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2',
  [spaceId, req.user.id]
)
if (!member.rows[0] && req.user.role !== 'admin') {
  return res.status(403).json({ error: 'Not a member of this space' })
}
const spaceRole = member.rows[0]?.role

// Manager-or-above check within space
if (!['site_admin', 'manager'].includes(spaceRole) && req.user.role !== 'admin') {
  return res.status(403).json({ error: 'Insufficient space permissions' })
}
```
