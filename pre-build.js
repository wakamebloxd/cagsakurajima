// Pre-build: patches youtubei.js & undici, bundles EJS views, patches server.js
const fs = require('fs');
const path = require('path');

// === 1. Patch youtubei.js: `import ... with { type: 'json' }` ===
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

// === 2. Patch undici: remove node:sqlite ===
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

// === 3. Bundle EJS views into bundled-views.js ===
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

// === 4. Patch server.js: convert to ES module ===
if (fs.existsSync('server.js')) {
  let c = fs.readFileSync('server.js', 'utf8');
  // Remove everything from "if (require.main" to end of file
  const idx = c.indexOf('if (require.main');
  if (idx !== -1) c = c.substring(0, idx);
  // Replace module.exports with export default
  c = c.replace(/module\.exports\s*=\s*app\s*;?/g, 'export default app;');
  // Remove "use strict"
  c = c.replace(/"use strict";?\n?/g, '');
  // Ensure export default is present
  if (!c.includes('export default')) c += '\nexport default app;\n';
  fs.writeFileSync('server.js', c);
  console.log('Patched: server.js');
}

console.log('Pre-build complete!');
