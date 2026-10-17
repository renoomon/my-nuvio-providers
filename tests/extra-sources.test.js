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

test('archive searches use each source actual form and preserve Arabic/Turkish aliases',()=>{
 const c=setup(),meta={titles:['Collision','Çarpışma','اصطدام']};
 const dd=c.extraSearchRequests(meta,{search:'ddizi'},'https://www.ddizi.tel',[{season:1,episode:1}]);
 assert(dd.every(r=>r.url==='https://www.ddizi.tel/arama/'&&r.method==='POST'&&r.body.startsWith('arama=')));
 assert(dd.some(r=>decodeURIComponent(r.body).includes('Çarpışma')));assert(dd.some(r=>decodeURIComponent(r.body).includes('اصطدام')));
 const tv=c.extraSearchRequests(meta,{search:'tvajax'},'https://tvdiziler.tv',[{season:1,episode:1}]);
 assert(tv.every(r=>r.url.includes('/search?qr=')&&r.method==='POST'&&r.jsonHtml));
 const sh=c.extraSearchRequests(meta,{search:'php'},'https://sh4u.buzz',[{season:1,episode:1}]);
 assert(sh.some(r=>decodeURIComponent(r.url).includes('اصطدام الحلقة 1')));
});
test('AJAX catalog search extracts HTML from successful JSON only',async()=>{
 const c=setup();let options;
 c.fetch=async(url,opts)=>{options=opts;return{ok:true,status:200,url,text:async()=>JSON.stringify({success:true,data:'<a href="dizi/carpisma">Çarpışma</a>'})};};
 const page=await c.extraFetchCatalog({url:'https://tvdiziler.tv/search?qr=carpisma',method:'POST',body:'',jsonHtml:true},'https://tvdiziler.tv/');
 assert(page.html.includes('Çarpışma'));assert.equal(options.method,'POST');assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest');
});
test('DDizi follows owned zero-based archive pagination and can jump to oldest episodes',()=>{
 const c=setup(),url='https://www.ddizi.tel/diziler/1716/carpisma';
 const html='<a href="/izle/24" title="Çarpışma 24.Bölüm">24</a><a href="/izle/15" title="Çarpışma 15.Bölüm">15</a><ul class="pagination"><li><a href="'+url+'/sayfa-0">1</a></li><li><a href="'+url+'/sayfa-1">2</a></li><li><a href="'+url+'/sayfa-2">3</a></li></ul>';
 assert.equal(c.extraNextCatalogPage(html,url),url+'/sayfa-1');assert.equal(c.extraLastCatalogPage(html,url,[{season:1,episode:1}]),url+'/sayfa-2');
});
test('strict owned heading rejects العهد inside ولي العهد even when a secondary title claims otherwise',()=>{
 const c=setup();assert.equal(c.extraPageTitleMatches('<h1>مسلسل ولي العهد الحلقة 1</h1><title>مسلسل العهد الحلقة 1</title>',{titles:['العهد','Söz']}),false);
 assert.equal(c.extraPageTitleMatches('<h1>مسلسل العهد الحلقة 1</h1>',{titles:['العهد','Söz']}),true);
});
test('NOW archive navigation follows only archive URLs exposed by its own catalog',()=>{
 const c=setup(),links=c.nowArchiveLinks('<a href="/dizi-arsivi">DİZİ ARŞİVİ</a><a href="/dizi-izle">Diziler</a><a href="https://ad.test/arsiv">Archive</a>','https://www.nowtv.com.tr/');
 assert.equal(links.length,2);assert(links.every(u=>u.startsWith('https://www.nowtv.com.tr/')));
});
test('DDizi archive discovery reaches episode one through POST search and owned last page',async()=>{
 const c=setup(),calls=[],base='https://www.ddizi.tel';
 c.fetch=async(url,opts)=>{
  calls.push([url,opts]);let html='';
  if(url===base+'/')html='<h1>Latest episodes</h1>';
  else if(url===base+'/arama/')html=(opts.body.includes(encodeURIComponent('Çarpışma'))?'<a href="/diziler/1716/carpisma" title="Çarpışma izle">Çarpışma</a>':'');
  else if(url===base+'/diziler/1716/carpisma')html='<a href="/izle/24" title="Çarpışma 24.Bölüm">24</a><ul class="pagination"><li><a href="/diziler/1716/carpisma/sayfa-2">3</a></li></ul>';
  else if(url===base+'/diziler/1716/carpisma/sayfa-2')html='<a href="/izle/1" title="Çarpışma 1.Bölüm">1</a>';
  else if(url===base+'/izle/1')html='<h1>Çarpışma 1.Bölüm izle</h1><iframe src="/player/1"></iframe>';
  else if(url===base+'/player/1')html='<meta name="referrer" content="no-referrer"><script>sources:[{file:"https://media.example.test/episode.mp4"}]</script>';
  else throw Error('Unexpected URL '+url);
  return{ok:true,status:200,url,text:async()=>html};
 };
 c.addMediaEntry=async(entry,referer,label,streams)=>streams.push({url:entry.url,name:'Krmizi',title:'Krmizi'});
 const result=await c.resolveExtraSource({titles:['Collision','Çarpışma','اصطدام']},{name:'DDizi',bases:[base],search:'ddizi',language:'tr'},[{season:1,episode:1}]);
 assert.equal(result.length,1);assert.equal(result[0].provider,'DDizi');assert.equal(result[0].language,'tr');
 assert(calls.some(([url,opts])=>url===base+'/arama/'&&opts.method==='POST'));
 assert(calls.some(([url])=>url.endsWith('/sayfa-2')));assert(!calls.some(([url])=>url.includes('/?s=')));
});

test('3ick mirror normalization is limited to its numbered HTTPS catalog hosts',()=>{
 const c=setup();assert.equal(c.threeickOwnedUrl('https://ww5.3ick.club/watch/episodes/owned/','https://ww4.3ick.club/'),'https://ww4.3ick.club/watch/episodes/owned/');
 for(const url of ['https://3ick.club.ad.test/watch/episodes/owned/','https://evil.test/watch/episodes/owned/','http://ww5.3ick.club/watch/episodes/owned/'])assert.equal(c.threeickOwnedUrl(url,'https://ww4.3ick.club/'),'');
});
test('3ick rejects dubbed cuts and substring titles before resolving a player',()=>{
 const c=setup();assert.equal(c.threeickTitleMatches('<h1>مسلسل اصطدام مترجم قصة عشق الاصلي HD</h1>',{titles:['اصطدام']}),true);
 assert.equal(c.threeickTitleMatches('<h1>مسلسل اصطدام مدبلج قصة عشق الاصلي HD</h1>',{titles:['اصطدام']}),false);
 assert.equal(c.threeickTitleMatches('<h1>مسلسل ولي العهد الحلقة 1 مترجمة قصة عشق الاصلي HD</h1>',{titles:['العهد']}),false);
});
test('3ick session cookies stay on the catalog origin and missing cookies are allowed',async()=>{
 const c=setup(),calls=[],base='https://ww4.3ick.club';
 c.fetch=async(url,opts)=>{calls.push([url,opts]);return {ok:true,status:200,url,headers:{get:k=>k==='set-cookie'?'PHPSESSID=session123; path=/':null},text:async()=>'<h1>public</h1>'};};
 const session=c.threeickSession();await session.get(base+'/episode/','');await session.get(base+'/episode/see/',base+'/episode/');await session.get('https://ww5.3ick.club/','');
 assert.equal(calls[0][1].headers.Cookie,undefined);assert.equal(calls[1][1].headers.Cookie,'PHPSESSID=session123');assert.equal(calls[2][1].headers.Cookie,undefined);
 await assert.rejects(session.get('https://miravd.com/embed-owned.html',''));assert.equal(calls.length,3);
 c.fetch=async url=>({ok:true,status:200,url,headers:{get:()=>null},text:async()=>'<h1>public</h1>'});await c.threeickSession().get(base+'/','');
});
test('3ick discovers a series, uses its own episode and cookie watch page, and resolves both public servers',async()=>{
 const c=setup(),base='https://ww4.3ick.club',series=base+'/watch/tvshows/owned/',episode=base+'/watch/episodes/owned-season-1-episode-17/',calls=[];
 const heading='<h1>مسلسل تحت الارض الحلقة 17 مترجمة قصة عشق الاصلي HD</h1>';
 c.fetch=async(url,opts)=>{
  calls.push([url,opts]);let html='',cookie='';
  if(url===base+'/')html='<form action="/"><input name="s"></form>';
  else if(url.startsWith(base+'/?s='))html='<a href="/watch/tvshows/dubbed-mudblij/" title="مسلسل تحت الارض مدبلج">مسلسل تحت الارض</a><a href="/watch/tvshows/owned/" title="مسلسل تحت الارض مترجم">مسلسل تحت الارض</a>';
  else if(url===series)html='<h1>مسلسل تحت الارض مترجم قصة عشق الاصلي HD</h1><a href="https://ww5.3ick.club/watch/episodes/owned-season-1-episode-17/" title="مسلسل تحت الارض الحلقة 17">17</a>';
  else if(url===episode){html=heading+'<a href="'+episode+'see/">مشاهدة</a>';cookie='PHPSESSID=episode123; path=/';}
  else if(url===episode+'see/'){assert.equal(opts.headers.Cookie,'PHPSESSID=episode123');html=heading+'<iframe id="iframe_player" src="/embed/1/777/2/"></iframe><ul id="player_servers"><li data-post="777" data-nume="1" data-type="tv"></li><li data-post="777" data-nume="2" data-type="tv"></li></ul>';}
  else if(url===base+'/embed/1/777/2/')html='<iframe src="https://miravd.com/embed-one.html"></iframe>';
  else if(url===base+'/embed/2/777/2/')html='<iframe src="https://mwdy.cc/embed-two.html"></iframe>';
  else throw Error('Unexpected URL '+url);
  return {ok:true,status:200,url,headers:{get:key=>key==='set-cookie'?cookie:null},text:async()=>html};
 };
 c.supportedDirectEmbed=url=>/^https:\/\/(?:miravd\.com|mwdy\.cc)\/embed-/.test(url);
 c.resolveEmbedTarget=async(target,request,streams)=>{assert.equal(request.season,1);assert.equal(request.episode,17);assert.equal(request.identities.length,2);streams.push({url:target.url+'/media.m3u8',name:'Krmizi',title:'Krmizi',quality:'720p'});};
 const result=await c.resolveExtraSource(metadata,{name:'3ick',bases:[base],search:'3ick'},[{season:2,episode:1},{season:1,episode:17}]);
 assert.equal(result.length,2);assert(result.every(s=>s.provider==='3ick'&&s.language==='ar'));assert(!calls.some(([u])=>u.includes('dubbed')||u.startsWith('https://ww5')));
});
test('3ick does not invent a player when its watch page redirects after a missing cookie',async()=>{
 const c=setup(),base='https://ww4.3ick.club',episode=base+'/watch/episodes/owned-season-1-episode-1/';let resolved=0;
 const heading='<h1>مسلسل اصطدام الحلقة 1 مترجمة قصة عشق الاصلي HD</h1>';
 const session={get:async(url)=>({url:url.endsWith('/see/')?episode:url,html:heading+'<a href="'+episode+'see/">مشاهدة</a>',status:200})};
 c.extraResolveOwnedPlayer=async()=>{resolved++;return[];};
 const result=await c.threeickResolveEpisode({url:episode},{titles:['اصطدام']},[{season:1,episode:1}],session,base+'/');assert.equal(result.length,0);assert.equal(resolved,0);
});
