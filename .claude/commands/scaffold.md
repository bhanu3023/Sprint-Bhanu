# /project:scaffold — Scaffold a New Resource

Generates boilerplate for a new API resource in server.js following project patterns.

## Usage
```
/project:scaffold $ARGUMENTS
```
Example: `/project:scaffold resource=labels`

## What Gets Created

### 1. List + Create routes
```js
// GET /api/<resource>?space_id=
app.get('/api/<resource>', authenticate, wrap(async (req, res) => {
  const { space_id } = req.query
  const member = await pool.query(
    'SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2',
    [space_id, req.user.id]
  )
  if (!member.rows[0] && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not a member of this space' })
  }
  const result = await pool.query(
    'SELECT * FROM <table> WHERE space_id=$1 ORDER BY created_at DESC',
    [space_id]
  )
  res.json(result.rows)
}))

// POST /api/<resource>
app.post('/api/<resource>', authenticate, wrap(async (req, res) => {
  const { name, space_id } = req.body
  if (!name || !space_id) {
    return res.status(400).json({ error: 'name and space_id are required' })
  }
  // space-member check ...
  const result = await pool.query(
    'INSERT INTO <table> (id, space_id, name, created_at) VALUES ($1,$2,$3,NOW()) RETURNING *',
    [uid(), space_id, name]
  )
  await pool.query(
    'INSERT INTO audit_logs (space_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [space_id, req.user.id, 'created', '<entity>', result.rows[0].id, JSON.stringify({ name })]
  )
  res.status(201).json(result.rows[0])
}))
```

### 2. Get + Update + Delete by ID
Same pattern with GET/:id, PUT/:id, DELETE/:id (soft-delete if issue-related).

## Post-Scaffold Checklist
- [ ] Replace all `<table>` and `<entity>` placeholders
- [ ] Add to `GET /api/data` if SPA needs it on startup
- [ ] Wire `createNotif()` for user-facing events
- [ ] Register routes before the 404 catch-all in server.js
- [ ] Add DB table to schema.sql
