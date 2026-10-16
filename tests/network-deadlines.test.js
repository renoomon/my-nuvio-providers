'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require.resolve('../providers/krmizi.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function runtime(fetch, timers = true) {
  let now = 0, nextId = 0;
  const pending = new Map(), cleared = [];
  const ctx = {
    module: { exports: {} }, require: () => ({}), fetch,
    console: { log() {} }
  };
  if (timers) {
    ctx.setTimeout = (callback, delay) => {
      const id = ++nextId;
      pending.set(id, { callback, at: now + delay });
      return id;
    };
    ctx.clearTimeout = id => { cleared.push(id); pending.delete(id); };
  }
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    ctx, pending, cleared,
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...pending].filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        pending.delete(due[0]); now = due[1].at; due[1].callback();
      }
      now = target;
    }
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('deadline clears timers after success and preserves a fast failure', async () => {
  const run = runtime();
  assert.equal(await run.ctx.withDeadline(Promise.resolve('ready'), 20, 'slow'), 'ready');
  assert.equal(run.pending.size, 0);
  const failure = new Error('upstream failed');
  await assert.rejects(run.ctx.withDeadline(Promise.reject(failure), 20), error => error === failure);
  assert.equal(run.pending.size, 0);
  assert.equal(run.cleared.length, 2);
});

test('expired work rejects once and its later rejection is still observed', async () => {
  const run = runtime(), work = deferred();
  const result = run.ctx.withDeadline(work.promise, 20, 'source_timeout');
  const check = assert.rejects(result, /source_timeout/);
  run.advance(20);
  await check;
  work.reject(new Error('late network error'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.pending.size, 0);
  assert.equal(run.cleared.length, 1);
});

test('runtimes without timer APIs retain normal Promise results and errors', async () => {
  const run = runtime(undefined, false);
  assert.equal(await run.ctx.withDeadline(Promise.resolve('legacy'), 20), 'legacy');
  await assert.rejects(run.ctx.withDeadline(Promise.reject(new Error('legacy error')), 20), /legacy error/);
});

test('a stuck fetch stops at six seconds and does not discard its late failure', async () => {
  const work = deferred(), run = runtime(() => work.promise);
  const result = run.ctx.fetchTextInfo('https://site.test/episode/18', '', '');
  const check = assert.rejects(result, /http_timeout https:\/\/site\.test\/episode\/18/);
  await flush(); run.advance(5999); await flush();
  assert.equal(run.pending.size, 1);
  run.advance(1); await check;
  work.reject(new Error('network eventually failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.pending.size, 0);
});

test('fetch and a stuck text body share one six-second budget', async () => {
  const response = deferred(), body = deferred();
  const run = runtime(() => response.promise);
  const result = run.ctx.fetchTextInfo('https://site.test/slow-body', '', '');
  const check = assert.rejects(result, /http_timeout/);
  await flush(); run.advance(2000);
  response.resolve({ ok: true, status: 200, text: () => body.promise });
  await flush(); run.advance(3999); await flush();
  assert.equal(run.pending.size, 1);
  run.advance(1); await check;
  body.resolve('eventual body'); await flush();
  assert.equal(run.pending.size, 0);
});

test('binary media-body reads are bounded and a stalled probe becomes false', async () => {
  const bytes = deferred();
  const run = runtime(() => Promise.resolve({
    ok: true, headers: { get: () => null }, arrayBuffer: () => bytes.promise
  }));
  const result = run.ctx.probeMediaFile('https://media.test/segment.ts', 'https://player.test/', false);
  await flush(); run.advance(6000);
  assert.equal(await result, false);
  bytes.reject(new Error('late binary read failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.pending.size, 0);
});

test('successful MP4 HEAD probes preserve method and headers and clear their deadline', async () => {
  let options;
  const run = runtime((url, opts) => {
    options = opts;
    return Promise.resolve({ ok: true, headers: { get: name => name === 'content-type' ? 'video/mp4' : '4096' } });
  });
  assert.equal(await run.ctx.probeMediaFile('https://media.test/video.mp4', 'https://player.test/', true), true);
  assert.equal(options.method, 'HEAD');
  assert.equal(options.headers.Referer, 'https://player.test/');
  assert.equal(options.headers.Range, undefined);
  assert.equal(run.pending.size, 0);
});

// The desktop host cannot cancel its native sleeping coroutine. No single
// sleeping job may outlive a completed provider by tens of seconds.
test('long deadlines schedule only short native sleeps', async () => {
  const run = runtime(), work = deferred();
  const result = run.ctx.withDeadline(work.promise, 50000, 'slow');
  assert.equal([...run.pending.values()][0].at, 250);
  run.advance(250);
  assert.equal([...run.pending.values()][0].at, 500);
  work.resolve('done');
  assert.equal(await result, 'done');
  assert.equal(run.pending.size, 0);
});
