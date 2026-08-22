require('dotenv').config();
const { Pool } = require('pg');
// connectionTimeoutMillis bounds how long a request may wait for a pooled
// client. pg's default is 0, meaning WAIT FOREVER: once all `max` clients are
// checked out, further requests queue with no deadline, so a single slow query
// holding a client can hang requests indefinitely and the socket never answers.
//
// 10s is chosen from measurement, not convention. Acquisition latency against
// this database, pool max=10:
//     warm (idle client ready)   p50 0.0ms   p99 0.1ms
//     contended (queued at max)  p50 1.3ms   p99 18.8ms   max 18.8ms
//     cold (new tcp+auth)        p50 44ms    p99/max 181ms
// Worst acquisition observed anywhere was 181ms, so 10s is ~55x the measured
// ceiling. That headroom is deliberate: those numbers are local postgres with
// ssl:false, and a production cold connect additionally pays TLS handshake and
// network RTT, which are NOT measured here. 10s also stays under the usual 60s
// reverse-proxy read timeout, so the pool fails first and the caller gets a
// clean 500 from the route's catch instead of a hung connection.
const CONNECTION_TIMEOUT_MS = 10000;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS })
  : new Pool({ host: 'sprint-postgres', port: 5432, database: 'sprintboard', user: 'postgres', password: 'postgres', connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
pool.on('error', (err) => { console.error('[pg pool error] Client lost connection:', err.message); });
const q = (text, params) => pool.query(text, params);

module.exports = { pool, q };
