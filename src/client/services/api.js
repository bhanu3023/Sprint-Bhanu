
// ═══════════════════════════════════════════════════════════
// API WRAPPER
// ═══════════════════════════════════════════════════════════
function getAuthToken() { return localStorage.getItem('sb-token') || ''; }

/** Authenticated file URL for img/a tags (session token as query param). */
function fileApiUrl(fileIdOrPath) {
  var id = fileIdOrPath;
  if (typeof id === 'string' && id.indexOf('/api/files/') === 0) {
    id = id.replace(/^\/api\/files\//, '').split('?')[0];
  }
  var t = getAuthToken();
  return '/api/files/' + encodeURIComponent(id) + (t ? '?t=' + encodeURIComponent(t) : '');
}

function augmentFileUrlsInHtml(html) {
  if (!html || html.indexOf('/api/files/') === -1) return html;
  var t = getAuthToken();
  if (!t) return html;
  // Consumes an existing "?t=..." (if any) instead of just stopping before it,
  // so a description saved with a stale token already baked in — see the
  // drawer description/fix-description save handlers — gets a single fresh
  // token here rather than a second one appended after the old one.
  return html.replace(/\/api\/files\/([^"'\s?]+)(?:\?t=[^"'\s&]+)?/g, function (_m, id) {
    return '/api/files/' + id + '?t=' + encodeURIComponent(t);
  });
}

function stripFileAuthTokensFromHtml(html) {
  if (!html || html.indexOf('/api/files/') === -1) return html;
  return html.replace(/\/api\/files\/([^"'\s?]+)\?t=[^"'\s&]+/g, '/api/files/$1');
}

// fetch() only throws a TypeError when the request never got an HTTP response at
// all — offline, DNS failure, connection reset, CORS block, an upload larger than
// a reverse proxy will accept. Its message ("Failed to fetch", "NetworkError when
// attempting to fetch resource.", Safari's "Load failed") is a browser-internal
// string, not something written for a user to read — surfacing it verbatim in a
// toast looks like a broken error message even though it correctly identifies a
// connectivity problem. Anything that reached the server and came back as a JSON
// {error: "..."} is unaffected by this and keeps its own real message.
function friendlyFetchErrorMessage(e, fallback) {
  if (e instanceof TypeError) {
    return 'Could not reach the server — check your connection and try again.';
  }
  return (e && e.message) || fallback || 'Something went wrong';
}

async function api(url, method, body, opts) {
  opts = opts || {};
  method = method || 'GET';
  try {
    var token = getAuthToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var fetchOpts = { method: method, headers: headers };
    if (body !== undefined && body !== null) fetchOpts.body = JSON.stringify(body);
    var res;
    try {
      res = await fetch(url, fetchOpts);
    } catch (networkErr) {
      throw new Error(friendlyFetchErrorMessage(networkErr, 'API request failed'));
    }
    if (res.status === 401) {
      localStorage.removeItem('sb-token');
      localStorage.removeItem('sb-user');
      window.location.href = '/login.html';
      return;
    }
    if (!res.ok) {
      var err;
      try { err = await res.json(); } catch (_) { err = {}; }
      throw new Error(err.error || res.statusText);
    }
    if (res.status === 204) return null;
    return await res.json();
  } catch (e) {
    if (e.message && e.message.includes('redirect')) return;
    // errorReason maps text written for a machine (a bare 500 body, a raw
    // HTTP statusText) onto something a person can act on, and never yields
    // an empty string. Messages the API already writes for users pass through
    // unchanged. Applied here so every call site that does NOT render its own
    // message still gets readable text; sites that DO render their own pass
    // {silent:true} so one failure never stacks two error toasts.
    // capitaliseFirst because here the reason IS the whole message rather
    // than a clause after a dash -- errorReason lower-cases the first letter
    // for the dash form, and this is its one standalone caller.
    if (!opts.silent) toast(capitaliseFirst(errorReason(e, 'the request failed')), 'error');
    throw e;
  }
}
