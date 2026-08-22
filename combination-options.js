/**
 * Combination options for Product_Team — grouped by Product Type.
 * Message Type | Mail Type | Content Type
 *
 * LOADED BY BOTH THE BROWSER AND NODE -- this is why it lives at the repository
 * root rather than under src/client or src/server:
 *   browser  index.html loads it as a <script>, and the bottom of this file
 *            assigns to window.*
 *   node     lib/builtin-issue-fields.js and
 *            scripts/migrations/003-product-team-combination.js require() it,
 *            and the bottom of this file assigns to module.exports
 * Moving it into either tree breaks the other consumer. There is no bundler to
 * resolve a shared path, so root IS the shared location. See ADR-009.
 */
function normalizeCombinationLabel(s) {
  return String(s)
    .replace(/\s+to\s+/gi, ' - ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

var COMBINATION_OPTIONS_RAW = [
  'Amazon S3 - SharePoint',
  'Amazon workdocs - NFS',
  'Amazon workdocs - Onedrive/SharePoint',
  'Box - Amazon S3',
  'Box - Box',
  'Box - Citrix',
  'Box - Dropbox',
  'Box - Microsoft',
  'Box - MyDrive',
  'Box - OneDrive',
  'Box - SharePoint',
  'Box - Shared Drive',
  'Chat - Chat',
  'Chat - Slack',
  'Chat - Team',
  'Chat - Teams',
  'Citrix - Citrix',
  'Citrix - MyDrive',
  'Citrix - OneDrive',
  'Citrix - SharePoint',
  'Citrix - Shared Drive',
  'Drive Change',
  'DropBox - Azure',
  'DropBox - Egnyte',
  'Dropbox - Box',
  'Dropbox - MyDrive',
  'Dropbox - Onedrive',
  'Dropbox - SharePoint',
  'Dropbox - Shared Drive',
  'Egnyte - Azure',
  'Egnyte - MyDrive',
  'Egnyte - Onedrive',
  'Egnyte - SharePoint',
  'Egnyte - Shared Drive',
  'Gmail - Gmail',
  'Gmail - Outlook',
  'Meta - Chat',
  'Meta - Teams',
  'Meta - Viva',
  'My Drive - MyDrive',
  'MyDrive - Box',
  'MyDrive - Dropbox',
  'MyDrive - Egnyte',
  'MyDrive - MyDrive',
  'MyDrive - Onedrive',
  'MyDrive - SharePoint',
  'NFS - MyDrive',
  'NFS - Onedrive',
  'NFS - SharePoint',
  'NFS - Shared Drive',
  'OneDrive - Amazon S3',
  'OneDrive - MyDrive',
  'OneDrive - OneDrive',
  'Onedrive - MyDrive',
  'Onedrive - Onedrive',
  'Other',
  'Outlook - Gmail',
  'Outlook - Outlook',
  'Share Point - Amazon S3',
  'ShareDrive - ShareDrive',
  'ShareFile - MyDrive',
  'ShareFile - OneDrive',
  'ShareFile - ShareDrive',
  'ShareFile - SharePoint',
  'SharePoint - Azure',
  'SharePoint - Egnyte',
  'SharePoint - Mydrive',
  'SharePoint - SharePoint',
  'SharePoint - Shared Drive',
  'Shared Drive - Amazon S3',
  'Shared Drive - Azure',
  'Shared Drive - Egnyte',
  'Shared Drive - Onedrive',
  'Shared Drive - SharePoint',
  'Shared Drive - Shared Drive',
  'Sharefile - Amazon S3',
  'Sharefile - Azure',
  'Slack - Chat',
  'Slack - Slack',
  'Slack - Teams',
  'Teams - Chat',
  'Teams - Slack',
  'Teams - Teams'
];

var _comboSeen = {};
var COMBINATION_OPTIONS = [];
COMBINATION_OPTIONS_RAW.forEach(function (item) {
  var norm = normalizeCombinationLabel(item);
  var key = norm.toLowerCase();
  if (!_comboSeen[key]) {
    _comboSeen[key] = true;
    COMBINATION_OPTIONS.push(norm);
  }
});
COMBINATION_OPTIONS.sort(function (a, b) { return a.localeCompare(b); });

// Combination groups are entirely per-space and admin-configured (mirroring
// whatever Product Type options that space has) -- a brand-new space starts
// with NO groups at all, just this flat catalogue of known real-world values
// as a starting point to pick from. There is no fixed Message/Email/Content
// classification here any more (there used to be one, keyword-matched by
// source/destination name into exactly those 3 buckets regardless of what
// Product Types the space actually had -- removed because it silently
// mis-seeded every new space's Combination field with the old hardcoded
// shape, bypassing the real per-space admin configuration entirely).
function buildCombinationOptionsPayload() {
  return {
    v: 2,
    groups: {},
    flat: COMBINATION_OPTIONS.slice()
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = COMBINATION_OPTIONS;
  module.exports.normalizeCombinationLabel = normalizeCombinationLabel;
  module.exports.buildCombinationOptionsPayload = buildCombinationOptionsPayload;
}
if (typeof window !== 'undefined') {
  window.COMBINATION_OPTIONS = COMBINATION_OPTIONS;
  window.normalizeCombinationLabel = normalizeCombinationLabel;
  window.buildCombinationOptionsPayload = buildCombinationOptionsPayload;
}
