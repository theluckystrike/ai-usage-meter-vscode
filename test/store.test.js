'use strict';
const { NOW, fixtures } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { UsageStore } = require('../src/core/store');
const { listFiles } = require('../src/core/roots');
const { readNewLines } = require('../src/core/lines');
const { summarize } = require('../src/core/aggregate');
const { buildTable } = require('../src/core/prices');
const { dataMessage } = require('../src/core/protocol');

async function load(fx, store = new UsageStore({ historyDays: 90 })) {
  const list = await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }, { claude: true, codex: true }, 0);
  await store.update(list, { now: NOW });
  return { store, list };
}

test('store: reads both fixture folders, today totals match the hand-built records', async (t) => {
  const fx = fixtures();
  t.after(fx.cleanup);
  const { store, list } = await load(fx);
  assert.ok(list.some((f) => f.file.includes('subagents')), 'subagent files are listed');
  const { table } = buildTable({});
  const s = summarize(store.entries(), { now: NOW, table, days: 30, limits: store.limits });
  // Claude today: 6 messages (each written twice while streaming), 1 subagent message, 1 unpriced model.
  const want = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const { u } of fx.expect.claudeToday) { want.input += u[0]; want.output += u[1]; want.cacheWrite += u[2]; want.cacheRead += u[3]; }
  want.input += 500 + 100; want.output += 600 + 200; want.cacheRead += 7000;
  const c = s.today.claude;
  assert.deepEqual([c.input, c.output, c.cacheWrite, c.cacheRead], [want.input, want.output, want.cacheWrite, want.cacheRead]);
  const x = s.today.codex;
  assert.deepEqual([x.input, x.cacheRead, x.output], [fx.expect.codexToday.input, fx.expect.codexToday.cacheRead, fx.expect.codexToday.output]);
  assert.equal(s.limits.primary.usedPercent, 42.5);
  assert.equal(s.limits.secondary.usedPercent, 71);
  assert.equal(s.limits.plan, 'pro');
  assert.ok(store.stats.badLines >= 1, 'corrupt lines are counted, not fatal');
  assert.deepEqual(s.unpricedModels, ['claude-experimental-x']);
});

test('store: no prompt or reply text reaches entries or the webview message', async (t) => {
  const fx = fixtures();
  t.after(fx.cleanup);
  const { store } = await load(fx);
  const { table } = buildTable({});
  const s = summarize(store.entries(), { now: NOW, table, days: 90, limits: store.limits });
  const blob = JSON.stringify([...store.entries()]) + JSON.stringify(dataMessage(s, { home: '/Users/demo' })) + JSON.stringify(store.limits);
  assert.ok(!blob.includes(fx.mark), 'marker text leaked');
  assert.ok(blob.includes('~/shop-api'), 'home folder is shortened to ~');
});

test('store: incremental read only reads appended bytes and waits for a full last line', async (t) => {
  const fx = fixtures();
  t.after(fx.cleanup);
  const store = new UsageStore();
  const { list } = await load(fx, store);
  const target = list.find((f) => f.file.includes('11111111'));
  const before = store.stats.bytesRead;
  // Nothing changed: nothing is read.
  let r = await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.equal(r.bytesRead, 0);
  assert.equal(r.changed, false);
  const rec = { type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), cwd: '/Users/demo/shop-api', message: { id: 'msg_new', model: 'claude-opus-5-5', usage: { input_tokens: 7, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
  const line = JSON.stringify(rec);
  const half = Math.floor(line.length / 2);
  fs.appendFileSync(target.file, line.slice(0, half));
  r = await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.equal(r.bytesRead, 0, 'a half-written line is not consumed');
  fs.appendFileSync(target.file, line.slice(half) + '\n');
  r = await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.equal(r.bytesRead, Buffer.byteLength(line) + 1);
  assert.ok(store.claude.has('msg_new:'));
  assert.ok(store.stats.bytesRead > before);
});

test('store: a truncated or deleted file is forgotten and re-read', async (t) => {
  const fx = fixtures();
  t.after(fx.cleanup);
  const store = new UsageStore();
  const { list } = await load(fx, store);
  const target = list.find((f) => f.file.includes('11111111'));
  const has = () => [...store.claude.values()].some((e) => e.file === target.file);
  assert.ok(has());
  fs.writeFileSync(target.file, '');
  await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.equal(has(), false, 'empty file: listing drops it');
  fs.writeFileSync(target.file, JSON.stringify({ type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { id: 'z', usage: { input_tokens: 1 } } }) + '\n');
  await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.ok(store.claude.has('z:'));
  fs.rmSync(target.file);
  await store.update(await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }), { now: NOW });
  assert.equal(store.claude.has('z:'), false);
});

test('store: history cutoff drops old entries and old files', async (t) => {
  const fx = fixtures();
  t.after(fx.cleanup);
  const store = new UsageStore({ historyDays: 7 });
  const list = await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }, undefined, 0);
  await store.update(list, { now: NOW });
  for (const e of store.entries()) assert.ok(e.ts >= NOW - 7 * 86400000);
  const future = await listFiles({ claude: [fx.claudeRoot], codex: [fx.codexRoot] }, undefined, Date.now() + 3600000);
  assert.equal(future.length, 0, 'files older than the cutoff are not listed');
});

test('lines: a big file streams line by line and skips an over-long line', async (t) => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ai-usage-big-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'big.jsonl');
  const fd = fs.openSync(f, 'w');
  const line = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { id: 'x', usage: { input_tokens: 1 } }, pad: 'p'.repeat(900) }) + '\n';
  const block = line.repeat(1000);
  for (let i = 0; i < 20; i++) fs.writeSync(fd, block); // about 20 MB, under the 50 MB fixture limit
  fs.writeSync(fd, 'x'.repeat(3 * 1024 * 1024) + '\n');
  fs.writeSync(fd, line);
  fs.closeSync(fd);
  let n = 0;
  const r = await readNewLines(f, 0, () => { n++; }, { maxLineBytes: 1024 * 1024, chunkSize: 64 * 1024 });
  assert.equal(n, 20001);
  assert.equal(r.longLines, 1);
  assert.equal(r.offset, fs.statSync(f).size);
});
