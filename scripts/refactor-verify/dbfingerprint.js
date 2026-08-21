/**
 * DB state fingerprint.
 *
 *   node scripts/refactor-verify/dbfingerprint.js <label>
 *   node scripts/refactor-verify/dbfingerprint.js --compare <labelA> <labelB>
 *
 * Per table: row count + max(updated_at/created_at) + a hash of the primary
 * keys. Used to prove that flows.js restores the database exactly, and to tell
 * a DOM diff caused by the REFACTOR apart from one caused by DATA DRIFT
 * (flows.js, the sprint auto-completer that runs every 60s, the retention
 * sweeper, or a human using the app between phases).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./lib/session');

const OUTDIR = path.join(__dirname, '..', '..', '.refactor-verify');

const TABLES = [
  'audit_logs', 'comments', 'custom_fields', 'file_storage', 'invitations',
  'issue_attachments', 'issue_favorites', 'issue_field_values', 'issue_history',
  'issue_links', 'issues', 'notifications', 'organizations', 'roadmap_colors',
  'roadmap_items', 'saved_filters', 'sessions', 'space_favorites',
  'space_members', 'spaces', 'sprints', 'users', 'worklogs'
];

async function fingerprint() {
  const p = pool();
  const out = {};
  try {
    for (const t of TABLES) {
      const cnt = (await p.query('SELECT COUNT(*)::int AS c FROM ' + t)).rows[0].c;
      // primary-key hash: detects add+delete pairs that leave the count unchanged
      let pkHash = null;
      try {
        const ids = (await p.query('SELECT id FROM ' + t + ' ORDER BY id')).rows.map(r => r.id).join(',');
        pkHash = crypto.createHash('sha1').update(ids).digest('hex').slice(0, 16);
      } catch (_) { pkHash = 'n/a'; } // composite-PK tables have no single id column
      let maxTs = null;
      for (const col of ['updated_at', 'created_at']) {
        try { maxTs = (await p.query('SELECT MAX(' + col + ') AS m FROM ' + t)).rows[0].m; break; } catch (_) {}
      }
      out[t] = { count: cnt, pkHash, maxTs: maxTs ? new Date(maxTs).toISOString() : null };
    }
  } finally { await p.end(); }
  return out;
}

function diff(a, b) {
  const rows = [];
  for (const t of TABLES) {
    const x = a[t] || {}, y = b[t] || {};
    if (x.count !== y.count || x.pkHash !== y.pkHash || x.maxTs !== y.maxTs) {
      rows.push({ table: t, before: x, after: y });
    }
  }
  return rows;
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (process.argv[2] === '--compare') {
    const [, , , A, B] = process.argv;
    const a = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'db-' + A + '.json'), 'utf8'));
    const b = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'db-' + B + '.json'), 'utf8'));
    const d = diff(a, b);
    console.log('=== DB fingerprint diff "' + A + '" -> "' + B + '" ===');
    if (!d.length) { console.log('  -> IDENTICAL (no data drift)'); process.exit(0); }
    d.forEach(r => {
      console.log('  ' + r.table);
      console.log('     count  ' + r.before.count + ' -> ' + r.after.count);
      if (r.before.pkHash !== r.after.pkHash) console.log('     pkHash ' + r.before.pkHash + ' -> ' + r.after.pkHash);
      if (r.before.maxTs !== r.after.maxTs) console.log('     maxTs  ' + r.before.maxTs + ' -> ' + r.after.maxTs);
    });
    console.log('  -> ' + d.length + ' table(s) drifted');
    process.exit(1);
  }
  const label = process.argv[2];
  if (!label) { console.error('usage: dbfingerprint.js <label> | --compare <a> <b>'); process.exit(2); }
  const fp = await fingerprint();
  fs.writeFileSync(path.join(OUTDIR, 'db-' + label + '.json'), JSON.stringify(fp, null, 1));
  const total = Object.values(fp).reduce((s, v) => s + v.count, 0);
  console.log('db fingerprint "' + label + '" written — ' + TABLES.length + ' tables, ' + total + ' rows total');
})().catch(e => { console.error('FINGERPRINT FAILED:', e); process.exit(1); });
