'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cheerio=require('cheerio');
const code=fs.readFileSync(require.resolve('../providers/krmizi.js'),'utf8');

function runtime(fetch,globals={}) {
  let now=0,id=0;
  const timers=new Map(),calls=[],logs=[];
  function load(html) {
    const $=cheerio.load(html);
    function wrap(nodes){return {length:nodes.length,attr:key=>nodes.attr(key),text:()=>nodes.text(),
      first:()=>wrap(nodes.first()),find:selector=>wrap(nodes.find(selector)),
      each:callback=>nodes.each((i,node)=>callback(i,wrap($(node))))};}
    return selector=>wrap($(selector));
  }
  const ctx={module:{exports:{}},require:name=>{assert.equal(name,'cheerio-without-node-native');return{load};},
    fetch:(url,options)=>{calls.push({url,options});return Promise.resolve().then(()=>fetch(url,options));},
    console:{log:(...args)=>logs.push(args.join(' '))},
    setTimeout:(callback,delay)=>{const timer=++id;timers.set(timer,{callback,at:now+delay});return timer;},
    clearTimeout:timer=>timers.delete(timer),...globals};
  vm.createContext(ctx);vm.runInContext(code,ctx);ctx.EXTRA_SOURCES=[];
  return {ctx,calls,logs,timers,advance(ms){const until=now+ms;for(;;){
    const due=[...timers].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].callback();
  }now=until;}};
}
async function flush(){for(let i=0;i<160;i++)await Promise.resolve();}
const base='https://catalog.test',seriesUrl=base+'/series/yeralti/';
const episodeUrl=n=>base+'/episode/yeralti-'+n+'/';
const mediaUrl=n=>'https://media.test/yeralti-'+n+'-720p.mp4';
const metadata={titles:['تحت الأرض','Yeraltı'],year:2026,seasons:[{season_number:1,episode_count:16},{season_number:2,episode_count:2}]};
const card=(n,finale=false)=>`<article class="postEp"><a href="${episodeUrl(n)}" title="تحت الارض الحلقة ${n}"><span class="episodeNum">حلقة ${n}</span>${finale?'نهاية الموسم':''}</a></article>`;
const seriesHtml='<div class="singleSeries"><h1>مسلسل تحت الارض</h1><div class="story">Yeraltı</div></div><section class="sec-line">'+card(18)+card(17)+card(16,true)+'</section>';
const searchHtml=`<a class="slv2-card" href="${seriesUrl}" title="مسلسل تحت الارض"><span class="title">مسلسل تحت الارض</span></a>`;
const source={name:'ShoofLive',bases:[base],index:'/turkish-series/'};
function response(body,url,type='text/html'){return{ok:true,status:200,url,headers:{get:name=>name.toLowerCase()==='content-type'?type:null},text:()=>Promise.resolve(typeof body==='string'?body:JSON.stringify(body))};}
function network(url,options) {
  if(url.startsWith('https://api.themoviedb.org/3/'))return response({name:'تحت الأرض',original_name:'Yeraltı',first_air_date:'2026-01-01',seasons:metadata.seasons},url,'application/json');
  if(url===base+'/turkish-series/'||url.startsWith(base+'/?s='))return response(searchHtml,url);
  if(url===seriesUrl)return response(seriesHtml,url);
  const episode=url.match(/^https:\/\/catalog\.test\/episode\/yeralti-(\d+)\/$/);
  if(episode){const n=+episode[1];return response(`<h1>تحت الارض الحلقة ${n}</h1><h2><a href="${seriesUrl}">تحت الارض</a></h2><div class="getEmbed"><div class="watch"><video src="${mediaUrl(n)}"></video></div></div>`,url);}
  if(url.startsWith('https://media.test/')){assert.equal(options.method,'HEAD');return response('',url,'video/mp4');}
  throw Error('unexpected URL '+url);
}

test('one never-settling source times out without discarding a verified working source',async()=>{
  const run=runtime(network),{ctx}=run;
  ctx.SOURCES=[{name:'Stalled'},source];
  ctx.getTmdbMetadata=()=>Promise.resolve(metadata);
  ctx.resolveSeries=(_,candidate)=>candidate.name==='Stalled'?new Promise(()=>{}):Promise.resolve({url:seriesUrl,html:seriesHtml});
  let settled=false;
  const result=ctx.module.exports.getStreams('123','tv',2,1).then(streams=>{settled=true;return streams;});
  await flush();assert(run.calls.some(call=>call.url===mediaUrl(17)));assert.equal(settled,false);
  run.advance(31999);await flush();assert.equal(settled,false);
  run.advance(1);const streams=await result;
  assert.equal(streams.length,1);assert.equal(streams[0].provider,'ShoofLive');assert.equal(streams[0].url,mediaUrl(17));
  assert(run.logs.some(line=>line.includes('source_timeout Stalled')));assert.equal(run.timers.size,0);
});

test('both numbering systems traverse metadata, series discovery, page verification and media probe in getStreams',async()=>{
  for(const [requested,absolute] of [[1,17],[17,17],[2,18],[18,18]]) {
    const {ctx,calls,timers}=runtime(network,{TMDB_API_KEY:'test-only'});ctx.SOURCES=[source];
    const streams=await ctx.module.exports.getStreams('123','tv',2,requested);
    assert.equal(streams.length,1);assert.equal(streams[0].url,mediaUrl(absolute));assert.equal(streams[0].quality,'720p');
    assert(calls.some(call=>call.url===episodeUrl(absolute)));
    assert(!calls.some(call=>call.url===episodeUrl(absolute+16)));
    assert.equal(calls.filter(call=>call.url.startsWith('https://api.themoviedb.org/3/')).length,3);
    assert.equal(timers.size,0);
  }
});

test('declared extra collectors and base sources contribute together with numbering aliases and source names',async()=>{
  const {ctx,timers}=runtime(network);ctx.SOURCES=[source];ctx.getTmdbMetadata=()=>Promise.resolve(metadata);
  ctx.EXTRA_SOURCES=[{name:'Extra Catalog',strategy:'extra'},{name:'Official Catalog',strategy:'extra'}];
  const started=[];
  ctx.resolveExtraSource=(data,extra,aliases)=>{
    assert.equal(data.year,2026);started.push(extra.name);
    assert(aliases.some(request=>request.season===1&&request.episode===17));
    assert(aliases.some(request=>request.season===2&&request.episode===1));
    return Promise.resolve([{name:'Krmizi • Main',title:'Krmizi 1080p',url:'https://extra.test/'+encodeURIComponent(extra.name)+'.mp4',quality:'1080p',language:'ar'}]);
  };
  const streams=await ctx.module.exports.getStreams('123','tv',2,17);
  assert.equal(streams.length,3);assert.deepEqual(started,['Extra Catalog','Official Catalog']);
  assert.deepEqual(Array.from(streams,stream=>stream.provider).sort(),['Extra Catalog','Official Catalog','ShoofLive']);
  assert.equal(streams[2].quality,'720p');
  for(const stream of streams){assert(stream.name.startsWith(stream.provider+' •'));assert(stream.title.startsWith(stream.provider));}
  assert.equal(timers.size,0);
});

test('a failed extra collector cannot discard a successful base source or another collector',async()=>{
  const {ctx}=runtime(network);ctx.SOURCES=[source];ctx.getTmdbMetadata=()=>Promise.resolve(metadata);
  ctx.EXTRA_SOURCES=[{name:'Broken',strategy:'extra'},{name:'Working Extra',strategy:'extra'}];
  ctx.resolveExtraSource=(_,extra)=>extra.name==='Broken'?Promise.reject(Error('upstream failed')):Promise.resolve([{name:'Krmizi • Main',title:'Krmizi',url:'https://extra.test/good.mp4',language:'ar'}]);
  const streams=await ctx.module.exports.getStreams('123','tv',2,1);
  assert.equal(streams.length,2);assert.deepEqual(Array.from(streams,stream=>stream.provider).sort(),['ShoofLive','Working Extra']);
});

test('getStreams returns Arabic streams only',async()=>{
  const {ctx}=runtime(network);ctx.SOURCES=[];ctx.getTmdbMetadata=()=>Promise.resolve(metadata);
  ctx.EXTRA_SOURCES=[{name:'Arabic Only',strategy:'extra'}];
  ctx.resolveExtraSource=()=>Promise.resolve([
    {name:'Krmizi • A',title:'Krmizi • A',url:'https://extra.test/ar.mp4',language:'ar'},
    {name:'Krmizi • B',title:'Krmizi • B',url:'https://extra.test/tr.mp4',language:'tr'},
    {name:'Krmizi • C',title:'Krmizi • C',url:'https://extra.test/unknown.mp4'}
  ]);
  const streams=await ctx.module.exports.getStreams('123','tv',1,1);
  assert.equal(streams.length,1);assert.equal(streams[0].url,'https://extra.test/ar.mp4');assert.equal(streams[0].language,'ar');
});

for (const failure of ['missing episode', 'deleted player', 'failed verification']) {
  test('base source tries its next mirror after ' + failure, async () => {
    const {ctx, timers}=runtime(network);
    const broken='https://broken.test', healthy='https://catalog.test';
    ctx.SOURCES=[{name:'ShoofLive',bases:[broken,healthy],index:'/turkish-series/'}];
    ctx.getTmdbMetadata=()=>Promise.resolve(metadata);
    const attempted=[];
    ctx.resolveSeries=(_,candidate)=>{
      const origin=candidate.bases[0];attempted.push(origin);
      return Promise.resolve({url:origin+'/series/yeralti/',html:origin===broken && failure==='missing episode' ? '<h1>تحت الارض</h1>' : seriesHtml});
    };
    const verify=ctx.verifyEpisodePage, player=ctx.resolvePlayer;
    ctx.verifyEpisodePage=(series,...args)=>{
      if(series.url.startsWith(broken)) {
        if(failure==='failed verification') return Promise.reject(Error('http_404'));
        return Promise.resolve({broken:true});
      }
      return verify(series,...args);
    };
    ctx.resolvePlayer=verified=>verified.broken ? Promise.resolve([]) : player(verified);
    const streams=await ctx.getStreams('123','tv',2,1);
    assert.deepEqual(attempted,[broken,healthy]);
    assert.equal(streams.length,1);assert.equal(streams[0].url,mediaUrl(17));
    assert.equal(streams[0].provider,'ShoofLive');assert.equal(timers.size,0);
  });
}
