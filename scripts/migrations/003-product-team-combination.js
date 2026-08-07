/**
 * Seed Combination custom field on Product_Team space (v2 grouped options).
 * Usage: node scripts/migrations/003-product-team-combination.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { buildCombinationOptionsPayload } = require('../../combination-options');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

function uid() {
  return crypto.randomUUID();
}

(async () => {
  const client = await pool.connect();
  try {
    const space = (await client.query(
      "SELECT id, key FROM spaces WHERE name = 'Product_Team' OR key = 'PTM' LIMIT 1"
    )).rows[0];
    if (!space) {
      console.log('Product_Team space not found — skipping.');
      return;
    }

    const options = buildCombinationOptionsPayload();
    const existing = (await client.query(
      "SELECT id, options FROM custom_fields WHERE space_id = $1 AND LOWER(name) = 'combination' LIMIT 1",
      [space.id]
    )).rows[0];

    if (existing) {
      let parsed = existing.options;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; }
      }
      if (parsed && parsed.v === 2 && parsed.groups) {
        console.log('OK — Combination field already exists on', space.key);
        return;
      }
      await client.query(
        'UPDATE custom_fields SET options = $1::jsonb, field_type = $2, show_in = $3 WHERE id = $4',
        [JSON.stringify(options), 'multi_select', ['drawer', 'create'], existing.id]
      );
      console.log('Updated Combination field options on', space.key);
      return;
    }

    await client.query(
      `INSERT INTO custom_fields(id, space_id, name, field_type, options, is_required, position, show_in)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        uid(),
        space.id,
        'Combination',
        'multi_select',
        JSON.stringify(options),
        false,
        10,
        ['drawer', 'create']
      ]
    );
    console.log('Created Combination field on Product_Team space (' + space.key + ')');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
