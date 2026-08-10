/**
 * Migration runner — applies lib/migrations exactly once each, at server boot.
 *
 * Design notes:
 *  - Every applied id is recorded in schema_migrations, so restarts are cheap
 *    and a migration can never run twice. This is what makes auto-migrate at
 *    boot safe, unlike the old approach of re-running raw DDL on every start.
 *  - Each migration runs inside its own transaction: a failure rolls that
 *    migration back rather than leaving the schema half-changed.
 *  - A Postgres advisory lock serialises the whole run, so two app instances
 *    (or a restart racing a deploy) can't apply the same migration twice.
 *  - Failures are fatal by design. Continuing would boot code against a schema
 *    it doesn't match, which shows up as 500s on random endpoints; crashing is
 *    an unambiguous signal that the deploy did not take. Override with
 *    MIGRATE_ON_BOOT=warn if you would rather start anyway.
 */

const { MIGRATIONS } = require('./migrations');

// Arbitrary but fixed — must be identical in every process for the lock to work.
const ADVISORY_LOCK_KEY = 918273645;

// `runner` is anything with .query() — a pool or a specific client.
async function ensureMigrationsTable(runner) {
  await runner.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id          VARCHAR PRIMARY KEY,
    applied_at  TIMESTAMP DEFAULT NOW(),
    duration_ms INTEGER
  )`);
}

async function getAppliedIds(runner) {
  const r = await runner.query('SELECT id FROM schema_migrations');
  return new Set(r.rows.map(row => row.id));
}

/**
 * Apply all pending migrations.
 * @returns {Promise<{applied: string[], skipped: number, failed: string|null}>}
 */
async function runMigrations(pool, opts = {}) {
  const log = opts.logger || console;
  const result = { applied: [], skipped: 0, failed: null };

  const lockClient = await pool.connect();
  try {
    // Lock FIRST, before touching the schema at all. Concurrent
    // `CREATE TABLE IF NOT EXISTS` is not race-safe in Postgres — two sessions
    // creating the same table at once fail on pg_type_typname_nsp_index — so
    // even the bookkeeping table has to be created inside the lock.
    await lockClient.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(lockClient);

    // Read applied ids *after* taking the lock — another instance may have
    // finished migrating while this one was waiting for it.
    const applied = await getAppliedIds(lockClient);
    const pending = MIGRATIONS.filter(m => !applied.has(m.id));
    result.skipped = MIGRATIONS.length - pending.length;

    if (!pending.length) {
      log.log('[migrate] Up to date — ' + MIGRATIONS.length + ' migration(s) already applied.');
      return result;
    }

    log.log('[migrate] ' + pending.length + ' pending migration(s).');

    for (const m of pending) {
      const client = await pool.connect();
      const started = Date.now();
      try {
        await client.query('BEGIN');
        const detail = await m.up(client);
        const ms = Date.now() - started;
        await client.query(
          'INSERT INTO schema_migrations(id, duration_ms) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [m.id, ms]
        );
        await client.query('COMMIT');
        result.applied.push(m.id);
        log.log('[migrate]   applied ' + m.id + ' (' + ms + 'ms)' + (detail ? ' — ' + detail : ''));
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        result.failed = m.id;
        log.error('[migrate]   FAILED ' + m.id + ' — ' + e.message);
        log.error('[migrate]   rolled back; no partial schema change from this migration.');
        throw Object.assign(new Error('Migration ' + m.id + ' failed: ' + e.message), { migrationId: m.id });
      } finally {
        client.release();
      }
    }

    log.log('[migrate] Done — applied ' + result.applied.length + ', already present ' + result.skipped + '.');
    return result;
  } finally {
    try { await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch (_) {}
    lockClient.release();
  }
}

module.exports = { runMigrations, ensureMigrationsTable, getAppliedIds, MIGRATIONS, ADVISORY_LOCK_KEY };
