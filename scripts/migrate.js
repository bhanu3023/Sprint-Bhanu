#!/usr/bin/env node
/**
 * Apply pending migrations without starting the server.
 *   npm run migrate           apply everything pending
 *   npm run migrate -- --status   show what is applied / pending, change nothing
 *
 * The server does this automatically at boot; this is for running migrations
 * ahead of a code deploy (all migrations are additive, so the currently
 * running release keeps working) or for recovering a failed deploy.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { runMigrations, ensureMigrationsTable, getAppliedIds, MIGRATIONS } = require('../lib/migrate');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : new Pool({ host: 'sprint-postgres', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres' });

(async () => {
  try {
    await pool.query('SELECT 1');

    if (process.argv.includes('--status')) {
      await ensureMigrationsTable(pool);
      const applied = await getAppliedIds(pool);
      console.log('');
      for (const m of MIGRATIONS) {
        console.log('  ' + (applied.has(m.id) ? '[applied]' : '[PENDING]') + '  ' + m.id + ' — ' + m.description);
      }
      const pending = MIGRATIONS.filter(m => !applied.has(m.id)).length;
      console.log('\n  ' + MIGRATIONS.length + ' total, ' + pending + ' pending.\n');
      await pool.end();
      process.exit(0);
    }

    const r = await runMigrations(pool);
    await pool.end();
    process.exit(r.failed ? 1 : 0);
  } catch (e) {
    console.error('[migrate] ' + e.message);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
  }
})();
