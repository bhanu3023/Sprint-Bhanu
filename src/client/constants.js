
// ═══════════════════════════════════════════════════════════
// CONSTANTS: STATUSES, PRIORITIES, TYPES
// ═══════════════════════════════════════════════════════════
// ── Schema-owned enumerations ─────────────────────────────
// These three lists are fixed by CHECK constraints on the issues table
// (issues_status_check / issues_type_check / issues_priority_check). They are NOT
// admin-configurable: a value outside these sets is rejected by the database, so
// every menu, filter and report must read them from here.
//
// They were previously hardcoded in a dozen places and had already drifted:
//   - the All Work inline status menu omitted 'Blocked', so a blocked ticket
//     showed no current-status tick and could not be set from there;
//   - the All Work priority filter offered 'critical' (matches nothing, the enum
//     has no such value) and omitted 'highest' and 'lowest' entirely, so the
//     top and bottom priorities could not be filtered at all.
// Keep in step with db/schema.sql if a constraint ever changes.
var ISSUE_STATUSES   = ['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'];
var ISSUE_TYPES      = ['epic', 'story', 'task', 'bug', 'subtask'];
var ISSUE_PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
// {v,l} option lists for the filter/menu builders.
function enumOpts(values) {
  return values.map(function (v) { return { v: v, l: cap(v) }; });
}

var STATUS_COLORS = {
  'To Do': '#42526e',
  'In Progress': '#0052cc',
  'In Review': '#ff991f',
  'Done': '#00875a',
  'Blocked': '#dc2626'
};
var PRIORITY_COLORS = {
  highest: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6', lowest: '#6b7280'
};
var PRIORITY_ICONS = {
  highest: '\u2B06\u2B06', high: '\u2B06', medium: '\u2B1B', low: '\u2B07', lowest: '\u2B07\u2B07'
};
var TYPE_ICONS = {
  // Standalone glyph family (no badge). Sized on a 16x16 grid because that is
  // where they are read — board cards, table rows, the drawer type picker.
  epic: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M9.6 1.6 4.2 9.1h3.2l-.9 5.6 5.5-7.6H8.9z" fill="#6554C0"/></svg>', story: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4.4 2.2h7.2v11.6L8 11l-3.6 2.8z" fill="#36B37E"/></svg>', task: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="3.4" fill="none" stroke="#0052CC" stroke-width="1.7"/><path d="M4.9 8.2 7.1 10.4 11.2 5.9" stroke="#0052CC" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', bug: '<svg width="16" height="16" viewBox="0 0 16 16"><ellipse cx="8" cy="9.2" rx="5" ry="5.6" fill="#E5493A"/><path d="M3 9.2a5 5.6 0 0 1 10 0z" fill="#D93A2B"/><circle cx="8" cy="3.5" r="2.3" fill="#22252A"/><line x1="6.6" y1="1.8" x2="5.4" y2="0.7" stroke="#22252A" stroke-width="1" stroke-linecap="round"/><line x1="9.4" y1="1.8" x2="10.6" y2="0.7" stroke="#22252A" stroke-width="1" stroke-linecap="round"/><line x1="8" y1="4.4" x2="8" y2="14.6" stroke="#22252A" stroke-width="0.9"/><circle cx="5.6" cy="7.6" r="1.15" fill="#22252A"/><circle cx="10.4" cy="7.6" r="1.15" fill="#22252A"/><circle cx="5.9" cy="11.2" r="0.95" fill="#22252A"/><circle cx="10.1" cy="11.2" r="0.95" fill="#22252A"/></svg>', subtask: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3.6 2.6v5.2a2.2 2.2 0 0 0 2.2 2.2h4.6" stroke="#00B8D9" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M9.3 7.8 12.8 10 9.3 12.2z" fill="#00B8D9"/></svg>'
};
var SPRINT_STATUS_COLORS = {
  planning: '#6b7280', active: '#3b82f6', completed: '#10b981'
};

// Type/priority are admin-configurable per space (migration 016) — an admin
// can add a value with no entry in PRIORITY_COLORS/badge-type-* CSS. Rather
// than every such value collapsing to the same flat gray (indistinguishable
// on a chart, invisible as a badge with no background at all), derive a
// stable color from the string itself so new values still read as distinct.
function _hashHue(v) {
  var s = String(v || ''), h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function fallbackAccentColor(v) { return 'hsl(' + _hashHue(v) + ',65%,45%)'; }
function fallbackBadgeBg(v) { return 'hsl(' + _hashHue(v) + ',70%,93%)'; }
function fallbackBadgeText(v) { return 'hsl(' + _hashHue(v) + ',60%,32%)'; }
