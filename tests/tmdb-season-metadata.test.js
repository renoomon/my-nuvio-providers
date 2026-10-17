'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const core=fs.readFileSync(require.resolve('../providers/krmizi.js'),'utf8');
const fixture=fs.readFileSync(__dirname+'/fixtures/tmdb-seasons-309328.html','utf8');
const url='https://www.themoviedb.org/tv/309328/seasons?language=en-US';
function setup(fetch=()=>Promise.reject(Error('offline'))) {
 const calls=[];
 function load(html){const $=cheerio.load(html);const wrap=nodes=>({length:nodes.length,attr:k=>nodes.attr(k),text:()=>nodes.text(),first:()=>wrap(nodes.first()),find:s=>wrap(nodes.find(s)),each:cb=>nodes.each((i,n)=>cb(i,wrap($(n))))});return selector=>wrap($(selector));}
 const ctx={module:{exports:{}},require:()=>({load}),console:{log(){}},fetch:(link,options)=>{calls.push(link);return Promise.resolve().then(()=>fetch(link,options));}};
 vm.createContext(ctx);vm.runInContext(core,ctx);ctx.EXTRA_SOURCES=[];return{ctx,calls};
}
const response=(html,url)=>({ok:true,status:200,url,text:()=>Promise.resolve(html)});
const countPairs=seasons=>Array.from(seasons,season=>[season.season_number,season.episode_count]);
function network(link){
 if(link===url)return response(fixture,link);
 if(link.includes('/titles?'))return response('<table class="titles"><tbody><tr><td>تحت الأرض</td></tr></tbody></table>',link);
 return response('<title>Underground (TV Series 2026)</title><meta property="og:title" content="Yeraltı (2026)">',link);
}

test('actual public TMDB season cards establish the 16-episode first-season offset',()=>{
 const {ctx}=setup();assert.deepEqual(countPairs(ctx.parseTmdbSeasonCounts(fixture,'309328')),[[1,16],[2,3]]);
});
test('season counts must belong to this series and the season-card count field',()=>{
 const {ctx}=setup();
 const foreign=fixture.replaceAll('/tv/309328-yeralti/','/tv/999-unrelated/');
 const outside='<aside><a href="/tv/309328/season/1">Season 1</a><h4>999 Episodes</h4></aside>';
 assert.equal(ctx.parseTmdbSeasonCounts(foreign+outside,'309328').length,0);
 const external=fixture.replaceAll('href="/tv/','href="https://unrelated.test/tv/');
 assert.equal(ctx.parseTmdbSeasonCounts(external,'309328').length,0);
});
test('conflicting counts, specials, and unavailable counts cannot establish a season offset',()=>{
 const {ctx}=setup();
 const conflict=fixture+fixture.replace('16 Episodes','20 Episodes');
 assert.deepEqual(countPairs(ctx.parseTmdbSeasonCounts(conflict,'309328')),[[2,3]]);
 const missing=fixture.replace(/16 Episodes|3 Episodes/g,'Upcoming Episodes');
 assert.equal(ctx.parseTmdbSeasonCounts(missing,'309328').length,0);
 const specials=fixture.replaceAll('/season/1','/season/0').replaceAll('/season/2','/season/0');
 assert.equal(ctx.parseTmdbSeasonCounts(specials,'309328').length,0);
});
test('public metadata requests localized titles, aliases and season counts in parallel without an API key',async()=>{
 const pending=[];
 const {ctx,calls}=setup(link=>new Promise(resolve=>pending.push(()=>resolve(network(link)))));
 const result=ctx.getTmdbHtmlMetadata('309328');
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(calls.length,5);assert(calls.includes(url));assert.equal(pending.length,5);
 pending.forEach(resolve=>resolve());const metadata=await result;
 assert(metadata.titles.includes('Yeraltı'));assert(metadata.titles.includes('تحت الأرض'));
 assert.equal(metadata.year,2026);assert.deepEqual(countPairs(metadata.seasons),[[1,16],[2,3]]);
});
test('a failed season overview preserves usable title metadata without inventing season counts',async()=>{
 const {ctx}=setup(link=>{if(link===url)throw Error('overview unavailable');return network(link);});
 const metadata=await ctx.getTmdbHtmlMetadata('309328');
 assert(metadata.titles.includes('Yeraltı'));assert.equal(metadata.seasons.length,0);
});
test('extra collectors receive both episode forms from real public season metadata without an API key',async()=>{
 for(const [requested,absolute]of [[1,17],[17,17],[2,18],[18,18]]){
  const {ctx}=setup(network);ctx.SOURCES=[];ctx.EXTRA_SOURCES=[{name:'Public Catalog',strategy:'extra'}];
  let received;
  ctx.resolveExtraSource=(_,source,aliases)=>{received=aliases;return Promise.resolve([{name:'Krmizi • Main',title:'Krmizi',url:'https://media.test/'+absolute+'.mp4',language:'ar'}]);};
  const streams=await ctx.module.exports.getStreams('309328','tv',2,requested);
  assert.equal(streams.length,1);
  assert(received.some(item=>item.season===1&&item.episode===absolute));
  assert(received.some(item=>item.season===2&&item.episode===absolute-16));
 }
});
