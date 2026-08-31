// Shim: re-exports the repo-root lib/ module so that a relocated server body
// calling require('./lib/issue-field-values') resolves exactly as it did from server.js.
module.exports = require('../../../lib/issue-field-values');
