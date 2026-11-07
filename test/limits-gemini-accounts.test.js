'use strict';
const { NOW, fixtures } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLimits, windowView, ClaudeLimitsReader, configFiles } = require('../src/core/claudeLimits');
const { resolveRoots, discoverClaudeDirs, listFiles, geminiProjectNames } = require('../src/core/roots');
const { geminiEntries } = require('../src/core/usage');
const { UsageStore } = require('../src/core/store');
const { summarize } = require('../src/core/aggregate');
const { buildTable } = require('../src/core/prices');
const { statusView } = require('../src/core/statusbar');
const { dataMessage } = require('../src/core/protocol');

const MIN = 60000, HOUR = 60 * MIN;

// ---------- Claude Code plan limits saved by Claude Code ----------
test('limits: parseLimits keeps the known windows only and never the account fields', () => {
  const fx = fixtures(NOW);
  try {
    const raw = JSON.parse(fs.readFileSync(fx.claudeConfig, 'utf8'));
    const l = parseLimits(raw);
    assert.equal(l.fetchedAt, NOW - 4 * MIN);
    assert.deepEqual(l.windows.map((w) => [w.key, w.usedPercent]), [['five_hour', 34], ['seven_day', 61], ['seven_day_opus', 22]]);
    assert.equal(l.windows[0].resetsAt, NOW + 2 * HOUR + 13 * MIN);
    assert.ok(!JSON.stringify(l).includes(fx.mark), 'no email, org or account id kept');
  } finally { fx.cleanup(); }
  assert.equal(parseLimits({}), null);
  assert.equal(parseLimits({ cachedUsageUtilization: { utilization: { five_hour: null, seven_day: { utilization: 'x' } } } }), null);
  assert.equal(parseLimits(null), null);
  const clamp = parseLimits({ cachedUsageUtilization: { utilization: { five_hour: { utilization: 130, resets_at: 'bad' } } } });
  assert.equal(clamp.windows[0].usedPercent, 100);
  assert.equal(clamp.windows[0].resetsAt, null);
});

test('limits: a window that has reset since Claude Code saved it shows no stale percent', () => {
  const v = windowView({ key: 'five_hour', name: '5h', label: '5-hour', usedPercent: 80, resetsAt: NOW - MIN }, NOW);
  assert.equal(v.usedPercent, null);
  assert.equal(v.reset, true);
  const live = windowView({ key: 'seven_day', name: 'wk', label: 'weekly', usedPercent: 61.4, resetsAt: NOW + HOUR }, NOW);
  assert.equal(live.usedPercent, 61);
  assert.equal(live.resetsIn, HOUR);
});

test('limits: the default ~/.claude folder uses ~/.claude.json first', () => {
  assert.deepEqual(configFiles('/h/.claude', '/h'), ['/h/.claude.json', '/h/.claude/.claude.json']);
  assert.deepEqual(configFiles('/h/.claude-work', '/h'), ['/h/.claude-work/.claude.json']);
});

test('limits: the reader re-reads a config file only when it changes, newest account first', async () => {
  const fx = fixtures(NOW);
  try {
    const r = new ClaudeLimitsReader({ home: fx.dir });
    const configs = [{ dir: path.join(fx.dir, 'claude-work'), label: 'work' }, { dir: path.join(fx.dir, 'claude'), label: 'main' }, { dir: path.join(fx.dir, 'nope'), label: 'nope' }];
    let out = await r.read(configs);
    assert.deepEqual(out.map((a) => a.account), ['main', 'work'], 'newest saved reading first, missing folder skipped');
    let calls = 0;
    const orig = fs.promises.readFile;
    fs.promises.readFile = async (...a) => { calls++; return orig(...a); };
    try {
      out = await r.read(configs);
      assert.equal(calls, 0, 'unchanged files are not read again');
      const raw = JSON.parse(fs.readFileSync(fx.claudeConfig, 'utf8'));
      raw.cachedUsageUtilization.utilization.five_hour.utilization = 91;
      fs.writeFileSync(fx.claudeConfig, JSON.stringify(raw, null, 1));
      out = await r.read(configs);
      assert.equal(calls, 1);
      assert.equal(out[0].windows[0].usedPercent, 91);
      fs.writeFileSync(fx.claudeConfig, '{"cachedUsageUtilization": {"utilization": {"five_h'); // half-written
      out = await r.read(configs);
      assert.deepEqual(out.map((a) => a.account), ['work'], 'a broken file is skipped, not fatal');
    } finally { fs.promises.readFile = orig; }
  } finally { fx.cleanup(); }
});

// ---------- several Claude Code config folders ----------
test('accounts: finds ~/.claude, ~/.config/claude and ~/.claude-* folders that hold projects', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-home-'));
  try {
    for (const d of ['.claude/projects', '.claude-work/projects', '.config/claude/projects', '.claude-empty', '.claude.json.backup/projects', '.claudeX/projects']) fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude.json'), '{}');
    const found = discoverClaudeDirs(home);
    assert.deepEqual(found, [path.join(home, '.claude'), path.join(home, '.config', 'claude'), path.join(home, '.claude-work')]);
    const r = resolveRoots({}, {}, home);
    assert.deepEqual(r.claude, found.map((d) => path.join(d, 'projects')));
    assert.deepEqual(r.claudeConfigs.map((c) => c.label), ['~/.claude', '~/.config/claude', '~/.claude-work']);
    assert.equal(r.claudeAccount[path.join(home, '.claude-work', 'projects')], '~/.claude-work');
    assert.deepEqual(resolveRoots({ findClaudeAccounts: false }, {}, home).claude, [path.join(home, '.claude', 'projects')]);
    assert.deepEqual(resolveRoots({}, { CLAUDE_CONFIG_DIR: '/x/cfg' }, home).claude, ['/x/cfg/projects'], 'env wins over discovery');
    assert.deepEqual(resolveRoots({ claudeRoots: ['/y/projects'] }, {}, home).claudeConfigs, [{ dir: '/y', label: '/y' }]);
    assert.deepEqual(resolveRoots({}, {}, home).gemini, [path.join(home, '.gemini', 'tmp')]);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-home-'));
  try { assert.deepEqual(resolveRoots({}, {}, empty).claude, [path.join(empty, '.claude', 'projects')], 'nothing found: the default folder'); }
  finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('accounts: usage from two config folders is split by account', async () => {
  const fx = fixtures(NOW);
  try {
    const roots = { claude: [fx.claudeRoot, fx.workRoot], codex: [], gemini: [], claudeAccount: { [fx.claudeRoot]: '~/main', [fx.workRoot]: '~/.claude-work' } };
    const store = new UsageStore();
    await store.update(await listFiles(roots, undefined, 0), { now: NOW });
    const s = summarize(store.entries(), { now: NOW, table: buildTable({}).table, days: 30 });
    assert.deepEqual(s.perAccount.map((a) => a.name).sort(), ['~/.claude-work', '~/main']);
    const work = s.perAccount.find((a) => a.name === '~/.claude-work');
    assert.equal(work.count, 4);
    assert.equal(work.total, 4 * (800 + 1500 + 4000 + 30000));
    const msg = dataMessage(s, { home: '' });
    assert.equal(msg.perAccount.length, 2);
  } finally { fx.cleanup(); }
});

// ---------- Gemini CLI ----------
test('gemini: JSON sessions count cached tokens as cache read and thinking as output; JSONL works too', () => {
  const fx = fixtures(NOW);
  try {
    const today = fx.files.find((f) => f.includes('gtoday'));
    const e = geminiEntries(fs.readFileSync(today, 'utf8'));
    const sum = (k) => e.reduce((a, x) => a + x[k], 0);
    assert.equal(e.length, 2, 'user, info and undated messages are skipped');
    assert.equal(sum('input'), fx.expect.geminiToday.input);
    assert.equal(sum('cacheRead'), fx.expect.geminiToday.cacheRead);
    assert.equal(sum('output'), fx.expect.geminiToday.output);
    assert.ok(!JSON.stringify(e).includes(fx.mark), 'no prompt, reply or thought text');
    const jl = geminiEntries(fs.readFileSync(fx.files.find((f) => f.endsWith('.jsonl') && f.includes('gemini')), 'utf8'));
    assert.equal(jl.length, 1, 'a message saved twice counts once');
    assert.deepEqual([jl[0].input, jl[0].cacheRead, jl[0].output], [fx.expect.geminiJsonl.input, fx.expect.geminiJsonl.cacheRead, fx.expect.geminiJsonl.output]);
  } finally { fx.cleanup(); }
  assert.deepEqual(geminiEntries(''), []);
  assert.deepEqual(geminiEntries('not json'), []);
  assert.deepEqual(geminiEntries('{"messages": "x"}'), []);
});

test('gemini: the store reads session files, names projects from projects.json and re-reads a changed file without double counting', async () => {
  const fx = fixtures(NOW);
  try {
    const roots = { claude: [], codex: [], gemini: [fx.geminiRoot] };
    const names = await geminiProjectNames(roots.gemini);
    assert.equal(names['data-pipeline'], '/Users/demo/data-pipeline');
    const store = new UsageStore();
    await store.update(await listFiles(roots, undefined, 0), { now: NOW, geminiNames: names });
    const table = buildTable({}).table;
    let s = summarize(store.entries(), { now: NOW, table, days: 30 });
    const t = s.today.gemini;
    assert.equal(t.input, fx.expect.geminiToday.input);
    assert.equal(t.cacheRead, fx.expect.geminiToday.cacheRead);
    assert.equal(t.output, fx.expect.geminiToday.output);
    assert.ok(t.cost > 0, 'gemini-3-flash has a built-in price');
    assert.ok(s.perProject.some((p) => p.name === '/Users/demo/data-pipeline'));
    assert.ok(s.perProject.some((p) => p.name === 'f3a9c1d2e4b5'), 'unknown folders keep their name');
    // Gemini CLI rewrites the whole file when a message is added.
    const file = fx.files.find((f) => f.includes('gtoday'));
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    d.messages.push({ id: 'gm3', timestamp: new Date(NOW - HOUR).toISOString(), type: 'gemini', model: 'gemini-3-flash-preview', tokens: { input: 1000, output: 100, cached: 0, thoughts: 0, tool: 0 } });
    fs.writeFileSync(file, JSON.stringify(d));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const r = await store.update(await listFiles(roots, undefined, 0), { now: NOW });
    assert.equal(r.filesRead, 1, 'only the changed file is read');
    s = summarize(store.entries(), { now: NOW, table, days: 30 });
    assert.equal(s.today.gemini.input, fx.expect.geminiToday.input + 1000);
    assert.equal(s.today.gemini.output, fx.expect.geminiToday.output + 100);
    const again = await store.update(await listFiles(roots, undefined, 0), { now: NOW });
    assert.equal(again.filesRead, 0, 'nothing read when nothing changed');
  } finally { fx.cleanup(); }
});

// ---------- status bar and dashboard message ----------
function sumWith(claudeLimits, gemini = true) {
  const e = [
    { tool: 'claude', ts: NOW - HOUR, model: 'claude-opus-5-5', input: 1000, output: 1000, cacheWrite: 0, cacheRead: 0, project: '/a' },
    { tool: 'codex', ts: NOW - HOUR, model: 'gpt-6.1-sol', input: 1000, output: 1000, cacheWrite: 0, cacheRead: 0, project: '/a' },
  ];
  if (gemini) e.push({ tool: 'gemini', ts: NOW - HOUR, model: 'gemini-3-flash-preview', input: 5000, output: 500, cacheWrite: 0, cacheRead: 1000, project: '/b' });
  return summarize(e, { now: NOW, table: buildTable({}).table, days: 1, claudeLimits });
}

test('status bar: Claude Code 5-hour and weekly percent from the saved limits, warning at 90%', () => {
  const lim = [{ account: '~/.claude', fetchedAt: NOW - 3 * MIN, windows: [
    { key: 'five_hour', name: '5h', label: '5-hour', usedPercent: 34, resetsAt: NOW + 2 * HOUR },
    { key: 'seven_day', name: 'wk', label: 'weekly', usedPercent: 61, resetsAt: NOW + 50 * HOUR },
    { key: 'seven_day_opus', name: 'wk Opus', label: 'weekly Opus', usedPercent: 95, resetsAt: NOW + 50 * HOUR },
  ] }];
  const v = statusView(sumWith(lim), { tools: { claude: true, codex: true, gemini: true } });
  assert.match(v.text, /^\$\(pulse\) Claude 2k \$0\.02 5h 34% wk 61% · Codex 2k \$0\.01 · Gemini 6\.5k <\$0\.01$/);
  assert.match(v.text, /Gemini 6\.5k <?\$/);
  assert.doesNotMatch(v.text, /Opus/, 'the status bar stays short');
  assert.doesNotMatch(v.text, /\$\(clock\)/);
  assert.match(v.tooltip, /weekly Opus: 95% used/);
  assert.match(v.tooltip, /saved 3m ago/);
  assert.equal(v.warn, true, 'a window at 95% turns the item yellow');
  const noGemini = statusView(sumWith(lim), { tools: { claude: true, codex: true } });
  assert.doesNotMatch(noGemini.text, /Gemini/, 'Gemini CLI shows only when it has files');
  const two = statusView(sumWith([...lim, { account: '~/.claude-work', fetchedAt: NOW - 3 * HOUR, windows: [{ key: 'five_hour', name: '5h', label: '5-hour', usedPercent: 12, resetsAt: NOW - MIN }] }]), {});
  assert.doesNotMatch(two.tooltip, /claude-work/, 'a second account with only reset windows is left out');
  assert.match(two.tooltip, /^- 5-hour: 34% used/m, 'one account left, so no folder prefix');
});

test('dashboard message: limits per account with reset windows marked, and no account text', () => {
  const fx = fixtures(NOW);
  try {
    const lim = [{ account: '/Users/demo/.claude', fetchedAt: NOW - MIN, windows: parseLimits(JSON.parse(fs.readFileSync(fx.claudeConfig, 'utf8'))).windows }];
    const msg = dataMessage(sumWith(lim), { home: '/Users/demo' });
    assert.equal(msg.claudeLimits[0].account, '~/.claude');
    assert.equal(msg.claudeLimits[0].windows[0].usedPercent, 34);
    assert.ok(!JSON.stringify(msg).includes(fx.mark));
    assert.ok(msg.today.gemini.total > 0);
  } finally { fx.cleanup(); }
});

test('status bar: accounts whose windows have all reset are left out of the tooltip, except the newest', () => {
  const w = (pct, resetsAt) => ({ key: 'five_hour', name: '5h', label: '5-hour', usedPercent: pct, resetsAt });
  const lim = [
    { account: '~/.claude-new', fetchedAt: NOW - MIN, windows: [w(10, NOW - MIN)] },
    { account: '~/.claude-old', fetchedAt: NOW - 50 * HOUR, windows: [w(98, NOW - 45 * HOUR)] },
    { account: '~/.claude-live', fetchedAt: NOW - 2 * HOUR, windows: [w(40, NOW + HOUR)] },
  ];
  const v = statusView(sumWith(lim), {});
  assert.match(v.tooltip, /~\/\.claude-new: 5-hour: window has reset/);
  assert.match(v.tooltip, /~\/\.claude-live: 5-hour: 40% used/);
  assert.doesNotMatch(v.tooltip, /claude-old/);
  assert.equal(v.warn, false, 'an old 98% that has reset does not warn');
});
