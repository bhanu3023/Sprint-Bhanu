const { q } = require('./db');
const {
  validateSchemaReadOnly, logProductTeamCombinationStatus, logDuplicateKeyWarning
} = require('./lib/schema-check');
const { runMigrations } = require('./lib/migrate');
const {
  buildDynamicUpdate, canActInSpace, denyUnlessCanAct, requireOrgAdmin, isOrgAdmin,
  UPDATE_WHITELIST, validateSpaceRoleAssignment, canRemoveSpaceMember, getSpaceMemberRole,
  getIssueSpaceId, getSprintSpaceId, getCommentIssueSpaceId,
  getCustomFieldSpaceId, getFilterSpaceId, getSpaceMemberRecord, getMemberSpaceIds, getVisibleSpaceIds, pickAllowed
} = require('./lib/permissions');
const { seedBuiltinIssueFields, getConfiguredOptions } = require('./lib/builtin-issue-fields');
const { uid } = require('./core');
const { upsertIssueFieldValue: upsertIssueFieldValueImpl } = require('./lib/issue-field-values');
// One shared upsert for every custom-field-value write — the drawer's PUT
// route and the bulk CSV import both call this instead of maintaining two
// copies of the empty-string-deletes-the-row rule and the history write.
const upsertIssueFieldValue = (issueId, fieldId, value, actorUserId) =>
  upsertIssueFieldValueImpl({ q, uid }, issueId, fieldId, value, actorUserId);

/**
 * type/priority have no DB CHECK constraint since migration 016 — each space
 * configures its own list via custom_fields, same model as team/product_type.
 * Validates a NEW value being written; callers must skip this when a value is
 * unchanged so an issue keeping an old, since-removed value stays valid.
 */
async function isBuiltinSelectValueAllowed(spaceId, fieldKey, value) {
  if (value == null) return true;
  const opts = await getConfiguredOptions(q, spaceId, fieldKey);
  return opts.indexOf(String(value)) >= 0;
}
const { startRetentionSweeper, retentionDays, purgeIssueRows: purgeIssueCascade } = require('./lib/retention');
const { completeSprint, startSprintAutoCompleter } = require('./lib/sprint-complete');
// One shared cascade for every issue purge — manual, bulk, and the retention sweep.
const purgeIssueRows = (id) => purgeIssueCascade(q, id);
const https = require('https');

// ── Microsoft OAuth2 state store (CSRF) ───────────────────
const oauthStates = new Map(); // state → { createdAt }
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
}, 10 * 60 * 1000);


module.exports = { validateSchemaReadOnly, logProductTeamCombinationStatus, logDuplicateKeyWarning, runMigrations, buildDynamicUpdate, canActInSpace, denyUnlessCanAct, requireOrgAdmin, isOrgAdmin, UPDATE_WHITELIST, validateSpaceRoleAssignment, canRemoveSpaceMember, getSpaceMemberRole, getIssueSpaceId, getSprintSpaceId, getCommentIssueSpaceId, getCustomFieldSpaceId, getFilterSpaceId, getSpaceMemberRecord, getMemberSpaceIds, getVisibleSpaceIds, pickAllowed, seedBuiltinIssueFields, getConfiguredOptions, isBuiltinSelectValueAllowed, startRetentionSweeper, retentionDays, purgeIssueCascade, purgeIssueRows, completeSprint, startSprintAutoCompleter, https, oauthStates, upsertIssueFieldValue };
