
// ═══════════════════════════════════════════════════════════
// COMBINATION UPGRADERS — admin / space admin only
// ═══════════════════════════════════════════════════════════
// Reachable only from the "Upgraders" button next to the Combination custom
// field in Space Settings → Custom Fields (paintSettingsCustomFields in
// settings.js). That button's own visibility is not gated further — every
// space member can already see the Custom Fields settings page — but the
// real boundary is server-side: GET /api/custom-fields/:id/upgraders is
// member-level (seeing who is responsible for a combination is useful to
// the team), while PUT is 'custom_field.manage' (site_admin tier), the same
// gate as editing the Combination field's own options. A plain member can
// open this modal and see assignments, but a save attempt 403s.
//
// Each combination's Upgrader is looked up and saved by EMAIL. The server
// accepts any ACTIVE user in the same organization as this space, not only
// this space's own members (an Upgrader is very often a specialist who
// handles a combination without being formally added to every space that
// has one) — "select from the space" and "type their email" are the same
// control: a plain text input with a <datalist> of this space's own members
// for autocomplete convenience, accepting either a picked suggestion or any
// other org member's email typed in directly. Saves per-row automatically
// (on picking a datalist suggestion, or on blur for anything typed by hand),
// mirroring the debounced-PUT-on-change pattern already used for the
// Product Type + Combination picker on the drawer (saveDrawerPtComboSelection)
// rather than introducing a page-wide Save button for what could be 70+ rows.

var _cuField = null;
var _cuUpgraders = {}; // combination string -> { user_id, user_name, user_email }

function openCombinationUpgradersModal(field) {
  _cuField = field;
  _cuUpgraders = {};
  var space = getSpace(field.space_id);
  var nameEl = $('cuSpaceName');
  if (nameEl) nameEl.textContent = space ? space.name : 'this space';
  if ($('cuFilterInput')) $('cuFilterInput').value = '';
  $('cuGroupsContainer').innerHTML = '<p class="text-muted" style="padding:16px;text-align:center">Loading…</p>';
  openModal('modal-combination-upgraders');

  renderCombinationUpgradersMembersList(field.space_id);

  api('/api/custom-fields/' + field.id + '/upgraders', 'GET', null, { silent: true }).then(function (rows) {
    (rows || []).forEach(function (r) { _cuUpgraders[r.combination] = r; });
    renderCombinationUpgradersList('');
  }).catch(function (e) {
    $('cuGroupsContainer').innerHTML = '<p style="padding:16px;text-align:center;color:var(--red,#dc2626)">Could not load upgraders — ' + esc(errorReason(e)) + '</p>';
  });
}
window.openCombinationUpgradersModal = openCombinationUpgradersModal;

// The datalist is autocomplete convenience only — the server accepts any
// active user in the organization by email regardless of what's suggested
// here — but this space's own members are the common case and always
// resolve locally with no extra request. An org admin additionally gets
// every OTHER org user merged in too, since GET /api/users (org-admin only)
// is the one place that full list is available; a plain space site_admin
// (not an org admin) still has to type a name from another space by hand,
// same as before, since there is no endpoint that would let them list users
// outside their own spaces.
function renderCombinationUpgradersMembersList(spaceId) {
  function paint(users) {
    var byEmail = {};
    users.forEach(function (m) { if (m.email) byEmail[m.email.toLowerCase()] = m; });
    var sorted = Object.keys(byEmail).map(function (k) { return byEmail[k]; }).sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    $('cuMembersList').innerHTML = sorted.map(function (m) {
      return '<option value="' + escAttr(m.email) + '" label="' + escAttr(m.name || m.email) + '">';
    }).join('');
  }

  var members = getSpaceMembers(spaceId);
  paint(members);
  if (typeof isOrgAdminUser === 'function' && isOrgAdminUser()) {
    api('/api/users', 'GET', null, { silent: true }).then(function (allUsers) {
      paint(members.concat((allUsers || []).filter(function (u) { return u.is_active !== false; })));
    }).catch(function () { /* keep the space-members-only list already painted */ });
  }
}

function closeCombinationUpgradersModal() {
  closeModal('modal-combination-upgraders');
  _cuField = null;
  _cuUpgraders = {};
}
window.closeCombinationUpgradersModal = closeCombinationUpgradersModal;

// One section per Product Type this space has configured, same grouping as
// the Edit Combination editor itself — a combination appearing in more than
// one group (the data model permits it) shares a single underlying
// assignment either way, since it is keyed by the combination string alone.
function renderCombinationUpgradersList(filter) {
  var container = $('cuGroupsContainer');
  if (!container || !_cuField) return;
  var parsed = parseCombinationFieldOptions(_cuField);
  var ptOptions = getProductTypeOptionsForSpace(_cuField.space_id);
  var q = (filter || '').trim().toLowerCase();

  var html = '';
  var shownAny = false;
  ptOptions.forEach(function (pt) {
    var combos = (parsed.groups[pt.v] || []).filter(function (c) {
      return !q || c.toLowerCase().indexOf(q) !== -1;
    });
    if (!combos.length) return;
    shownAny = true;
    html += '<div class="cu-group"><h4 class="cu-group-title">' + esc(pt.l) + '</h4>';
    combos.forEach(function (combo) {
      var current = _cuUpgraders[combo];
      var email = current ? (current.user_email || '') : '';
      html += '<div class="cu-row">' +
        '<span class="cu-combo-label">' + esc(combo) + '</span>' +
        '<input type="text" class="input cu-input" list="cuMembersList" placeholder="— None —" ' +
          'value="' + escAttr(email) + '" data-combination="' + escAttr(combo) + '" data-last-value="' + escAttr(email) + '">' +
        '<span class="cu-status"></span>' +
        '</div>' +
        // A rejection message (an unknown combination, a non-member/non-cloudfuze
        // email, or a 403) can run much longer than the ~70px status column next
        // to the input, so it gets its own full-width line below the row instead
        // of being squeezed sideways into that column. Hidden until there is
        // actually something to show.
        '<div class="cu-row-error" hidden></div>';
    });
    html += '</div>';
  });

  container.innerHTML = shownAny ? html : '<p class="text-muted" style="padding:16px;text-align:center">' +
    (q ? 'No combinations match "' + esc(filter) + '"' : 'No combinations configured yet — add some in Edit Combination first.') + '</p>';

  qsa('.cu-input', container).forEach(bindCombinationUpgraderInput);
}

function bindCombinationUpgraderInput(input) {
  input.addEventListener('blur', function () { saveCombinationUpgraderInput(input); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
  // A native <datalist> has no dedicated "option picked" event — the current
  // value exactly matching one of the datalist's own option values is the
  // standard way to tell a pick apart from ordinary typing, so choosing a
  // suggestion saves immediately rather than waiting for the field to lose
  // focus.
  input.addEventListener('input', function () {
    if (isKnownCombinationUpgraderEmail(input.value.trim())) saveCombinationUpgraderInput(input);
  });
}

function isKnownCombinationUpgraderEmail(value) {
  if (!value) return false;
  var opts = document.querySelectorAll('#cuMembersList option');
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].value === value) return true;
  }
  return false;
}

async function saveCombinationUpgraderInput(input) {
  var statusEl = input.nextElementSibling;   // .cu-status, a sibling of the input WITHIN .cu-row
  var row = input.closest('.cu-row');
  var errorEl = row ? row.nextElementSibling : null; // .cu-row-error, a sibling of .cu-row ITSELF, one level up
  var combo = input.dataset.combination;
  var newVal = input.value.trim();
  var lastVal = input.dataset.lastValue || '';
  if (newVal === lastVal) return;

  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--text3)'; }
  input.disabled = true;
  try {
    var result = await api('/api/custom-fields/' + _cuField.id + '/upgraders', 'PUT', { combination: combo, email: newVal }, { silent: true });
    if (result.user_id) {
      _cuUpgraders[combo] = result;
      input.value = result.user_email || newVal;
    } else {
      delete _cuUpgraders[combo];
      input.value = '';
    }
    input.dataset.lastValue = input.value;
    if (statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.style.color = 'var(--green,#10b981)';
      setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 1500);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = '';
    if (errorEl) { errorEl.textContent = errorReason(err); errorEl.hidden = false; }
    input.value = lastVal; // revert — the server rejected it
  } finally {
    input.disabled = false;
  }
}

if ($('cuFilterInput')) {
  $('cuFilterInput').addEventListener('input', function () { renderCombinationUpgradersList(this.value); });
}
