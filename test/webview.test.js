'use strict';
const { NOW } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/core/protocol');
const { buildHtml } = require('../src/html');
const { summarize } = require('../src/core/aggregate');
const { buildTable } = require('../src/core/prices');

test('protocol: only known message types pass; values are checked', () => {
  assert.deepEqual(P.fromWebview({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(P.fromWebview({ type: 'refresh', extra: '<x>' }), { type: 'refresh' });
  assert.deepEqual(P.fromWebview({ type: 'setRange', days: '30' }), { type: 'setRange', days: 30 });
  assert.equal(P.fromWebview({ type: 'setRange', days: 31 }), null);
  assert.deepEqual(P.fromWebview({ type: 'openSettings', key: 'prices' }), { type: 'openSettings', key: 'prices' });
  assert.equal(P.fromWebview({ type: 'openSettings', key: 'security.workspace.trust' }), null);
  assert.equal(P.fromWebview({ type: 'runCommand', cmd: 'rm' }), null);
  assert.equal(P.fromWebview(null), null);
  assert.equal(P.fromWebview('ready'), null);
  assert.deepEqual(P.fromWebview({ type: 'rendered' }), { type: 'rendered' });
  assert.deepEqual(P.fromWebview({ type: 'moreRows' }), { type: 'moreRows' });
});

test('protocol: data message trims long tables and shortens the home folder', () => {
  const list = [];
  for (let i = 0; i < 60; i++) list.push({ tool: 'claude', ts: NOW - 1000, model: 'claude-opus-5-5', project: '/home/me/p' + i, input: 1, output: 1, cacheWrite: 0, cacheRead: 0 });
  const s = summarize(list, { now: NOW, table: buildTable({}).table, days: 7 });
  const m = P.dataMessage(s, { home: '/home/me' });
  assert.equal(m.type, 'data');
  assert.equal(m.perProject.length, P.MAX_ROWS);
  assert.equal(m.moreProjects, 10);
  assert.ok(m.perProject.every((r) => r.name.startsWith('~/p')));
  assert.equal(P.dataMessage(s, { home: '/home/me', allRows: true }).perProject.length, 60);
  assert.equal(m.pricesTakenOn, '2026-11-06');
  assert.equal(P.shortPath('/home/meow/x', '/home/me'), '/home/meow/x');
});

test('protocol: a Codex window that already reset shows no percentage', () => {
  const s = summarize([], { now: NOW, table: {}, days: 7, limits: { ts: NOW - 7200000, plan: '', credits: null, primary: { usedPercent: 80, resetsAt: NOW - 1000, windowMinutes: 300 }, secondary: { usedPercent: 20, resetsAt: NOW + 1000, windowMinutes: 10080 } } });
  const m = P.dataMessage(s, {});
  assert.equal(m.limits.primary.usedPercent, null);
  assert.equal(m.limits.primary.reset, true);
  assert.equal(m.limits.secondary.usedPercent, 20);
  assert.equal(m.limits.secondary.name, 'week');
});

test('html: strict CSP, nonce script, no remote content', () => {
  const html = buildHtml({ cspSource: 'vscode-resource:', scriptUri: 'vscode-resource:/d.js', styleUri: 'vscode-resource:/d.css', nonce: 'N0nce' });
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-N0nce'/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /<script nonce="N0nce" src=/);
  assert.equal(buildHtml({ cspSource: 'x', scriptUri: 'a', styleUri: 'b', showSupportLinks: false }).includes('zovo-support'), false);
});

test('webview script: never writes HTML from data and posts only protocol messages', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'dashboard.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  const types = [...src.matchAll(/postMessage\(\{ type: '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(types.length >= 5);
  for (const t of types) assert.ok(P.FROM_WEBVIEW.has(t), t);
});

test('webview script: renders the data message in a fake DOM without errors', async () => {
  // Small DOM stand-in, enough for dashboard.js.
  const listeners = {};
  function node(tag) {
    const n = { tagName: tag, children: [], attrs: {}, style: {}, textContent: '', hidden: false, className: '', options: [], value: '', clientWidth: 800, offsetWidth: 100,
      appendChild(c) { this.children.push(c); if (tag === 'select' && c.tagName === 'option') this.options.push(c); return c; },
      replaceChildren() { this.children = []; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
      getBoundingClientRect() { return { width: 800 }; } };
    return n;
  }
  const ids = {};
  const doc = {
    getElementById: (id) => (ids[id] = ids[id] || node(id === 'range' ? 'select' : 'div')),
    createElement: node, createElementNS: (ns, t) => node(t), createTextNode: (t) => ({ textContent: t }),
  };
  const posted = [];
  const win = { addEventListener: (k, f) => { listeners[k] = f; } };
  const sandbox = { window: win, document: doc, acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(m), getState: () => null, setState() {} }), setTimeout, clearTimeout, isFinite, Math, Number, String, Date };
  const vm = require('vm');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'media', 'dashboard.js'), 'utf8'), sandbox);
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(posted[0]), { type: 'ready' });
  const list = [{ tool: 'claude', ts: NOW - 1000, model: 'claude-opus-5-5', project: '<img src=x onerror=alert(1)>', input: 5, output: 5, cacheWrite: 0, cacheRead: 0 }];
  const s = summarize(list, { now: NOW, table: buildTable({}).table, days: 30 });
  listeners.message({ data: P.dataMessage(s, { files: 3 }) });
  assert.deepEqual(plain(posted[1]), { type: 'rendered' });
  assert.match(ids.status.textContent, /3 local session files/);
  assert.ok(ids.chart.children.length === 1, 'chart drawn');
  listeners.message({ data: P.dataMessage(s, { files: 3 }) });
  assert.equal(posted.filter((m) => m.type === 'rendered').length, 1, 'rendered is sent once');
});
