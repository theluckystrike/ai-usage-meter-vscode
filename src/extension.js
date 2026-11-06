'use strict';
// Claude Code & Codex usage meter. Reads local session files read-only, keeps a byte offset per file and reads
// only new lines. No network calls, no API keys, no telemetry.
const vscode = require('vscode');
const path = require('path');
const { UsageStore, DAY_MS } = require('./core/store');
const { resolveRoots, listFiles } = require('./core/roots');
const { summarize } = require('./core/aggregate');
const { buildTable } = require('./core/prices');
const { statusView } = require('./core/statusbar');
const { fromWebview, dataMessage } = require('./core/protocol');
const { buildHtml } = require('./html');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

const SECTION = 'aiUsageMeter';
const EXT_ID = 'zovo.ai-usage-meter';

function cfg() { return vscode.workspace.getConfiguration(SECTION); }

function settings() {
  const c = cfg();
  const num = (k, d, min, max) => { const v = Number(c.get(k, d)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
  return {
    claudeRoots: c.get('claudeRoots', []),
    codexRoots: c.get('codexRoots', []),
    tools: { claude: c.get('showClaudeCode', true) !== false, codex: c.get('showCodex', true) !== false },
    refreshSeconds: num('refreshSeconds', 60, 10, 3600),
    historyDays: num('historyDays', 90, 7, 3650),
    prices: c.get('prices', {}),
    statusBar: c.get('statusBar', true) !== false,
    statusBarCost: c.get('statusBarCost', true) !== false,
  };
}

class Meter {
  constructor(context) {
    this.context = context;
    this.s = settings();
    this.store = new UsageStore({ historyDays: this.s.historyDays });
    this.scanning = null;
    this.again = false;
    this.firstDone = false;
    this.panel = null;
    this.panelDays = 30;
    this.allRows = false;
    this.item = vscode.window.createStatusBarItem('aiUsageMeter.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Claude Code & Codex Usage';
    this.item.command = 'aiUsageMeter.openDashboard';
    this.item.text = '$(pulse) Reading AI usage…';
    this.timer = null;
    this.watchers = [];
    this.debounce = null;
    this.rating = createRatingPrompt({
      vscode, context, extensionId: EXT_ID, section: SECTION,
      message: (n) => `Claude Code & Codex Usage has shown your usage dashboard ${n} times. A rating helps other people find it.`,
    });
    context.subscriptions.push(this.item, { dispose: () => this.dispose() });
  }

  prices() { return buildTable(this.s.prices); }

  presentTools() {
    const present = { claude: false, codex: false };
    for (const st of this.store.files.values()) present[st.tool] = true;
    return { claude: this.s.tools.claude && present.claude, codex: this.s.tools.codex && present.codex };
  }

  /** Reads new lines from every file. Overlapping calls are merged into one more pass. */
  async scan() {
    if (this.scanning) { this.again = true; return this.scanning; }
    this.scanning = (async () => {
      do {
        this.again = false;
        const now = Date.now();
        const roots = resolveRoots(this.s);
        const listing = await listFiles(roots, this.s.tools, now - this.s.historyDays * DAY_MS);
        await this.store.update(listing, {
          now,
          onProgress: (i, n) => { if (!this.firstDone) this.item.text = `$(sync~spin) Reading AI usage ${i}/${n}`; },
        });
        this.firstDone = true;
        this.render();
      } while (this.again);
    })().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  render() {
    const { table } = this.prices();
    const now = Date.now();
    if (!this.firstDone) { if (this.s.statusBar) this.item.show(); this.postData(); return; }
    if (this.s.statusBar && (this.s.tools.claude || this.s.tools.codex)) {
      const tools = this.presentTools();
      if (!tools.claude && !tools.codex) {
        this.item.text = '$(pulse) No AI usage yet';
        this.item.tooltip = 'No Claude Code or Codex session files found in the folders from settings. Click to open the dashboard.';
      } else {
        const sum = summarize(this.store.entries(), { now, table, days: 1, tools, limits: this.store.limits });
        const v = statusView(sum, { tools, showCost: this.s.statusBarCost });
        this.item.text = v.text;
        const md = new vscode.MarkdownString(v.tooltip);
        md.supportThemeIcons = true;
        this.item.tooltip = md;
        this.item.backgroundColor = v.warn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      }
      this.item.show();
    } else this.item.hide();
    this.postData();
  }

  postData() {
    if (!this.panel || !this.panel.visible) return;
    const { table, ignored } = this.prices();
    const sum = summarize(this.store.entries(), { now: Date.now(), table, days: this.panelDays, tools: this.s.tools, limits: this.store.limits });
    const msg = dataMessage(sum, { tools: this.s.tools, ignoredPrices: ignored, files: this.store.fileCount, scanning: !!this.scanning && !this.firstDone, allRows: this.allRows });
    this.panel.webview.postMessage(msg);
  }

  openDashboard() {
    if (this.panel) { this.panel.reveal(); return; }
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const panel = vscode.window.createWebviewPanel('aiUsageMeter.dashboard', 'AI Usage', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [media],
      enableCommandUris: commandUris(SECTION),
    });
    panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'pulse.svg'));
    this.panel = panel;
    this.allRows = false;
    let counted = false;
    const w = panel.webview;
    w.html = buildHtml({
      cspSource: w.cspSource,
      scriptUri: w.asWebviewUri(vscode.Uri.joinPath(media, 'dashboard.js')).toString(),
      styleUri: w.asWebviewUri(vscode.Uri.joinPath(media, 'dashboard.css')).toString(),
      showSupportLinks: showLinks(vscode, SECTION),
    });
    w.onDidReceiveMessage((raw) => {
      const m = fromWebview(raw);
      if (!m) return;
      if (m.type === 'ready') this.postData();
      else if (m.type === 'refresh') this.scan();
      else if (m.type === 'setRange') { this.panelDays = m.days; this.postData(); }
      else if (m.type === 'moreRows') { this.allRows = true; this.postData(); }
      else if (m.type === 'openSettings') vscode.commands.executeCommand('workbench.action.openSettings', m.key ? `${SECTION}.${m.key}` : SECTION);
      else if (m.type === 'rendered' && !counted) { counted = true; this.rating.success(); }
    }, null, this.context.subscriptions);
    panel.onDidChangeViewState(() => { if (panel.visible) this.postData(); }, null, this.context.subscriptions);
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = null; }, null, this.context.subscriptions);
  }

  schedule() {
    clearInterval(this.timer);
    // The timer also moves the 5-hour countdown and the Codex reset times forward.
    this.timer = setInterval(() => this.scan(), this.s.refreshSeconds * 1000);
  }

  rewatch() {
    this.watchers.splice(0).forEach((w) => w.dispose());
    const roots = resolveRoots(this.s);
    const dirs = [...(this.s.tools.claude ? roots.claude : []), ...(this.s.tools.codex ? roots.codex : [])];
    const later = () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.scan(), 1500); };
    for (const r of dirs) {
      try {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(r), '**/*.jsonl'), false, false, false);
        w.onDidCreate(later); w.onDidChange(later); w.onDidDelete(later);
        this.watchers.push(w);
      } catch { /* folder missing: the timer still picks it up later */ }
    }
  }

  reconfigure() {
    const old = this.s;
    this.s = settings();
    const rootsChanged = JSON.stringify([old.claudeRoots, old.codexRoots, old.tools, old.historyDays]) !== JSON.stringify([this.s.claudeRoots, this.s.codexRoots, this.s.tools, this.s.historyDays]);
    if (rootsChanged) {
      this.store = new UsageStore({ historyDays: this.s.historyDays });
      this.firstDone = false;
      this.rewatch();
    }
    this.schedule();
    this.render();
    if (rootsChanged) this.scan();
  }

  dispose() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.watchers.splice(0).forEach((w) => w.dispose());
  }
}

let meter = null;

function activate(context) {
  registerSupport({ vscode, context, prefix: SECTION, selfId: EXT_ID });
  meter = new Meter(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('aiUsageMeter.openDashboard', () => meter.openDashboard()),
    vscode.commands.registerCommand('aiUsageMeter.refresh', () => meter.scan()),
    vscode.commands.registerCommand('aiUsageMeter.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', SECTION)),
    vscode.commands.registerCommand('aiUsageMeter.editPrices', () => vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.prices`)),
    vscode.commands.registerCommand('aiUsageMeter.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#aiUsageMeter.start`, false)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(SECTION)) meter.reconfigure(); }),
  );
  meter.rewatch();
  meter.schedule();
  meter.render();
  meter.scan();
  return { meter };
}

function deactivate() { if (meter) meter.dispose(); }

module.exports = { activate, deactivate, Meter, settings };
