# /project:audit-permissions — Scan Routes for Missing Permission Checks

Scans every route in server.js and flags ones that are missing authentication or authorization checks.

## Usage
```
/project:audit-permissions
```

## What It Checks

### Check 1 — Missing `authenticate` Middleware
Any `app.METHOD(path, async (req, res)` (no `authenticate` as second arg) that is not in the known-public whitelist:
**Known public routes:** `POST /api/auth/login`, `GET /auth/microsoft`, `GET /api/auth/callback/microsoft`, `GET /api/auth/invite/:token`, `POST /api/auth/accept-invite`

### Check 2 — Missing Space-Member Check
Routes that accept `space_id` as a param or query but do NOT contain a `space_members` query before returning data:
```
grep: pool.query('SELECT' ... 'FROM issues' without prior 'FROM space_members'
```

### Check 3 — Missing Org-Role Check for Admin Operations
Routes that create/delete users, change roles, or manage invitations without:
```js
if (req.user.role !== 'admin' && req.user.role !== 'owner')
```

### Check 4 — Worklog User Impersonation Risk
Any `POST /api/worklogs` or `PUT /api/worklogs` that uses `req.body.user_id` instead of `req.user.id` for the user_id column

### Check 5 — Missing Ownership Check on Delete
Routes that DELETE/soft-delete a resource without verifying the requester is the owner OR an admin — specifically comments, worklogs, attachments

## Output
```md
## Permission Audit — server.js

### ❌ Missing authenticate middleware
| Route | Method | Risk |
|-------|--------|------|

### ❌ Missing space-member check
| Route | Method | Risk |

### ❌ Missing org-role check
| Route | Method | Risk |

### ⚠️ Potential worklog impersonation
| Route | Line | Detail |

### ⚠️ Missing ownership check on delete
| Route | Line | Resource |

### ✅ Summary
X issues found. Y routes clean.
```
