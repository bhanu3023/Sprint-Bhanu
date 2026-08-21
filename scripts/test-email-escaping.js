/**
 * Email HTML escaping — asserts FIX 3 and guards it against regression.
 *
 *   node scripts/test-email-escaping.js
 *
 * Two parts:
 *
 *   [A] escapeHtml behaviour, including the property that matters for "no
 *       user-visible change": text with no HTML metacharacters comes back
 *       byte-identical, so ordinary names and titles render exactly as before.
 *
 *   [B] a static audit of every ${...} interpolation inside the HTML bodies
 *       built in email.js, notify.js and routes/admin.js. Each one must either
 *       be wrapped in escapeHtml() or appear in ALLOWED below with a reason.
 *       Adding a new raw interpolation of untrusted data therefore fails here
 *       rather than silently shipping an injection.
 *
 * Subjects are deliberately NOT escaped and are excluded: a subject line is
 * plain text, so escaping it would put a literal "&amp;" in the user's inbox.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { escapeHtml } = require(path.join(ROOT, 'src', 'server', 'email.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('=== [A] escapeHtml behaviour ===');

// the five characters that can break out of an element or an attribute
ok('escapes &', escapeHtml('a & b') === 'a &amp; b', escapeHtml('a & b'));
ok('escapes <', escapeHtml('a < b') === 'a &lt; b', escapeHtml('a < b'));
ok('escapes >', escapeHtml('a > b') === 'a &gt; b', escapeHtml('a > b'));
ok('escapes "', escapeHtml('say "hi"') === 'say &quot;hi&quot;', escapeHtml('say "hi"'));
ok("escapes '", escapeHtml("O'Brien") === 'O&#39;Brien', escapeHtml("O'Brien"));

// & must be escaped first, or the other replacements get double-encoded
ok('no double-encoding', escapeHtml('<') === '&lt;', escapeHtml('<'));
ok('ampersand-first ordering', escapeHtml('&lt;') === '&amp;lt;', escapeHtml('&lt;'));

// the no-visible-change property: safe text is returned untouched
const safeSamples = [
  'Fix login redirect on Safari',
  'Manmadha Jayamangala',
  'Sprint 42 — velocity 31 points',
  'PROJ-1234 status changed from To Do to In Progress',
  'Neutara Technologies'
];
safeSamples.forEach(s => ok('unchanged: ' + s.slice(0, 34), escapeHtml(s) === s, escapeHtml(s)));

// real injection payloads must not survive as live markup
const payloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><a href="https://evil.example">click</a>',
  "</p><style>body{display:none}</style>",
  '<a href="javascript:alert(1)">x</a>'
];
payloads.forEach(p => {
  const out = escapeHtml(p);
  ok('neutralized: ' + p.slice(0, 30), !/<[a-zA-Z/]/.test(out), out.slice(0, 60));
});

// String(v), not ''-coercion: preserves what the templates rendered before
ok('undefined -> "undefined"', escapeHtml(undefined) === 'undefined', escapeHtml(undefined));
ok('null -> "null"', escapeHtml(null) === 'null', escapeHtml(null));
ok('number passthrough', escapeHtml(42) === '42', escapeHtml(42));

console.log('=== [B] static audit of HTML-body interpolations ===');

// Interpolations that are safe to leave raw, each with the reason it qualifies.
const ALLOWED = {
  'heading':   'literal chosen from two constants in this file',
  'msg':       'literal HTML from two constants in this file (contains <strong>)',
  'status':    'literal "Activated"/"Deactivated"',
  'color':     'hex colour from a local map / ternary',
  'safeUrl':   'already escapeHtml(inviteUrl) above',
  'bodyHtml':  'the composed body passed into emailWrapper',
  'activated ? `<div style="text-align:center;margin:24px 0"><a href="http://localhost:3000/login.html" style="background:#174F96;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Sign In Now</a></div>` : \'\'':
               'ternary between a literal block and empty string'
};

const FILES = ['src/server/email.js', 'src/server/notify.js', 'src/server/routes/admin.js'];

// Only audit template literals that actually build HTML: those containing a tag.
for (const rel of FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/<(h2|p|div|a|span|hr|strong)\b/.test(line)) return;      // not an HTML line
    if (/^\s*(\/\/|\*)/.test(line)) return;                        // comment
    const interps = line.match(/\$\{[^}]*\}/g) || [];
    interps.forEach(raw => {
      const expr = raw.slice(2, -1).trim();
      if (/^escapeHtml\(/.test(expr)) return;                      // escaped
      if (expr in ALLOWED) return;                                 // vetted literal
      if (/^body \? /.test(expr) && /escapeHtml\(body\)/.test(expr)) return; // guarded+escaped
      fail++;
      console.log('  FAIL: unescaped interpolation ' + rel + ':' + (i + 1));
      console.log('        ' + expr.slice(0, 120));
    });
  });
}
if (!fail) pass++;

// The specific values FIX 3 was about must be escaped somewhere in their file.
const emailSrc = fs.readFileSync(path.join(ROOT, 'src/server/email.js'), 'utf8');
const notifySrc = fs.readFileSync(path.join(ROOT, 'src/server/notify.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'src/server/routes/admin.js'), 'utf8');
ok('inviterName escaped', /escapeHtml\(inviterName\)/.test(emailSrc));
ok('orgName escaped in body', /escapeHtml\(orgName\)/.test(emailSrc));
ok('inviteUrl escaped', /escapeHtml\(inviteUrl\)/.test(emailSrc));
ok('user.name escaped x3', (emailSrc.match(/escapeHtml\(user\.name\)/g) || []).length === 3);
ok('newRole escaped', /escapeHtml\(newRole\)/.test(emailSrc));
ok('notif title escaped', /escapeHtml\(title\)/.test(notifySrc));
ok('notif body escaped', /escapeHtml\(body\)/.test(notifySrc));
ok('issueLink escaped', /escapeHtml\(issueLink\)/.test(notifySrc));
ok('admin test-email escaped', /escapeHtml\(req\.user\.name\)/.test(adminSrc));

// Subjects must stay raw — assert we did not over-escape them.
ok('invite subject raw', /You've been invited to join \$\{orgName\} on SprintBoard/.test(emailSrc));
ok('notif subject raw', /sendEmail\(toEmail, title, emailBody\)/.test(notifySrc));
ok('role subject raw', /role has been updated to \$\{newRole\}/.test(emailSrc));

console.log('\n====================================================');
console.log('Email escaping: ' + pass + ' passed, ' + fail + ' failed');
console.log('====================================================');
process.exit(fail ? 1 : 0);
