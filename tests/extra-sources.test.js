'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const cheerio=require('cheerio');
const core=fs.readFileSync(require.resolve('../providers/krmizi.js'),'utf8');
const fragment=fs.readFileSync(require.resolve('../providers/extra-sources.fragment.js'),'utf8');
function setup(){const ctx={module:{exports:{}},require:()=>cheerio,console:{log(){}},fetch:()=>Promise.reject(Error('unexpected network'))};vm.createContext(ctx);vm.runInContext(core+'\n'+fragment,ctx);return ctx;}
const metadata={titles:['تحت الأرض','Yeraltı'],year:2026};
test('extra catalog selects exact requested episode and rejects trailers and cross origin links',()=>{
 const c=setup(),html='<a href="/episode/18" title="مسلسل تحت الارض الحلقة 18">18</a><a href="/episode/17" title="مسلسل تحت الارض الحلقة 17">17</a><a href="/ad" title="مسلسل تحت الارض الحلقة 18 اعلان">ad</a><a href="https://advert.test/episode/18" title="مسلسل تحت الارض الحلقة 18">18</a>';
 const links=c.extraCatalogLinks(html,'https://catalog.test/',metadata,[{season:1,episode:18}],false);
 assert.equal(links.length,1);assert.equal(links[0].url,'https://catalog.test/episode/18');
});
test('PHP episode query identifiers remain distinct',()=>{
 const c=setup();assert.notEqual(c.extraUrlKey('https://sh4u.buzz/watch.php?vid=a'),c.extraUrlKey('https://sh4u.buzz/watch.php?vid=b'));
});
test('extra sources follow only supported player containers and known wrapper hosts',()=>{
 const c=setup();const targets=c.extraOwnedPlayerTargets('<iframe src="https://ad.test/player/"></iframe><iframe src="/embed/291/"></iframe><div id="Playerholder"><a href="//3sktvtr.com/watch/?hash=x">watch</a></div>','https://catalog.test/episode/18');
 assert.equal(targets.length,2);assert.equal(targets[0].url,'https://catalog.test/embed/291/');assert.equal(targets[1].url,'https://3sktvtr.com/watch/?hash=x');
});
test('explicit player season and episode must match a supplied numbering candidate',()=>{
 const c=setup();assert.equal(c.extraRequestMatch('yeralti-s01e18',[{season:2,episode:2}]),null);assert.equal(c.extraRequestMatch('yeralti-s01e18',[{season:1,episode:18}]).episode,18);assert.equal(c.extraRequestMatch('حلقة رقم 18',[{season:1,episode:18}]).episode,18);
});
test('mismatching episode heading is rejected before a player request',async()=>{
 const c=setup();let called=0;c.fetch=async url=>({ok:true,status:200,url,text:async()=>'<h1>مسلسل تحت الارض الحلقة 17</h1><iframe src="https://w.anaplayer.online/albaplayer/yeralti-s01e18/"></iframe>'});c.resolveAnaPlayer=async()=>{called++;return[];};
 const streams=await c.extraResolveEpisode({url:'https://catalog.test/episode/18'},metadata,[{season:1,episode:18}],'https://catalog.test/');assert.equal(streams.length,0);assert.equal(called,0);
});

test('unmapped season-two requests cannot match a flat episode-one page',()=>{
 const c=setup();assert.equal(c.extraRequestMatch('مسلسل تحت الارض الحلقة 1',[{season:2,episode:1}]),null);
});
test('verified seasonal heading passes confirmed absolute player aliases',async()=>{
 const c=setup(), aliases=[{season:2,episode:1},{season:1,episode:17}];
 const request=c.extraRequestMatch('yeralti-s02e01',aliases);let received;
 c.resolveAnaPlayer=async(...args)=>{received=args;return[];};
 await c.extraResolveOwnedPlayer({url:'https://w.anaplayer.online/albaplayer/yeralti-s01e17/',referer:'https://catalog.test/episode/17'},request,0);
 assert.equal(received[2],2);assert.equal(received[3],1);assert.equal(received[4],aliases);
});
test('page-declared no-referrer policy is preserved for Twitter HLS',async()=>{
 const c=setup();let received;
 c.fetch=async url=>({ok:true,status:200,url,text:async()=>'<meta name="referrer" content="no-referrer"><script>sources:[{file:"https://video.twimg.com/public/test.m3u8"}]</script>'});
 c.addMediaEntry=async(entry,referer,name,streams)=>{received=referer;streams.push({url:entry.url});};
 const streams=await c.extraResolveOwnedPlayer({url:'https://catalog.test/player/owned',referer:'https://catalog.test/episode/18',label:'Main'},{season:1,episode:18},0);
 assert.equal(received,'');assert.equal(streams.length,1);
});
test('NOW uses only full episode links with confirmed flat numbering',()=>{
 const c=setup(),html='<a href="/Yeralti/bolum/18">Yeraltı18.Bölüm</a><a href="/Yeralti/fragman/18-Bolum">Yeraltı18.Bölüm Fragmanı</a><a href="/Yeralti/bolum/1">Yeraltı1.Bölüm</a>';
 assert.equal(c.nowOwnedLinks(html,'https://www.nowtv.com.tr/',metadata,[{season:1,episode:18}]).episodes.length,1);
 assert.equal(c.nowOwnedLinks(html,'https://www.nowtv.com.tr/',metadata,[{season:2,episode:1}]).episodes.length,0);
});
