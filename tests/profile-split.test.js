'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cheerio=require('cheerio');
const fastCode=fs.readFileSync(require.resolve('../providers/krmizi.js'),'utf8');
const archivePath=require.resolve('../providers/krmizi-archive.js');
const {generate}=require('../scripts/build-profiles.js');

const FAST=['Qeseh','3ick'];
const ARCHIVE=['Krmizi','ShoofLive','3skNews','FaselHD','Dailymotion'];

function runtime() {
  const ctx={module:{exports:{}},require:name=>{assert.equal(name,'cheerio-without-node-native');return cheerio;},
    console:{log(){}},fetch:()=>Promise.reject(Error('unexpected network')),setTimeout,clearTimeout};
  vm.createContext(ctx);vm.runInContext(fastCode,ctx);return ctx;
}

test('fast profile keeps only 3ick, Qeseh and Qesset, archive keeps the rest',()=>{
  const ctx=runtime();
  assert.deepEqual(Array.from(ctx.sourcesForProfile('fast'),source=>source.name),FAST);
  assert.deepEqual(Array.from(ctx.sourcesForProfile('archive'),source=>source.name),ARCHIVE);
});

test('no catalog is lost or duplicated between the two profiles',()=>{
  const ctx=runtime();
  const all=ctx.SOURCES.concat(ctx.EXTRA_SOURCES).map(source=>source.name);
  const fast=ctx.sourcesForProfile('fast').map(source=>source.name);
  const archive=ctx.sourcesForProfile('archive').map(source=>source.name);
  assert.deepEqual(fast.concat(archive).sort(),all.slice().sort());
  assert.equal(new Set(fast.concat(archive)).size,all.length);
  assert.equal(fast.filter(name=>archive.indexOf(name)>=0).length,0);
});

test('each profile uses its own request budget',()=>{
  const ctx=runtime();
  assert.equal(ctx.profileRequestBudget('fast'),5500);
  assert.equal(ctx.profileRequestBudget('archive'),12000);
  assert.equal(ctx.profileRequestBudget('unknown'),12000);
});

async function attemptedSources(profile) {
  const ctx=runtime();
  ctx.SOURCE_PROFILE=profile;
  ctx.getTmdbMetadata=()=>Promise.resolve({titles:['تحت الأرض'],seasons:[{season_number:1,episode_count:2}]});
  const attempted=[];
  ctx.resolveSeries=(metadata,source)=>{attempted.push(source.name);return Promise.resolve(null);};
  ctx.resolveExtraSource=(metadata,source)=>{attempted.push(source.name);return Promise.resolve([]);};
  const streams=await ctx.module.exports.getStreams('123','tv',1,1);
  return {attempted:Array.from(new Set(attempted)),streams};
}

test('getStreams searches only the catalogs of its own profile',async()=>{
  const fast=await attemptedSources('fast');
  assert.deepEqual(fast.attempted,FAST);
  assert(!fast.attempted.some(name=>ARCHIVE.indexOf(name)>=0));
  assert.equal(fast.streams.length,0);
  const archive=await attemptedSources('archive');
  assert.deepEqual(archive.attempted,ARCHIVE);
  assert(!archive.attempted.some(name=>FAST.indexOf(name)>=0));
  assert.equal(archive.streams.length,0);
});

test('generated archive provider is the fast provider with one line flipped',()=>{
  const archive=fs.readFileSync(archivePath,'utf8');
  assert.equal(archive,generate(fastCode));
  assert.match(fastCode,/var SOURCE_PROFILE = "fast";/);
  assert.match(archive,/var SOURCE_PROFILE = "archive";/);
  assert.match(archive,/Krmizi \/ Qrmzi archive provider/);
});
