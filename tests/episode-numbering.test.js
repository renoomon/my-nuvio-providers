'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const code = fs.readFileSync(require.resolve('../providers/krmizi.js'), 'utf8');
function runtime(fetch = () => { throw Error('offline fixture'); }) {
  const $load = html => {
    const $ = cheerio.load(html);
    const wrap = nodes => ({length:nodes.length, attr:k=>nodes.attr(k), text:()=>nodes.text(),
      first:()=>wrap(nodes.first()), find:s=>wrap(nodes.find(s)),
      each:cb=>nodes.each((i,n)=>cb(i,wrap($(n))))});
    return selector => wrap($(selector));
  };
  const calls = [], ctx = {module:{exports:{}}, require:name=>{
    assert.equal(name,'cheerio-without-node-native'); return {load:$load};
  }, fetch:(url,options)=>{calls.push(url);return Promise.resolve().then(()=>fetch(url,options));}, console:{log:()=>{}}};
  vm.runInNewContext(code,ctx);ctx.EXTRA_SOURCES=[]; return {ctx,calls};
}
const base = 'https://s5.shooflive.cyou';
const seriesUrl = base+'/series/yeralti/';
const epUrl = n => base+'/episode/yeralti-'+n+'/';
const playerUrl = 'https://shooof.site/albaplayer/yeralti-2026-s01e17';
const card = (n,title='الحلقة '+n,finale=false) => `<article class="postEp"><a href="${epUrl(n)}" title="${title}"><span class="episodeNum">الحلقة ${n}</span>${finale?'نهاية الموسم':''}</a></article>`;
const series = html => ({url:seriesUrl,html:'<h1>تحت الارض</h1><section class="sec-line">'+html+'</section>'});
const continuous = series(card(18)+card(17)+card(16,undefined,true));
const metadata = {seasons:[{season_number:1,episode_count:16},{season_number:2,episode_count:2}]};
const response = (html,url) => ({ok:true,status:200,url,headers:{get:()=>null},text:()=>Promise.resolve(html)});
const episodeHtml = (heading,player=playerUrl) => `<h1>${heading}</h1><h2><a href="${seriesUrl}">تحت الارض</a></h2><div class="getEmbed"><div class="watch"><iframe src="${player}"></iframe></div></div>`;

test('both season-local and already absolute requests select captured original episodes 17 and 18', () => {
  const {ctx}=runtime();
  for (const [requested,absolute] of [[1,17],[17,17],[2,18],[18,18]]) {
    const requests=ctx.siteEpisodeRequests(continuous,metadata,2,requested);
    assert.equal(requests.length,1);
    assert.equal(requests[0].season,1);
    assert.equal(requests[0].episode,absolute);
    assert.equal(ctx.findExactEpisode(continuous,requests[0].season,requests[0].episode).url,epUrl(absolute));
  }
});
test('a finale in this series alone establishes both numbering forms without API counts', () => {
  const {ctx}=runtime();
  assert.equal(ctx.siteEpisodeRequest(continuous,{},2,1).episode,17);
  assert.equal(ctx.siteEpisodeRequest(continuous,{},2,17).episode,17);
});
test('the captured public ShoofLive series gives identical URLs for both request systems', () => {
  const {ctx}=runtime();
  const actual=series(fs.readFileSync(__dirname+'/fixtures/shoof-series.html','utf8'));
  for(const [local,absolute] of [[1,17],[2,18]]) {
    const first=ctx.siteEpisodeRequest(actual,{},2,local);
    const second=ctx.siteEpisodeRequest(actual,{},2,absolute);
    const localUrl=ctx.findExactEpisode(actual,first.season,first.episode).url;
    const absoluteUrl=ctx.findExactEpisode(actual,second.season,second.episode).url;
    assert.equal(localUrl,absoluteUrl);
    assert(decodeURIComponent(localUrl).includes('الحلقة-'+absolute));
  }
});
test('season one and later-season cumulative offsets retain their distinct identity', () => {
  const {ctx}=runtime();
  assert.equal(ctx.siteEpisodeRequest(continuous,metadata,1,17).episode,17);
  const three=series(card(31)+card(30,undefined,true)+card(16,undefined,true));
  const counts={seasons:[{season_number:1,episode_count:16},{season_number:2,episode_count:14}]};
  assert.equal(ctx.siteEpisodeRequest(three,counts,3,1).episode,31);
  assert.equal(ctx.siteEpisodeRequest(three,counts,3,31).episode,31);
});
test('candidate order is bounded to an explicit local card plus the same continuous episode', () => {
  const {ctx}=runtime();
  const mixed=series(card(1,'S2E1')+card(17)+card(16,undefined,true));
  for(const input of [1,17]) {
    const requests=ctx.siteEpisodeRequests(mixed,metadata,2,input);
    assert.equal(requests.length,2);
    assert.equal(requests[0].season,2);assert.equal(requests[0].episode,1);
    assert.equal(requests[1].season,1);assert.equal(requests[1].episode,17);
  }
});
test('missing or conflicting season boundaries cannot guess the next season', () => {
  const {ctx}=runtime();
  assert.equal(ctx.siteEpisodeRequest(series(card(17)),{},2,1),null);
  assert.equal(ctx.siteEpisodeRequest(continuous,{},3,1),null);
  assert.equal(ctx.siteEpisodeRequest(continuous,{seasons:[{season_number:1,episode_count:20}]},2,1),null);
  assert.equal(ctx.siteEpisodeRequest({html:'<aside>'+card(16,undefined,true)+'</aside>'},{},2,1),null);
});
test('dubbed segmented episodes never inherit original Turkish season offsets', () => {
  const {ctx}=runtime();
  const dubbed={...continuous,heading:'مسلسل تحت الارض مدبلج'};
  assert.equal(ctx.siteEpisodeRequest(dubbed,metadata,2,1),null);
  const explicit={...series(card(1,'S2E1')),heading:'مسلسل مدبلج'};
  assert.equal(ctx.siteEpisodeRequest(explicit,metadata,2,1).episode,1);
  assert.equal(ctx.siteEpisodeRequest(explicit,metadata,2,17),null);
});
test('a verified local S2E1 page can own a native S1E17 player using its confirmed alias', async () => {
  const {ctx}=runtime(url=>response(episodeHtml('تحت الارض S2E1'),url));
  const local=series(card(1,'S2E1')+card(16,undefined,true));
  const request=ctx.siteEpisodeRequests(local,metadata,2,17)[0];
  const candidate=ctx.findExactEpisode(local,request.season,request.episode);
  const verified=await ctx.verifyEpisodePage(local,candidate,request.season,request.episode,request);
  assert(verified);assert.equal(verified.episode,1);
  assert.equal(verified.identities[1].episode,17);
});
test('a verified continuous episode can own an explicitly season-local player', async () => {
  const {ctx}=runtime(url=>response(episodeHtml('تحت الارض الحلقة 17',playerUrl.replace('s01e17','s02e1')),url));
  const request=ctx.siteEpisodeRequests(continuous,metadata,2,1)[0];
  const verified=await ctx.verifyEpisodePage(continuous,{url:epUrl(17)},1,17,request);
  assert(verified);
});
test('the alias does not accept a different episode or season in heading or player', async () => {
  for(const html of [episodeHtml('تحت الارض S3E17'),episodeHtml('تحت الارض الحلقة 17',playerUrl.replace('s01e17','s01e18')),episodeHtml('تحت الارض الحلقة 17',playerUrl.replace('s01e17','s03e1'))]) {
    const {ctx}=runtime(url=>response(html,url));
    const request=ctx.siteEpisodeRequests(continuous,metadata,2,1)[0];
    assert.equal(await ctx.verifyEpisodePage(continuous,{url:epUrl(17)},1,17,request),null);
  }
});
test('conflicting native player URL and title are rejected separately before any server fetch', async () => {
  const {ctx,calls}=runtime(url=>response('<title>Yeraltı S1E18</title>',url));
  const identities=ctx.siteEpisodeRequests(continuous,metadata,2,1)[0].identities;
  assert.equal((await ctx.resolveAnaPlayer(playerUrl,epUrl(17),1,17,identities)).length,0);
  assert.equal(calls.length,1);
});
test('different content hidden in a second page heading field cannot override identity checks', async () => {
  const {ctx}=runtime(url=>response(episodeHtml('تحت الارض الحلقة 17')+'<title>تحت الارض S2E2</title>',url));
  const request=ctx.siteEpisodeRequests(continuous,metadata,2,1)[0];
  assert.equal(await ctx.verifyEpisodePage(continuous,{url:epUrl(17)},1,17,request),null);
});
test('multiple indistinguishable episode cards fail safely rather than choosing one', () => {
  const {ctx}=runtime();
  const duplicate=series(card(17)+card(17).replace('yeralti-17','other-17'));
  assert.equal(ctx.findExactEpisode(duplicate,1,17),null);
});
