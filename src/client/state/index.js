
// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
  data: null,
  currentUser: null,
  currentSpace: null,
  currentView: 'home',
  currentTab: null,
  drawerIssueId: null,
  calendarDate: new Date(),
  calendarView: 'month',
  allWorkSort: { col: 'updated_at', dir: 'desc' },
  allWorkPage: 1,
  allWorkSelected: new Set(),
  yourWorkTab: 'assigned',
  // shape lives in emptyYwFilters() (utils) so state, clear and the open
  // filter cannot drift apart; assigned by init() once utils is loaded
  ywFilters: { key: [], type: [], status: [], priority: [], space: [],
    productType: [], combination: [], assignee: [], reporter: [] },
  ywExcludeDone: false,
  awFilters: {
    type: [], status: [], priority: [], assignee: [], sprint: [],
    productType: [], team: [], desc: '',
    createdFrom: '', createdTo: '',
    updatedFrom: '', updatedTo: '',
    dueDateFrom: '', dueDateTo: '',
    startDateFrom: '', startDateTo: ''
  }
};
