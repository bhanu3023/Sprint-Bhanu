require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sprintboard'
});

(async () => {
  const r = await pool.query(`
    SELECT s.name AS space_name, s.key AS space_key, cf.id, cf.name, cf.field_type, cf.show_in
    FROM custom_fields cf
    JOIN spaces s ON s.id = cf.space_id
    WHERE LOWER(cf.name) = 'combination' OR s.name = 'Product_Team'
    ORDER BY s.name, cf.name
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
})().catch(async (e) => {
  console.error(e.message);
  await pool.end();
  process.exit(1);
});
