// Builds the Chromium variant (Chrome, Edge, Brave, ...) of the extension from extension/:
// same code, manifest with a service worker instead of background scripts.
// Usage: node scripts/build-chrome.js <out-dir> [version]
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'extension');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'chrome'));
// the output directory is deleted first: refuse anything containing the sources
if (path.relative(out, src) === '' || !path.relative(out, src).startsWith('..')) {
  console.error(`refusing to replace ${out}, it contains the extension sources`);
  process.exit(2);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (p) => !/^(tests|amo)([\\/]|$)/.test(path.relative(src, p)) });

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
if (process.argv[3]) {
  manifest.version = process.argv[3];
}

// Chromium only knows service workers; they load the same scripts via importScripts()
fs.writeFileSync(path.join(out, 'background-sw.js'),
  '// Chromium service worker: loads the background scripts shared with Firefox\n'
  + `importScripts(${manifest.background.scripts.map((s) => JSON.stringify(s)).join(', ')});\n`);
manifest.background = { service_worker: 'background-sw.js' };

// Firefox specific
delete manifest.browser_specific_settings;
manifest.permissions = manifest.permissions.map((p) => (p === 'menus' ? 'contextMenus' : p));
manifest.minimum_chrome_version = '120';

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Chromium extension ${manifest.version} in ${out}`);
