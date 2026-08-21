const { pool, q } = require('./db');
const { logDuplicateKeyWarning, logProductTeamCombinationStatus, runMigrations, startRetentionSweeper, startSprintAutoCompleter, validateSchemaReadOnly } = require('./deps');
const { app } = require('./express-app');
const { sprintDeps } = require('./notify');
// ── Startup (read-only — no DDL) ─────────────────────────
(async () => {
  try {
    await pool.query('SELECT 1');

    // Bring the schema up to what this build expects, before anything serves
    // traffic. Tracked in schema_migrations, so this is a no-op on every boot
    // after the first. MIGRATE_ON_BOOT=off skips it (apply manually with
    // `npm run migrate`); =warn starts the server even if a migration fails.
    const migrateMode = (process.env.MIGRATE_ON_BOOT || 'on').toLowerCase();
    if (migrateMode === 'off') {
      console.log('[migrate] Skipped (MIGRATE_ON_BOOT=off).');
    } else {
      try {
        await runMigrations(pool);
      } catch (e) {
        if (migrateMode === 'warn') {
          console.error('[migrate] Continuing despite failure (MIGRATE_ON_BOOT=warn):', e.message);
        } else {
          console.error('');
          console.error('  DEPLOY ABORTED — a database migration failed.');
          console.error('  ' + e.message);
          console.error('  The schema was rolled back to its previous state and no');
          console.error('  traffic was served. Fix the migration or restore the last');
          console.error('  release; data is unchanged.');
          console.error('');
          process.exit(1);
        }
      }
    }

    await validateSchemaReadOnly(pool);
    await logProductTeamCombinationStatus(pool, q);
    await logDuplicateKeyWarning(pool, q);

    console.log('==================================================');
    console.log('  SprintBoard Server');
    console.log('  Database connected (schema read-only at boot)');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log('  Listening on http://localhost:' + PORT);
      console.log('==================================================');
      // Started after listen so a slow first sweep never delays accepting traffic.
      startRetentionSweeper(q);
      startSprintAutoCompleter(sprintDeps);
    });
  } catch (e) {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
  }
})();
