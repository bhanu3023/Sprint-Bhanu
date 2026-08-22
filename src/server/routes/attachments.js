const { requireAuth } = require('../auth');
const { multer, path, uid, wrap } = require('../core');
const { q } = require('../db');
const { denyUnlessCanAct, getIssueSpaceId } = require('../deps');
const { app } = require('../express-app');
const { fs, uploadsDir, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, guardUploadSize } = require('../files');
// ── Attachments ───────────────────────────────────────────
app.get('/api/issues/:id/attachments', requireAuth, wrap(async (req, res) => {
  const spaceId = await getIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'attachment.read'))) return;
  const r = await q(`SELECT a.*, u.name AS uploader_name FROM issue_attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.issue_id=$1 ORDER BY a.created_at DESC`, [req.params.id]);
  res.json(r.rows);
}));

app.post('/api/issues/:id/attachments', requireAuth, (req, res, next) => {
  if (!multer) return res.status(503).json({ error: 'File upload not available' });
  if (!guardUploadSize(req, res)) return;
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES } });
  memUpload.array('files', 20)(req, res, async (err) => {
    if (err) { console.error('[attachments/upload]', err); return res.status(400).json({ error: 'Upload failed' }); }
    try {
      const spaceId = await getIssueSpaceId(q, req.params.id);
      if (!spaceId) return res.status(404).json({ error: 'Issue not found' });
      if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'attachment.upload'))) return;
        // multer only populates req.files for a multipart body, so a JSON POST
        // left it undefined and the loop below threw a TypeError -- surfacing as a
        // 500 on what is plainly a bad request. Same guard, same wording as the
        // sibling route at comments.js:71. The err.status work in errors.js cannot
        // cover this one: a TypeError carries neither a status nor a SQLSTATE.
        if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });
      const saved = [];
      for (const f of req.files) {
        const fileId = uid();
        await q(`INSERT INTO file_storage(id,original_name,mime_type,size,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)`,
          [fileId, f.originalname, f.mimetype, f.size, f.buffer, req.user.id]);
        const r = await q(`INSERT INTO issue_attachments(id,issue_id,filename,original_name,size,mime_type,uploaded_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [uid(), req.params.id, fileId, f.originalname, f.size, f.mimetype, req.user.id]);
        saved.push(r.rows[0]);
        await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
          VALUES($1,$2,$3,'attachment',NULL,$4)`,
          [uid(), req.params.id, req.user.id, f.originalname]);
      }
      res.status(201).json(saved);
    } catch(e) { next(e); }
  });
});

app.delete('/api/attachments/:id', requireAuth, wrap(async (req, res) => {
  const a = (await q('SELECT * FROM issue_attachments WHERE id=$1', [req.params.id])).rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.uploaded_by !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Cannot delete another user\'s attachment' });
  try { fs.unlinkSync(path.join(uploadsDir, a.filename)); } catch(_) {}
  try { await q('DELETE FROM file_storage WHERE id=$1', [a.filename]); } catch(_) {}
  await q('DELETE FROM issue_attachments WHERE id=$1', [req.params.id]);
  await q(`INSERT INTO issue_history(id,issue_id,user_id,field_name,old_value,new_value)
    VALUES($1,$2,$3,'attachment',$4,NULL)`,
    [uid(), a.issue_id, req.user.user_id, a.original_name]);
  res.json({ ok: true });
}));

// Rename attachment
app.patch('/api/attachments/:id', requireAuth, wrap(async (req, res) => {
  const { original_name } = req.body;
  if (!original_name) return res.status(400).json({ error: 'name required' });
  const a = (await q('SELECT * FROM issue_attachments WHERE id=$1', [req.params.id])).rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.uploaded_by !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'owner')
    return res.status(403).json({ error: 'Forbidden' });
  const r = await q('UPDATE issue_attachments SET original_name=$2 WHERE id=$1 RETURNING *', [req.params.id, original_name]);
  res.json(r.rows[0]);
}));

