const fs = require('fs');
const path = require('path');

// === 1. Patch youtubei.js ===
const ytiFiles = [
  'node_modules/youtubei.js/dist/src/core/Player.js',
  'node_modules/youtubei.js/dist/src/core/Session.js',
  'node_modules/youtubei.js/dist/src/parser/parser.js',
  'node_modules/youtubei.js/dist/src/utils/StreamingInfo.js',
  'node_modules/youtubei.js/dist/src/utils/Utils.js',
];
for (const p of ytiFiles) {
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/import\s+(\w+)\s+from\s+['"][^'"]*package\.json['"]\s+with\s*\{\s*type:\s*['"]json['"]\s*\}\s*;?/g, 'const $1 = { version: "0.0.0", name: "youtubei.js" };');
    fs.writeFileSync(p, c);
    console.log('Patched: ' + p);
  }
}


const undiciShim = `const { EventEmitter } = require('events');
class Body extends EventEmitter {
  constructor(stream) { super(); this.stream = stream; }
  pipe(dest) {
    if (!this.stream) { if (dest.end) dest.end(); return dest; }
    const reader = this.stream.getReader();
    (async () => {
      try { while (true) { const { done, value } = await reader.read(); if (done) break; if (dest.write) dest.write(Buffer.from(value)); } if (dest.end) dest.end(); }
      catch (e) { this.emit('error', e); }
    })();
    return dest;
  }
  async dump() { if (!this.stream) return; const r = this.stream.getReader(); try { while (true) { const { done } = await r.read(); if (done) break; } } catch {} }
}
class Agent { compose(i) { return this; } }
const interceptors = { redirect: (o) => (d) => d, dump: (o) => (d) => d, retry: (o) => (d) => d };
async function request(url, opts = {}) {
  const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, redirect: 'follow' });
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  return { statusCode: r.status, headers, body: new Body(r.body), trailers: {} };
}
module.exports = { request, fetch: globalThis.fetch, Headers: globalThis.Headers, Request: globalThis.Request, Response: globalThis.Response, FormData: globalThis.FormData, Agent, ProxyAgent: Agent, RetryAgent: Agent, interceptors, setGlobalDispatcher: () => {}, getGlobalDispatcher: () => new Agent() };`;
fs.writeFileSync('node_modules/undici/index.js', undiciShim);
console.log('Stubbed: undici');

// === 3. Write http-shim ===
fs.mkdirSync('node_modules/http-shim', { recursive: true });
const httpShim = `const { EventEmitter } = require('events');
function request(options, callback) {
  const req = new EventEmitter();
  const url = (options.protocol || 'http:') + '//' + (options.hostname || options.host) + (options.path || '/');
  req.end = function() {
    (async () => {
      try {
        const r = await fetch(url, { method: options.method || 'GET', headers: options.headers || {} });
        const res = new EventEmitter();
        res.statusCode = r.status;
        res.headers = {};
        r.headers.forEach((v, k) => { res.headers[k] = v; });
        if (callback) callback(res);
        if (r.body) { const reader = r.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) { res.emit('end'); break; } res.emit('data', Buffer.from(value)); } } else { res.emit('end'); }
      } catch (e) { req.emit('error', e); }
    })();
    return req;
  };
  req.write = function() { return req; };
  return req;
}
module.exports = { request, get: function(o, cb) { const r = request(o, cb); r.end(); return r; }, createServer: function() { return { listen: function() {} }; } };`;
fs.writeFileSync('node_modules/http-shim/index.js', httpShim);
fs.writeFileSync('node_modules/http-shim/package.json', JSON.stringify({ name: 'http-shim', version: '1.0.0', main: 'index.js' }));
console.log('Created: http-shim');

// === 4. Write miniget shim ===
const minigetShim = `const { EventEmitter } = require('events');
function miniget(url, opts = {}) {
  const e = new EventEmitter();
  e.pipe = function(dest) {
    e.on('data', c => { if (dest.write) dest.write(c); });
    e.on('end', () => { if (dest.end) dest.end(); });
    e.on('error', err => { if (dest.emit) dest.emit('error', err); });
    return dest;
  };
  (async () => {
    try {
      const r = await fetch(url, { headers: opts.headers || {} });
      if (!r.ok) { e.emit('error', new Error('HTTP ' + r.status)); return; }
      const reader = r.body.getReader();
      while (true) { const { done, value } = await reader.read(); if (done) { e.emit('end'); break; } e.emit('data', Buffer.from(value)); }
    } catch (err) { e.emit('error', err); }
  })();
  return e;
}
module.exports = miniget;`;
fs.writeFileSync('node_modules/miniget/index.js', minigetShim);
console.log('Stubbed: miniget');

// === 5. Bundle EJS views ===
function walkDir(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full, ext));
    else if (ext === '' || entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}
const viewsDir = path.join(process.cwd(), 'views');
let viewsOut = '// Auto-generated. Do not edit.\nexport const views = {\n';
if (fs.existsSync(viewsDir)) {
  for (const vf of walkDir(viewsDir, '.ejs')) {
    const rel = path.relative(viewsDir, vf).replace(/\\\\/g, '/');
    const content = fs.readFileSync(vf, 'utf8');
    const escaped = content.replace(/\\\\/g, '\\\\\\\\').replace(/\`/g, '\\\\\`').replace(/\\$/g, '\\\\$');
    viewsOut += '  ' + JSON.stringify(rel) + ': \`' + escaped + '\`,\n';
  }
}
viewsOut += '};\n';
fs.writeFileSync('bundled-views.js', viewsOut);
console.log('Bundled EJS views');

// === 6. Bundle public files ===
const publicDir = path.join(process.cwd(), 'public');
let publicOut = '// Auto-generated. Do not edit.\nexport const publicFiles = {\n';
if (fs.existsSync(publicDir)) {
  for (const pf of walkDir(publicDir, '')) {
    const rel = path.relative(publicDir, pf).replace(/\\\\/g, '/');
    const ext = path.extname(pf).toLowerCase();
    const mimeTypes = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.pdf':'application/pdf','.txt':'text/plain'};
    const mime = mimeTypes[ext] || 'application/octet-stream';
    const isBinary = ['.png','.jpg','.jpeg','.gif','.ico','.woff','.woff2','.ttf','.mp4','.webm','.mp3','.wav','.pdf'].includes(ext);
    if (isBinary) {
      const buf = fs.readFileSync(pf);
      publicOut += '  ' + JSON.stringify(rel) + ': { mime: ' + JSON.stringify(mime) + ', b64: ' + JSON.stringify(buf.toString('base64')) + ' },\n';
    } else {
      const content = fs.readFileSync(pf, 'utf8');
      const escaped = content.replace(/\\\\/g, '\\\\\\\\').replace(/\`/g, '\\\\\`').replace(/\\$/g, '\\\\$');
      publicOut += '  ' + JSON.stringify(rel) + ': { mime: ' + JSON.stringify(mime) + ', text: \`' + escaped + '\` },\n';
    }
  }
}
publicOut += '};\n';
fs.writeFileSync('bundled-public.js', publicOut);
console.log('Bundled public files');

// === 7. Patch ALL project .js files ===
function patchFile(filePath, isServerJs) {
  if (filePath.includes('node_modules/')) return;
  if (filePath.endsWith('pre-build.js') || filePath.endsWith('worker-entry.js') || filePath.endsWith('bundled-views.js') || filePath.endsWith('bundled-public.js')) return;
  let c = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  if (c.includes('__dirname')) { c = c.replace(/__dirname/g, '"/app"'); changed = true; }
  if (c.includes('__filename')) { c = c.replace(/__filename/g, JSON.stringify('/app/' + path.relative(process.cwd(), filePath))); changed = true; }
  if (c.match(/require\(['"]http['"]\)/)) { c = c.replace(/require\(['"]http['"]\)/g, "require('http-shim')"); changed = true; }
  if (c.match(/require\(['"]https['"]\)/)) { c = c.replace(/require\(['"]https['"]\)/g, "require('http-shim')"); changed = true; }
  if (c.match(/require\(['"]compression['"]\)/)) { c = c.replace(/require\(['"]compression['"]\)/g, '(function(){return function(){return function(req,res,next){next();};};})'); changed = true; }
  if (c.match(/express\.static\s*\(/)) {
    c = c.replace(/app\.use\(\s*express\.static\([^)]*\)\s*\)/g, m => '// REMOVED: ' + m);
    c = c.replace(/express\.static\([^)]*\)/g, m => '(function(){return function(req,res,next){next();};})() /* was: ' + m + ' */');
    changed = true;
  }
  if (c.match(/app\.listen\s*\(/)) { c = c.replace(/app\.listen\([^;]*;/g, m => '// REMOVED: ' + m); changed = true; }
  if (c.match(/http\.createServer\s*\(/)) { c = c.replace(/http\.createServer\([^;]*;/g, m => '// REMOVED: ' + m); changed = true; }
  if (c.match(/fs\.createReadStream/)) { c = c.replace(/fs\.createReadStream/g, '// REMOVED: fs.createReadStream'); changed = true; }
  if (c.match(/fs\.(writeFile|writeFileSync|mkdir|mkdirSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rename|renameSync|copyFile|copyFileSync)/)) {
    c = c.replace(/fs\.(writeFile|writeFileSync|mkdir|mkdirSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rename|renameSync|copyFile|copyFileSync)/g, m => '// REMOVED: ' + m);
    changed = true;
  }
  if (c.match(/require\(['"]child_process['"]\)/)) { c = c.replace(/require\(['"]child_process['"]\)/g, '{} /* child_process not available */'); changed = true; }
  if (isServerJs) {
    const idx = c.indexOf('process.on');
    if (idx !== -1) { c = c.substring(0, idx); changed = true; }
    c = c.replace(/async\s+function\s+initInnerTube\s*\(\)\s*\{[\s\S]*?^}/gm, '// initInnerTube removed for Workers\n');
    c = c.replace(/initInnerTube\s*\(\s*\)\s*;?/g, '// initInnerTube() removed\n');
    c = c.replace(/"use strict";?\n?/g, '');
    if (!c.includes('module.exports')) c += '\nmodule.exports = app;\n';
    changed = true;
  }
  if (changed) { fs.writeFileSync(filePath, c); console.log('Patched: ' + filePath); }
}
function walkJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}
for (const f of walkJsFiles(process.cwd())) { patchFile(f, path.basename(f) === 'server.js'); }
console.log('Pre-build complete!');
