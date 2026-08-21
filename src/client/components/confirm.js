
// ═══════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════
var _confirmResolve = null;
function confirmDialog(msg) {
  return new Promise(function (resolve) {
    $('confirmMsg').textContent = msg;
    openModal('modal-confirm');
    _confirmResolve = resolve;
    $('confirmYes').onclick = function () { _confirmResolve = null; closeModal('modal-confirm'); resolve(true); };
    $('confirmNo').onclick = function () { _confirmResolve = null; closeModal('modal-confirm'); resolve(false); };
  });
}

// ═══════════════════════════════════════════════════════════
// TYPED CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════
// GitHub-style "type the name to confirm" gate for destructive actions. The
// confirm button stays disabled until the typed text matches, so nobody deletes
// a ticket by muscle-memory-clicking through a dialog.
//
//   opts = {
//     title, intro,             // heading + first paragraph
//     phrase,                   // the exact text the user must type
//     phraseHint,               // label above the input (defaults from phrase)
//     note,                     // reassurance line (recoverable) — optional
//     warn,                     // red warning line (irreversible) — optional
//     details,                   // array of 'label: value' strings, rendered as a list
//     confirmLabel              // button text (default 'Delete')
//   }
// Resolves true only on an exact (case-insensitive, trimmed) match.
function typedConfirmDialog(opts) {
  opts = opts || {};
  var phrase = String(opts.phrase || 'delete');
  return new Promise(function (resolve) {
    var done = false;
    function finish(val) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      resolve(val);
    }
    var wrap = document.createElement('div');
    wrap.className = 'typed-confirm';
    wrap.innerHTML =
      '<div class="typed-confirm-backdrop"></div>' +
      '<div class="typed-confirm-dialog" role="dialog" aria-modal="true">' +
        '<h3 class="typed-confirm-title">' + esc(opts.title || 'Confirm delete') + '</h3>' +
        '<p class="typed-confirm-intro">' + esc(opts.intro || '') + '</p>' +
        (opts.details && opts.details.length
          ? '<ul class="typed-confirm-details">' +
            opts.details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') +
            '</ul>'
          : '') +
        (opts.warn ? '<p class="typed-confirm-warn">' + esc(opts.warn) + '</p>' : '') +
        (opts.note ? '<p class="typed-confirm-note">' + esc(opts.note) + '</p>' : '') +
        '<label class="typed-confirm-label">' +
          esc(opts.phraseHint || 'To confirm, type') +
          ' <code class="typed-confirm-phrase">' + esc(phrase) + '</code>' +
        '</label>' +
        '<input class="typed-confirm-input" type="text" autocomplete="off" spellcheck="false" ' +
          'aria-label="Type ' + escAttr(phrase) + ' to confirm">' +
        '<div class="typed-confirm-actions">' +
          '<button class="btn btn-secondary typed-confirm-cancel" type="button">Cancel</button>' +
          '<button class="btn btn-danger typed-confirm-ok" type="button" disabled>' +
            esc(opts.confirmLabel || 'Delete') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var input = wrap.querySelector('.typed-confirm-input');
    var okBtn = wrap.querySelector('.typed-confirm-ok');
    var matches = function () {
      return input.value.trim().toLowerCase() === phrase.trim().toLowerCase();
    };
    input.addEventListener('input', function () {
      var m = matches();
      okBtn.disabled = !m;
      wrap.querySelector('.typed-confirm-dialog').classList.toggle('is-armed', m);
    });
    // Enter submits only once it matches, so it can't fire on a half-typed phrase.
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && matches()) { e.preventDefault(); finish(true); }
    });
    okBtn.addEventListener('click', function () { if (matches()) finish(true); });
    wrap.querySelector('.typed-confirm-cancel').addEventListener('click', function () { finish(false); });
    wrap.querySelector('.typed-confirm-backdrop').addEventListener('click', function () { finish(false); });
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }
    document.addEventListener('keydown', onKey, true);
    setTimeout(function () { input.focus(); }, 0);
  });
}
window.typedConfirmDialog = typedConfirmDialog;

// The two standard destructive copy blocks, so every call site says the same thing.
// Soft delete is recoverable by an org admin until the retention window expires.
function binRetentionDays() {
  var n = (S.data && S.data.bin_retention_days) || 30;
  return n;
}
function softDeleteNote() {
  return 'This moves it to Deleted Items. If you need it back, ask an org admin to restore it — ' +
    'after ' + binRetentionDays() + ' days it is deleted permanently and cannot be recovered.';
}
