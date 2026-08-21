// Entry point. server.js is now the ordered require list: every module below
// registers its routes when required, so the 117 route registrations still
// happen in exactly their original order. npm start is unchanged.
require('./src/server/core');
require('./src/server/db');
require('./src/server/auth');
require('./src/server/email');
require('./src/server/deps');
require('./src/server/notify');
require('./src/server/express-app');
require('./src/server/files');
require('./src/server/oauth-helpers');
require('./src/server/routes/data');
require('./src/server/routes/my-issues');
require('./src/server/routes/org');
require('./src/server/routes/spaces');
require('./src/server/routes/sprints');
require('./src/server/routes/issues');
require('./src/server/routes/comments');
require('./src/server/routes/worklogs');
require('./src/server/routes/roadmap');
require('./src/server/routes/links');
require('./src/server/routes/attachments');
require('./src/server/routes/custom-fields');
require('./src/server/routes/filters');
require('./src/server/routes/reports');
require('./src/server/routes/notifications');
require('./src/server/routes/oauth');
require('./src/server/routes/auth');
require('./src/server/routes/users');
require('./src/server/routes/admin');
require('./src/server/errors');
require('./src/server/routes/spa');
require('./src/server/startup');
