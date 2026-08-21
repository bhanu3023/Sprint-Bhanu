// ═══════════════════════════════════════════════════════════
// SPRINTBOARD ENTERPRISE — SPA CORE LOGIC
// ═══════════════════════════════════════════════════════════

// ── Analytics ─────────────────────────
// Module scope, not DOMContentLoaded: recording starts as soon as this
// script runs, so the loading overlay and any pre-auth state are covered.
// A no-op unless HOTJAR_SITE_ID is configured — see hotjar.js.
if (typeof initHotjar === 'function') initHotjar();
