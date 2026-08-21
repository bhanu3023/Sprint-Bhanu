// Shim: re-exports the repo-root lib/ module so that a relocated server body
// calling require('./lib/permissions') resolves exactly as it did from server.js.
module.exports = require('../../../lib/permissions');
