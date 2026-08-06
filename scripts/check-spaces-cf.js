require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sprintboard'
});
(async () => {
  const spaces = await pool.query("SELECT id, name, key FROM spaces WHERE name='Product_Team' OR key='PTM'");
  const cfs = await pool.query('SELECT id, space_id, name FROM custom_fields WHERE LOWER(name)=\'combination\'');
  console.log('Spaces:', JSON.stringify(spaces.rows, null, 2));
  console.log('Combination fields:', JSON.stringify(cfs.rows, null, 2));
  await pool.end();
})();
