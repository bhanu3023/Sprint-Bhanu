/**
 * PRE-FLIGHT — refuses to let a check measure yesterday's code.
 *
 *   node scripts/refactor-verify/preflight.js [--max-age-seconds N]
 *   require('./preflight').assertFreshServer(baseUrl)
 *
 * WHY THIS EXISTS
 * `pkill -f "server.js"` does not kill Windows node processes from Git Bash.
 * Ten stale servers accumulated during one session, the oldest kept holding
 * port 3000, and several "restart, then verify" steps silently measured code
 * from hours earlier. A green check that measures the wrong build is the same
 * class of defect as a gate that checks a deleted file, or a tamper test that
 * perturbs nothing: it reports success without testing the thing.
 *
 * Two independent assertions, because either alone can be fooled:
 *
 *   [P1] EXACTLY ONE LISTENER — one process, and only one, is bound to the
 *        port under test. More than one means an older server may be the one
 *        answering, and which one wins is not something the checks can see.
 *
 *   [P2] STARTED THIS RUN — the listening process is younger than the max age
 *        (default 900s). A server older than that predates the edit being
 *        verified, so a pass proves nothing about the current tree.
 *
 * Also reports [P3]: any OTHER node process running server.js, bound or not.
 * Those are not necessarily fatal -- a second extraction on another port is
 * legitimate -- but they are the population that produced the original bug,
 * so they are always printed.
 */
const { execFileSync } = require('child_process');

const DEFAULT_MAX_AGE_SECONDS = 900;

function portFromBase(base) {
  const m = String(base || '').match(/:(\d+)\s*$/) || String(base || '').match(/:(\d+)\//);
  if (m) return Number(m[1]);
  return /^https:/.test(base || '') ? 443 : 80;
}

// ── platform probes ───────────────────────────────────────────────────────
// `; exit 0` is load-bearing. Get-NetTCPConnection with no match leaves a
// non-zero exit status even under -ErrorAction SilentlyContinue, which made
// execFileSync throw. The catch below then treated "no listener at all" as an
// unreadable probe and PASSED -- fail-open, the exact defect this file exists
// to catch. An empty result must be an empty list, not an exception.
function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script + '; exit 0'],
    { encoding: 'utf8', timeout: 30000 });
}

function listenersWin(port) {
  const out = ps(
    '$c = Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue; ' +
    'if ($c) { $c | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique }'
  );
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number);
}

function processAgeSecondsWin(pid) {
  const out = ps(
    '$p = Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue; ' +
    'if ($p) { [int]((Get-Date) - $p.StartTime).TotalSeconds }'
  ).trim();
  return out ? Number(out) : null;
}

function serverProcessesWin() {
  const out = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'server\\.js' } | " +
    'ForEach-Object { "$($_.ProcessId)" }'
  );
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number);
}

function listenersPosix(port) {
  try {
    const out = execFileSync('sh', ['-c', "lsof -nP -iTCP:" + port + " -sTCP:LISTEN -t || true"],
      { encoding: 'utf8', timeout: 30000 });
    return [...new Set(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number))];
  } catch (_) { return []; }
}

function processAgeSecondsPosix(pid) {
  try {
    const out = execFileSync('sh', ['-c', 'ps -o etimes= -p ' + pid + ' 2>/dev/null || true'],
      { encoding: 'utf8', timeout: 30000 }).trim();
    return out ? Number(out) : null;
  } catch (_) { return null; }
}

const isWin = process.platform === 'win32';
const listeners = isWin ? listenersWin : listenersPosix;
const processAge = isWin ? processAgeSecondsWin : processAgeSecondsPosix;

// ── the assertion ─────────────────────────────────────────────────────────
function checkFreshServer(base, maxAgeSeconds) {
  const port = portFromBase(base);
  // Explicit undefined checks, not `||`. A max age of 0 is a legitimate value
  // (it means "nothing is fresh enough"), and `maxAgeSeconds || default` threw
  // it away as falsy -- so --max-age-seconds 0 silently used 900 and could not
  // fail anything.
  const maxAge = maxAgeSeconds !== undefined && maxAgeSeconds !== null && !Number.isNaN(maxAgeSeconds)
    ? Number(maxAgeSeconds)
    : (process.env.SB_MAX_SERVER_AGE !== undefined
      ? Number(process.env.SB_MAX_SERVER_AGE)
      : DEFAULT_MAX_AGE_SECONDS);
  const problems = [];
  const lines = [];

  let pids = [];
  try {
    pids = listeners(port);
  } catch (e) {
    // A probe that cannot run is not evidence of health. Fail, rather than
    // waving the checks through on no information.
    problems.push('could not enumerate listeners on port ' + port + ' (' + e.message.split('\n')[0] +
      ') -- cannot confirm which server would answer, so refusing to proceed');
    lines.push('  [P1] FAIL: listener probe errored on port ' + port);
    return { ok: false, skipped: false, lines, problems };
  }

  if (pids.length === 1) {
    lines.push('  [P1] exactly one listener on port ' + port + ' (pid ' + pids[0] + ')');
  } else if (pids.length === 0) {
    problems.push('nothing is listening on port ' + port + ' -- start the server before running checks');
    lines.push('  [P1] FAIL: no listener on port ' + port);
  } else {
    problems.push(pids.length + ' processes are listening on port ' + port + ' (' + pids.join(', ') +
      ') -- an older server may be answering; kill them and start exactly one');
    lines.push('  [P1] FAIL: ' + pids.length + ' listeners on port ' + port + ': ' + pids.join(', '));
  }

  if (pids.length === 1) {
    const age = processAge(pids[0]);
    if (age === null || Number.isNaN(age)) {
      lines.push('  [P2] could not read start time for pid ' + pids[0] + ' -- age not verified');
    } else if (age > maxAge) {
      problems.push('the server on port ' + port + ' started ' + age + 's ago (limit ' + maxAge +
        's) -- it predates this run, so a pass would not prove anything about the current tree');
      lines.push('  [P2] FAIL: listener is ' + age + 's old (limit ' + maxAge + 's)');
    } else {
      lines.push('  [P2] listener started ' + age + 's ago (within ' + maxAge + 's)');
    }
  }

  try {
    const all = isWin ? serverProcessesWin() : [];
    if (all.length > 1) {
      lines.push('  [P3] note: ' + all.length + ' node processes are running server.js (' + all.join(', ') +
        '). Legitimate only if they serve other ports.');
    } else if (all.length === 1) {
      lines.push('  [P3] one node server.js process total');
    }
  } catch (_) { /* informational only */ }

  return { ok: problems.length === 0, skipped: false, lines, problems };
}

function assertFreshServer(base, maxAgeSeconds) {
  const r = checkFreshServer(base, maxAgeSeconds);
  console.log('=== pre-flight: is the server under test actually this run\'s code? ===');
  r.lines.forEach(l => console.log(l));
  if (!r.ok) {
    console.log('');
    console.log('PRE-FLIGHT FAILED — refusing to run checks against a server that may not be this build:');
    r.problems.forEach(p => console.log('  - ' + p));
    process.exit(2);
  }
  console.log('  -> pre-flight OK\n');
}

module.exports = { checkFreshServer, assertFreshServer, portFromBase };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--max-age-seconds');
  const maxAge = i >= 0 ? Number(argv[i + 1]) : undefined;
  assertFreshServer(process.env.SB_BASE || 'http://localhost:3000', maxAge);
}
