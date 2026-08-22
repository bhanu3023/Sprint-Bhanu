/**
 * Backend test suite runner.   npm test
 *
 * Guarantees this runner enforces, rather than assumes:
 *
 *  1. FRESH CODE. It spawns its own server from this working tree on a
 *     dedicated port and verifies it is the only listener there. A stale
 *     process from an earlier run silently serving old code has burned this
 *     project before, so the run aborts rather than measure the wrong binary.
 *
 *  2. ISOLATION. tests/lib/fixture.js builds a whole organization -- users,
 *     spaces, sprints, issues -- with randomised keys, and nothing reads or
 *     writes a pre-existing row. ENG, PTM and real data are untouchable.
 *
 *  3. NO DRIFT. The db fingerprint is taken before setup and after teardown
 *     and must be IDENTICAL. Any row a test forgot to clean up fails the run.
 *     This is the check that keeps the suite runnable against a real database.
 *
 *  4. ORDER INDEPENDENCE. --shuffle randomises test order within each suite.
 *     Claiming independence without ever varying the order is just a hope, so
 *     CI should run it both ways.
 *
 *  5. HONEST ACCOUNTING. A test marked `knownBug` is reported in its own
 *     category. It never counts as a pass, and it never turns the run green.
 *
 * Flags:  --shuffle [seed]   --only <substring>   --keep (skip teardown)
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 3399);
const SUITE_DIR = path.join(__dirname, 'suites');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const flagVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const SHUFFLE = flag('--shuffle');
const ONLY = flagVal('--only');
const KEEP = flag('--keep');
const SEED = Number(flagVal('--shuffle')) || (SHUFFLE ? Math.floor(Math.random() * 1e9) : 0);

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const log = (s = '') => console.log(s);

// ── deterministic shuffle so a failing order can be replayed ──────────────
function shuffled(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── server lifecycle ─────────────────────────────────────────────────────
function listenersOn(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    return out.split(/\r?\n/)
      .filter(l => new RegExp(':' + port + '\\s').test(l) && /LISTENING/i.test(l))
      .map(l => l.trim().split(/\s+/).pop());
  } catch (_) { return []; }
}

function killPort(port) {
  for (const pid of new Set(listenersOn(port))) {
    if (!/^\d+$/.test(pid)) continue;
    try { execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' }); } catch (_) {}
  }
}

async function waitUp(port, ms = 45000) {
  const http = require('http');
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise(res => {
      const r = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2500 }, s => { s.resume(); res(s.statusCode > 0); });
      r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); r.end();
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

let child = null;
const serverLog = path.join(require('os').tmpdir(), 'sprintboard-test-server.log');

async function startServer(why) {
  killPort(PORT);
  await new Promise(r => setTimeout(r, 600));
  const before = listenersOn(PORT);
  if (before.length) throw new Error('port ' + PORT + ' still held by pid(s) ' + before.join(',') + ' -- refusing to test against an unknown process');

  const out = fs.openSync(serverLog, 'a');
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', out, out], detached: false, windowsHide: true
  });
  if (!(await waitUp(PORT))) throw new Error('server did not come up on port ' + PORT + ' (see ' + serverLog + ')');

  // [T1] exactly one listener -- proves we are not talking to a leftover.
  const after = listenersOn(PORT);
  if (new Set(after).size !== 1) throw new Error('expected exactly one listener on ' + PORT + ', found ' + after.join(','));
  return { pid: child.pid, why };
}

function stopServer() {
  if (child) { try { child.kill(); } catch (_) {} child = null; }
  killPort(PORT);
}

// ── db fingerprint (reuses the refactor-verify implementation) ────────────
function fingerprint(label) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'refactor-verify', 'dbfingerprint.js'), label],
    { cwd: ROOT, stdio: 'ignore' });
}
function fingerprintDiff(a, b) {
  try {
    const out = execFileSync(process.execPath,
      [path.join(ROOT, 'scripts', 'refactor-verify', 'dbfingerprint.js'), '--compare', a, b],
      { cwd: ROOT, encoding: 'utf8' });
    return { identical: /IDENTICAL/.test(out), out };
  } catch (e) {
    return { identical: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// ── main ─────────────────────────────────────────────────────────────────
(async () => {
  log();
  log(C.b + '=== SprintBoard backend test suite ===' + C.x);
  log('  port ' + PORT + (SHUFFLE ? '   shuffle seed ' + SEED : '   order: declaration') + (ONLY ? '   only: ' + ONLY : ''));

  const suites = fs.readdirSync(SUITE_DIR).filter(f => /\.js$/.test(f)).sort()
    .map(f => ({ file: f, mod: require(path.join(SUITE_DIR, f)) }));

  let ctx = null, started = null;
  let owned = { issues: [], sprints: [], spaces: [], worklogs: [] };
  const results = [];
  let fpBefore = 'test-before-' + crypto.randomBytes(3).toString('hex');
  let fpAfter = fpBefore.replace('before', 'after');
  let hardError = null;

  try {
    log();
    log(C.d + '  [fingerprint] recording the database state before setup' + C.x);
    fingerprint(fpBefore);

    started = await startServer('initial');
    log(C.d + '  [server] pid ' + started.pid + ' on ' + PORT + ', sole listener' + C.x);

    const { up, down } = require('./lib/fixture');
    const { makeClient } = require('./lib/http');
    let client = makeClient(PORT);

    ctx = await up();
    log(C.d + '  [fixture] org ' + ctx.orgId.slice(0, 12) + '...  tag ' + ctx.tag +
        '  space ' + ctx.spaceKey + '  6 users' + C.x);

    // Rows a test created and wants removed even if teardown-by-org misses them.
    const own = {
      issue: id => id && owned.issues.push(id),
      sprint: id => id && owned.sprints.push(id),
      space: id => id && owned.spaces.push(id),
      worklog: id => id && owned.worklogs.push(id)
    };

    for (const s of suites) {
      const suite = s.mod;
      let tests = suite.tests || [];
      if (ONLY) tests = tests.filter(t => (suite.name + ' ' + t.name).toLowerCase().includes(ONLY.toLowerCase()));
      if (!tests.length) continue;
      if (SHUFFLE) tests = shuffled(tests, SEED);

      log();
      log(C.b + '  ' + suite.name + C.x + C.d + '  (' + s.file + ', ' + tests.length + ' tests)' + C.x);

      for (const t of tests) {
        // Some tests need in-process state (the login throttle counters) reset.
        if (t.freshServer) {
          stopServer();
          started = await startServer(t.name);
          client = makeClient(PORT);
        }
        const t0 = Date.now();
        let status = 'pass', err = null;
        try {
          await t.fn(client, ctx, own);
        } catch (e) {
          status = t.knownBug ? 'knownbug' : 'fail';
          err = e;
        }
        if (status === 'pass' && t.knownBug) status = 'fixed';   // the bug is gone
        const ms = Date.now() - t0;
        results.push({ suite: suite.name, name: t.name, status, err, ms, knownBug: t.knownBug });

        const mark = { pass: C.g + '  ok  ' + C.x, fail: C.r + ' FAIL ' + C.x,
                       knownbug: C.y + ' BUG  ' + C.x, fixed: C.g + ' FIXED' + C.x }[status];
        log('   ' + mark + ' ' + t.name + C.d + '  ' + ms + 'ms' + C.x);
        if (status === 'fail') log('        ' + C.r + err.message + C.x);
        if (status === 'knownbug') log('        ' + C.y + 'known: ' + err.message + C.x);
      }
    }
  } catch (e) {
    hardError = e;
    log();
    log(C.r + '  HARD ERROR: ' + e.message + C.x);
  } finally {
    // Teardown must run even after a hard error, or the next run inherits rows.
    if (ctx && !KEEP) {
      try {
        const { down } = require('./lib/fixture');
        const d = await down(ctx, owned);
        log();
        log(C.d + '  [fixture] teardown removed ' + d.deleted + ' rows' + C.x);
        if (d.errors && d.errors.length) {
          log(C.r + '  [fixture] teardown hit ' + d.errors.length + ' error(s):' + C.x);
          d.errors.forEach(e => log(C.r + '      ' + e + C.x));
          hardError = hardError || new Error('teardown incomplete');
        }
      } catch (e) { log(C.r + '  teardown FAILED: ' + e.message + C.x); hardError = hardError || e; }
    } else if (KEEP) {
      log();
      log(C.y + '  [fixture] --keep: test data LEFT IN PLACE, fingerprint will differ' + C.x);
    }
    stopServer();
    try { const { pool } = require('./lib/fixture'); await pool.end(); } catch (_) {}
  }

  // ── drift check ────────────────────────────────────────────────────────
  let drift = { identical: true, out: 'skipped (--keep)' };
  if (!KEEP) {
    fingerprint(fpAfter);
    drift = fingerprintDiff(fpBefore, fpAfter);
  }

  // ── summary ────────────────────────────────────────────────────────────
  const by = (st) => results.filter(r => r.status === st);
  const pass = by('pass'), fail = by('fail'), bug = by('knownbug'), fixed = by('fixed');

  log();
  log(C.b + '  --- summary by category ---' + C.x);
  const cats = [...new Set(results.map(r => r.suite))];
  for (const cat of cats) {
    const rs = results.filter(r => r.suite === cat);
    const p = rs.filter(r => r.status === 'pass' || r.status === 'fixed').length;
    const f = rs.filter(r => r.status === 'fail').length;
    const k = rs.filter(r => r.status === 'knownbug').length;
    log('   ' + (f ? C.r : C.g) + String(p) + '/' + rs.length + C.x + '  ' + cat.padEnd(22) +
        (f ? C.r + f + ' failed  ' + C.x : '') + (k ? C.y + k + ' known bug' + C.x : ''));
  }

  log();
  log('   total   : ' + results.length + ' tests   ' +
      C.g + pass.length + ' passed' + C.x + '   ' +
      (fail.length ? C.r : C.d) + fail.length + ' failed' + C.x + '   ' +
      (bug.length ? C.y : C.d) + bug.length + ' known bugs' + C.x +
      (fixed.length ? '   ' + C.g + fixed.length + ' previously-known bugs now FIXED' + C.x : ''));
  log('   db drift: ' + (drift.identical ? C.g + 'none -- fingerprint identical before and after' + C.x
                                         : C.r + 'DETECTED -- the suite left rows behind' + C.x));
  if (!drift.identical && !KEEP) log(C.r + drift.out.split('\n').map(l => '     ' + l).join('\n') + C.x);

  if (fail.length) {
    log();
    log(C.r + '  --- failures ---' + C.x);
    fail.forEach(f => { log('   ' + C.r + f.suite + ' / ' + f.name + C.x); log('     ' + f.err.message); });
  }
  if (bug.length) {
    log();
    log(C.y + '  --- known bugs, reported and NOT fixed ---' + C.x);
    bug.forEach(b => { log('   ' + C.y + b.suite + ' / ' + b.name + C.x); log('     ' + b.knownBug); });
  }
  if (fixed.length) {
    log();
    log(C.g + '  --- a known bug now passes; remove its knownBug marker ---' + C.x);
    fixed.forEach(b => log('   ' + b.suite + ' / ' + b.name));
  }

  const green = !hardError && fail.length === 0 && drift.identical;
  log();
  log('  ' + (green ? C.g + C.b + 'RESULT: PASS' + C.x : C.r + C.b + 'RESULT: FAIL' + C.x) +
      (bug.length ? C.y + '  (with ' + bug.length + ' known, reported bug' + (bug.length > 1 ? 's' : '') + ')' + C.x : ''));
  if (SHUFFLE) log(C.d + '  replay this order with: npm test -- --shuffle ' + SEED + C.x);
  log();
  process.exit(green ? 0 : 1);
})();
