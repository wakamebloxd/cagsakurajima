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

// === 2. Stub undici (incompatible with Workers, use native fetch) ===
const undiciStub = `
const noop = function() {};
const noopAsync = async function() { return {}; };
module.exports = new Proxy({}, {
  get(target, prop) {
    if (prop === 'fetch') return globalThis.fetch;
    if (prop === 'Headers') return globalThis.Headers;
    if (prop === 'Request') return globalThis.Request;
    if (prop === 'Response') return globalThis.Response;
    if (prop === 'FormData') return globalThis.FormData;
    if (prop === 'WebSocket') return globalThis.WebSocket;
    if (prop === 'request') return async function(url, opts) {
      const r = await fetch(url, opts);
      return { statusCode: r.status, headers: r.headers, body: r.body, trailers: {} };
    };
    if (prop === 'redirect') return async function(url, opts) {
      const r = await fetch(url, opts);
      return { statusCode: r.status, headers: r.headers, body: r.body, trailers: {} };
    };
    if (prop === 'stream') return async function*() {};
    if (prop === 'pipeline') return noop;
    if (prop === 'Agent') return noop;
    if (prop === 'ProxyAgent') return noop;
    if (prop === 'RetryAgent') return noop;
    if (prop === 'MockAgent') return noop;
    if (prop === 'MockClient') return noop;
    if (prop === 'MockPool') return noop;
    if (prop === 'Agent') return noop;
    if (prop === 'Client') return noop;
    if (prop === 'Pool') return noop;
    if (prop === 'BalancedPool') return noop;
    if (prop === 'errors') return {};
    if (prop === 'setGlobalDispatcher') return noop;
    if (prop === 'getGlobalDispatcher') return noop;
    if (prop === 'isLocalhost') return () => false;
    return noop;
  }
});
`;

const undiciMain = 'node_modules/undici/index.js';
if (fs.existsSync(undiciMain)) {
  fs.writeFileSync(undiciMain, undiciStub);
  console.log('Stubbed: undici');
}
// Also stub undici submodules
const undiciSubs = ['node_modules/undici/lib'];
for (const d of undiciSubs) {
  if (fs.existsSync(d)) {
    // Create a package.json redirect
  }
}

// === 3. Bundle EJS views ===
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
    const rel = path.relative(viewsDir, vf).replace(/\\/g, '/');
    const content = fs.readFileSync(vf, 'utf8');
    const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    viewsOut += `  ${JSON.stringify(rel)}: \`${escaped}\`,\n`;
  }
}
viewsOut += '};\n';
fs.writeFileSync('bundled-views.js', viewsOut);
console.log('Bundled EJS views');

// === 4. Bundle public/ static files ===
const publicDir = path.join(process.cwd(), 'public');
let publicOut = '// Auto-generated. Do not edit.\nexport const publicFiles = {\n';
if (fs.existsSync(publicDir)) {
  for (const pf of walkDir(publicDir, '')) {
    const rel = path.relative(publicDir, pf).replace(/\\/g, '/');
    const ext = path.extname(pf).toLowerCase();
    const mimeTypes = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.pdf':'application/pdf','.txt':'text/plain'};
    const mime = mimeTypes[ext] || 'application/octet-stream';
    const isBinary = ['.png','.jpg','.jpeg','.gif','.ico','.woff','.woff2','.ttf','.mp4','.webm','.mp3','.wav','.pdf'].includes(ext);
    if (isBinary) {
      const buf = fs.readFileSync(pf);
      publicOut += `  ${JSON.stringify(rel)}: { mime: ${JSON.stringify(mime)}, b64: ${JSON.stringify(buf.toString('base64'))} },\n`;
    } else {
      const content = fs.readFileSync(pf, 'utf8');
      const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      publicOut += `  ${JSON.stringify(rel)}: { mime: ${JSON.stringify(mime)}, text: \`${escaped}\` },\n`;
    }
  }
}
publicOut += '};\n';
fs.writeFileSync('bundled-public.js', publicOut);
console.log('Bundled public files');

// === 5. Patch ALL project .js files ===
function patchFile(filePath, isServerJs) {
  if (filePath.includes('node_modules/')) return;
  if (filePath.endsWith('pre-build.js') || filePath.endsWith('worker-entry.js') || filePath.endsWith('bundled-views.js') || filePath.endsWith('bundled-public.js')) return;
  let c = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  if (c.includes('__dirname')) { c = c.replace(/__dirname/g, '"/app"'); changed = true; }
  if (c.includes('__filename')) { c = c.replace(/__filename/g, JSON.stringify('/app/' + path.relative(process.cwd(), filePath))); changed = true; }
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
