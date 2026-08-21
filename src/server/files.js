var __dirname = require("path").dirname(require.resolve("../../package.json"));
const { requireAuthFile } = require('./auth');
const { express, multer, path, uid, wrap } = require('./core');
const { q } = require('./db');
const { canActInSpace, denyUnlessCanAct, isOrgAdmin } = require('./deps');
const { app } = require('./express-app');

// Serve uploaded files (auth + space membership required)
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function getFileLinkedSpaceIds(fileId) {
  const spaces = new Set();
  const attach = await q(
    `SELECT DISTINCT i.space_id FROM issue_attachments a
     JOIN issues i ON i.id = a.issue_id AND i.deleted_at IS NULL
     WHERE a.filename = $1`, [fileId]
  );
  attach.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  const pattern = '%/api/files/' + fileId + '%';
  const fromIssues = await q(
    `SELECT DISTINCT space_id FROM issues
     WHERE deleted_at IS NULL AND (description LIKE $1 OR fix_description LIKE $1)`, [pattern]
  );
  fromIssues.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  const fromComments = await q(
    `SELECT DISTINCT i.space_id FROM comments c
     JOIN issues i ON i.id = c.issue_id AND i.deleted_at IS NULL
     WHERE c.body LIKE $1`, [pattern]
  );
  fromComments.rows.forEach(function (row) { if (row.space_id) spaces.add(row.space_id); });
  return Array.from(spaces);
}

async function denyUnlessCanAccessFile(user, res, fileId) {
  const spaceIds = await getFileLinkedSpaceIds(fileId);
  if (spaceIds.length) {
    for (let i = 0; i < spaceIds.length; i++) {
      if (await canActInSpace(q, user, spaceIds[i], 'attachment.read')) return true;
    }
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  const fr = await q('SELECT uploaded_by FROM file_storage WHERE id=$1', [fileId]);
  if (!fr.rows.length) {
    res.status(404).json({ error: 'File not found' });
    return false;
  }
  const userId = user.id || user.user_id;
  if (fr.rows[0].uploaded_by === userId || isOrgAdmin(user.role)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function sanitizeOrgRow(orgRow, admin) {
  if (!orgRow) return null;
  if (admin) return orgRow;
  const safe = Object.assign({}, orgRow);
  delete safe.email_settings;
  return safe;
}

app.use('/uploads', requireAuthFile, wrap(async (req, res, next) => {
  const filename = path.basename(decodeURIComponent(req.path || ''));
  if (!filename || filename === '/') return res.status(404).end();
  const attach = await q(
    `SELECT i.space_id FROM issue_attachments a
     JOIN issues i ON i.id = a.issue_id AND i.deleted_at IS NULL
     WHERE a.filename = $1 LIMIT 1`, [filename]
  );
  if (attach.rows[0]) {
    if (!(await denyUnlessCanAct(q, req.user, res, attach.rows[0].space_id, 'attachment.read'))) return;
    return next();
  }
  if (!isOrgAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}), express.static(uploadsDir));

// Multer storage config. No artificial size cap here — the practical ceiling is
// the upload routes below, which buffer the file in memory and store the bytes in
// file_storage.data (bytea, hard-capped at 1GB per value by Postgres).
const storage = multer ? multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uid() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
}) : null;
const upload = multer ? multer({ storage, limits: { fileSize: Infinity, files: Infinity } }) : null;


module.exports = { fs, uploadsDir, getFileLinkedSpaceIds, denyUnlessCanAccessFile, sanitizeOrgRow, storage, upload };
