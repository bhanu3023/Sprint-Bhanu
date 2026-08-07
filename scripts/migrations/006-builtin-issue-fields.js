/**
 * Add is_builtin + field_key to custom_fields and backfill built-in field rows per space.
 * Usage: node scripts/migrations/006-builtin-issue-fields.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { seedBuiltinIssueFields } = require('../../lib/builtin-issue-fields');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

const uid = () => crypto.randomUUID();

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS field_key VARCHAR
    `);

    const spaces = (await client.query(
      'SELECT id, name, key FROM spaces WHERE is_archived = false OR is_archived IS NULL ORDER BY name'
    )).rows;

    let totalAdded = 0;
    for (const sp of spaces) {
      const added = await seedBuiltinIssueFields(
        (sql, params) => client.query(sql, params),
        uid,
        sp.id,
        sp
      );
      totalAdded += added.length;
      if (added.length) console.log(sp.name + ': added ' + added.join(', '));
    }
    console.log('Done — seeded ' + totalAdded + ' built-in field row(s) across ' + spaces.length + ' space(s).');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
