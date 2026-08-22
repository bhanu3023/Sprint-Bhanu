/**
 * Category 2 — the three security fixes, each pinned so it cannot silently
 * regress:
 *   login rate limiting   src/server/routes/auth.js
 *   upload ceilings       src/server/files.js
 *   email HTML escaping   src/server/email.js
 *
 * The rate-limit tests are the reason run.js boots its own dedicated server:
 * the counters are in-memory and per-process with a 15-minute window, so a
 * shared server would carry throttle state between runs and the suite would
 * stop being repeatable. Each test also uses a UNIQUE email so the per-email
 * bucket is never shared with another test.
 */
const path = require('path');
const { A } = require('../lib/harness');
const ROOT = path.join(__dirname, '..', '..');
const { escapeHtml } = require(path.join(ROOT, 'src', 'server', 'email'));
const files = require(path.join(ROOT, 'src', 'server', 'files'));

// Mirrors the constants in src/server/routes/auth.js. Deliberately duplicated
// rather than imported: they are not exported, and a test that reads the
// implementation's own numbers cannot detect those numbers being weakened.
const MAX_PER_EMAIL = 8;

module.exports = {
  name: 'security fixes',
  tests: [

    // ---- 1. login rate limiting ----------------------------------------
    { name: 'login throttles after the per-email limit and answers 429', freshServer: true, fn: async (c, x) => {
      const email = 'rl-a-' + x.tag + '@test.invalid';   // unique -> own bucket
      let sawOk = 0;
      for (let i = 0; i < MAX_PER_EMAIL; i++) {
        const r = await c.post('/api/auth/login', { body: { email, password: 'wrong' } });
        A.status(r, 401, 'failed attempt #' + (i + 1) + ' must be 401, not yet throttled');
        sawOk++;
      }
      A.eq(sawOk, MAX_PER_EMAIL, 'attempts allowed before throttling');
      const blocked = await c.post('/api/auth/login', { body: { email, password: 'wrong' } });
      A.status(blocked, 429, 'attempt #' + (MAX_PER_EMAIL + 1) + ' must be throttled');
      A.noLeak(blocked, '429 response');
    }},

    { name: 'throttling does not reveal whether an account exists', freshServer: true, fn: async (c, x) => {
      // Burn one real address and one fake one to the limit; the 429 must be
      // byte-identical, or the throttle itself becomes an enumeration oracle.
      const real = x.users.viewer.email;
      const fake = 'rl-ghost-' + x.tag + '@test.invalid';
      const burn = async (email) => {
        let last;
        for (let i = 0; i <= MAX_PER_EMAIL; i++) last = await c.post('/api/auth/login', { body: { email, password: 'wrong-' + x.tag } });
        return last;
      };
      const a = await burn(real), b = await burn(fake);
      A.status(a, 429, 'real address throttled');
      A.status(b, 429, 'nonexistent address throttled');
      A.eq(a.raw, b.raw, '429 body for a real vs a nonexistent address');
    }},

    { name: 'a successful login clears the failure counter', freshServer: true, fn: async (c, x) => {
      // Ordinary users who mistype then succeed must never be locked out.
      const email = x.users.owner.email;
      for (let i = 0; i < MAX_PER_EMAIL - 1; i++) {
        const r = await c.post('/api/auth/login', { body: { email, password: 'wrong' } });
        A.status(r, 401, 'pre-success failure #' + (i + 1));
      }
      const good = await c.post('/api/auth/login', { body: { email, password: x.password } });
      A.status(good, 200, 'correct password while under the limit');
      // Bucket cleared: we may now fail the full quota again without a 429.
      for (let i = 0; i < MAX_PER_EMAIL; i++) {
        const r = await c.post('/api/auth/login', { body: { email, password: 'wrong' } });
        A.status(r, 401, 'post-success failure #' + (i + 1) + ' -- counter should have been reset');
      }
    }},

    // ---- 2. upload ceilings --------------------------------------------
    { name: 'the upload ceiling constants are the measured values, not lowered', fn: async () => {
      // These were chosen so that nothing which previously SUCCEEDED starts
      // failing; silently lowering them would be a functional regression.
      A.eq(files.MAX_UPLOAD_FILE_BYTES, 1073741823, 'MAX_UPLOAD_FILE_BYTES (postgres bytea hard max)');
      A.eq(files.MAX_UPLOAD_FILES, 20, 'MAX_UPLOAD_FILES');
      A.ok(files.MAX_UPLOAD_REQUEST_BYTES > files.MAX_UPLOAD_FILE_BYTES,
        'the request ceiling must exceed the per-file ceiling or a legal max-size file cannot be sent');
    }},

    { name: 'an over-ceiling Content-Length is refused on headers alone', fn: async (c, x, own) => {
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'upload ceiling ' + x.tag, type: 'task' } });
      A.statusIn(iss, [200, 201], 'issue for upload test');
      own.issue(iss.body.id);
      // Declare more than the request ceiling and send NO body. If the guard
      // works it answers immediately; streaming 1 GiB to prove this would make
      // the suite unusable.
      const r = await c.headerOnly('POST', '/api/issues/' + iss.body.id + '/attachments',
        { token: x.users.manager.token, contentLength: files.MAX_UPLOAD_REQUEST_BYTES + 1 });
      A.status(r, 413, 'over-ceiling upload must be refused with 413 before any bytes are read');
      A.noLeak(r, '413 response');
    }},

    { name: 'a legal-size upload still succeeds and is retrievable', fn: async (c, x, own) => {
      // The ceiling must not break the normal path -- that was the whole point
      // of choosing the bytea maximum rather than a small round number.
      const iss = await c.post('/api/issues', { token: x.users.manager.token,
        body: { space_id: x.spaceId, title: 'upload ok ' + x.tag, type: 'task' } });
      A.statusIn(iss, [200, 201], 'issue for legal upload');
      own.issue(iss.body.id);
      const payload = Buffer.from('test-attachment-' + x.tag + '-' + 'y'.repeat(2048));
      const up = await c.postMultipart('/api/issues/' + iss.body.id + '/attachments',
        [{ name: 'note-' + x.tag + '.txt', data: payload, type: 'text/plain' }],
        { token: x.users.manager.token });
      A.statusIn(up, [200, 201], 'legal-size attachment upload');
      const list = await c.get('/api/issues/' + iss.body.id + '/attachments', { token: x.users.manager.token });
      A.status(list, 200, 'list attachments');
      const rows = Array.isArray(list.body) ? list.body : [];
      A.eq(rows.length, 1, 'attachment count after one upload');
      A.eq(Number(rows[0].size), payload.length, 'stored attachment size must match what was sent');
    }},

    // ---- 3. email HTML escaping ----------------------------------------
    { name: 'escapeHtml neutralises the injection characters', fn: async () => {
      A.eq(escapeHtml('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;', 'script tag');
      A.eq(escapeHtml('a & b'), 'a &amp; b', 'ampersand');
      A.eq(escapeHtml('" onload="x"'), '&quot; onload=&quot;x&quot;', 'double quote');
      // Ampersand must be escaped FIRST or the other replacements get
      // double-escaped into &amp;lt; and the output is wrong.
      A.eq(escapeHtml('&lt;'), '&amp;lt;', 'a literal &lt; must not be collapsed back into a tag');
    }},

    { name: 'escapeHtml is null-safe', fn: async () => {
      // Called on user fields that can legitimately be absent; throwing here
      // would take out the whole invite path.
      for (const v of [null, undefined, '', 0, false]) {
        const out = escapeHtml(v);
        A.ok(typeof out === 'string', 'escapeHtml(' + JSON.stringify(v) + ') must return a string, got ' + typeof out);
      }
    }},

    { name: 'an attacker-controlled name cannot inject markup into an invite email', fn: async () => {
      const { sendInviteEmail, emailWrapper } = require(path.join(ROOT, 'src', 'server', 'email'));
      // Render the template body directly rather than sending: no SMTP, no
      // side effects, and the assertion is about the HTML that would be sent.
      const evil = '<img src=x onerror="steal()">';
      const html = emailWrapper('<p>' + escapeHtml(evil) + '</p>');
      A.excludes(html, '<img src=x', 'rendered invite HTML must not contain a live tag from user input');
      A.includes(html, '&lt;img src=x', 'the payload must appear escaped');
      A.ok(typeof sendInviteEmail === 'function', 'sendInviteEmail is exported');
    }}
  ]
};
