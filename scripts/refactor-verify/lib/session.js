/**
 * Stable test session for the refactor verification harness.
 *
 * The same token must be reused across the baseline capture and every
 * post-phase capture, because fileApiUrl() embeds the live session token
 * directly into <img src> attributes -- a fresh token per run would make every
 * DOM snapshot differ for a reason that has nothing to do with the refactor.
 *
 * The token is a real credential, so it is stored OUTSIDE the repo (in the
 * OS temp dir) and never committed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const STORE = path.join(os.tmpdir(), 'sprintboard-refactor-verify-session.json');
const CONN = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sprintboard';

function pool() { return new Pool({ connectionString: CONN }); }

/** Returns { token, userId } — reuses the stored session while it is still valid. */
async function getSession() {
  const p = pool();
  try {
    if (fs.existsSync(STORE)) {
      const saved = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      const r = await p.query(
        'SELECT user_id FROM sessions WHERE token=$1 AND expires_at > NOW() + interval \'1 hour\'',
        [saved.token]
      );
      if (r.rows[0]) return saved;
    }
    const u = (await p.query(
      "SELECT id FROM users WHERE role IN ('owner','admin') AND is_active IS NOT FALSE ORDER BY role='owner' DESC LIMIT 1"
    )).rows[0];
    if (!u) throw new Error('No active owner/admin user found to build a verification session.');
    const token = crypto.randomBytes(32).toString('hex');
    await p.query(
      "INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,NOW()+interval '30 days')",
      ['ses-' + crypto.randomUUID(), u.id, token]
    );
    const rec = { token, userId: u.id };
    fs.writeFileSync(STORE, JSON.stringify(rec));
    return rec;
  } finally {
    await p.end();
  }
}

/**
 * Space keys used for space-scoped page captures, most-sprint-rich first.
 *
 * Ordering by sprint count matters: a space with zero sprints renders
 * "No sprints found." on the reports/board/MBR tabs, so capturing only such a
 * space would prove those renderers identical without ever running them.
 * Callers take the first key as the "primary" (real report data) and capture
 * additional keys for config diversity.
 */
async function rankedSpaceKeys(limit) {
  const p = pool();
  try {
    const r = await p.query(`
      SELECT s.key,
             COUNT(sp.id) FILTER (WHERE sp.deleted_at IS NULL) AS sprints,
             COUNT(DISTINCT i.id) FILTER (WHERE i.deleted_at IS NULL) AS issues
      FROM spaces s
      LEFT JOIN sprints sp ON sp.space_id = s.id
      LEFT JOIN issues  i  ON i.space_id  = s.id
      WHERE s.is_archived = false
      GROUP BY s.id, s.key
      ORDER BY sprints DESC, issues DESC, s.key
      LIMIT $1`, [limit || 2]);
    return r.rows.map(x => ({ key: x.key, sprints: Number(x.sprints), issues: Number(x.issues) }));
  } finally { await p.end(); }
}

/** Backwards-compatible single-key helper: the most sprint-rich space. */
async function pickSpaceKey() {
  const ranked = await rankedSpaceKeys(1);
  return ranked[0] ? ranked[0].key : null;
}

module.exports = { getSession, pickSpaceKey, rankedSpaceKeys, pool, CONN, STORE };
