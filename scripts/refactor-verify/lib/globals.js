/**
 * The list of global identifiers the client scripts are expected to create.
 *
 * WHY THIS EXISTS: Object.keys(window) does NOT see top-level `const`/`let`
 * bindings. In a classic <script>, `function f(){}` and `var x` become window
 * properties, but `const esc = ...` creates a binding in the global declarative
 * record instead -- reachable as `esc` from any script and from inline handlers,
 * but absent from Object.keys(window). Verified on the real baseline: S, esc,
 * escAttr, qs, qsa, cap and wrap are all invisible to Object.keys(window).
 *
 * Those are the most-used symbols in the codebase (esc has 103 call sites, $ has
 * 122, S is read by 151 functions), so a window-key diff alone would not notice
 * if the refactor lost them. capture.js therefore probes each name BY NAME in
 * page scope as well.
 *
 * Extraction is a column-0 regex rather than a real parser, because adding a
 * parser dependency to the repo is forbidden by the refactor constraints. That
 * is safe for this codebase: every top-level declaration in these files starts
 * at column 0. The count is asserted against the parser-derived figure from the
 * Phase 0 inventory (app.js: 453 functions + 86 var + 8 const = 547) so silent
 * drift in the regex is caught.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

// Files that contribute globals, in load order.
const SOURCES = ['combination-options.js', 'hotjar.js', 'app.js'];

const DECL = [
  /^function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^var\s+([A-Za-z_$][\w$]*)/,
  /^let\s+([A-Za-z_$][\w$]*)/,
  /^const\s+([A-Za-z_$][\w$]*)/,
  /^class\s+([A-Za-z_$][\w$]*)/
];

/**
 * NOTE on the window.* count: acorn reports 156 assignments for app.js, this
 * regex 155. The difference is `window[stateKey] = sel` (app.js:13471), a
 * COMPUTED assignment -- acorn surfaces the identifier `stateKey` as though it
 * were a literal property name, which it is not. 155 is the correct count of
 * statically-named props. The two real runtime props that line creates
 * (_issuePtComboSel, _drawerPtComboSel) are separately declared as top-level
 * `var`s, so they are already in the declared list and are also visible to
 * Object.keys(window) at runtime.
 *
 * @param {string} baseDir preferred directory for sources (normally the pristine
 *        snapshot dir, so the expectation is pinned to pre-refactor code). Files
 *        not present there fall back to the repo root -- correct for sources that
 *        this refactor does not split (combination-options.js, hotjar.js).
 */
function collect(baseDir) {
  const out = { byFile: {}, all: [], windowProps: [] };
  for (const f of SOURCES) {
    let p = path.join(baseDir, path.basename(f));
    if (!fs.existsSync(p)) p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const names = new Set();
    const winProps = new Set();
    for (const line of text.split('\n')) {
      for (const re of DECL) {
        const m = line.match(re);
        if (m) { names.add(m[1]); break; }
      }
      // window.foo = ... (any indentation; these are real window properties)
      const w = line.match(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/);
      if (w) winProps.add(w[1]);
    }
    out.byFile[f] = { declared: [...names].sort(), windowProps: [...winProps].sort() };
    // UNION of column-0 declarations AND window.* assignments. Declarations alone
    // missed two whole categories: hotjar.js declares nothing at column 0 (its
    // functions live inside an IIFE and are exported only as window.initHotjar /
    // window.identifyHotjarUser), and app.js has many window-only globals such as
    // _prmSetView that are assigned but never declared. Object.keys(window)
    // covers window props, so combined coverage held -- but [2b] was weaker than
    // its count suggested, so both categories are now probed by name.
    out.all.push(...names, ...winProps);
    out.windowProps.push(...winProps);
  }
  out.all = [...new Set(out.all)].sort();
  out.windowProps = [...new Set(out.windowProps)].sort();
  return out;
}

module.exports = { collect, SOURCES };
