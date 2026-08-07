/**
 * Add sprints.developer_leaves (jsonb) for per-developer leave tracking.
 * Usage: node scripts/migrations/005-sprint-developer-leaves.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '005-sprint-developer-leaves.sql'), 'utf8');
    await pool.query(sql);
    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sprints' AND column_name='developer_leaves'`
    )).rows;
    console.log(cols.length ? 'OK — sprints.developer_leaves exists' : 'FAILED — column still missing');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
