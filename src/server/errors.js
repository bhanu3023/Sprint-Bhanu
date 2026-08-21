const { app } = require('./express-app');
// ── Error Handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Crash Protection ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});

