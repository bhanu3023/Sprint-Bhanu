require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const crypto = require('crypto');
const uid = () => crypto.randomUUID();

const EMAIL = process.env.NOTIF_EMAIL || 'manmadha.jayamangala@cloudfuze.com';
const COUNT = Math.min(parseInt(process.env.NOTIF_COUNT || '4', 10) || 4, 10);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const userRes = await client.query(
      'SELECT id, name, email FROM users WHERE LOWER(email) = $1',
      [EMAIL.toLowerCase()]
    );
    const user = userRes.rows[0];
    if (!user) {
      console.error('User not found:', EMAIL);
      process.exit(1);
    }

    const issueRes = await client.query(
      `SELECT i.id, i.key, i.title, i.space_id, s.key AS space_key
       FROM issues i
       JOIN spaces s ON s.id = i.space_id
       WHERE i.deleted_at IS NULL
         AND (
           i.assignee_id = $1
           OR i.reporter_id = $1
           OR EXISTS (
             SELECT 1 FROM space_members sm
             WHERE sm.space_id = i.space_id AND sm.user_id = $1
           )
         )
       ORDER BY i.updated_at DESC
       LIMIT 8`,
      [user.id]
    );
    const issues = issueRes.rows;
    const pick = (i) => issues[i] || issues[0] || null;
    const issueLink = (iss) => (iss ? '/?issue=' + encodeURIComponent(iss.key) : null);

    const spaceRes = await client.query(
      `SELECT s.id, s.key, s.name
       FROM spaces s
       JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = $1
       WHERE NOT s.is_archived
       ORDER BY s.name
       LIMIT 1`,
      [user.id]
    );
    const space = spaceRes.rows[0];
    const boardLink = space ? '/space/' + encodeURIComponent(space.key) + '/board' : null;

    const templates = [
      {
        type: 'status_changed',
        title: pick(0) ? pick(0).key + ' status changed to In Review' : 'Issue status updated',
        body: pick(0) ? pick(0).title : 'An issue you follow was moved to In Review.',
        link: issueLink(pick(0)),
        space_id: pick(0)?.space_id || null
      },
      {
        type: 'comment_added',
        title: pick(1) ? 'New comment on ' + pick(1).key : 'New comment on your issue',
        body: pick(1) ? 'Latest update: please review the new comment on ' + pick(1).title : 'Someone commented on an issue you follow.',
        link: issueLink(pick(1)),
        space_id: pick(1)?.space_id || null
      },
      {
        type: 'issue_assigned',
        title: pick(2) ? 'You were assigned to ' + pick(2).key : 'You were assigned a new issue',
        body: pick(2) ? pick(2).title : 'A new ticket was assigned to you.',
        link: issueLink(pick(2)),
        space_id: pick(2)?.space_id || null
      },
      {
        type: 'mention',
        title: pick(3) ? 'Alex mentioned you on ' + pick(3).key : 'You were mentioned in a comment',
        body: pick(3) ? '@you — can you take a look at ' + pick(3).title + '?' : 'You were @mentioned in a discussion.',
        link: issueLink(pick(3)),
        space_id: pick(3)?.space_id || null
      },
      {
        type: 'priority_changed',
        title: pick(4) ? pick(4).key + ' priority changed to highest' : 'Issue priority updated',
        body: pick(4) ? pick(4).title : 'Priority was updated on one of your issues.',
        link: issueLink(pick(4)),
        space_id: pick(4)?.space_id || null
      },
      {
        type: 'sprint_started',
        title: space ? 'Sprint 24 has started' : 'Sprint has started',
        body: space ? 'Active sprint is now open in ' + space.name + '.' : 'A sprint in your space has started.',
        link: boardLink,
        space_id: space?.id || null
      }
    ];

    const samples = templates.slice(0, COUNT);

    const inserted = [];
    for (const n of samples) {
      const id = uid();
      await client.query(
        `INSERT INTO notifications(id, user_id, space_id, type, title, body, link, is_read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
        [id, user.id, n.space_id, n.type, n.title, n.body, n.link]
      );
      inserted.push({ id, type: n.type, title: n.title, link: n.link });
    }

    console.log('Created ' + inserted.length + ' notifications for', user.email);
    inserted.forEach(function (n, i) {
      console.log((i + 1) + '. [' + n.type + '] ' + n.title);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
