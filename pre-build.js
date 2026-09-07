const fs = require('fs');
const path = require('path');

// === 1. Patch youtubei.js: replace `import ... with { type: 'json' }` ===
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

// === 2. Stub undici (use native fetch) ===
const undiciLines = [
  "const { EventEmitter } = require('events');",
  "class Body extends EventEmitter {",
  "  constructor(stream) { super(); this.stream = stream; }",
  "  pipe(dest) {",
  "    if (!this.stream) { if (dest.end) dest.end(); return dest; }",
  "    const reader = this.stream.getReader();",
  "    (async () => {",
  "      try { while (true) { const { done, value } = await reader.read(); if (done) break; if (dest.write) dest.write(Buffer.from(value)); } if (dest.end) dest.end(); }",
  "      catch (e) { this.emit('error', e); }",
  "    })();",
  "    return dest;",
  "  }",
  "  async dump() { if (!this.stream) return; const r = this.stream.getReader(); try { while (true) { const { done } = await r.read(); if (done) break; } } catch {} }",
  "}",
  "class Agent { compose(i) { return this; } }",
  "const interceptors = { redirect: function(o) { return function(d) { return d; }; }, dump: function(o) { return function(d) { return d; }; }, retry: function(o) { return function(d) { return d; }; } };",
  "async function request(url, opts) {",
  "  opts = opts || {};",
  "  const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, redirect: 'follow' });",
  "  const headers = {};",
  "  r.headers.forEach(function(v, k) { headers[k] = v; });",
  "  return { statusCode: r.status, headers: headers, body: new Body(r.body), trailers: {} };",
  "}",
  "module.exports = { request: request, fetch: globalThis.fetch, Headers: globalThis.Headers, Request: globalThis.Request, Response: globalThis.Response, FormData: globalThis.FormData, Agent: Agent, ProxyAgent: Agent, RetryAgent: Agent, interceptors: interceptors, setGlobalDispatcher: function() {}, getGlobalDispatcher: function() { return new Agent(); } };"
];
fs.writeFileSync('node_modules/undici/index.js', undiciLines.join('\n'));
console.log('Stubbed: undici');

// === 3. Create http-shim.js in project root ===
const httpShimLines = [
  "const { EventEmitter } = require('events');",
  "function request(options, callback) {",
  "  const req = new EventEmitter();",
  "  var protocol = options.protocol || 'http:';",
  "  var host = options.hostname || options.host || 'localhost';",
  "  var port = options.port ? ':' + options.port : '';",
  "  var url = protocol + '//' + host + port + (options.path || '/');",
  "  req.end = function() {",
  "    (async function() {",
  "      try {",
  "        var r = await fetch(url, { method: options.method || 'GET', headers: options.headers || {} });",
  "        var res = new EventEmitter();",
  "        res.statusCode = r.status;",
  "        res.headers = {};",
  "        r.headers.forEach(function(v, k) { res.headers[k] = v; });",
  "        if (callback) callback(res);",
  "        if (r.body) {",
  "          var reader = r.body.getReader();",
  "          while (true) {",
  "            var result = await reader.read();",
  "            if (result.done) { res.emit('end'); break; }",
  "            res.emit('data', Buffer.from(result.value));",
  "          }",
  "        } else { res.emit('end'); }",
  "      } catch (e) { req.emit('error', e); }",
  "    })();",
  "    return req;",
  "  };",
  "  req.write = function() { return req; };",
  "  req.on = EventEmitter.prototype.on.bind(req);",
  "  req.once = EventEmitter.prototype.once.bind(req);",
  "  return req;",
  "}",
  "function get(options, callback) {",
  "  var r = request(options, callback);",
  "  r.end();",
  "  return r;",
  "}",
  "module.exports = { request: request, get: get, createServer: function() { return { listen: function() {} }; } };"
];
fs.writeFileSync('http-shim.js', httpShimLines.join('\n'));
console.log('Created: http-shim.js');

// === 4. Stub miniget ===
const minigetLines = [
  "const { EventEmitter } = require('events');",
  "function miniget(url, opts) {",
  "  opts = opts || {};",
  "  var e = new EventEmitter();",
  "  e.pipe = function(dest) {",
  "    e.on('data', function(c) { if (dest.write) dest.write(c); });",
  "    e.on('end', function() { if (dest.end) dest.end(); });",
  "    e.on('error', function(err) { if (dest.emit) dest.emit('error', err); });",
  "    return dest;",
  "  };",
  "  (async function() {",
  "    try {",
  "      var r = await fetch(url, { headers: opts.headers || {} });",
  "      if (!r.ok) { e.emit('error', new Error('HTTP ' + r.status)); return; }",
  "      var reader = r.body.getReader();",
  "      while (true) {",
  "        var result = await reader.read();",
  "        if (result.done) { e.emit('end'); break; }",
  "        e.emit('data', Buffer.from(result.value));",
  "      }",
  "    } catch (err) { e.emit('error', err); }",
  "  })();",
  "  return e;",
  "}",
  "module.exports = miniget;"
];
fs.writeFileSync('node_modules/miniget/index.js', minigetLines.join('\n'));
console.log('Stubbed: miniget');

// === 5. Bundle EJS views: pre-compile, then strip `with` (banned in Workers strict mode) ===
function walkDir(dir, ext) {
  var results = [];
  if (!fs.existsSync(dir)) return results;
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkDir(full, ext));
    else if (ext === '' || entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

var ejs = require('ejs');

var jsSkip = new Set([
  'var','let','const','function','return','if','else','for','while','do','switch',
  'case','break','continue','new','typeof','instanceof','in','of','delete','void',
  'throw','try','catch','finally','class','extends','super','yield','async','await',
  'this','arguments','true','false','null','undefined','NaN','Infinity','default',
  'from','as','with','require','module','exports','process','console','Buffer',
  'global','globalThis','Promise','setTimeout','setInterval','clearTimeout',
  'clearInterval','encodeURIComponent','decodeURIComponent','parseInt','parseFloat',
  'isNaN','isFinite','Math','JSON','Object','Array','String','Number','Boolean',
  'Date','RegExp','Error','TypeError','RangeError','SyntaxError','Map','Set',
  'WeakMap','WeakSet','Symbol','Proxy','Reflect','escape','include','rethrow',
  'locals','__output','__append','import','export','enum','implements','interface',
  'package','private','protected','public','static','debugger','eval','arguments'

]);


var viewsDir = path.join(process.cwd(), 'views');
var viewsObj = {};

if (fs.existsSync(viewsDir)) {
  for (var vf of walkDir(viewsDir, '.ejs')) {
    var rel = path.relative(viewsDir, vf).replace(/\\/g, '/');
    var tmpl = fs.readFileSync(vf, 'utf8');
    try {
      var compiled = ejs.compile(tmpl, { filename: vf, client: true });
      var source = compiled.toString();

      // Replace `with (locals || {}) {` with var declarations + block `{` (keeps braces balanced, removes `with` keyword)
      var withMatch = source.match(/with\s*\(\s*locals\s*(?:\|\|\s*\{\}\s*)?\)\s*\{/);
      if (withMatch) {
        var afterWith = source.substring(withMatch.index + withMatch[0].length);
        var identifiers = new Set();
        var idRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
        var m;
        while (m = idRegex.exec(afterWith)) {
          var name = m[1];
          var offset = m.index;
          if (offset > 0 && afterWith[offset - 1] === '.') continue;
          if (jsSkip.has(name)) continue;
          identifiers.add(name);
        }

        var decls = '';
        if (identifiers.size > 0) {
          decls = 'var ' + Array.from(identifiers).map(function(id) {
            return id + ' = locals != null ? locals[' + JSON.stringify(id) + '] : undefined';
          }).join(', ') + ';';
        }

        // Replace `with (locals || {}) {` with `var declarations; {` (keep the { as a block)
        source = source.substring(0, withMatch.index) + decls + '\n{' + source.substring(withMatch.index + withMatch[0].length);
      }

      viewsObj[rel] = source;
    } catch (e) {
      console.error('EJS compile error for ' + rel + ': ' + e.message);
      viewsObj[rel] = 'function() { return "EJS compile error: ' + e.message.replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"; }';
    }
  }
}

var lines = ['export const views = {'];
for (var key of Object.keys(viewsObj)) {
  lines.push('  ' + JSON.stringify(key) + ': ' + viewsObj[key] + ',');
}
lines.push('};');
fs.writeFileSync('bundled-views.js', lines.join('\n') + '\n');
console.log('Bundled EJS views (' + Object.keys(viewsObj).length + ' files, pre-compiled)');

// === 6. Bundle public files using JSON.stringify ===
var publicObj = {};
var publicDir = path.join(process.cwd(), 'public');
var mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
  '.txt': 'text/plain'
};
var binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.mp3', '.wav', '.pdf'];
if (fs.existsSync(publicDir)) {
  for (var pf of walkDir(publicDir, '')) {
    var rel = path.relative(publicDir, pf).replace(/\\/g, '/');
    var ext = path.extname(pf).toLowerCase();
    var mime = mimeTypes[ext] || 'application/octet-stream';
    if (binaryExts.includes(ext)) {
      var buf = fs.readFileSync(pf);
      publicObj[rel] = { mime: mime, b64: buf.toString('base64') };
    } else {
      publicObj[rel] = { mime: mime, text: fs.readFileSync(pf, 'utf8') };
    }
  }
}
fs.writeFileSync('bundled-public.js', 'export const publicFiles = ' + JSON.stringify(publicObj) + ';\n');
console.log('Bundled public files (' + Object.keys(publicObj).length + ' files)');

// === 7. Patch ALL project .js files ===
function patchFile(filePath, isServerJs) {
  if (filePath.includes('node_modules/')) return;
  var basename = path.basename(filePath);
  if (basename === 'pre-build.js' || basename === 'worker-entry.js' || basename === 'bundled-views.js' || basename === 'bundled-public.js' || basename === 'http-shim.js') return;

  var c = fs.readFileSync(filePath, 'utf8');
  var changed = false;

  // Replace __dirname and __filename
  if (c.includes('__dirname')) { c = c.replace(/__dirname/g, '"/app"'); changed = true; }
  if (c.includes('__filename')) { c = c.replace(/__filename/g, JSON.stringify('/app/' + path.relative(process.cwd(), filePath))); changed = true; }

  // Replace require('http') and require('https') with relative path to http-shim.js
  var relDir = path.relative(path.dirname(filePath), process.cwd()).replace(/\\/g, '/');
  if (relDir === '') relDir = '.';
  var shimPath = relDir + '/http-shim';
  if (c.includes("require('http')")) { c = c.replace(/require\('http'\)/g, "require('" + shimPath + "')"); changed = true; }
  if (c.includes('require("http")')) { c = c.replace(/require\("http"\)/g, "require('" + shimPath + "')"); changed = true; }
  if (c.includes("require('https')")) { c = c.replace(/require\('https'\)/g, "require('" + shimPath + "')"); changed = true; }
  if (c.includes('require("https")')) { c = c.replace(/require\("https"\)/g, "require('" + shimPath + "')"); changed = true; }

  // Stub compression
  if (c.includes("require('compression')")) { c = c.replace(/require\('compression'\)/g, "(function(){return function(req,res,next){next();};})"); changed = true; }
  if (c.includes('require("compression")')) { c = c.replace(/require\("compression"\)/g, "(function(){return function(req,res,next){next();};})"); changed = true; }

  // Remove express.static
  if (c.match(/express\.static\s*\(/)) {
    c = c.replace(/app\.use\(\s*express\.static\([^)]*\)\s*\)/g, function(m) { return '// REMOVED: ' + m; });
    c = c.replace(/express\.static\([^)]*\)/g, function(m) { return '(function(){return function(req,res,next){next();};})() /* was: ' + m + ' */'; });
    changed = true;
  }

  // Remove app.listen
  if (c.match(/app\.listen\s*\(/)) { c = c.replace(/app\.listen\([^;]*;/g, function(m) { return '// REMOVED: ' + m; }); changed = true; }

  // Remove http.createServer
  if (c.match(/http\.createServer\s*\(/)) { c = c.replace(/http\.createServer\([^;]*;/g, function(m) { return '// REMOVED: ' + m; }); changed = true; }

  // Remove fs.createReadStream
  if (c.includes('fs.createReadStream')) { c = c.replace(/fs\.createReadStream/g, '// REMOVED: fs.createReadStream'); changed = true; }

  // Remove fs write operations
  if (c.match(/fs\.(writeFile|writeFileSync|mkdir|mkdirSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rename|renameSync|copyFile|copyFileSync)/)) {
    c = c.replace(/fs\.(writeFile|writeFileSync|mkdir|mkdirSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rename|renameSync|copyFile|copyFileSync)/g, function(m) { return '// REMOVED: ' + m; });
    changed = true;
  }

  // Stub child_process
  if (c.includes("require('child_process')")) { c = c.replace(/require\('child_process'\)/g, '{} /* child_process not available */'); changed = true; }
  if (c.includes('require("child_process")')) { c = c.replace(/require\("child_process"\)/g, '{} /* child_process not available */'); changed = true; }

  // Server.js specific patches
  if (isServerJs) {
    var idx = c.indexOf('process.on');
    if (idx !== -1) { c = c.substring(0, idx); changed = true; }
    c = c.replace(/async\s+function\s+initInnerTube\s*\(\)\s*\{[\s\S]*?\n\}/g, '// initInnerTube removed for Workers\n');
    c = c.replace(/initInnerTube\s*\(\s*\)\s*;?/g, '// initInnerTube() removed\n');
    c = c.replace(/"use strict";?\n?/g, '');
    if (c.includes('module.exports') === false) c += '\nmodule.exports = app;\n';
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, c);
    console.log('Patched: ' + filePath);
  }
}

function walkJsFiles(dir) {
  var results = [];
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

for (var f of walkJsFiles(process.cwd())) {
  patchFile(f, path.basename(f) === 'server.js');
}

console.log('Pre-build complete!');
