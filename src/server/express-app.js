var __dirname = require("path").dirname(require.resolve("../../package.json"));
const { express } = require('./core');
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// ── Runtime client config (/config.js) ─────────────────────
// This project has no build step: index.html and login.html load their scripts
// straight off disk through express.static below, so there is no bundler that
// could substitute an env var into the frontend at build time. This route
// synthesizes a tiny script instead, which means every value below is read
// fresh from process.env on each request — turning Hotjar off later is a config
// change plus a restart, with no rebuild and no asset redeploy.
//
// Registered before express.static so it wins even if a config.js file ever
// lands on disk. Served unauthenticated to every visitor (the login page needs
// it too), so only non-secret, publicly-safe values belong here.
app.get('/config.js', (req, res) => {
  const cfg = {
    // Blank/unset means Hotjar never loads and no script is requested — the
    // committed default, so local dev does not record into the real site.
    hotjarSiteId: (process.env.HOTJAR_SITE_ID || '').trim()
  };
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send('window.APP_CONFIG = ' + JSON.stringify(cfg) + ';');
});

app.use(express.static(__dirname, {
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

module.exports = { app };
