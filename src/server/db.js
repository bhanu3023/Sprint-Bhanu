require('dotenv').config();
const { Pool } = require('pg');
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : new Pool({ host: 'sprint-postgres', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres' });
pool.on('error', (err) => { console.error('[pg pool error] Client lost connection:', err.message); });
const q = (text, params) => pool.query(text, params);

module.exports = { pool, q };
