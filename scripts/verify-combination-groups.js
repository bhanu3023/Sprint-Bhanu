require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sprintboard'
});

(async () => {
  const r = await pool.query(
    "SELECT field_type, options FROM custom_fields WHERE LOWER(name)='combination' LIMIT 1"
  );
  const o = r.rows[0].options;
  console.log('field_type:', r.rows[0].field_type);
  console.log('v:', o.v);
  console.log('Message:', (o.groups.Message || []).length);
  console.log('Email:', (o.groups.Email || []).length);
  console.log('Content:', (o.groups.Content || []).length);
  console.log('Message samples:', (o.groups.Message || []).slice(0, 8).join(' | '));
  console.log('Email samples:', (o.groups.Email || []).join(' | '));
  await pool.end();
})().catch(async (e) => {
  console.error(e.message);
  await pool.end();
  process.exit(1);
});
