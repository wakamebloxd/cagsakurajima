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
    c = c.replace(
      /import\s+(\w+)\s+from\s+['"][^'"]*package\.json['"]\s+with\s*\{\s*type:\s*['"]json['"]\s*\}\s*;?/g,
      'const $1 = { version: "0.0.0", name: "youtubei.js" };'
    );
    fs.writeFileSync(p, c);
    console.log('Patched: ' + p);
  }
}

// === 2. Patch undici ===
const undiciFiles = [
  'node_modules/undici/lib/cache/sqlite-cache-store.js',
  'node_modules/undici/lib/util/runtime-features.js',
];
for (const p of undiciFiles) {
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/require\(['"]node:sqlite['"]\)/g, 'undefined');
    c = c.replace(/'node:sqlite':\s*\(\)\s*=>\s*require\(['"]node:sqlite['"]\)/g, "'node:sqlite': () => undefined");
    fs.writeFileSync(p, c);
    console.log('Patched: ' + p);
  }
}

// === 3. Bundle EJS views ===
function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.name.endsWith('.ejs')) results.push(full);
  }
  return results;
}
const viewsDir = path.join(process.cwd(), 'views');
let out = '// Auto-generated. Do not edit.\nexport const views = {\n';
if (fs.existsSync(viewsDir)) {
  for (const vf of walkDir(viewsDir)) {
    const rel = path.relative(viewsDir, vf).replace(/\\/g, '/');
    const content = fs.readFileSync(vf, 'utf8');
    const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    out += `  ${JSON.stringify(rel)}: \`${escaped}\`,\n`;
  }
}
out += '};\n';
fs.writeFileSync('bundled-views.js', out);
console.log('Bundled EJS views');

// === 4. Patch server.js (keep CommonJS, just remove server startup) ===
if (fs.existsSync('server.js')) {
  let c = fs.readFileSync('server.js', 'utf8');
  // Remove everything from "process.on" to end of file
  const idx = c.indexOf('process.on');
  if (idx !== -1) c = c.substring(0, idx);
  // Remove "use strict" (esbuild handles this)
  c = c.replace(/"use strict";?\n?/g, '');
  // Keep module.exports = app (DO NOT convert to ES module)
  // Just ensure it ends with module.exports = app
  if (!c.includes('module.exports')) c += '\nmodule.exports = app;\n';
  fs.writeFileSync('server.js', c);
  console.log('Patched: server.js');
}

console.log('Pre-build complete!');
