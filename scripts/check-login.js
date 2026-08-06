require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const email = 'manmadha.jayamangala@cloudfuze.com';
  const users = await pool.query(`SELECT id, name, email, role, is_active FROM users WHERE LOWER(email) LIKE '%manmadha%'`);
  console.log('Users:', users.rows);

  const u = (await pool.query(`SELECT id, name, role, is_active FROM users WHERE LOWER(email)=$1`, [email])).rows[0];
  if (!u) { console.log('User not found — will be auto-created on Microsoft login'); await pool.end(); return; }

  const members = await pool.query(
    `SELECT s.key, s.name, sm.role FROM space_members sm JOIN spaces s ON s.id=sm.space_id WHERE sm.user_id=$1`,
    [u.id]
  );
  console.log('Memberships:', members.rows);

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,NOW()+interval '7 days')`,
    [`ses-${crypto.randomUUID()}`, u.id, token]);

  const me = await fetch('http://localhost:3000/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  console.log('/api/auth/me', me.status, me.ok ? await me.json() : await me.text());

  const data = await fetch('http://localhost:3000/api/data', { headers: { Authorization: 'Bearer ' + token } });
  console.log('/api/data', data.status);
  if (!data.ok) console.log(await data.text());
  else {
    const j = await data.json();
    console.log('spaces:', j.spaces?.length, 'issues:', j.issues?.length, 'notifications:', j.notifications?.length);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
