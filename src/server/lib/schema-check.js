// Shim: re-exports the repo-root lib/ module so that a relocated server body
// calling require('./lib/schema-check') resolves exactly as it did from server.js.
module.exports = require('../../../lib/schema-check');
