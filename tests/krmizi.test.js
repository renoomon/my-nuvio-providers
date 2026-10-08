'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../providers/krmizi.js'), 'utf8');

function runtime(routes = {}) {
  const requests = [];
  const context = {
    require,
    module: { exports: {} },
    console: { log() {} },
    fetch(url) {
      requests.push(url);
      const route = routes[url];
      if (route === undefined) return Promise.reject(new Error('unexpected_url ' + url));
      if (route instanceof Error) return Promise.reject(route);
      const info = typeof route === 'string' ? { html: route } : route;
      return Promise.resolve({
        ok: (info.status || 200) === 200,
        status: info.status || 200,
        url: info.url || url,
        text: () => Promise.resolve(info.html)
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context, requests };
}

function seasonPage(id, season, count) {
  let html = '<h3 class="episode_sort">Episodes <span>' + count + '</span></h3>';
  for (let i = 1; i <= count; i++) html += '<a data-season-number="' + season + '" data-episode-number="' + i + '" href="/tv/' + id + '/season/' + season + '/episode/' + i + '">Episode</a>';
  return html;
}

function episodeCard(number, extra = '') {
  return '<article class="postEp"><a href="/episode/yeralti-' + number + '/" title="تحت الأرض الحلقة ' + number + '"><div class="episodeNum">حلقة ' + number + '</div>' + extra + '</a></article>';
}

function pipelineRoutes() {
  const routes = {};
  for (const language of ['tr-TR', 'en-US', 'ar-SA']) {
    routes['https://www.themoviedb.org/tv/309328?language=' + language] = '<title>Yeraltı (TV Series 2026)</title><meta property="og:title" content="تحت الأرض">';
  }
  routes['https://www.themoviedb.org/tv/309328/titles?language=en-US'] = '';
  routes['https://www.themoviedb.org/tv/309328/season/1?language=en-US'] = seasonPage('309328', 1, 16);
  routes['https://www.qrmzi.tv/all-turkish-series/'] = {
    url: 'https://w3.qrmzi.cyou/all-turkish-series/',
    html: '<div class="pagination"><a href="/all-turkish-series/page/2/">2</a></div>'
  };
  routes['https://w3.qrmzi.cyou/all-turkish-series/page/2/'] = '<article class="postEp"><a href="/series/yeralti/" title="مسلسل تحت الأرض"><img alt="تحت الأرض"></a></article>';
  routes['https://w3.qrmzi.cyou/series/yeralti/'] = '<div class="singleSeries"><h1>مسلسل تحت الأرض</h1></div><div class="sec-line">' + episodeCard(1) + episodeCard(16) + '</div><div class="pagination"><a href="/series/yeralti/page/2/">2</a></div>';
  routes['https://w3.qrmzi.cyou/series/yeralti/page/2/'] = '<div class="sec-line">' + episodeCard(17) + '</div>';
  routes['https://w3.qrmzi.cyou/episode/yeralti-17/'] = '<div class="singleInfo"><h1>تحت الأرض الحلقة 17</h1></div><h2><a href="/series/yeralti/">تحت الأرض</a></h2><div class="getEmbed"><div class="watch"><iframe src="https://w.anaplayer.online/albaplayer/yeralti-s01e17/"></iframe></div></div>';
  routes['https://w.anaplayer.online/albaplayer/yeralti-s01e17/'] = '<title>تحت الأرض الحلقة 17</title><div class="aplr-player-content"><iframe id="iframe" src="https://cdnplus.sbs/embed-video.html"></iframe></div><a class="aplr-link" href="?token=abc&serv=1">CDNPlus</a>';
  routes['https://w.anaplayer.online/albaplayer/yeralti-s01e17/?token=abc&serv=1'] = '<iframe id="iframe" src="https://cdnplus.sbs/embed-video.html"></iframe>';
  routes['https://cdnplus.sbs/embed-video.html'] = '<script>var sources=[{file:"https://media.example/hls/master.m3u8?token=master"}];</script>';
  routes['https://media.example/hls/master.m3u8?token=master'] = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720/index.m3u8?token=low\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n../1080/index.m3u8?token=high\n';
  return routes;
}

test('Yeraltı S02E01 resolves episode 17 across paginated indexes and returns 1080p first', async () => {
  const { api, requests } = runtime(pipelineRoutes());
  const streams = await api.module.exports.getStreams('309328', 'tv', 2, 1);
  assert.equal(streams.length, 2);
  assert.equal(streams[0].quality, '1080p');
  assert.equal(streams[0].url, 'https://media.example/1080/index.m3u8?token=high');
  assert.equal(streams[0].headers.Referer, 'https://cdnplus.sbs/embed-video.html');
  assert.equal(streams[0].type, 'm3u8');
  assert.equal(streams[1].quality, '720p');
  assert(requests.includes('https://w3.qrmzi.cyou/episode/yeralti-17/'));
  assert(!requests.includes('https://w3.qrmzi.cyou/episode/yeralti-1/'));
});

test('missing previous season metadata never substitutes S01E01 for S02E01', async () => {
  const routes = pipelineRoutes();
  routes['https://www.themoviedb.org/tv/309328/season/1?language=en-US'] = new Error('unavailable');
  const { api, requests } = runtime(routes);
  assert.equal((await api.module.exports.getStreams('309328', 'tv', 2, 1)).length, 0);
  assert(!requests.some(url => url.includes('/episode/yeralti-')));
});

test('player with a conflicting episode or series is rejected', async () => {
  for (const wrong of ['yeralti-s01e01', 'yeralti-s02e02']) {
    const routes = pipelineRoutes();
    routes['https://w3.qrmzi.cyou/episode/yeralti-17/'] = routes['https://w3.qrmzi.cyou/episode/yeralti-17/'].replace('yeralti-s01e17', wrong);
    const { api, requests } = runtime(routes);
    assert.equal((await api.module.exports.getStreams('309328', 'tv', 2, 1)).length, 0);
    assert(!requests.some(url => url.includes('anaplayer.online')));
  }
  const routes = pipelineRoutes();
  routes['https://w3.qrmzi.cyou/episode/yeralti-17/'] = routes['https://w3.qrmzi.cyou/episode/yeralti-17/'].replace('href="/series/yeralti/"', 'href="/series/another-show/"');
  assert.equal((await runtime(routes).api.module.exports.getStreams('309328', 'tv', 2, 1)).length, 0);
});

test('season counts require complete contiguous TMDB episode identities', async () => {
  const { api } = runtime({
    'https://www.themoviedb.org/tv/1/season/1?language=en-US': seasonPage('1', 1, 16),
    'https://www.themoviedb.org/tv/1/season/2?language=en-US': seasonPage('1', 2, 8)
  });
  assert.equal(await api.getAbsoluteEpisode('1', 3, 2), 26);
  assert.equal(api.parseSeasonCount(seasonPage('1', 1, 16), '1', 1), 16);
  assert.equal(api.parseSeasonCount(seasonPage('2', 1, 16), '1', 1), 0);
  assert.equal(api.parseSeasonCount(seasonPage('1', 1, 16).replace('data-episode-number="16"', 'data-episode-number="15"'), '1', 1), 0);
});

test('exact season numbers take precedence over absolute numbering and related links are ignored', () => {
  const { api } = runtime();
  const series = { url: 'https://www.qrmzi.tv/series/yeralti/', html: '<div class="sec-line">' + episodeCard(17) + episodeCard(1, '<span class="title">S02E01</span>') + '</div><aside>' + episodeCard(17) + '</aside>' };
  assert.equal(api.findExactEpisode(series, 2, 1, 17).numbering, 'season');
  assert.equal(api.findExactEpisode({ url: series.url, html: '<aside>' + episodeCard(17) + '</aside>' }, 2, 1, 17), null);
});

test('Arabic and percent-encoded episode identifiers are recognized', () => {
  const { api } = runtime();
  assert.equal(api.episodeNumber('الحلقة ١٧'), 17);
  assert.equal(api.episodeNumber('/episode/' + encodeURIComponent('تحت-الأرض-الحلقة-17')), 17);
  assert.equal(api.episodeNumber('الحلقة ۱۷'), 17);
  assert.equal(api.explicitSeasonEpisode('S02E01').season, 2);
});

test('pagination stays on the same listing and host', () => {
  const { api } = runtime();
  const links = api.paginationUrls('<div class="pagination"><a href="/series/yeralti/page/2/">2</a><a href="https://evil.example/series/yeralti/page/3/">3</a><a href="/series/other/page/2/">2</a></div>', 'https://www.qrmzi.tv/series/yeralti/', 'https://www.qrmzi.tv/series/yeralti/');
  assert.equal(links.length, 1);
  assert.equal(links[0], 'https://www.qrmzi.tv/series/yeralti/page/2/');
});

test('current CDN host accepted with a hostname boundary', () => {
  const { api } = runtime();
  assert(api.supportedDirectEmbed('https://cdnplus.sbs/embed-video.html'));
  assert(!api.supportedDirectEmbed('https://evilcdnplus.sbs/embed-video.html'));
  assert(!api.anaPlayerAllowed('https://evil-anaplayer.online/player'));
});

test('HLS labels come from the playlist and failed/HTML playlists are excluded', async () => {
  const url = 'https://media.example/video_,l,n,h,x,.urlset/master.m3u8';
  for (const response of [
    { status: 404, html: '' },
    { status: 200, html: '<html>video removed</html>' },
    { status: 200, html: '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=852x480\n480.m3u8\n' }
  ]) {
    const { api } = runtime({ [url]: response });
    const streams = [];
    await api.addMediaEntry({ url }, 'https://cdnplus.sbs/embed.html', 'CDNPlus', streams, {});
    assert.equal(streams.length, response.html.startsWith('#EXTM3U') ? 1 : 0);
    if (streams.length) assert.equal(streams[0].quality, '480p');
  }
});

test('network-unreadable master remains adaptive without invented resolutions', async () => {
  const url = 'https://media.example/master.m3u8';
  const { api } = runtime({ [url]: new Error('network_error') });
  const streams = [];
  await api.addMediaEntry({ url }, 'https://cdnplus.sbs/embed.html', 'CDNPlus', streams, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, url);
  assert.equal(streams[0].quality, undefined);
});

test('unknown MP4 quality is preserved without a fabricated label', async () => {
  const { api } = runtime();
  const streams = [];
  await api.addMediaEntry({ url: 'https://media.example/episode.mp4' }, 'https://mp4plus.cyou/embed.html', 'MP4Plus', streams, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].quality, undefined);
});

test('invalid requests do not perform network calls', async () => {
  const { api, requests } = runtime();
  for (const args of [['309328', 'movie', 2, 1], ['bad', 'tv', 2, 1], ['309328', 'tv', 0, 1]]) {
    assert.equal((await api.module.exports.getStreams(...args)).length, 0);
  }
  assert.equal(requests.length, 0);
});

test('relative playlist paths normalize without modifying signed query strings', () => {
  const { api } = runtime();
  assert.equal(api.absUrl('../1080/index.m3u8?token=a/../b', 'https://media.example/hls/master.m3u8'), 'https://media.example/1080/index.m3u8?token=a/../b');
  assert.equal(api.absUrl('/../../index.m3u8', 'https://media.example/hls/master.m3u8'), 'https://media.example/index.m3u8');
  assert.equal(api.episodeNumber(encodeURIComponent('الحلقة ١٧')), 17);
});

test('primary player remains usable when every listed server fails', async () => {
  const routes = pipelineRoutes();
  routes['https://w.anaplayer.online/albaplayer/yeralti-s01e17/?token=abc&serv=1'] = { status: 404, html: '' };
  assert.equal((await runtime(routes).api.module.exports.getStreams('309328', 'tv', 2, 1)).length, 2);
});

test('season one requests still resolve episode one without fetching season counts', async () => {
  const routes = pipelineRoutes();
  routes['https://w3.qrmzi.cyou/episode/yeralti-1/'] = routes['https://w3.qrmzi.cyou/episode/yeralti-17/'].replace(/الحلقة 17/g, 'الحلقة 1').replace('s01e17', 's01e01');
  for (const url of Object.keys(routes)) if (url.includes('s01e17')) routes[url.replace('s01e17', 's01e01')] = routes[url].replace(/الحلقة 17/g, 'الحلقة 1');
  const { api, requests } = runtime(routes);
  assert.equal((await api.module.exports.getStreams('309328', 'tv', 1, 1)).length, 2);
  assert(!requests.some(url => url.includes('/season/')));
});
