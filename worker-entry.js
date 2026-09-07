import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { views } from './bundled-views.js';
import { publicFiles } from './bundled-public.js';

const origRead = fs.readFileSync;
const origExists = fs.existsSync;
const origStat = fs.statSync;

function getView(p) {
  const s = String(p).replace(/\\/g, '/');
  const m = s.match(/views\/(.+)$/);
  if (m) { let key = m[1]; if (views[key]) return views[key]; if (!key.endsWith('.ejs') && views[key + '.ejs']) return views[key + '.ejs']; }
  const pm = s.match(/public\/(.+)$/);
  if (pm) { let key = pm[1]; if (publicFiles[key]) { const f = publicFiles[key]; return f.text !== undefined ? f.text : Buffer.from(f.b64, 'base64'); } }
  return null;
}
fs.readFileSync = function(p, ...a) { const v = getView(p); if (v !== null) return v; try { return origRead.call(fs, p, ...a); } catch { return ''; } };
fs.existsSync = function(p) { if (getView(p) !== null) return true; try { return origExists.call(fs, p); } catch { return false; } };
fs.statSync = function(p) { if (getView(p) !== null) return { isFile: () => true, isDirectory: () => false, size: 0, mtime: new Date(), mtimeMs: Date.now() }; try { return origStat.call(fs, p); } catch { return { isFile: () => false, isDirectory: () => false, size: 0, mtime: new Date(), mtimeMs: 0 }; } };

function staticMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname.replace(/^\/+/, '');
  if (pathname === '') pathname = 'index.html';
  if (publicFiles[pathname]) {
    const f = publicFiles[pathname];
    const body = f.text !== undefined ? f.text : Buffer.from(f.b64, 'base64');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(body);
    return;
  }
  next();
}

let appPromise;
async function getApp() {
  if (!appPromise) {
    appPromise = import('./server.js').then(m => {
      const app = m.default || m;
      if (typeof app.use === 'function') { app.use(staticMiddleware); }
      return app;
    });
  }
  return appPromise;
}

export default {
  async fetch(request) {
        // === Serve static files first (bypasses Express & login middleware) ===
    const url0 = new URL(request.url);
    let sp = url0.pathname.replace(/^\/+/, '');
    if (sp === '') sp = 'index.html';
    if (publicFiles[sp]) {
      const f = publicFiles[sp];
      const body = f.text !== undefined ? f.text : Buffer.from(f.b64, 'base64');
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=3600' }
      });
    }
      app = await getApp();
    } catch (e) {
      return new Response('Module load error: ' + e.message + '\n' + (e.stack || ''), { status: 500, headers: { 'content-type': 'text/plain' } });
    }

    const url = new URL(request.url);
    const headers = {};
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const cookies = {};
    if (headers['cookie']) { headers['cookie'].split(';').forEach(c => { const [n, ...v] = c.trim().split('='); if (n) cookies[n] = v.join('='); }); }
    const query = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    let body = '';
    if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();
    let parsedBody = body;
    const ct = headers['content-type'] || '';
    if (ct.includes('application/x-www-form-urlencoded') && body) { parsedBody = Object.fromEntries(new URLSearchParams(body)); }
    else if (ct.includes('application/json') && body) { try { parsedBody = JSON.parse(body); } catch {} }

    const req = new EventEmitter();
    Object.assign(req, { method: request.method, url: url.pathname + url.search, originalUrl: url.pathname + url.search, path: url.pathname, headers, cookies, query, params: {}, body: parsedBody, _body: true, ip: headers['cf-connecting-ip'] || '0.0.0.0', ips: [], protocol: 'https', secure: true, xhr: false, hostname: url.hostname, subdomains: [], get(n) { return headers[n.toLowerCase()]; }, accepts() { return true; }, is() { return null; }, resume() {}, pause() {} });

    const resHeaders = {};
    const chunks = [];
    let statusCode = 200;
    let done = false;
    let resolveResp;
    const respPromise = new Promise(r => { resolveResp = r; });
    const finish = () => { if (!done) { done = true; resolveResp(); } };

    const res = new EventEmitter();
    Object.assign(res, { statusCode: 200, headersSent: false, finished: false, locals: {}, status(c) { statusCode = c; this.statusCode = c; return this; }, sendStatus(c) { statusCode = c; chunks.push(Buffer.from(String(c))); finish(); return this; }, set(f, v) { if (typeof f === 'object') Object.assign(resHeaders, f); else resHeaders[f] = v; return this; }, setHeader(k, v) { resHeaders[k] = v; return this; }, getHeader(k) { return resHeaders[k]; }, removeHeader(k) { delete resHeaders[k]; }, header(f, v) { resHeaders[f] = v; return this; }, get(k) { return resHeaders[k.toLowerCase()]; }, type(t) { resHeaders['content-type'] = t; return this; }, contentType(t) { resHeaders['content-type'] = t; return this; }, write(c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; }, writeHead(s, h) { statusCode = s; if (h) Object.assign(resHeaders, h); }, end(c) { if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); this.finished = true; this.headersSent = true; finish(); }, send(d) { if (Buffer.isBuffer(d)) chunks.push(d); else if (typeof d === 'object' && d !== null) { if (!resHeaders['content-type']) resHeaders['content-type'] = 'application/json'; chunks.push(Buffer.from(JSON.stringify(d))); } else chunks.push(Buffer.from(String(d ?? ''))); this.finished = true; this.headersSent = true; finish(); }, json(d) { resHeaders['content-type'] = 'application/json'; chunks.push(Buffer.from(JSON.stringify(d))); this.finished = true; finish(); }, redirect(s, l) { if (typeof s === 'string') { l = s; s = 302; } statusCode = s; resHeaders['location'] = l; finish(); }, location(p) { resHeaders['location'] = p; return this; }, cookie(n, v, o) { let c = `${n}=${v}`; if (o?.maxAge) c += `; Max-Age=${o.maxAge}`; if (o?.path) c += `; Path=${o.path}`; if (o?.httpOnly) c += '; HttpOnly'; if (o?.secure) c += '; Secure'; if (o?.sameSite) c += `; SameSite=${o.sameSite}`; const ex = resHeaders['set-cookie']; if (ex) { Array.isArray(ex) ? ex.push(c) : resHeaders['set-cookie'] = [ex, c]; } else resHeaders['set-cookie'] = [c]; return this; }, clearCookie(n, o) { let c = `${n}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT`; if (o?.path) c += `; Path=${o.path}`; const ex = resHeaders['set-cookie']; if (ex) { Array.isArray(ex) ? ex.push(c) : resHeaders['set-cookie'] = [ex, c]; } else resHeaders['set-cookie'] = [c]; return this; }, append(k, v) { resHeaders[k] = resHeaders[k] ? `${resHeaders[k]}, ${v}` : v; return this; }, format() { return this; }, links() { return this; } });

    try {
      const result = app(req, res);
      if (result && typeof result.then === 'function') await result;
    } catch (e) {
      return new Response('Express error: ' + e.message + '\n' + (e.stack || ''), { status: 500, headers: { 'content-type': 'text/plain' } });
    }

    await Promise.race([respPromise, new Promise(r => setTimeout(r, 10000))]);

    const rh = new Headers();
    for (const [k, v] of Object.entries(resHeaders)) { if (v == null) continue; if (k === 'set-cookie' && Array.isArray(v)) v.forEach(c => rh.append('set-cookie', c)); else rh.set(k, String(v)); }
    const bodyOut = chunks.length > 0 ? Buffer.concat(chunks) : '';
    return new Response(bodyOut, { status: statusCode || 200, headers: rh });
  }
};
