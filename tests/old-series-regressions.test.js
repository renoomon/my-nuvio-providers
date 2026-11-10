'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const code=fs.readFileSync(require.resolve('../providers/krmizi.js'),'utf8');
function runtime(fetch=()=>{throw Error('offline')}){
  const $load=html=>{const $=cheerio.load(html);const wrap=n=>({length:n.length,attr:k=>n.attr(k),text:()=>n.text(),first:()=>wrap(n.first()),find:s=>wrap(n.find(s)),each:cb=>n.each((i,x)=>cb(i,wrap($(x))))});return s=>wrap($(s));};
  const ctx={module:{exports:{}},require:()=>({load:$load}),fetch:(url,o)=>Promise.resolve().then(()=>fetch(url,o)),console:{log(){}}};
  vm.createContext(ctx);vm.runInContext(code,ctx);ctx.EXTRA_SOURCES=[];return ctx;
}
const base='https://s5.shooflive.cyou',seriesUrl=base+'/series/adsdam/';
const card=(n,title,label)=>`<article class="postEp"><a href="${base}/episode/adsdam-${n}/" title="${title}"><span class="episodeNum">${label}</span><div class="title">${title}</div></a></article>`;
const seriesHtml=body=>({url:seriesUrl,html:'<h1>مسلسل اصطدام</h1><section class="sec-line">'+body+'</section>'});
const episodeHtml=`<h1>مسلسل اصطدام الحلقة 2</h1><h2><a href="${seriesUrl}">مسلسل اصطدام</a></h2><div class="getEmbed"><iframe src="https://shooof.site/albaplayer/adsdam-s01e2"></iframe></div>`;
const response=(html,url,status=200,type='text/html')=>({ok:status>=200&&status<300,status,url,headers:{get:n=>n.toLowerCase()==='content-type'?type:null},text:()=>Promise.resolve(html)});
const mediaPlaylist='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment-1.ts\n#EXT-X-ENDLIST\n';

test('a bare episode number and a Turkish Bölüm label select the right card',()=>{
  const ctx=runtime();
  const bare=seriesHtml(card(1,'اصطدام 1','1')+card(2,'اصطدام 2','2'));
  assert.equal(ctx.findExactEpisode(bare,1,2).url,base+'/episode/adsdam-2/');
  const turkish=seriesHtml(card(1,'Çarpışma 1. Bölüm','1')+card(2,'Çarpışma 2. Bölüm','2'));
  assert.equal(ctx.findExactEpisode(turkish,1,2).url,base+'/episode/adsdam-2/');
  assert.equal(ctx.episodeNumber('Çarpışma 24. Bölüm Final İzle HD'),24);
});

test('flattened seasons with identical labels are disambiguated by the owned URL number',()=>{
  const ctx=runtime();
  const page=seriesHtml(card(1,'اصطدام الحلقة 1','حلقة 1')+card(25,'اصطدام الحلقة 1','حلقة 1'));
  assert.equal(ctx.findExactEpisode(page,1,1).url,base+'/episode/adsdam-1/');
});

test('a partial series archive falls back to the site search for the missing episode',async()=>{
  const ctx=runtime(url=>{
    if(url.startsWith(base+'/?s='))return response(`<a href="${base}/episode/adsdam-2/" title="مسلسل اصطدام الحلقة 2"><div class="title">مسلسل اصطدام الحلقة 2</div></a>`,url);
    if(url===base+'/episode/adsdam-2/')return response(episodeHtml,url);
    throw Error('unexpected '+url);
  });
  const series=seriesHtml(card(1,'اصطدام الحلقة 1','حلقة 1'));
  assert.equal(ctx.findExactEpisode(series,1,2),null);
  const verified=await ctx.findEpisodeViaSearch(series,{titles:['اصطدام','Çarpışma']},{season:1,episode:2});
  assert(verified);assert.equal(verified.episode,2);assert.equal(verified.playerUrl,'https://shooof.site/albaplayer/adsdam-s01e2');
});

test('an episode page may link its own season subpage instead of the root series page',async()=>{
  const ctx=runtime(url=>response(episodeHtml.replace(seriesUrl,seriesUrl+'season/2/'),url));
  const verified=await ctx.verifyEpisodePage({url:seriesUrl},{url:base+'/episode/adsdam-2/'},1,2);
  assert(verified);
});

test('a master with alternate audio keeps its best verified quality label',async()=>{
  const master='https://media.test/hls/master.m3u8';
  const playlist='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n'+
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n360/index.m3u8\n'+
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080\n1080/index.m3u8\n';
  const ctx=runtime((url,opts)=>{
    if(url===master)return response(playlist,url,200,'application/vnd.apple.mpegurl');
    if(url.endsWith('.ts'))return response('',url,206,'video/mp2t');
    return response(mediaPlaylist,url,200,'application/vnd.apple.mpegurl');
  });
  const streams=[];await ctx.addMediaEntry({url:master},'https://cdnplus.sbs/embed-x.html','CDNPlus',streams,{});
  assert.equal(streams.length,1);assert.equal(streams[0].url,master);assert.equal(streams[0].quality,'1080p');
});

test('getStreams restores a missing archive episode through the source search',async()=>{
  const cardHtml=`<a href="${seriesUrl}" title="مسلسل اصطدام"><span class="title">مسلسل اصطدام</span></a>`;
  const episodeLink=`<a href="${base}/episode/adsdam-2/" title="مسلسل اصطدام الحلقة 2"><div class="title">مسلسل اصطدام الحلقة 2</div></a>`;
  const ctx=runtime(url=>{
    if(url===base+'/turkish-series/'||url.startsWith(base+'/?s='))return response(cardHtml+episodeLink,url);
    if(url===seriesUrl)return response('<h1>مسلسل اصطدام</h1><section class="sec-line">'+card(1,'مسلسل اصطدام الحلقة 1','حلقة 1')+'</section>',url);
    if(url===base+'/episode/adsdam-2/')return response(`<h1>مسلسل اصطدام الحلقة 2</h1><h2><a href="${seriesUrl}">مسلسل اصطدام</a></h2><video src="https://media.test/adsdam-2.mp4"></video>`,url);
    if(url==='https://media.test/adsdam-2.mp4')return response('',url,200,'video/mp4');
    throw Error('unexpected '+url);
  });
  ctx.SOURCES=[{name:'ShoofLive',bases:[base],index:'/turkish-series/'}];
  ctx.getTmdbMetadata=()=>Promise.resolve({titles:['اصطدام','Çarpışma'],seasons:[{season_number:1,episode_count:24}]});
  const streams=await ctx.module.exports.getStreams('123','tv',1,2);
  assert.equal(streams.length,1);assert.equal(streams[0].url,'https://media.test/adsdam-2.mp4');assert.equal(streams[0].provider,'ShoofLive');
});

test('an old server page that carries sources inline is resolved without an iframe',async()=>{
  const master='https://media.test/old/master.m3u8';
  const player='https://shooof.site/albaplayer/adsdam-s01e2';
  const server=player+'?serv=1';
  const ctx=runtime((url,opts)=>{
    if(url===player)return response(`<title>adsdam-s01e2</title><a class="aplr-link" href="${server}">Old</a>`,url);
    if(url===server)return response(`sources:[{file:"${master}",label:"720p"}]`,url);
    if(url===master)return response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment-1.ts\n#EXT-X-ENDLIST\n',url,200,'application/vnd.apple.mpegurl');
    if(url.endsWith('.ts'))return response('',url,206,'video/mp2t');
    throw Error('unexpected '+url);
  });
  const streams=await ctx.resolveAnaPlayer(player,base+'/episode/adsdam-2/',1,2);
  assert.equal(streams.length,1);assert.equal(streams[0].url,master);assert.equal(streams[0].quality,'720p');
});

test('identical player paths collapse to one stream with the combined catalog names',()=>{
  const ctx=runtime();
  const streams=[
    {name:'Krmizi • Main',title:'Krmizi • Main • 720p',url:'https://cdn.test/player/abc/master.m3u8?token=one',provider:'Krmizi',quality:'720p',language:'ar'},
    {name:'3skNews • Main',title:'3skNews • Main • 1080p',url:'https://cdn.test/player/abc/master.m3u8?token=two',provider:'3skNews',quality:'1080p',language:'ar'},
    {name:'3skNews • Other',title:'3skNews • Other • 480p',url:'https://cdn.test/player/xyz/master.m3u8?token=two',provider:'3skNews',quality:'480p',language:'ar'}
  ];
  const merged=ctx.dedupeStreams(streams);
  assert.equal(merged.length,2);
  assert.equal(merged[0].quality,'1080p');
  assert.equal(merged[0].name,'Krmizi · 3skNews');
  assert.equal(merged[0].title,'Krmizi · 3skNews • 1080p');
  // A different player path stays a separate stream with its own label.
  assert.equal(merged[1].url,'https://cdn.test/player/xyz/master.m3u8?token=two');
  assert.equal(merged[1].name,'3skNews • Other');
});

test('base mirrors are tried in order and a dead mirror is logged',async()=>{
  const calls=[];
  const ctx=runtime(url=>{
    calls.push(url);
    if(url.startsWith('https://dead.test'))throw Error('getaddrinfo ENOTFOUND dead.test');
    if(url.startsWith('https://empty.test'))return response('<html><div class="noResult">لا نتائج</div></html>',url);
    if(url.startsWith('https://live.test')&&url.indexOf('/index-that-fails/')>=0)throw Error('connection reset');
    if(url.startsWith('https://live.test'))return response(searchHtml,'https://live.test/?s=x');
    throw Error('unexpected '+url);
  });
  const logs=[];ctx.console={log:(...args)=>logs.push(args.join(' '))};
  ctx.SOURCES=[{name:'Krmizi',bases:['https://dead.test','https://live.test','https://empty.test'],index:'/all-turkish-series/'}];
  ctx.getTmdbMetadata=()=>Promise.resolve({titles:['اصطدام'],seasons:[{season_number:1,episode_count:24}]});
  await ctx.module.exports.getStreams('83584','tv',1,1);
  assert(logs.some(line=>line.includes('failure=base_unreachable detail=https://dead.test')));
  assert(logs.some(line=>line.includes('failure=base_no_match detail=https://empty.test')));
  assert(!logs.some(line=>line.includes('base_unreachable detail=https://empty.test')));
  assert(calls.some(url=>url.startsWith('https://live.test')));
  assert(calls.findIndex(url=>url.startsWith('https://dead.test')) < calls.findIndex(url=>url.startsWith('https://live.test')));
});
