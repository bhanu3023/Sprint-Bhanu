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

// ── Upload ceilings ───────────────────────────────────────
// The upload routes buffer each file wholly in memory (multer.memoryStorage)
// and then write the bytes into file_storage.data, a Postgres `bytea`.
//
// Both limits below are chosen so that nothing which currently SUCCEEDS starts
// failing; they only bound the cases that already could not work:
//
//   per file    1,073,741,823 bytes is the hard maximum size of a single bytea
//               value in Postgres. A larger file provably cannot be stored, so
//               rejecting it costs no working functionality. Measured before
//               this change: 150 MB uploaded in 1.8s and 600 MB in 11.6s (both
//               HTTP 200), while 1100 MB did not fail -- it hung past ten
//               minutes with the bytes buffered in RAM. That hang is the bug.
//
//   per request the browser already refuses more than 1 GiB total per upload
//               (ISSUE_MAX_TOTAL_ATTACH_BYTES), so no upload the UI permits is
//               affected. Without it, `files: 20` means one request could pin
//               20 x 1 GB in memory, and the per-file cap alone would not stop
//               it. The headroom above 1 GiB covers multipart framing overhead,
//               because Content-Length counts the envelope, not just the bytes.
const MAX_UPLOAD_FILE_BYTES = 1073741823;      // Postgres bytea hard maximum
const MAX_UPLOAD_REQUEST_BYTES = 1100000000;   // 1 GiB payload + multipart overhead
const MAX_UPLOAD_FILES = 20;

// Checked BEFORE multer parses, so an oversized request is refused on its
// Content-Length instead of being buffered into memory first. Returns false
// when it has already answered the request.
//
// The socket has to be torn down explicitly. Replying 413 alone is not enough:
// the client is mid-upload, so without closing the connection the response is
// not delivered until the body has been fully read -- which is exactly the
// gigabyte of buffering being avoided. Measured while getting this wrong: curl
// saw only "100 Continue" and sat for the full 120s timeout.
//
// end() rather than destroy(): the client is typically mid-upload behind an
// `Expect: 100-continue`, and destroy() is an abortive close that can discard
// the 413 still sitting in the socket buffer -- observed as an intermittent bare
// "100" on the client with no body. end() flushes the response, then sends FIN,
// so the client reliably reads the status before the connection goes away.
function guardUploadSize(req, res) {
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_UPLOAD_REQUEST_BYTES) {
    res.set('Connection', 'close');
    res.status(413).json({ error: 'Upload too large' });
    res.on('finish', () => { try { req.socket.end(); } catch (_) {} });
    return false;
  }
  return true;
}

const storage = multer ? multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uid() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
}) : null;
const upload = multer ? multer({ storage, limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES } }) : null;


module.exports = { fs, uploadsDir, getFileLinkedSpaceIds, denyUnlessCanAccessFile, sanitizeOrgRow, storage, upload,
  MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_FILES, guardUploadSize };
