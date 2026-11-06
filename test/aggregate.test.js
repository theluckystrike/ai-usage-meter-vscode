'use strict';
const { NOW } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/core/aggregate');
const P = require('../src/core/prices');

const H = 3600000;
const e = (tool, ts, model, project, n = [100, 50, 10, 1000]) => ({ tool, ts, model, project, input: n[0], output: n[1], cacheWrite: n[2], cacheRead: n[3] });
const { table } = P.buildTable({});

test('block: starts at the hour of the first message after a gap, lasts 5 hours', () => {
  const list = [
    e('claude', NOW - 9 * H, 'claude-opus-5-5'), e('claude', NOW - 8 * H, 'claude-opus-5-5'),
    e('claude', NOW - 2 * H - 600000, 'claude-opus-5-5'), e('claude', NOW - 3600000, 'claude-sonnet-5-5'),
    e('codex', NOW - 600000, 'gpt-6.1-sol'),
  ];
  const b = A.claudeBlock(list, NOW, table);
  const start = NOW - 2 * H - 600000 - ((NOW - 2 * H - 600000) % H);
  assert.equal(b.start, start);
  assert.equal(b.end, start + 5 * H);
  assert.equal(b.resetsInMs, start + 5 * H - NOW);
  assert.equal(b.totals.count, 2, 'only Claude Code messages in this block');
});

test('block: a block that crosses into a new one when 5 hours pass with steady work', () => {
  const list = [];
  for (let t = NOW - 7 * H; t <= NOW; t += 30 * 60000) list.push(e('claude', t, 'claude-opus-5-5'));
  const b = A.claudeBlock(list, NOW, table);
  const first = NOW - 7 * H - ((NOW - 7 * H) % H);
  assert.equal(b.start, first + 5 * H, 'the second block starts where the first ended');
  assert.equal(b.totals.count, 5);
});

test('block: none when the last block has ended', () => {
  assert.equal(A.claudeBlock([e('claude', NOW - 6 * H, 'claude-opus-5-5')], NOW, table), null);
  assert.equal(A.claudeBlock([], NOW, table), null);
});

test('summarize: per day, project, model and tool add up; tool filter hides a tool', () => {
  const list = [
    e('claude', NOW - 1000, 'claude-opus-5-5', '/a'), e('claude', NOW - 26 * H, 'claude-haiku-5-5', '/b'),
    e('codex', NOW - 2000, 'gpt-6.1-sol', '/a'), e('codex', NOW - 40 * 24 * H, 'gpt-6.1-sol', '/c'),
  ];
  const s = A.summarize(list, { now: NOW, table, days: 30 });
  assert.equal(s.perDay.length, 30);
  assert.equal(s.perDay[29].day, '2026-11-06');
  assert.equal(s.perDay[29].claude.count, 1);
  assert.equal(s.perDay[29].codex.count, 1);
  assert.equal(s.perDay[28].claude.count, 1);
  const sumP = s.perProject.reduce((x, r) => x + r.total, 0);
  const sumM = s.perModel.reduce((x, r) => x + r.total, 0);
  const sumT = s.perTool.reduce((x, r) => x + r.total, 0);
  assert.equal(sumP, s.range.total);
  assert.equal(sumM, s.range.total);
  assert.equal(sumT, s.range.total);
  assert.equal(s.range.count, 3, 'the 40-day-old entry is outside 30 days');
  assert.deepEqual(s.perProject.find((p) => p.name === '/a').tools.sort(), ['claude', 'codex']);
  const only = A.summarize(list, { now: NOW, table, days: 30, tools: { claude: true, codex: false } });
  assert.equal(only.perTool.length, 1);
  assert.equal(only.limits, null);
});

test('summarize: cost uses the price table; unknown models count tokens but no cost', () => {
  const list = [e('claude', NOW - 1000, 'claude-opus-5-5', '/a', [1e6, 1e6, 1e6, 1e6]), e('claude', NOW - 1000, 'mystery-model', '/a', [1e6, 0, 0, 0])];
  const s = A.summarize(list, { now: NOW, table, days: 7 });
  assert.equal(s.today.claude.cost, 4 + 20 + 5 + 0.2);
  assert.equal(s.today.claude.unpriced, 1e6);
  assert.deepEqual(s.unpricedModels, ['mystery-model']);
});

test('prices: longest prefix wins, dated ids match, user rows override, bad rows are ignored', () => {
  assert.equal(P.priceFor(table, 'claude-opus-4-5-20251101').key, 'claude-opus-4-5');
  assert.equal(P.priceFor(table, 'claude-opus-4-1-20250805').key, 'claude-opus-4');
  assert.equal(P.priceFor(table, 'claude-sonnet-4-5-20250929').row.input, 3);
  assert.equal(P.priceFor(table, 'claude-opus-5-5').row.input, 4);
  assert.equal(P.priceFor(table, 'claude-opus-5').row.input, 5);
  assert.equal(P.priceFor(table, 'gpt-5.1-codex-max').key, 'gpt-5.1-codex');
  assert.equal(P.priceFor(table, 'anthropic/claude-haiku-5-5').key, 'claude-haiku-5-5');
  assert.equal(P.priceFor(table, 'claude-opus-55'), null, 'a prefix must end at a separator');
  assert.equal(P.priceFor(table, ''), null);
  const u = P.buildTable({ 'Claude-Opus-5-5': { input: 1, output: 2 }, 'my-model': { input: 3 }, bad: 'x', empty: {} });
  assert.equal(u.table['claude-opus-5-5'].input, 1);
  assert.equal(u.table['claude-opus-5-5'].cacheRead, 0);
  assert.equal(u.table['claude-opus-5-5'].source, 'settings');
  assert.equal(P.costOf(u.table, 'my-model-v2', { input: 1e6 }), 3);
  assert.deepEqual(u.ignored, ['bad', 'empty']);
  assert.equal(P.PRICES_TAKEN_ON, '2026-11-06');
});
