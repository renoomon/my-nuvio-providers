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
function runtime(fetch, globals = {}) {
  const calls = [], logs = [];
  const ctx = { module: { exports: {} },
    require: name => { assert.equal(name, 'cheerio-without-node-native'); return { load: shimLoad }; },
    fetch: (url, opts) => { calls.push(url); return Promise.resolve().then(() => fetch(url, opts)); },
    console: { log: (...args) => logs.push(args.join(' ')) }, ...globals };
  vm.runInNewContext(code, ctx);
  return { ctx, calls, logs };
}
const response = (body, url, status = 200) => ({ ok: status >= 200 && status < 300,
  status, url, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
const base = 'https://s5.shooflive.cyou';
const seriesUrl = base + '/series/yeralti/';
const episodeUrl = n => base + '/episode/yeralti-' + n + '/';
const playerUrl = n => 'https://shooof.site/albaplayer/yeralti-2026-s01e' + n;
const cdnUrl = 'https://cdnplus.sbs/embed-test.html';
const master = 'https://media.example.test/hls/master.m3u8?token=example';
const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n360/index.m3u8?token=example\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080\n1080/index.m3u8?token=example\n';
function card(n, finale = false) {
  return `<article class="postEp"><a href="${episodeUrl(n)}" title="مسلسل تحت الارض الحلقة ${n}">${finale ? '<b>نهاية الموسم</b>' : ''}<span class="episodeNum">حلقة ${n}</span><div class="title">مسلسل تحت الارض الحلقة ${n}</div></a></article>`;
}
const seriesHtml = `<div class="singleSeries"><h1>مسلسل تحت الارض</h1><div class="story">Yeraltı</div></div><section class="sec-line">${[18,17,16,1].map(n => card(n, n === 16)).join('')}</section>`;
const searchHtml = `<a class="slv2-card" href="${seriesUrl}" title="مسلسل تحت الارض"><span class="title">مسلسل تحت الارض</span></a>`;
function episodeHtml(n, linkedSeries = seriesUrl, player = playerUrl(n)) {
  return `<h1>مسلسل تحت الارض الحلقة ${n}</h1><h2><a href="${linkedSeries}">مسلسل تحت الارض</a></h2><div class="getEmbed"><div class="watch"><iframe src="${player}"></iframe></div></div>`;
}
function playerHtml(n) {
  return `<title>yeralti-2026-s01e${n}</title><a class="aplr-link" href="${playerUrl(n)}?serv=1">Cdnplus</a><div class="aplr-player-content"><iframe id="iframe" src="${cdnUrl}"></iframe></div>`;
}
function network({ primary = false, emptyPrimary = false, third = false } = {}) {
  return (url, opts) => {
    if (url.startsWith('https://api.themoviedb.org/3/')) return response({ name: 'تحت الأرض', original_name: 'Yeraltı', seasons: [{season_number:1, episode_count:16},{season_number:2,episode_count:2}] }, url);
    if (url.startsWith('https://www.themoviedb.org/')) throw Error('HTML metadata must not be fetched with an injected key');
    const source = third ? 'https://www.qisat.tv' : primary || emptyPrimary ? 'https://www.qrmzi.tv' : base;
    if (url.startsWith(source + '/?s=')) return response(searchHtml.replaceAll(base, source), url);
    if (url === seriesUrl.replace(base, source)) return response(seriesHtml.replaceAll(base, source), url);
    if (url.startsWith(source + '/episode/')) {
      const n = +(url.match(/yeralti-(\d+)/) || [])[1];
      return response(episodeHtml(n).replaceAll(base, source), url);
    }
    if (url.startsWith('https://shooof.site/')) return response(emptyPrimary ? '<title>no servers</title>' : playerHtml(+(url.match(/s01e(\d+)/) || [])[1]), url);
    if (url === cdnUrl) return response(`sources:[{file:"${master}"}]`, url);
    if (url === master) { assert.equal(opts.headers.Referer, cdnUrl); return response(playlist, url); }
    return response('unavailable', url, 503);
  };
}

test('S2E1 and S2E2 map to 17 and 18 and fall back to ShoofLive', async () => {
  for (const episode of [1,2]) {
    const {ctx,calls} = runtime(network(), { TMDB_API_KEY: 'test-key' });
    const streams = await ctx.module.exports.getStreams('123', 'tv', 2, episode);
    assert.equal(streams.length, 2);
    assert.equal(streams[0].quality, '1080p');
    assert.equal(streams[0].provider, 'ShoofLive');
    assert(calls.includes(episodeUrl(16 + episode)));
    assert(!calls.includes(episodeUrl(episode)));
    assert(!calls.some(u => u.includes('qisat')));
    assert(calls.filter(u => u.includes('api.themoviedb.org')).length === 3);
  }
});
test('a working primary source stops the fallback chain', async () => {
  const {ctx,calls} = runtime(network({primary:true}), { TMDB_API_KEY: 'test-key' });
  const streams = await ctx.module.exports.getStreams('123','tv',2,1);
  assert.equal(streams[0].provider, 'Krmizi');
  assert(!calls.some(u => u.startsWith(base)));
});
test('matched primary with no media continues to ShoofLive', async () => {
  const primary = network({emptyPrimary:true}), backup = network();
  const {ctx,calls} = runtime((url, opts) => {
    if (url.startsWith('https://www.qrmzi.tv/episode/')) return response('<h1>unavailable</h1>',url);
    return url.includes('qrmzi.tv') ? primary(url,opts) : backup(url,opts);
  }, {TMDB_API_KEY:'test-key'});
  const streams = await ctx.module.exports.getStreams('123','tv',2,1);
  assert.equal(streams[0].provider, 'ShoofLive');
  assert(calls.some(u => u.startsWith(base)));
});
test('Qisat is tried after both earlier sources fail', async () => {
  const {ctx} = runtime(network({third:true}), {TMDB_API_KEY:'test-key'});
  const streams = await ctx.module.exports.getStreams('123','tv',2,2);
  assert.equal(streams[0].provider,'Qisat');
});
test('follows pagination and verifies the result on page two', async () => {
  const root='https://www.qrmzi.tv', index=root+'/all-turkish-series/';
  const {ctx,calls}=runtime(url => {
    if(url === index) return response(`<a href="${index}page/2/">2</a><a href="https://unrelated.test/all-turkish-series/page/2/">ad</a>`,url);
    if(url === index+'page/2/') return response(searchHtml.replaceAll(base,root),url);
    if(url === seriesUrl.replace(base,root)) return response(seriesHtml,url);
    return response('',url);
  });
  assert(await ctx.resolveSeries({titles:['تحت الارض']},{bases:[root],index:'/all-turkish-series/'}));
  assert(calls.includes(index+'page/2/'));
  assert(!calls.some(u => u.includes('unrelated')));
});
test('finale markers work without API season counts; ambiguity fails safely', () => {
  const {ctx}=runtime(()=>{throw Error('offline')});
  assert.equal(ctx.siteEpisodeRequest({html:seriesHtml},{},2,2).episode,18);
  assert.equal(ctx.siteEpisodeRequest({html:seriesHtml},{},3,1),null);
  assert.equal(ctx.siteEpisodeRequest({html:seriesHtml},{seasons:[{season_number:1,episode_count:20}]},2,1),null);
  const unrelated=`<aside>${card(99,true)}</aside>`;
  assert.equal(ctx.siteEpisodeRequest({html:unrelated},{},2,1),null);
});
test('wrong episode, wrong series and wrong player episode are rejected', async () => {
  for(const html of [episodeHtml(18),episodeHtml(17,base+'/series/other/'),episodeHtml(17,seriesUrl,playerUrl(18))]){
    const {ctx}=runtime(url=>response(html,url));
    assert.equal(await ctx.verifyEpisodePage({url:seriesUrl},{url:episodeUrl(17)},1,17),null);
  }
});
test('unknown MP4 quality does not remove a real source or invent a label', async () => {
  const {ctx}=runtime(()=>{throw Error('unused')});const streams=[];
  await ctx.addMediaEntry({url:'https://media.test/file.mp4'},'', 'Full HD',streams,{});
  assert.equal(streams.length,1); assert.equal(streams[0].quality,undefined);
});
test('accepts current CDNPlus and Shoof AlbaPlayer hosts with exact host boundaries', () => {
  const {ctx}=runtime(()=>{});
  assert(ctx.supportedDirectEmbed(cdnUrl));assert(ctx.anaPlayerAllowed(playerUrl(17)));
  assert(!ctx.supportedDirectEmbed('https://fakecdnplus.sbs/embed-x.html'));
  assert(!ctx.anaPlayerAllowed('https://fakeanaplayer.online/albaplayer/x'));
});
test('HLS failures retain original master, without fabricated quality URLs', async () => {
  const {ctx}=runtime(()=>{throw Error('blocked')});const streams=[];
  const url='https://cdn.test/video_,l,n,h,x,.urlset/master.m3u8?signature=abc';
  await ctx.addMediaEntry({url},cdnUrl,'CDNPlus',streams,{});
  assert.equal(streams.length,1);assert.equal(streams[0].url,url);assert.equal(streams[0].quality,undefined);
});
test('valid HLS on other supported servers is parsed; HTML is rejected', async () => {
  for(const body of [playlist,'<html>not a playlist</html>']){
    const {ctx}=runtime(url=>response(body,url));const streams=[];
    await ctx.addMediaEntry({url:master},'https://vidspeed.space/embed-x','VidSpeed',streams,{});
    assert.equal(streams.length,body===playlist?2:0);
  }
});
test('HLS uses redirected base URLs, preserves audio, and deduplicates parallel entries', async () => {
  const {ctx}=runtime(()=>response(playlist,'https://redirect.test/path/master.m3u8'));const streams=[],seen={};
  await Promise.all([ctx.addMediaEntry({url:master},cdnUrl,'A',streams,seen),ctx.addMediaEntry({url:master},cdnUrl,'B',streams,seen)]);
  assert.equal(streams.length,2);assert(streams[0].url.startsWith('https://redirect.test/path/360/'));
  const audio=runtime(url=>response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n'+playlist,url));const withAudio=[];
  await audio.ctx.addMediaEntry({url:master},cdnUrl,'A',withAudio,{});assert.equal(withAudio.length,1);assert.equal(withAudio[0].url,master);
});
test('packer decoding extracts sources without executing page JavaScript', () => {
  const {ctx}=runtime(()=>{});
  const packed="eval(function(p,a,c,k,e,d){throw new Error('must not execute')}('0:[{1:\"2://3.4/5.6\"}]',10,7,'sources|file|https|media|test|master|m3u8'.split('|')))";
  assert.equal(ctx.mediaEntriesFromHtml(packed)[0].url,'https://media.test/master.m3u8');
});
test('invalid requests return an empty array without network requests', async () => {
  const {ctx,calls}=runtime(()=>{throw Error('unused')});
  for(const args of [['123','movie',1,1],['no','tv',1,1],['123','tv',0,1]]) assert.equal((await ctx.module.exports.getStreams(...args)).length,0);
  assert.equal(calls.length,0);
});
test('metadata HTML fallback remains available without a runtime key', async () => {
  const {ctx}=runtime(url=>response('<title>Yeraltı (2026)</title><meta property="og:title" content="Yeraltı (2026)">',url));
  const meta=await ctx.getTmdbMetadata('123');assert(meta.titles.includes('Yeraltı'));
});

test('captured ShoofLive HTML resolves the actual episode 18 and current player', async () => {
  const fixture = name => fs.readFileSync(__dirname+'/fixtures/shoof-'+name+'.html','utf8');
  const actualSeries=base+'/series/%d9%85%d8%b3%d9%84%d8%b3%d9%84-%d8%aa%d8%ad%d8%aa-%d8%a7%d9%84%d8%a7%d8%b1%d8%b6/';
  const {ctx}=runtime(url=>response(fixture('episode'),url));
  const cards=ctx.parseSeriesCards(fixture('search'),base+'/?s=title',['تحت الأرض']);
  assert.equal(cards[0].url,actualSeries);
  const series={url:actualSeries,html:fixture('series')};
  const request=ctx.siteEpisodeRequest(series,{},2,2);assert.equal(request.episode,18);
  const candidate=ctx.findExactEpisode(series,request.season,request.episode);assert(candidate);
  const verified=await ctx.verifyEpisodePage(series,candidate,request.season,request.episode);
  assert.equal(verified.playerUrl,'https://shooof.site/albaplayer/yeralti-2026-s01e18');
  assert.equal(ctx.collectAnaServers(fixture('player'),verified.playerUrl).length,7);
  assert.equal(ctx.primaryServerEmbed(fixture('player'),verified.playerUrl),'https://cdnplus.sbs/embed-cchfgontu0in.html');
});
