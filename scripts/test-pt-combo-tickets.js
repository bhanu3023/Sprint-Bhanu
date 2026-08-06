/**
 * Create 2 Product_Team tickets with multi product-type + combination data
 * and verify round-trip storage (issues.product_type + Combination field).
 */
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE = process.env.APP_URL || 'http://localhost:3000';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sprintboard'
});

async function authAs(email) {
  const u = (await pool.query('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase()])).rows[0];
  if (!u) throw new Error('User not found: ' + email);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,NOW()+interval \'7 days\')',
    ['ses-' + crypto.randomUUID(), u.id, token]
  );
  return { token, userId: u.id };
}

async function api(token, path, method, body) {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  if (!r.ok) throw new Error(r.status + ' ' + path + ': ' + text);
  return json;
}

function parseStored(productType, combinationVal) {
  const sel = { productTypes: [], combinations: [] };
  if (combinationVal && String(combinationVal).trim().charAt(0) === '{') {
    const parsed = JSON.parse(combinationVal);
    if (parsed.v === 2) {
      sel.productTypes = parsed.productTypes || [];
      sel.combinations = parsed.combinations || [];
      return sel;
    }
  }
  if (productType) sel.productTypes = productType.split(',').map((s) => s.trim()).filter(Boolean);
  if (combinationVal && String(combinationVal).trim() && String(combinationVal).trim().charAt(0) !== '{') {
    sel.combinations = [combinationVal.trim()];
  }
  return sel;
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

const TICKETS = [
  {
    title: 'QA Multi-Type Test A — Message + Mail',
    product_type: 'Message,Email',
    combination: JSON.stringify({
      v: 2,
      productTypes: ['Message', 'Email'],
      combinations: ['Chat - Slack', 'Teams - Teams', 'Gmail - Gmail', 'Outlook - Outlook']
    }),
    expectTypes: ['Message', 'Email'],
    expectCombos: ['Chat - Slack', 'Teams - Teams', 'Gmail - Gmail', 'Outlook - Outlook']
  },
  {
    title: 'QA Multi-Type Test B — Content + Manage',
    product_type: 'Content,Manage',
    combination: JSON.stringify({
      v: 2,
      productTypes: ['Content', 'Manage'],
      combinations: ['Box - SharePoint', 'SharePoint - SharePoint']
    }),
    expectTypes: ['Content', 'Manage'],
    expectCombos: ['Box - SharePoint', 'SharePoint - SharePoint']
  }
];

(async () => {
  const email = process.env.TEST_EMAIL || 'manmadha.jayamangala@cloudfuze.com';
  const { token } = await authAs(email);

  const space = (await pool.query(
    "SELECT id, key FROM spaces WHERE name='Product_Team' OR key='PTM' LIMIT 1"
  )).rows[0];
  assert(space, 'Product_Team space not found');

  const comboField = (await pool.query(
    "SELECT id FROM custom_fields WHERE space_id=$1 AND LOWER(name)='combination' LIMIT 1",
    [space.id]
  )).rows[0];
  assert(comboField, 'Combination custom field not found');

  const created = [];

  for (const t of TICKETS) {
    const issue = await api(token, '/api/issues', 'POST', {
      space_id: space.id,
      title: t.title,
      type: 'task',
      priority: 'medium',
      status: 'To Do',
      product_type: t.product_type,
      reporter_id: (await pool.query('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase()])).rows[0].id
    });
    assert(issue.id, 'Issue create failed for ' + t.title);
    await api(token, '/api/issues/' + issue.id + '/field-values/' + comboField.id, 'PUT', {
      value: t.combination
    });
    created.push({ ...t, id: issue.id, key: issue.key });
    console.log('Created', issue.key, '—', t.title);
  }

  console.log('\n--- Verification ---\n');
  let allOk = true;

  for (const t of created) {
    const full = await api(token, '/api/issues/' + t.id);
    const cf = (full.custom_field_values || []).find(
      (v) => (v.field_name || '').toLowerCase() === 'combination' || v.field_id === comboField.id
    );
    const comboVal = cf ? cf.value : null;
    const parsed = parseStored(full.product_type, comboVal);

    const typesOk = t.expectTypes.every((x) => parsed.productTypes.indexOf(x) >= 0) &&
      parsed.productTypes.length === t.expectTypes.length;
    const combosOk = t.expectCombos.every((x) => parsed.combinations.indexOf(x) >= 0) &&
      parsed.combinations.length === t.expectCombos.length;

    console.log(t.key);
    console.log('  product_type DB:', full.product_type);
    console.log('  combination DB:', comboVal);
    console.log('  parsed types:  ', parsed.productTypes.join(', '));
    console.log('  parsed combos: ', parsed.combinations.join(', '));
    console.log('  types OK:', typesOk, '| combos OK:', combosOk);

    if (!typesOk || !combosOk) allOk = false;
  }

  console.log('\n' + (allOk ? '✅ All 2 tickets stored and verified correctly.' : '❌ Verification failed.'));
  await pool.end();
  process.exit(allOk ? 0 : 1);
})().catch(async (e) => {
  console.error(e.message || e);
  await pool.end();
  process.exit(1);
});
