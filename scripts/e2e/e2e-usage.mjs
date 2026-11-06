// Release gate: drives zovo.ai-usage-meter (installed from the .vsix) in a real VS Code window over CDP,
// on synthetic session folders only. Harness vsc.mjs is the one lane SMV used.
// usage: node scripts/e2e/e2e-usage.mjs <work> <port> <vsix> <shotDir> <outJson>
import { installVsix, launch, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeFixtures, MARK } = require('../make-fixtures.js');

const [work0, port, vsix, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0);
fs.rmSync(work, { recursive: true, force: true });
const ws = path.join(work, 'ws');
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, 'notes.md'), '# demo workspace\n');
const fx = makeFixtures(path.join(work, 'data'), Date.now());
// The extension must only see the synthetic folders: env and settings both point there.
process.env.CLAUDE_CONFIG_DIR = path.join(work, 'data', 'claude');
process.env.CODEX_HOME = path.join(work, 'data', 'codex');
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const before = Object.fromEntries(fx.files.map((f) => [f, hash(f)]));

const R = { install: installVsix(work, vsix), steps: [], console: [], logs: {} };
const base = { 'aiUsageMeter.claudeRoots': [fx.claudeRoot], 'aiUsageMeter.codexRoots': [fx.codexRoot], 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.auxiliaryBar.visible': false, 'window.titleBarStyle': 'custom' };
const vs = await launch(work, Number(port), ws, base);
const settingsFile = path.join(work, 'ud', 'User', 'settings.json');
const setSettings = (extra) => { const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); fs.writeFileSync(settingsFile, JSON.stringify({ ...s, ...extra }, null, 1)); };
const shots = [];
const shot = async (name) => { const f = path.join(shotDir, `x18-${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await vs.shot(f); shots.push(f); return f; };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const v = await fn(); R.steps.push({ name, ok: v !== false, value: v, ms: Date.now() - t0 }); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 700), ms: Date.now() - t0 }); try { await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch {} }
};
const statusText = () => vs.wbEval(`(() => { const e = [...document.querySelectorAll('.part.statusbar .statusbar-item')].find(i => /Claude|Codex|AI usage|Reading AI/.test(i.textContent)); return e ? e.textContent.trim() : null; })()`);
const statusBox = () => vs.wbEval(`(() => { const e = [...document.querySelectorAll('.part.statusbar .statusbar-item')].find(i => /Claude|Codex/.test(i.textContent)); if (!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2, bg: getComputedStyle(e).backgroundColor }); })()`);
async function dash(ms = 20000) {
  return vs.waitFor(async () => {
    for (const [sid, info] of vs.attached) {
      if (sid === vs.wb || info.type !== 'iframe') continue;
      for (const c of vs.ctx.get(sid) || []) {
        if (!c.auxData?.isDefault) continue;
        try {
          const r = await vs.s.send('Runtime.evaluate', { expression: `!!document.getElementById('tiles') && document.body.getBoundingClientRect().width`, contextId: c.id, returnByValue: true }, sid);
          if (r.result.value > 0) return { sid, cid: c.id };
        } catch {}
      }
    }
    return null;
  }, ms);
}
let wv;
const E = (expr) => vs.wvEval(wv, expr);

try {
  await sleep(2500);
  await step('status bar shows Claude Code and Codex usage from the synthetic folders', async () => {
    const t = await vs.waitFor(async () => { const s = await statusText(); return s && /Claude .* · Codex /.test(s) ? s : null; }, 30000);
    if (!t) throw new Error('status text: ' + await statusText());
    if (!/Codex 5h 43% wk 71%/.test(t)) throw new Error('codex limits missing: ' + t);
    if (!/\d+h \d+m|\d+m/.test(t)) throw new Error('block countdown missing: ' + t);
    return t;
  });
  await step('hover shows the tooltip with split, block and reset times', async () => {
    const b = JSON.parse(await statusBox());
    await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y }, vs.wb);
    const tip = await vs.waitFor(() => vs.wbEval(`(() => { const h = [...document.querySelectorAll('.monaco-hover, .workbench-hover')].find(e => e.offsetParent !== null && /5-hour block/.test(e.textContent)); return h ? h.textContent.slice(0, 900) : null; })()`), 8000);
    if (!tip) throw new Error('no hover');
    await shot('status-tooltip');
    if (/PRIVATE-TEXT-MARKER/.test(tip)) throw new Error('text leaked');
    return tip.slice(0, 300);
  });
  await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 }, vs.wb);
  await step('clicking the status item opens the dashboard', async () => {
    const b = JSON.parse(await statusBox());
    await vs.click(b.x, b.y);
    wv = await dash();
    if (!wv) throw new Error('dashboard webview not found');
    const ok = await vs.waitFor(() => E(`document.querySelectorAll('#tiles .tile').length >= 5 && document.querySelectorAll('#chart path.bar, #chart rect.bar').length > 10`), 15000);
    if (!ok) throw new Error('dashboard not rendered: ' + await E(`document.body.innerText.slice(0, 500)`));
    await sleep(500);
    return await E(`JSON.stringify({ tiles: [...document.querySelectorAll('.tile')].map(t => t.innerText.replace(/\\n/g, ' | ')), bars: document.querySelectorAll('.bar').length, title: document.getElementById('chart-title').textContent })`);
  });
  await step('dashboard tables: tool, project, model, day; no session text', async () => {
    const r = JSON.parse(await E(`JSON.stringify({ tool: document.querySelectorAll('#t-tool tbody tr').length, proj: [...document.querySelectorAll('#t-project tbody tr td:first-child')].map(td => td.textContent), model: [...document.querySelectorAll('#t-model tbody tr td:first-child')].map(td => td.textContent), day: document.querySelectorAll('#t-day tbody tr').length, note: document.getElementById('cost-note').textContent, marker: document.body.innerText.includes(${JSON.stringify(MARK)}) })`));
    if (r.tool !== 2 || r.proj.length < 3 || r.model.length < 5 || r.day < 15) throw new Error(JSON.stringify(r));
    if (r.marker) throw new Error('marker text shown');
    if (!/claude-experimental-x/.test(r.note) || !/2026-11-06/.test(r.note)) throw new Error('cost note: ' + r.note);
    return r;
  });
  await step('screenshot: dashboard, dark theme', async () => { await E(`window.scrollTo(0, 0)`); await sleep(300); return await shot('dashboard-dark'); });
  await step('hover a day bar shows a tooltip', async () => {
    await vs.wvClick(wv, `[...document.querySelectorAll('#chart .hit')].at(-1)`);
    const t = await vs.waitFor(() => E(`(() => { const t = document.getElementById('tip'); return t.hidden ? null : t.textContent; })()`), 4000);
    if (!t || !/Claude Code: .* tokens/.test(t)) throw new Error('tip: ' + t);
    return t;
  });
  await step('measure toggle switches the chart to estimated cost', async () => {
    await vs.wvClick(wv, `document.getElementById('m-cost')`);
    await sleep(400);
    const t = await E(`document.getElementById('chart-title').textContent + ' | ' + [...document.querySelectorAll('#chart .tick')][4].textContent`);
    if (!/Estimated cost/.test(t) || !/\$/.test(t)) throw new Error(t);
    await vs.wvClick(wv, `document.getElementById('m-tokens')`);
    return t;
  });
  await step('range select 7 days redraws the chart and the tables', async () => {
    await E(`(() => { const s = document.getElementById('range'); s.value = '7'; s.dispatchEvent(new Event('change')); })()`);
    const ok = await vs.waitFor(() => E(`document.getElementById('chart-title').textContent.includes('last 7 days') && document.querySelectorAll('#chart .hit').length === 7`), 5000);
    if (!ok) throw new Error(await E(`document.getElementById('chart-title').textContent`));
    await E(`(() => { const s = document.getElementById('range'); s.value = '30'; s.dispatchEvent(new Event('change')); })()`);
    return true;
  });
  await step('a line appended to a session file shows up without a manual refresh', async () => {
    const t0 = await statusText();
    const f = fx.files.find((x) => x.includes('11111111') && !x.includes('subagents'));
    const rec = { type: 'assistant', timestamp: new Date().toISOString(), cwd: '/Users/demo/shop-api', requestId: 'req_live', message: { id: 'msg_live', model: 'claude-opus-5-5', usage: { input_tokens: 400000, output_tokens: 300000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
    fs.appendFileSync(f, JSON.stringify(rec) + '\n');
    const t1 = await vs.waitFor(async () => { const s = await statusText(); return s && s !== t0 ? s : null; }, 15000);
    if (!t1) throw new Error('status did not change: ' + t0);
    return { before: t0, after: t1 };
  });
  await step('the Refresh button rereads without errors', async () => {
    await vs.wvClick(wv, `document.getElementById('refresh')`);
    await sleep(800);
    return await E(`document.getElementById('status').textContent`);
  });
  await step('light theme: dashboard tables', async () => {
    setSettings({ 'workbench.colorTheme': 'Default Light Modern' });
    await sleep(2500);
    wv = await dash();
    await E(`document.querySelector('#t-project').scrollIntoView({ block: 'start' })`);
    await sleep(500);
    const light = await E(`document.body.classList.contains('vscode-light')`);
    if (!light) throw new Error('not light');
    return await shot('dashboard-light');
  });
  await step('narrow editor (600 px) keeps controls reachable', async () => {
    await vs.s.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 900, deviceScaleFactor: 1, mobile: false }, vs.wb);
    await sleep(1200);
    wv = await dash();
    await E(`window.scrollTo(0, 0)`);
    await vs.waitFor(() => E(`document.querySelector('#chart svg').getBoundingClientRect().width <= document.getElementById('chart').clientWidth + 1`), 4000);
    const r = JSON.parse(await E(`JSON.stringify({ w: document.body.clientWidth, sw: document.documentElement.scrollWidth, btn: document.getElementById('prices').getBoundingClientRect().right, svg: Number(document.querySelector('#chart svg').getAttribute('width')), box: document.getElementById('chart').clientWidth })`));
    await E(`document.querySelector('#chart').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    await shot('narrow');
    await vs.s.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, vs.wb);
    if (r.sw > r.w + 40 || r.btn > r.w + 30 || r.svg > r.box + 1) throw new Error(JSON.stringify(r));
    return r;
  });
  await step('turning Codex off hides it from the status bar', async () => {
    setSettings({ 'aiUsageMeter.showCodex': false });
    const t = await vs.waitFor(async () => { const s = await statusText(); return s && !/Codex/.test(s) && /Claude/.test(s) ? s : null; }, 10000);
    if (!t) throw new Error(await statusText());
    setSettings({ 'aiUsageMeter.showCodex': true });
    return t;
  });
  await step('Edit prices opens the prices setting', async () => {
    await sleep(1500);
    wv = await dash();
    await vs.wvClick(wv, `document.getElementById('prices')`);
    const ok = await vs.waitFor(() => vs.wbEval(`!!document.querySelector('.settings-editor') && /aiUsageMeter|prices|Prices/.test(document.querySelector('.settings-editor').textContent)`), 8000);
    if (!ok) throw new Error('settings editor not shown');
    return true;
  });
} finally {
  R.console = vs.console.filter((c) => !/copilot|CloudSandboxApi|LESS API|github/i.test(c.text));
  for (const f of vs.extHostLogs()) {
    const txt = fs.readFileSync(f, 'utf8');
    const hits = txt.split('\n').filter((l) => /\[error\]/.test(l) && /usage-meter|aiUsageMeter/i.test(l));
    if (hits.length) R.logs[path.basename(f)] = hits.slice(0, 10);
  }
  await vs.close();
  R.unchanged = fx.files.filter((f) => !f.includes('11111111') || f.includes('subagents')).every((f) => before[f] === hash(f));
  R.shots = shots;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(R.steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.error ? ' :: ' + s.error : ''}`).join('\n'));
  console.log('console:', R.console.length, 'logs:', Object.keys(R.logs).length, 'fixtures unchanged:', R.unchanged);
}
