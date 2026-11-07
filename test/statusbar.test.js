'use strict';
const { NOW } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { statusView } = require('../src/core/statusbar');
const { summarize } = require('../src/core/aggregate');
const { buildTable } = require('../src/core/prices');
const F = require('../src/core/format');

const H = 3600000;
const list = [
  { tool: 'claude', ts: NOW - H, model: 'claude-opus-5-5', project: '/a', input: 1000, output: 2000, cacheWrite: 0, cacheRead: 1200000 },
  { tool: 'codex', ts: NOW - 2 * H, model: 'gpt-6.1-sol', project: '/a', input: 5000, output: 1000, cacheWrite: 0, cacheRead: 40000 },
];
const limits = { ts: NOW - H, plan: 'pro', credits: null, primary: { usedPercent: 93.4, resetsAt: NOW + 40 * 60000, windowMinutes: 300 }, secondary: { usedPercent: 50, resetsAt: NOW + 2 * 24 * H, windowMinutes: 10080 } };

test('status: tokens, cost, block countdown and Codex limits', () => {
  const s = summarize(list, { now: NOW, table: buildTable({}).table, days: 1, limits });
  const v = statusView(s, {});
  assert.match(v.text, /^\$\(pulse\) Claude 1\.2M \$0\.28 \$\(clock\) 4h 0m · Codex 46k \$0\.02 5h 93% wk 50%$/);
  assert.equal(v.warn, true, '90% or more warns');
  assert.match(v.tooltip, /Resets at/);
  assert.match(v.tooltip, /estimates/);
  const noCost = statusView(s, { showCost: false });
  assert.doesNotMatch(noCost.text, /\$\d/);
  const onlyCodex = statusView(s, { tools: { claude: false, codex: true } });
  assert.doesNotMatch(onlyCodex.text, /Claude|clock/);
});

test('format: tokens, money and durations', () => {
  assert.equal(F.tokens(0), '0');
  assert.equal(F.tokens(950), '950');
  assert.equal(F.tokens(1500), '1.5k');
  assert.equal(F.tokens(45600), '46k');
  assert.equal(F.tokens(1234567), '1.23M');
  assert.equal(F.tokens(25e6), '25M');
  assert.equal(F.tokens(3.2e9), '3.2B');
  assert.equal(F.money(0.004), '<$0.01');
  assert.equal(F.money(12.345), '$12.35');
  assert.equal(F.money(1234.5), '$1,235');
  assert.equal(F.duration(59 * 60000), '59m');
  assert.equal(F.duration(125 * 60000), '2h 5m');
  assert.equal(F.duration(50 * H), '2d 2h');
  assert.equal(F.windowName(300), '5h');
  assert.equal(F.windowName(10080), 'week');
});
