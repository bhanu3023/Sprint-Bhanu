const { requireAuth, requireAuthFile } = require('../auth');
const { multer, uid, wrap } = require('../core');
const { pool, q } = require('../db');
const { denyUnlessCanAct, getCommentIssueSpaceId } = require('../deps');
const { app } = require('../express-app');
const { denyUnlessCanAccessFile, upload, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, guardUploadSize } = require('../files');
const { createNotif } = require('../notify');
// ── Comments ──────────────────────────────────────────────
app.post('/api/comments', requireAuth, wrap(async (req, res) => {
  const { issue_id, body, mentioned_user_ids } = req.body;
  if (!issue_id || !body) return res.status(400).json({ error: 'issue_id and body are required' });
  const issueRow = (await q('SELECT space_id, key, title, assignee_id, reporter_id FROM issues WHERE id=$1', [issue_id])).rows[0];
  if (!issueRow) return res.status(404).json({ error: 'Issue not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, issueRow.space_id, 'comment.create'))) return;
  const user_id = req.user.id;
  const r = await q('INSERT INTO comments(id,issue_id,user_id,body) VALUES($1,$2,$3,$4) RETURNING *',
    [uid(), issue_id, user_id, body]);
  const issue = (await q('SELECT * FROM issues WHERE id=$1', [issue_id])).rows[0];
  if (issue) {
    const commenter = user_id;
    const link = '/?issue=' + encodeURIComponent(issue.key || issue_id);
    const preview = body.length > 80 ? body.slice(0, 80) + '…' : body;
    const notifyUsers = new Set([issue.assignee_id, issue.reporter_id].filter(Boolean));
    notifyUsers.forEach(function(uid_) {
      if (uid_ !== commenter) {
        createNotif({ user_id: uid_, space_id: issue.space_id, type: 'comment_added',
          title: 'New comment on ' + (issue.key || issue_id),
          body: preview, link });
      }
    });
    // Notify @mentioned users (skip commenter; dedupe with comment recipients)
    const mentionIds = Array.isArray(mentioned_user_ids) ? mentioned_user_ids : [];
    if (mentionIds.length) {
      const commenterRow = (await q('SELECT name FROM users WHERE id=$1', [commenter])).rows[0];
      const commenterName = commenterRow?.name || 'Someone';
      const mentioned = new Set(mentionIds.filter(Boolean));
      mentioned.forEach(function(uid_) {
        if (uid_ === commenter) return;
        createNotif({ user_id: uid_, space_id: issue.space_id, type: 'mention',
          title: commenterName + ' mentioned you on ' + (issue.key || issue_id),
          body: preview, link });
      });
    }
  }
  res.status(201).json(r.rows[0]);
}));

app.put('/api/comments/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getCommentIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'comment.update'))) return;
  // ACTION_MIN_ROLE only answers "may this tier touch comments at all". The
  // action's own denial message (lib/permissions.js:64) reads "You can only
  // edit your own comments." -- it promised an ownership check that was never
  // implemented, so any space member could rewrite anyone's comment.
  // Ownership is row-level, so it belongs here where the row is, following the
  // live precedent for author-owned content at worklogs.js:47: the author, or
  // an org admin.
  const existing = (await q('SELECT user_id FROM comments WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'You can only edit your own comments.' });
  }
  const r = await q('UPDATE comments SET body=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.body, req.params.id]);
  res.json(r.rows[0]);
}));

app.delete('/api/comments/:id', requireAuth, wrap(async (req, res) => {
  const spaceId = await getCommentIssueSpaceId(q, req.params.id);
  if (!spaceId) return res.status(404).json({ error: 'Not found' });
  if (!(await denyUnlessCanAct(q, req.user, res, spaceId, 'comment.delete'))) return;
  // Same ownership rule as the PUT route just above, and for the same reason:
  // ACTION_MIN_ROLE only answers "may this tier touch comments at all" -- a
  // member should be able to delete their OWN comment, but not anyone else's,
  // so ownership is row-level and checked here where the row is. The author,
  // or an org admin, matching worklogs.js:47 and the PUT route's precedent.
  const existing = (await q('SELECT user_id FROM comments WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'You can only delete your own comments.' });
  }
  await q('DELETE FROM comments WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/comments/upload', requireAuth, (req, res) => {
  if (!upload) return res.status(503).json({ error: 'File upload not available' });
  if (!guardUploadSize(req, res)) return;
  const memStorage = multer.memoryStorage();
  const memUpload = multer({ storage: memStorage, limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES } });
  memUpload.array('files', 20)(req, res, async (err) => {
    if (err) { console.error('[comments/upload]', err); return res.status(400).json({ error: 'Upload failed' }); }
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });
    const files = [];
    for (const f of req.files) {
      const fileId = uid();
      await pool.query(
        `INSERT INTO file_storage (id, original_name, mime_type, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [fileId, f.originalname, f.mimetype, f.size, f.buffer, req.user.user_id]
      );
      files.push({ name: f.originalname, url: '/api/files/' + fileId, type: f.mimetype });
    }
    res.json({ files });
  });
});

app.get('/api/files/:id', requireAuthFile, wrap(async (req, res) => {
  if (!(await denyUnlessCanAccessFile(req.user, res, req.params.id))) return;
  const r = await pool.query('SELECT original_name, mime_type, data FROM file_storage WHERE id=$1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'File not found' });
  const { original_name, mime_type, data } = r.rows[0];
  res.setHeader('Content-Type', mime_type);
  res.setHeader('Content-Disposition', 'inline; filename="' + original_name.replace(/"/g, '') + '"');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(data);
}));

