
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
// Each combination's Upgrader is looked up and saved by EMAIL, matched
// against this field's own space's members — "select from the space" and
// "type their email" are the same control: a plain text input with a
// <datalist> of every member's email for autocomplete, accepting either a
// picked suggestion or freely typed text. Saves per-row on blur, mirroring
// the debounced-PUT-on-change pattern already used for the Product Type +
// Combination picker on the drawer (saveDrawerPtComboSelection) rather than
// introducing a page-wide Save button for what could be 70+ rows.

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

  var members = getSpaceMembers(field.space_id).slice().sort(function (a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });
  $('cuMembersList').innerHTML = members.filter(function (m) { return m.email; }).map(function (m) {
    return '<option value="' + escAttr(m.email) + '" label="' + escAttr(m.name || m.email) + '">';
  }).join('');

  api('/api/custom-fields/' + field.id + '/upgraders', 'GET', null, { silent: true }).then(function (rows) {
    (rows || []).forEach(function (r) { _cuUpgraders[r.combination] = r; });
    renderCombinationUpgradersList('');
  }).catch(function (e) {
    $('cuGroupsContainer').innerHTML = '<p style="padding:16px;text-align:center;color:var(--red,#dc2626)">Could not load upgraders — ' + esc(errorReason(e)) + '</p>';
  });
}
window.openCombinationUpgradersModal = openCombinationUpgradersModal;

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
        '</div>';
    });
    html += '</div>';
  });

  container.innerHTML = shownAny ? html : '<p class="text-muted" style="padding:16px;text-align:center">' +
    (q ? 'No combinations match "' + esc(filter) + '"' : 'No combinations configured yet — add some in Edit Combination first.') + '</p>';

  qsa('.cu-input', container).forEach(function (input) {
    input.addEventListener('blur', handleCombinationUpgraderBlur);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
  });
}

async function handleCombinationUpgraderBlur(e) {
  var input = e.target;
  var statusEl = input.nextElementSibling; // .cu-status, always the input's next sibling in the row markup above
  var combo = input.dataset.combination;
  var newVal = input.value.trim();
  var lastVal = input.dataset.lastValue || '';
  if (newVal === lastVal) return;

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
    if (statusEl) { statusEl.textContent = errorReason(err); statusEl.style.color = 'var(--red,#dc2626)'; }
    input.value = lastVal; // revert — the server rejected it (unknown combination, non-member email, or a 403)
  } finally {
    input.disabled = false;
  }
}

if ($('cuFilterInput')) {
  $('cuFilterInput').addEventListener('input', function () { renderCombinationUpgradersList(this.value); });
}
