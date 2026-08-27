
// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
// All three renderers below build their text with textContent, never by
// interpolating into innerHTML. They used to concatenate the caller's message
// straight into innerHTML, which executed any markup in it -- and real call
// sites interpolate values a user controls: an uploaded file's name
// (space-context-menu.js), a custom field's name (space/settings.js), a space
// name or key (crud/space.js), a user's display name and an invitee's email
// (admin-settings.js). A file named `<img src=x onerror=…>.png` ran on upload.
// textContent is used rather than esc() at the call sites because it removes
// the vector at the sink: a future caller cannot forget to escape.
function toast(msg, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  var icon = type === 'error' ? '✕' : type === 'warning' ? '⚠️' : '✓';
  var iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icon;
  var msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  // String(msg), not a falsy guard: the old code concatenated msg into a
  // template, so undefined rendered as the literal "undefined". Keeping that
  // exact behaviour here so this commit changes no rendered text; the one
  // call site that can hit it (issue-drawer.js's bare e.message) is fixed
  // separately as a message change, not smuggled in as a rendering change.
  msgEl.textContent = String(msg);
  el.appendChild(iconEl);
  el.appendChild(msgEl);
  c.appendChild(el);
  setTimeout(function () { el.classList.add('toast-fade'); }, 3000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3600);
}

// A toast that offers one or more follow-up actions instead of just a message —
// e.g. "PTM-9 created" with buttons to open it or copy its link, for the case
// where auto-navigating away would be disruptive (a ticket is already open).
// Stays up longer than a plain toast and only auto-dismisses if nothing was
// clicked, since deciding takes a moment longer than reading a status line.
// buttons: [{ label, handler, dismissOnClick }] — dismissOnClick defaults true.
function toastWithButtons(msg, buttons, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast toast-' + type + ' toast-with-actions';
  var icon = type === 'error' ? '✕' : type === 'warning' ? '⚠️' : '✓';
  var iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icon;
  var msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  // This one previously went through esc(), which returns '' for any falsy
  // input -- so a falsy msg rendered empty here, not "undefined" as in
  // toast() above. Preserved rather than unified: same reason as above.
  msgEl.textContent = msg ? String(msg) : '';
  el.appendChild(iconEl);
  el.appendChild(msgEl);

  var timers = [];
  function dismiss() {
    timers.forEach(clearTimeout);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  var actionsWrap = document.createElement('div');
  actionsWrap.className = 'toast-actions';
  (buttons || []).forEach(function (b) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action-btn';
    btn.textContent = b.label;
    btn.onclick = function () {
      if (b.handler) b.handler();
      if (b.dismissOnClick !== false) dismiss();
    };
    actionsWrap.appendChild(btn);
  });
  el.appendChild(actionsWrap);

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close-btn';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.onclick = dismiss;
  el.appendChild(closeBtn);

  c.appendChild(el);
  timers.push(setTimeout(function () { el.classList.add('toast-fade'); }, 8000));
  timers.push(setTimeout(dismiss, 8600));
  return el;
}

// allowHtmlMsg opts ONE caller into rendering msg as markup: the "Invitation
// Resent / email not sent" alert in admin-settings.js, which appends
// `<br><small style="word-break:break-all">` + the invite URL so a long link
// wraps instead of overflowing the alert. That caller escapes its own
// interpolations. Every other caller gets msg as plain text, so none of them
// can be made to execute markup by a space name, user name or email address.
// title is always plain text — no caller passes markup in it.
function popupAlert(title, msg, type, allowHtmlMsg) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'popup-alert popup-alert-' + type;
  var icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅';

  var iconEl = document.createElement('div');
  iconEl.className = 'popup-alert-icon';
  iconEl.textContent = icon;

  var bodyEl = document.createElement('div');
  bodyEl.className = 'popup-alert-body';
  var titleEl = document.createElement('div');
  titleEl.className = 'popup-alert-title';
  titleEl.textContent = String(title);
  var msgEl = document.createElement('div');
  msgEl.className = 'popup-alert-msg';
  if (allowHtmlMsg) msgEl.innerHTML = String(msg);
  else msgEl.textContent = String(msg);
  bodyEl.appendChild(titleEl);
  bodyEl.appendChild(msgEl);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'popup-alert-close';
  // Kept as an inline attribute rather than a bound handler so the element
  // serialises identically to the previous innerHTML build.
  closeBtn.setAttribute('onclick', 'this.parentNode.remove()');
  closeBtn.textContent = '✕';

  el.appendChild(iconEl);
  el.appendChild(bodyEl);
  el.appendChild(closeBtn);
  c.appendChild(el);
  setTimeout(function () { el.classList.add('popup-fade'); }, 4000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4700);
}
