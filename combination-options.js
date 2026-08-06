/**
 * Combination options for Product_Team — grouped by Product Type.
 * Message Type | Mail Type | Content Type
 */
function normalizeCombinationLabel(s) {
  return String(s)
    .replace(/\s+to\s+/gi, ' - ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

var MESSAGE_KEYWORDS = ['slack', 'teams', 'team', 'chat', 'meta', 'viva'];
var MAIL_KEYWORDS = ['gmail', 'outlook'];

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

function partMatchesKeywords(part, keywords) {
  var p = String(part || '').toLowerCase();
  return keywords.some(function (k) { return p.indexOf(k) >= 0; });
}

/** Classify combination → Message | Email | Content (matches issues.product_type values). */
function classifyCombination(option) {
  var parts = String(option || '').split(' - ');
  var src = (parts[0] || '').trim();
  var dst = (parts[1] || src).trim();
  if (partMatchesKeywords(src, MAIL_KEYWORDS) && partMatchesKeywords(dst, MAIL_KEYWORDS)) {
    return 'Email';
  }
  if (partMatchesKeywords(src, MESSAGE_KEYWORDS) && partMatchesKeywords(dst, MESSAGE_KEYWORDS)) {
    return 'Message';
  }
  return 'Content';
}

var COMBINATION_GROUPS = { Message: [], Email: [], Content: [] };
COMBINATION_OPTIONS.forEach(function (opt) {
  var cat = classifyCombination(opt);
  if (!COMBINATION_GROUPS[cat]) COMBINATION_GROUPS[cat] = [];
  COMBINATION_GROUPS[cat].push(opt);
});
Object.keys(COMBINATION_GROUPS).forEach(function (k) {
  COMBINATION_GROUPS[k].sort(function (a, b) { return a.localeCompare(b); });
});

var PRODUCT_TYPES_WITH_COMBINATIONS = ['Message', 'Email', 'Content'];
var PRODUCT_TYPE_LABELS = {
  Message: 'Message Type',
  Email: 'Mail Type',
  Content: 'Content Type',
  Manage: 'Manage',
  Infra: 'Infra'
};

function buildCombinationOptionsPayload() {
  return {
    v: 2,
    groups: COMBINATION_GROUPS,
    flat: COMBINATION_OPTIONS.slice()
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = COMBINATION_OPTIONS;
  module.exports.normalizeCombinationLabel = normalizeCombinationLabel;
  module.exports.classifyCombination = classifyCombination;
  module.exports.COMBINATION_GROUPS = COMBINATION_GROUPS;
  module.exports.PRODUCT_TYPES_WITH_COMBINATIONS = PRODUCT_TYPES_WITH_COMBINATIONS;
  module.exports.PRODUCT_TYPE_LABELS = PRODUCT_TYPE_LABELS;
  module.exports.buildCombinationOptionsPayload = buildCombinationOptionsPayload;
}
if (typeof window !== 'undefined') {
  window.COMBINATION_OPTIONS = COMBINATION_OPTIONS;
  window.normalizeCombinationLabel = normalizeCombinationLabel;
  window.classifyCombination = classifyCombination;
  window.COMBINATION_GROUPS = COMBINATION_GROUPS;
  window.PRODUCT_TYPES_WITH_COMBINATIONS = PRODUCT_TYPES_WITH_COMBINATIONS;
  window.PRODUCT_TYPE_LABELS = PRODUCT_TYPE_LABELS;
  window.buildCombinationOptionsPayload = buildCombinationOptionsPayload;
}
