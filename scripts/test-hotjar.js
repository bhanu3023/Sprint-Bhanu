#!/usr/bin/env node
// ===== SprintBoard — Hotjar loader tests =====
// Run: node scripts/test-hotjar.js
//
// Pure unit tests against a stub DOM: no server, no database, no network, no
// dev dependencies. Nothing here can reach static.hotjar.com — the assertions
// are about what the loader *would* request.

const path = require('path');
const hotjar = require(path.join(__dirname, '..', 'hotjar.js'));
const { initHotjar, identifyHotjarUser, HOTJAR_SCRIPT_ID, SUPPRESS_ATTR } = hotjar;

const results = { pass: 0, fail: 0 };

function check(name, ok, detail) {
  const suffix = detail ? ' — ' + detail : '';
  if (ok) { results.pass++; console.log('PASS  ' + name + suffix); }
  else { results.fail++; console.log('FAIL  ' + name + suffix); }
}

// ── Stub DOM ────────────────────────────────────────────────
// hotjar.js reads `window`/`document` off the global object at call time, so
// swapping these between scenarios gives each one a clean page.
let warnings = [];
const realWarn = console.warn;
console.warn = function (msg) { warnings.push(String(msg)); };

function newPage(appConfig) {
  const scripts = [];
  const head = { appendChild: function (el) { scripts.push(el); return el; } };
  global.document = {
    documentElement: head,
    body: { nodeType: 1 },
    addEventListener: function () {},
    getElementById: function (id) {
      for (const s of scripts) if (s.id === id) return s;
      return null;
    },
    createElement: function () { return { id: '', async: false, src: '' }; },
    getElementsByTagName: function (tag) { return tag === 'head' ? [head] : []; }
  };
  global.window = {};
  if (appConfig !== undefined) global.window.APP_CONFIG = appConfig;
  warnings = [];
  return scripts;
}

/** A stub element that records attribute writes, like a body-appended overlay. */
function fakeEl(attrs) {
  const own = attrs || {};
  return {
    nodeType: 1,
    attrs: own,
    hasAttribute: function (n) { return Object.prototype.hasOwnProperty.call(own, n); },
    setAttribute: function (n, v) { own[n] = v; }
  };
}

/** The queued hj() calls the vendor script would replay once it loads. */
function hjCalls() {
  const q = global.window.hj && global.window.hj.q;
  if (!q) return [];
  return Array.prototype.slice.call(q).map(function (a) { return Array.prototype.slice.call(a); });
}

const A_USER = { id: 'usr-abc', email: '  Ada.Lovelace@Example.COM ', role: 'admin' };

// ── 1. No Site ID → Hotjar never loads ──────────────────────
// Config absent entirely, plus the blank-ish shapes a real deploy produces
// (unset env var, whitespace-only env var).
const BLANKS = [
  ['config absent', undefined],
  ['config empty object', {}],
  ['empty string', { hotjarSiteId: '' }],
  ['whitespace only', { hotjarSiteId: '   ' }]
];

for (const pair of BLANKS) {
  const label = pair[0];
  const scripts = newPage(pair[1]);
  const loaded = initHotjar();
  check('No ID (' + label + '): initHotjar returns false', loaded === false, 'got ' + loaded);
  check('No ID (' + label + '): no script tag requested', scripts.length === 0, scripts.length + ' script(s)');
  check('No ID (' + label + '): window.hj undefined', typeof global.window.hj === 'undefined');
  check('No ID (' + label + '): no _hjSettings', typeof global.window._hjSettings === 'undefined');
  check('No ID (' + label + '): identify returns false', identifyHotjarUser(A_USER) === false);
  // Being switched off is the committed default, not a misconfiguration.
  check('No ID (' + label + '): stays silent (no warn)', warnings.length === 0, warnings.join(' | '));
}

// ── 2. Site ID set → exactly one script, idempotent ─────────
{
  const scripts = newPage({ hotjarSiteId: '1234567' });

  check('ID set: initHotjar returns true', initHotjar() === true);
  check('ID set: exactly one script tag', scripts.length === 1, scripts.length + ' script(s)');
  check('ID set: script carries the guard id', !!scripts[0] && scripts[0].id === HOTJAR_SCRIPT_ID, String(scripts[0] && scripts[0].id));
  check('ID set: script is async', !!scripts[0] && scripts[0].async === true);
  check('ID set: src is the real Hotjar URL',
    !!scripts[0] && scripts[0].src === 'https://static.hotjar.com/c/hotjar-1234567.js?sv=6',
    String(scripts[0] && scripts[0].src));
  check('ID set: src contains no NaN', !!scripts[0] && scripts[0].src.indexOf('NaN') === -1);

  // Matches Hotjar's own snippet, which treats hjid as numeric.
  check('ID set: _hjSettings.hjid is a Number', typeof global.window._hjSettings.hjid === 'number',
    typeof global.window._hjSettings.hjid);
  check('ID set: _hjSettings.hjid value', global.window._hjSettings.hjid === 1234567);
  check('ID set: _hjSettings.hjsv is 6', global.window._hjSettings.hjsv === 6);
  check('ID set: window.hj is callable', typeof global.window.hj === 'function');
  check('ID set: no warning', warnings.length === 0, warnings.join(' | '));

  // Both entry points calling in, StrictMode, HMR: a second snippet would mean
  // two recordings per page view.
  const again = initHotjar();
  check('Second init returns true (already loaded)', again === true);
  check('Second init injects nothing new — still one script tag',
    scripts.length === 1, scripts.length + ' script(s)');

  const third = initHotjar();
  check('Third init still one script tag', third === true && scripts.length === 1, scripts.length + ' script(s)');
}

// ── 3. identify: lowercased email + role ────────────────────
{
  newPage({ hotjarSiteId: '1234567' });
  initHotjar();

  const ok = identifyHotjarUser(A_USER);
  check('identify returns true when Hotjar is loaded', ok === true);

  const call = hjCalls().find(function (c) { return c[0] === 'identify'; });
  check('identify queued an hj("identify", ...) call', !!call, JSON.stringify(hjCalls()));
  if (call) {
    check('identify uses the stable user id as Hotjar User ID', call[1] === 'usr-abc', String(call[1]));
    check('identify lowercases (and trims) the email',
      !!call[2] && call[2].email === 'ada.lovelace@example.com', JSON.stringify(call[2]));
    check('identify passes role', !!call[2] && call[2].role === 'admin', JSON.stringify(call[2]));
  }

  // One person must not become two Hotjar users because of casing.
  newPage({ hotjarSiteId: '1234567' });
  initHotjar();
  identifyHotjarUser({ id: 'usr-abc', email: 'ADA.LOVELACE@EXAMPLE.COM', role: 'member' });
  const call2 = hjCalls().find(function (c) { return c[0] === 'identify'; });
  check('identify: differently-cased email yields the same attributes',
    !!call2 && call2[1] === 'usr-abc' && call2[2].email === 'ada.lovelace@example.com',
    JSON.stringify(call2 && call2[2]));

  // Falls back to the email when there is no id, still lowercased.
  newPage({ hotjarSiteId: '1234567' });
  initHotjar();
  identifyHotjarUser({ email: 'No.Id@Example.com' });
  const call3 = hjCalls().find(function (c) { return c[0] === 'identify'; });
  check('identify falls back to the lowercased email as User ID',
    !!call3 && call3[1] === 'no.id@example.com', String(call3 && call3[1]));

  // Nothing useful to identify with.
  check('identify(undefined) returns false', identifyHotjarUser(undefined) === false);
  check('identify({}) returns false', identifyHotjarUser({}) === false);
}

// ── 4. Malformed Site ID → warn and refuse ──────────────────
// A typo must not look identical to Hotjar being switched off, and must never
// request hotjar-NaN.js.
const MALFORMED = ['abc', '12ab', 'hotjar-123', '0', '12 34', '1.5', '-7', 'null'];

for (const bad of MALFORMED) {
  const shown = JSON.stringify(bad);
  const scripts = newPage({ hotjarSiteId: bad });
  const loaded = initHotjar();
  check('Malformed ID ' + shown + ': refuses to load', loaded === false, 'got ' + loaded);
  check('Malformed ID ' + shown + ': no script requested', scripts.length === 0, scripts.length + ' script(s)');
  check('Malformed ID ' + shown + ': window.hj undefined', typeof global.window.hj === 'undefined');
  check('Malformed ID ' + shown + ': warns exactly once', warnings.length === 1, warnings.join(' | '));
  check('Malformed ID ' + shown + ': warning names the bad value',
    warnings.length === 1 && warnings[0].indexOf(bad) !== -1, warnings[0] || '(none)');
  check('Malformed ID ' + shown + ': identify returns false', identifyHotjarUser(A_USER) === false);
}

// ── 5. A numeric (non-string) Site ID from config still works ─
{
  const scripts = newPage({ hotjarSiteId: 1234567 });
  check('Numeric config value loads', initHotjar() === true && scripts.length === 1);
  check('Numeric config value: hjid is a Number',
    global.window._hjSettings.hjid === 1234567 && typeof global.window._hjSettings.hjid === 'number');
}

// ── 6. Overlay suppression observer ─────────────────────────
// app.js appends dialogs, menus, pickers and lightboxes straight to <body>, so
// no static attribute in index.html can reach them. One observer covers them
// all. Ordering matters here: the observer is created at most once per page
// lifetime, so the "switched off" case has to run before the "on" case.
{
  const observers = [];
  global.MutationObserver = function (cb) {
    const self = { cb: cb, observed: null };
    self.observe = function (target, opts) { self.observed = { target: target, opts: opts }; };
    observers.push(self);
    return self;
  };

  // 6a. Hotjar off → nothing observed, nothing masked. Suppression is Hotjar's
  //     concern; with no recording there is nothing to suppress.
  newPage({ hotjarSiteId: '' });
  initHotjar();
  check('Observer: not started when Hotjar is off', observers.length === 0, observers.length + ' observer(s)');

  // 6b. Hotjar on → exactly one observer, watching direct children of <body>.
  const scripts = newPage({ hotjarSiteId: '1234567' });
  initHotjar();
  check('Observer: started when Hotjar loads', observers.length === 1, observers.length + ' observer(s)');
  const obs = observers[0];
  check('Observer: watches document.body', !!obs && obs.observed.target === global.document.body);
  check('Observer: childList only', !!obs && obs.observed.opts.childList === true);
  check('Observer: not subtree — never walks the app\'s own re-renders',
    !!obs && !obs.observed.opts.subtree, JSON.stringify(obs && obs.observed.opts));

  // A second init must not attach a second observer.
  initHotjar();
  check('Observer: second init adds no second observer', observers.length === 1, observers.length + ' observer(s)');
  check('Observer: second init adds no second script', scripts.length === 1, scripts.length + ' script(s)');

  // 6c. An overlay appearing gets suppressed; a text node is ignored; an
  //     element that already opted in is left alone.
  const overlay = fakeEl();
  const alreadySet = fakeEl({ 'data-hj-suppress': 'keep-me' });
  const textNode = { nodeType: 3 };
  obs.cb([{ addedNodes: [overlay, textNode, alreadySet, null] }]);

  check('Observer: body-appended overlay is suppressed',
    overlay.hasAttribute(SUPPRESS_ATTR), JSON.stringify(overlay.attrs));
  check('Observer: text nodes are ignored', textNode.nodeType === 3 && !textNode.attrs);
  check('Observer: existing attribute is not overwritten',
    alreadySet.attrs[SUPPRESS_ATTR] === 'keep-me', alreadySet.attrs[SUPPRESS_ATTR]);

  // Multiple mutation records in one batch.
  const a = fakeEl(), b = fakeEl();
  obs.cb([{ addedNodes: [a] }, { addedNodes: [b] }]);
  check('Observer: handles several mutation records at once',
    a.hasAttribute(SUPPRESS_ATTR) && b.hasAttribute(SUPPRESS_ATTR));

  // A record with no addedNodes must not throw.
  let threw = false;
  try { obs.cb([{}]); } catch (e) { threw = true; }
  check('Observer: tolerates a record with no addedNodes', threw === false);

  delete global.MutationObserver;
}

// ── 7. index.html carries the static suppression attributes ─
// Regression guard: these containers hold data belonging to someone other than
// us. app.js replaces their innerHTML but never the elements, so the attribute
// is what makes suppression survive every re-render.
{
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const MUST_BE_SUPPRESSED = [
    // Tier A — PII / third-party data
    'issueDrawer', 'adminSettingsContent', 'settingsTabContent', 'wlrContent',
    'sidebarUserFooter', 'topbarProfileHeader',
    // Tier B — issue free text at scale
    'allWorkTable', 'backlogContent', 'sprintBoard', 'yourWorkContent',
    'calendarGrid', 'reportContent', 'globalReportContent', 'mbrTabContent',
    'prmContent', 'summaryWidgets', 'favIssues', 'notifList', 'globalSearchDrop',
    // Modals carrying data that is not ours
    'modal-issue', 'modal-invite-member', 'modal-worklog', 'modal-confirm',
    'modal-invite-user', 'modal-reset-pw', 'modal-bulk-issue'
  ];

  for (const id of MUST_BE_SUPPRESSED) {
    const needle = 'id="' + id + '"';
    const at = html.indexOf(needle);
    if (at === -1) { check('index.html: #' + id + ' exists', false, 'id not found'); continue; }
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
    check('index.html: #' + id + ' is suppressed', tag.indexOf(SUPPRESS_ATTR) !== -1, tag.slice(0, 70));
  }

  // Chrome we deliberately left readable — masking it would make the
  // recordings useless without protecting anyone.
  const MUST_STAY_READABLE = ['breadcrumb', 'spacesList', 'summaryStats', 'summaryCharts'];
  for (const id of MUST_STAY_READABLE) {
    const needle = 'id="' + id + '"';
    const at = html.indexOf(needle);
    if (at === -1) { check('index.html: #' + id + ' exists', false, 'id not found'); continue; }
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
    check('index.html: #' + id + ' stays readable', tag.indexOf(SUPPRESS_ATTR) === -1, tag.slice(0, 70));
  }
}

// ── Summary ─────────────────────────────────────────────────
console.warn = realWarn;
const bar = '====================================================';
console.log('\n' + bar);
console.log('Hotjar loader: ' + results.pass + ' passed, ' + results.fail + ' failed');
console.log(bar);
process.exit(results.fail === 0 ? 0 : 1);
