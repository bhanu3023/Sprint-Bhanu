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

// ── Public asset allowlist ────────────────────────────────
// This used to be a bare express.static(__dirname), which serves the WHOLE
// repository. That made the entire server-side tree publicly readable:
// lib/permissions.js (all authorization logic), db/schema.sql, db/init.sql,
// db/seed-qa-data.js, Dockerfile, docker-compose.yml, package.json and
// .github/workflows/deploy.yml all returned 200 in production.
//
// .env was NOT exposed, but not for a reason worth relying on. serve-static
// passes dotfiles: undefined, and send's legacy branch (send/index.js:565)
// resolves that to:
//     parts[parts.length - 1][0] === '.' ? 'ignore' : 'allow'
// i.e. only a dot-BASENAME is hidden. A dot-DIRECTORY is traversed happily,
// which is exactly why /.env 404s while /.github/workflows/deploy.yml returns
// 200. That is not a security boundary, so this no longer depends on it.
//
// Allowlist, not denylist: a new file added to the repo is private by default
// and has to be named here to become public.
const PUBLIC_ROOT_PATHS = new Set([
  '/',                        // static's index option serves index.html, as before
  '/index.html',
  '/login.html',
  '/styles.css',
  '/hotjar.js',
  '/combination-options.js'
]);
// Prefix + expected file type, not prefix alone. A bare prefix re-exposes
// whatever happens to sit in that directory, including files deleted from git
// that survive on the server: the deploy extracts over the directory without
// wiping, so a deleted file stays on disk. Caught in a deploy dry run, where
// the old tree was extracted first and the new archive overlaid on top --
// assets/placeholder.txt was deleted from the repo, remained on disk, and came
// straight back as a 200 under the '/assets/' prefix.
const PUBLIC_PREFIXES = [
  { prefix: '/src/client/', exts: ['.js'] },
  { prefix: '/assets/', exts: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf'] }
];

function isPublicAsset(p) {
  // Reject traversal outright rather than relying on send to normalize it.
  if (p.includes('..') || p.toLowerCase().includes('%2e')) return false;
  if (PUBLIC_ROOT_PATHS.has(p)) return true;
  // dev-login.html is a local-only page and cannot work unserved: it POSTs to
  // /api/auth/login, so it needs same origin -- opening it over file:// breaks.
  // Default-deny via explicit opt-in, so it can never be served by accident on
  // a host that has not asked for it. It is also untracked and excluded from
  // `git archive`, so it never reaches production in the first place.
  if (p === '/dev-login.html' && process.env.ALLOW_DEV_LOGIN === '1') return true;
  const lower = p.toLowerCase();
  for (const entry of PUBLIC_PREFIXES) {
    if (!p.startsWith(entry.prefix)) continue;
    return entry.exts.some(function(ext) { return lower.endsWith(ext); });
  }
  return false;
}

const publicStatic = express.static(__dirname, {
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
});

// Anything not on the allowlist skips the static handler entirely and falls
// through to the SPA routes and then the 404 handler -- so routing for paths
// like /spaces is untouched, and only file *reads* are narrowed.
app.use(function(req, res, next) {
  if (isPublicAsset(req.path)) return publicStatic(req, res, next);
  next();
});

module.exports = { app };
