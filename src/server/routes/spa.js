var __dirname = require("path").dirname(require.resolve("../../../package.json"));
const { path } = require('../core');
const { app } = require('../express-app');
// SPA routes — refresh-safe deep links
const SPA_HTML = path.join(__dirname, 'index.html');
app.get([
  '/',
  '/spaces',
  '/reports',
  '/work-log',
  '/roadmap',
  '/settings',
  '/my-work',
  '/my-work/open',
  '/my-work/assigned',
  '/my-work/reported',
  '/my-work/recent'
], (req, res) => {
  res.sendFile(SPA_HTML);
});
app.get('/space/:key/:tab?/:subtab?', (req, res) => {
  res.sendFile(SPA_HTML);
});
// Org Admin Settings' own sub-sections (/settings/user-management, etc.) —
// same gap as /space/:key/:tab above: a hard refresh on a valid client-side
// route 404'd because this list only had the bare parent path.
app.get('/settings/:section', (req, res) => {
  res.sendFile(SPA_HTML);
});

// /login is a clean alias for the existing login page. Without it the path fell
// through to the 404 handler, because login.html is only reachable by its filename
// and the SPA list above does not include it.
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

