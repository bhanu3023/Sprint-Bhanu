/**
 * DOM-snapshot normalization.
 *
 * A byte-diff of document.body.innerHTML is only meaningful if genuinely
 * volatile values are masked first. Everything masked here is time-, token- or
 * random-derived; nothing structural (tags, classes, ids, attributes, text) is
 * touched, so a real refactor regression still shows up as a diff.
 *
 * Each rule states WHY it is volatile. If a rule ever masks something
 * structural, the harness stops being able to detect a regression there -- so
 * the rules are deliberately narrow and anchored.
 */

const RULES = [
  // Session token embedded in every /api/files/<id>?t=<token> src by fileApiUrl().
  [/(\?t=)[a-f0-9]{16,}/g, '$1<TOKEN>'],
  // ISO timestamps rendered into title/datetime attributes.
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<ISO>'],
  // Optimistic-UI ids: 'temp-' + Date.now().
  [/temp-\d{10,}/g, 'temp-<TS>'],
  // Relative-time text. relativeTime() (app.js:541) emits exactly:
  //   'just now' | '<n>m ago' | '<n>h ago' | '<n>d ago' | fmtDate(d) beyond 30d.
  // Only the elapsed-time forms are volatile; the fmtDate fallback is stable.
  [/\b\d+[mhd] ago\b/g, '<RELTIME>'],
  [/\bjust now\b/gi, '<RELTIME>'],
  // Long-form elapsed text, in case any other call site renders it that way.
  [/\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, '<RELTIME>'],
  // Bare epoch-millis appearing in generated ids/keys.
  [/\b17\d{11}\b/g, '<EPOCHMS>'],
  // Sprint Summary's "Last Updated" stamp is a literal `new Date()` wall clock
  // (app.js:6512 nowStr, en-GB 'DD MMM YYYY HH:MM'), so it changes every minute.
  // Anchored on the label so it cannot mask any stored/structural date.
  [/(Last Updated: )\d{2} \w{3} \d{4} \d{2}:\d{2}/g, '$1<NOW>'],
  // uuid-shaped values are stable per row, but a freshly created row differs;
  // keep them (structural) EXCEPT inside our own harness-created markers.
  // (no rule -- documented intentionally so a future reader knows uuids are kept)
];

function normalizeHtml(html) {
  let out = String(html == null ? '' : html);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

/** Split into lines for readable diffing of very long single-line HTML. */
function toDiffableLines(html) {
  return normalizeHtml(html)
    .replace(/></g, '>\n<')
    .split('\n');
}

module.exports = { normalizeHtml, toDiffableLines, RULES };
