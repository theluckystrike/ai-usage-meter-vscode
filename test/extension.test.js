'use strict';
const { fixtures } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// A small fake of the VS Code API, enough to activate the extension and drive the dashboard.
function fakeVscode(conf) {
  const commands = new Map();
  const items = [];
  const panels = [];
  const watchers = [];
  const ev = () => { const fns = []; const f = (fn) => { fns.push(fn); return { dispose() {} }; }; f.fire = (x) => fns.forEach((fn) => fn(x)); return f; };
  const vscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: -1 },
    Uri: { file: (p) => ({ fsPath: p, toString: () => 'file://' + p }), joinPath: (u, ...a) => ({ fsPath: [u.fsPath, ...a].join('/'), toString: () => 'file://' + [u.fsPath, ...a].join('/') }), parse: (s) => ({ toString: () => s }) },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    MarkdownString: class { constructor(v) { this.value = v; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    env: { sessionId: 's1', openExternal: async () => true },
    extensions: { getExtension: () => null },
    window: {
      state: { focused: true },
      createStatusBarItem: (id) => { const it = { id, text: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} }; items.push(it); return it; },
      createWebviewPanel: (type, title) => {
        const recv = ev(), view = ev(), disp = ev();
        const p = {
          type, title, visible: true, posted: [], reveal() {}, onDidChangeViewState: view, onDidDispose: disp,
          webview: { cspSource: 'vscode-resource:', html: '', asWebviewUri: (u) => u, postMessage(m) { p.posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: recv },
          send: (m) => recv.fire(m), dispose: () => disp.fire(),
        };
        panels.push(p);
        return p;
      },
      showInformationMessage: async () => undefined,
      showQuickPick: async () => undefined,
    },
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({ get: (k, d) => (k in conf ? conf[k] : d) }),
      createFileSystemWatcher: (pattern) => { const w = { pattern, onDidCreate: ev(), onDidChange: ev(), onDidDelete: ev(), dispose() {} }; watchers.push(w); return w; },
      onDidChangeConfiguration: ev(),
    },
    commands: {
      registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
      executeCommand: async (id, ...a) => { if (commands.has(id)) return commands.get(id)(...a); return { id, a }; },
    },
  };
  return { vscode, commands, items, panels, watchers };
}

function withVscode(fake, fn) {
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'vscode' ? fake : orig.call(this, req, ...rest); };
  try { return fn(); } finally { Module._load = orig; }
}

test('extension: activates, reads the fixture folders, fills the status bar and the dashboard', async (t) => {
  const fx = fixtures(Date.now());
  t.after(fx.cleanup);
  const f = fakeVscode({ claudeRoots: [fx.claudeRoot], codexRoots: [fx.codexRoot], refreshSeconds: 3600 });
  const ext = withVscode(f.vscode, () => { delete require.cache[require.resolve('../src/extension')]; return require('../src/extension'); });
  const context = { subscriptions: [], extensionPath: require('path').join(__dirname, '..'), globalState: { get() {}, async update() {} } };
  const api = ext.activate(context);
  await api.meter.scan();
  const item = f.items[0];
  assert.ok(item.shown);
  assert.match(item.text, /Claude \S+ \$\S+ · Codex \S+ \$\S+ · \$\(clock\) \S+/);
  assert.match(item.tooltip.value, /Codex rate limits/);
  assert.equal(f.watchers.length, 2, 'one watcher per root');
  for (const id of ['aiUsageMeter.openDashboard', 'aiUsageMeter.refresh', 'aiUsageMeter.editPrices', 'aiUsageMeter.supportDeveloper', 'aiUsageMeter.moreViewers']) assert.ok(f.commands.has(id), id);
  await f.vscode.commands.executeCommand('aiUsageMeter.openDashboard');
  const p = f.panels[0];
  assert.match(p.webview.html, /Content-Security-Policy/);
  p.send({ type: 'ready' });
  const data = p.posted.find((m) => m.type === 'data');
  assert.ok(data);
  assert.equal(data.perDay.length, 30);
  assert.ok(data.today.claude.total > 0 && data.today.codex.total > 0);
  assert.ok(data.block, 'an active 5-hour block');
  assert.ok(!JSON.stringify(p.posted).includes(fx.mark), 'no session text in webview messages');
  p.send({ type: 'setRange', days: 7 });
  assert.equal(p.posted.at(-1).perDay.length, 7);
  p.send({ type: 'setRange', days: 8 });
  assert.equal(p.posted.at(-1).days, 7, 'bad range ignored');
  await f.vscode.commands.executeCommand('aiUsageMeter.openDashboard');
  assert.equal(f.panels.length, 1, 'one dashboard panel');
  p.dispose();
  ext.deactivate();
});
