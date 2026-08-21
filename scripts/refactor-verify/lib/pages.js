/**
 * Every page/view captured for the DOM byte-diff.
 *
 * Read-only navigation ONLY. Nothing in this list may create, update or delete
 * data -- a mutating capture would make the next run's snapshot differ for a
 * reason unrelated to the refactor. Mutating behaviour is covered by flows.js
 * (assertion-based) instead.
 *
 * Space-scoped pages are captured for MORE THAN ONE space on purpose. A space
 * with no sprints renders "No sprints found." on the reports/board/MBR tabs,
 * so capturing only such a space would prove those renderers identical without
 * ever executing them. We therefore capture a sprint-rich space (real report,
 * burndown, MBR and board rendering) as well as a space whose custom-field
 * config differs (e.g. the Combination field), so both code paths are covered.
 */

function globalPages() {
  return [
    { name: 'home',             url: '/' },
    { name: 'spaces',           url: '/spaces' },
    { name: 'my-work-assigned', url: '/my-work' },
    { name: 'my-work-reported', url: '/my-work/reported' },
    { name: 'my-work-recent',   url: '/my-work/recent' },
    { name: 'my-work-open',     url: '/my-work/open' },
    { name: 'work-log',         url: '/work-log' },
    { name: 'roadmap',          url: '/roadmap' },
    { name: 'global-reports',   url: '/reports' },
    { name: 'admin-settings',   url: '/settings' },
    { name: 'admin-users',      url: '/settings/user-management' },
    { name: 'admin-roles',      url: '/settings/roles-permissions' },
    { name: 'admin-all-spaces', url: '/settings/all-spaces' },
    { name: 'admin-audit-log',  url: '/settings/audit-log' },
    { name: 'admin-email',      url: '/settings/email-settings' },
    { name: 'admin-global-cf',  url: '/settings/global-custom-fields' },
    { name: 'admin-deleted',    url: '/settings/deleted-tickets' },
  ];
}

function spacePages(spaceKey) {
  const s = '/space/' + spaceKey;
  const p = k => spaceKey + ':' + k;
  return [
    { name: p('summary'),           url: s },
    { name: p('backlog'),           url: s + '/backlog' },
    { name: p('board'),             url: s + '/sprint' },
    { name: p('all-work'),          url: s + '/all-work' },
    { name: p('calendar'),          url: s + '/calendar' },
    { name: p('reports'),           url: s + '/reports' },
    { name: p('mbr'),               url: s + '/mbr' },
    { name: p('mbr-comparison'),    url: s + '/mbr/comparison' },
    { name: p('mbr-achievements'),  url: s + '/mbr/achievements' },
    { name: p('settings-general'),  url: s + '/settings' },
    { name: p('settings-people'),   url: s + '/settings/people' },
    { name: p('settings-cf'),       url: s + '/settings/custom-fields' },
    { name: p('settings-deleted'),  url: s + '/settings/deleted' },
    { name: p('settings-reports'),  url: s + '/settings/reports' },
  ];
}

module.exports = { globalPages, spacePages };
