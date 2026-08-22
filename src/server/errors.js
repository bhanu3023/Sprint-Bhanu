const { app } = require('./express-app');
// ── Error Handler ─────────────────────────────────────────
// SQLSTATE class 22 is "data exception": the VALUE the client sent could not be
// interpreted. Measured cases -- 22P02 invalid text representation (a
// non-numeric story_points), 22007 invalid datetime format, 22021 character not
// in repertoire (a NUL byte in a query parameter). These are bad requests, and
// reporting them as 500 both misleads the caller and hides genuine faults in
// the logs. Class 23 (integrity violations) is deliberately NOT mapped: the
// duplicate-key race is handled locally with a retry, and reclassifying it here
// would change behaviour well outside this concern.
const PG_DATA_EXCEPTION = /^22/;

app.use((err, req, res, next) => {
  console.error(err);
  // http-errors and body-parser attach their own status. express.json's parse
  // failure arrives as a SyntaxError carrying status 400 and
  // type 'entity.parse.failed'; the previous handler discarded that and
  // answered 500. Only 4xx is honoured -- a route that throws a 5xx-shaped
  // error still gets the generic 500 below.
  const declared = Number(err && (err.status || err.statusCode));
  if (declared >= 400 && declared < 500) {
    return res.status(declared).json({ error: 'Invalid request' });
  }
  if (err && typeof err.code === 'string' && PG_DATA_EXCEPTION.test(err.code)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  // Unchanged for everything else, and the body stays generic: the driver's
  // message must never reach the client.
  res.status(500).json({ error: 'Internal server error' });
});

// ── Crash Protection ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});

