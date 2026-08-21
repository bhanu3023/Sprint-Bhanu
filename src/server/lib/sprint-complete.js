// Shim: re-exports the repo-root lib/ module so that a relocated server body
// calling require('./lib/sprint-complete') resolves exactly as it did from server.js.
module.exports = require('../../../lib/sprint-complete');
