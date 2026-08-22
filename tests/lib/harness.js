/**
 * Minimal test harness. No new dependency -- the project's standing invariant
 * is that package.json dependencies do not change, so this is deliberately
 * hand-rolled rather than jest/mocha.
 *
 * A suite is a module exporting { name, tests: [{ name, fn, knownBug? }] }.
 * Each `fn` receives the shared context (see tests/lib/fixture.js) and either
 * returns normally (pass) or throws (fail). There is no shared mutable state
 * between tests beyond the fixture world, which is created once per run and
 * is read-only from a test's point of view unless the test creates its own rows
 * and removes them.
 */

class AssertionError extends Error {}

function fail(msg) { throw new AssertionError(msg); }

const A = {
  eq(actual, expected, what) {
    if (actual !== expected) fail((what || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  },
  ne(actual, forbidden, what) {
    if (actual === forbidden) fail((what || 'value') + ': must not be ' + JSON.stringify(forbidden));
  },
  ok(cond, what) { if (!cond) fail(what || 'expected truthy'); },
  // Status assertions read better as their own helpers because almost every
  // test makes one, and the response body is the thing you need when it fails.
  status(res, expected, what) {
    if (res.status !== expected) {
      fail((what || 'status') + ': expected ' + expected + ', got ' + res.status +
           '  body=' + JSON.stringify(res.body).slice(0, 240));
    }
  },
  statusIn(res, list, what) {
    if (!list.includes(res.status)) {
      fail((what || 'status') + ': expected one of ' + list.join('/') + ', got ' + res.status +
           '  body=' + JSON.stringify(res.body).slice(0, 240));
    }
  },
  // A denial must be a denial, never a silent success and never a crash.
  denied(res, what) {
    if (res.status >= 200 && res.status < 300) fail((what || 'call') + ' was ALLOWED (' + res.status + ') but must be denied');
    if (res.status >= 500) fail((what || 'call') + ' returned ' + res.status + ' -- a denial must not be a server error. body=' + JSON.stringify(res.body).slice(0, 200));
  },
  noLeak(res, what) {
    const s = typeof res.raw === 'string' ? res.raw : JSON.stringify(res.body || '');
    if (/password_hash/i.test(s)) fail((what || 'response') + ' leaked password_hash');
    if (/smtp_pass|client_secret/i.test(s)) fail((what || 'response') + ' leaked a secret');
    if (/node:internal|\bat\s+\w+\s+\([A-Za-z]:[\\/]/.test(s)) fail((what || 'response') + ' leaked a stack trace');
    if (/duplicate key value|syntax error at or near|relation ".*" does not exist/i.test(s)) {
      fail((what || 'response') + ' leaked a raw postgres error: ' + s.slice(0, 160));
    }
  },
  includes(haystack, needle, what) {
    if (!String(haystack).includes(needle)) fail((what || 'string') + ': expected to contain ' + JSON.stringify(needle) + ', got ' + String(haystack).slice(0, 200));
  },
  excludes(haystack, needle, what) {
    if (String(haystack).includes(needle)) fail((what || 'string') + ': must NOT contain ' + JSON.stringify(needle) + ', got ' + String(haystack).slice(0, 200));
  }
};

module.exports = { A, AssertionError, fail };
