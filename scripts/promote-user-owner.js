require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const crypto = require('crypto');
const uid = () => crypto.randomUUID();

const EMAIL = process.env.PROMOTE_EMAIL || 'manmadha.jayamangala@cloudfuze.com';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT id, name, email, role FROM users WHERE LOWER(email) = $1',
      [EMAIL.toLowerCase()]
    );
    const user = userRes.rows[0];
    if (!user) {
      console.error('User not found:', EMAIL);
      process.exit(1);
    }

    await client.query(
      `UPDATE users SET role = 'owner' WHERE id = $1`,
      [user.id]
    );

    const spacesRes = await client.query(
      `SELECT id, key, name FROM spaces WHERE is_archived = false OR is_archived IS NULL ORDER BY name`
    );

    let upserted = 0;
    for (const space of spacesRes.rows) {
      const existing = await client.query(
        'SELECT id, role FROM space_members WHERE space_id = $1 AND user_id = $2',
        [space.id, user.id]
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE space_members SET role = 'site_admin' WHERE id = $1`,
          [existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO space_members(id, space_id, user_id, role) VALUES ($1, $2, $3, 'site_admin')`,
          [uid(), space.id, user.id]
        );
      }
      upserted++;
    }

    await client.query('COMMIT');

    console.log('Promoted to org owner:', user.email);
    console.log('Space memberships set to site_admin on', upserted, 'space(s):');
    spacesRes.rows.forEach(function (s) {
      console.log('  -', s.key, '(' + s.name + ')');
    });

    const verify = await client.query(
      `SELECT u.email, u.role AS org_role, s.key, sm.role AS space_role
       FROM users u
       LEFT JOIN space_members sm ON sm.user_id = u.id
       LEFT JOIN spaces s ON s.id = sm.space_id
       WHERE u.id = $1
       ORDER BY s.key`,
      [user.id]
    );
    console.log('\nVerified:');
    verify.rows.forEach(function (r) {
      console.log(' ', r.email, '| org:', r.org_role, '|', r.key || '—', '| space:', r.space_role || '—');
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
