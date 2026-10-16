'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'providers/krmizi.js');
const start = '// BEGIN EXTRA SOURCE ADAPTERS';
const end = '// END EXTRA SOURCE ADAPTERS';
let core = fs.readFileSync(filename, 'utf8');
const fragment = fs.readFileSync(path.join(root, 'providers/extra-sources.fragment.js'), 'utf8').trim();
const block = start + '\n' + fragment + '\n' + end + '\n\n';
if (core.includes(start)) {
  const first = core.indexOf(start), last = core.indexOf(end, first);
  if (last < 0) throw Error('Missing adapter end marker');
  core = core.slice(0, first) + block + core.slice(last + end.length).replace(/^\s*\n/, '').replace(/^\n/, '');
} else {
  core = core.replace('function getStreams(tmdbId, mediaType, season, episode) {', block + 'function getStreams(tmdbId, mediaType, season, episode) {');
}
fs.writeFileSync(filename, core);
