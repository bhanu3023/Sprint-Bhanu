
// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function toast(msg, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  var icon = type === 'error' ? '✕' : type === 'warning' ? '⚠️' : '✓';
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + msg + '</span>';
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
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-msg">' + esc(msg) + '</span>';

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

function popupAlert(title, msg, type) {
  type = type || 'success';
  var c = $('toastContainer');
  var el = document.createElement('div');
  el.className = 'popup-alert popup-alert-' + type;
  var icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'info' ? 'ℹ️' : '✅';
  el.innerHTML =
    '<div class="popup-alert-icon">' + icon + '</div>' +
    '<div class="popup-alert-body">' +
    '<div class="popup-alert-title">' + title + '</div>' +
    '<div class="popup-alert-msg">' + msg + '</div>' +
    '</div>' +
    '<button class="popup-alert-close" onclick="this.parentNode.remove()">✕</button>';
  c.appendChild(el);
  setTimeout(function () { el.classList.add('popup-fade'); }, 4000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4700);
}
