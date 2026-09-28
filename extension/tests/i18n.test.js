// The message catalogs (_locales) cover each other and every key the code uses.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(root, '_locales', lang, 'messages.json'), 'utf8'));
const en = catalog('en');
const de = catalog('de');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['tests', '_locales', 'amo', 'icons'].includes(e.name) ? [] : files(p);
    return /\.(js|html|json)$/.test(e.name) ? [p] : [];
  });
}

test('both languages have the same keys', () => {
  assert.deepStrictEqual(Object.keys(de).sort(), Object.keys(en).sort());
});

test('placeholders match between the languages', () => {
  for (const key of Object.keys(en)) {
    const ph = (m) => (m.match(/\$\d/g) || []).sort().join();
    assert.strictEqual(ph(de[key].message), ph(en[key].message), key);
  }
});

test('every key used in the code exists', () => {
  const used = new Set();
  for (const file of files(root)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [/\bt\('([\w@]+)'(?! \+)/g, /rcidT\('([\w@]+)'/g, /data-i18n(?:-\w+)?="(\w+)"/g, /__MSG_(\w+)__/g]) {
      for (const m of src.matchAll(re)) used.add(m[1]);
    }
    // keys built from a prefix
    for (const m of src.matchAll(/\(filled > 1 \? '(\w+)' : '(\w+)'\) \+ \(copied \? '(\w+)'/g)) {
      used.add(m[1]).add(m[2]).add(m[1] + m[3]).add(m[2] + m[3]);
    }
  }
  used.delete('@@ui_locale');
  assert.ok(used.size > 50, `only ${used.size} keys found`);
  for (const key of used) {
    assert.ok(en[key], `missing key ${key}`);
  }
});

test('every error code of the API client has a text', () => {
  const src = fs.readFileSync(path.join(root, 'lib', 'api.js'), 'utf8');
  const codes = src.match(/new Set\(\[([^\]]+)\]\)/)[1].match(/'(\w+)'/g).map((c) => c.slice(1, -1));
  for (const code of codes) {
    assert.ok(en['err_' + code], `missing err_${code}`);
  }
});
