/**
 * HTTP client for the tests. Uses node:http directly so there is no new
 * dependency, and exposes the raw body as well as the parsed one -- several
 * assertions (leak scanning, escaping) need the bytes, not the object.
 */
const http = require('http');

function makeClient(port) {
  function request(method, path, { token, body, headers = {}, raw, timeout = 30000 } = {}) {
    return new Promise(resolve => {
      const h = { ...headers };
      if (token) h.Authorization = 'Bearer ' + token;
      let payload = null;
      if (raw !== undefined) {
        payload = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (!h['Content-Type']) h['Content-Type'] = 'application/octet-stream';
      } else if (body !== undefined) {
        payload = Buffer.from(JSON.stringify(body));
        h['Content-Type'] = 'application/json';
      }
      if (payload && h['Content-Length'] === undefined) h['Content-Length'] = payload.length;

      const started = process.hrtime.bigint();
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: h, timeout }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(rawBody); } catch (_) { parsed = null; }
          resolve({
            status: res.statusCode, headers: res.headers, raw: rawBody, body: parsed,
            ms: Number(process.hrtime.bigint() - started) / 1e6
          });
        });
      });
      req.on('error', e => resolve({ status: 0, err: e.code, raw: '', body: null, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'TIMEOUT', raw: '', body: null, ms: timeout }); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Sends ONLY headers, never the body. Used to prove the upload ceiling
  // rejects on the declared Content-Length before any bytes are transferred --
  // actually streaming a gigabyte would make the suite unusable.
  function headerOnly(method, path, { token, contentLength, contentType = 'multipart/form-data; boundary=----t' } = {}) {
    return new Promise(resolve => {
      const h = { 'Content-Type': contentType, 'Content-Length': String(contentLength), Expect: '100-continue' };
      if (token) h.Authorization = 'Bearer ' + token;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: h, timeout: 30000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let parsed = null; try { parsed = JSON.parse(rawBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, raw: rawBody, body: parsed });
        });
      });
      // Deliberately never write the body. If the server answers, the ceiling
      // fired on headers alone, which is the behaviour under test.
      req.on('continue', () => { /* server said go ahead -- do NOT send */ });
      req.on('error', e => resolve({ status: 0, err: e.code, raw: '', body: null }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'TIMEOUT', raw: '', body: null }); });
    });
  }

  // Builds a multipart body by hand -- no dependency, and the tests need to
  // control the exact field name and file count.
  function multipart(files, fieldName = 'files') {
    const B = '----testboundary' + Math.random().toString(16).slice(2);
    const parts = [];
    for (const f of files) {
      parts.push(Buffer.from(
        '--' + B + '\r\n' +
        'Content-Disposition: form-data; name="' + fieldName + '"; filename="' + f.name + '"\r\n' +
        'Content-Type: ' + (f.type || 'application/octet-stream') + '\r\n\r\n'));
      parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from('--' + B + '--\r\n'));
    return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + B };
  }

  const c = {
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    put: (p, o) => request('PUT', p, o),
    patch: (p, o) => request('PATCH', p, o),
    del: (p, o) => request('DELETE', p, o),
    request, headerOnly, multipart,
    postMultipart(p, files, { token, fieldName } = {}) {
      const m = multipart(files, fieldName);
      return request('POST', p, { token, raw: m.body, headers: { 'Content-Type': m.contentType } });
    }
  };
  return c;
}

module.exports = { makeClient };
