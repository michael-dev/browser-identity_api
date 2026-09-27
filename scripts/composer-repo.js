// Writes a static Composer repository (packages.json) for the plugin archives.
// Composer installs a package from the root of its archive, and the plugin
// lives in plugin/, so Composer uses the release archives, not the git repository.
//
// Usage: node scripts/composer-repo.js <url-template> <tag>=<identity_api-*.zip|.tar.gz> ... > packages.json
//   url-template: download URL of an archive, {tag} and {file} are replaced
//   (the version is the tag without a leading "v")
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [template, ...archives] = process.argv.slice(2);
if (!template || !archives.length) {
  console.error('Usage: node scripts/composer-repo.js <url-template> <tag>=<archive> ...');
  process.exit(2);
}

const fallback = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'composer.json'), 'utf8'));
const versions = {};

for (const arg of archives) {
  const eq = arg.indexOf('=');
  const tag = arg.slice(0, eq);
  const version = tag.replace(/^v/, '');
  const file = arg.slice(eq + 1);
  if (eq < 1 || !fs.existsSync(file)) {
    throw new Error(`invalid argument ${arg}`);
  }

  // zip preferred: Composer can't extract tar archives on PHP < 8
  const zip = file.endsWith('.zip');

  // metadata of that version, as shipped in its archive
  let meta;
  try {
    const [cmd, args] = zip ? ['unzip', ['-p', file]] : ['tar', ['-xzOf', file]];
    meta = JSON.parse(execFileSync(cmd, [...args, 'identity_api/composer.json'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    meta = fallback;
  }

  versions[version] = Object.assign({}, meta, {
    version,
    dist: {
      type: zip ? 'zip' : 'tar',
      url: template.replace(/\{tag\}/g, tag).replace(/\{file\}/g, path.basename(file)),
      shasum: crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'),
    },
  });
}

process.stdout.write(JSON.stringify({ packages: { [fallback.name]: versions } }, null, 2) + '\n');
