'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const code = fs.readFileSync(require.resolve('../providers/krmizi.js'), 'utf8');

// Match the embedded runtime's small Cheerio API, including wrapped each() nodes.
function shimLoad(html) {
  const $ = cheerio.load(html);
  function wrap(nodes) {
    return {
      length: nodes.length,
      attr: key => nodes.attr(key), text: () => nodes.text(),
      first: () => wrap(nodes.first()), find: selector => wrap(nodes.find(selector)),
      each: callback => { nodes.each((i, node) => callback(i, wrap($(node)))); }
    };
  }
  return selector => wrap($(selector));
}
function runtime() {
  const ctx = { module: { exports: {} },
    require: () => ({ load: shimLoad }),
    fetch: () => Promise.reject(Error('network must not be touched')),
    console: { log: () => {} } };
  vm.runInNewContext(code, ctx);
  return ctx;
}
// The live page writes `/albaplayer/ezel.S01E07` while its own server links
// write `/albaplayer/ezel-s01e07?serv=N` (dot + capitals vs dash + lowercase).
function serverMenu(path, count = 6, origin = 'https://shooof.site') {
  const items = [];
  for (let i = 1; i <= count; i++) {
    items.push(`<li><a class="aplr-link" href="${origin}${path}?serv=${i}" role="button">Server ${i}</a></li>`);
  }
  return `<title>ezel</title><ul class="aplr-menu">${items.join('')}</ul>`;
}

test('a dot-and-uppercase player page finds its dashed lowercase servers', () => {
  const ctx = runtime();
  const playerUrl = 'https://shooof.site/albaplayer/ezel.S01E07';
  const servers = ctx.collectAnaServers(serverMenu('/albaplayer/ezel-s01e07'), playerUrl);
  assert.equal(servers.length, 6);
  for (let n = 1; n <= 6; n++) {
    assert.equal(servers[n - 1].url, 'https://shooof.site/albaplayer/ezel-s01e07?serv=' + n);
    assert.equal(servers[n - 1].label, 'Server ' + n);
  }
});

test('a dashed lowercase player page still finds dot-and-uppercase servers', () => {
  const ctx = runtime();
  const playerUrl = 'https://shooof.site/albaplayer/ezel-s01e07';
  const servers = ctx.collectAnaServers(serverMenu('/albaplayer/ezel.S01E07'), playerUrl);
  assert.equal(servers.length, 6);
  assert.equal(servers[0].url, 'https://shooof.site/albaplayer/ezel.S01E07?serv=1');
});

test('normalized comparison keeps the original link and rejects other episodes or hosts', () => {
  const ctx = runtime();
  const playerUrl = 'https://shooof.site/albaplayer/ezel.S01E07';
  const html = `<title>ezel</title><ul class="aplr-menu">
    <li><a class="aplr-link" href="https://shooof.site/albaplayer/ezel_s01e07?serv=1">A</a></li>
    <li><a class="aplr-link" href="https://shooof.site/albaplayer/ezel.S01E08?serv=2">B</a></li>
    <li><a class="aplr-link" href="https://other.site/albaplayer/ezel-s01e07?serv=3">C</a></li>
    <li><a class="aplr-link" href="https://shooof.site/albaplayer/ezel_s01e07?serv=1">D</a></li>
  </ul>`;
  const servers = ctx.collectAnaServers(html, playerUrl);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].url, 'https://shooof.site/albaplayer/ezel_s01e07?serv=1');
  assert.equal(servers[0].label, 'A');
});
