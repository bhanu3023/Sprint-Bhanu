# /project:scaffold — Scaffold a New Express Route

Generate boilerplate for a new resource in server.js following the project's patterns.

## Usage
```
/project:scaffold $ARGUMENTS
```
Example: `/project:scaffold resource=time-reports`

## What Gets Generated

### List + Create routes template
```js
// GET /api/<resource>
app.get('/api/<resource>', authenticate, async (req, res) => {
  try {
    const { space_id } = req.query
    // space-member check
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
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/<resource>
app.post('/api/<resource>', authenticate, async (req, res) => {
  try {
    const { required_field, space_id } = req.body
    if (!required_field || !space_id) {
      return res.status(400).json({ error: 'required_field and space_id are required' })
    }
    // permission check ...
    const result = await pool.query(
      'INSERT INTO <table> (id, space_id, ..., created_at) VALUES ($1,$2,...,NOW()) RETURNING *',
      [generateId(), space_id, ...]
    )
    createNotif(...)  // fire-and-forget if needed
    await pool.query(
      'INSERT INTO audit_logs (space_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [space_id, req.user.id, 'created', '<entity>', result.rows[0].id, JSON.stringify({})]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

## Post-Scaffold Checklist
- [ ] Replace all `<table>` and `<entity>` placeholders
- [ ] Add to `GET /api/data` response if SPA needs it on startup
- [ ] Wire `createNotif()` for any user-facing event
- [ ] Register routes before the 404 catch-all in server.js
