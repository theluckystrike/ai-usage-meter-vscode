'use strict';
// Messages between the extension host and the dashboard webview. Messages from the webview are checked
// against a fixed list before the host acts on them.
const os = require('os');
const { PRICES_TAKEN_ON } = require('./prices');
const { limitView } = require('./format');

const FROM_WEBVIEW = new Set(['ready', 'refresh', 'setRange', 'openSettings', 'rendered', 'moreRows']);
const RANGES = [7, 14, 30, 90];
const SETTING_KEYS = new Set(['prices', 'claudeRoots', 'codexRoots', 'refreshSeconds', 'showClaudeCode', 'showCodex', 'historyDays', '']);
const MAX_ROWS = 50;

/** Returns a clean message or null. */
function fromWebview(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !FROM_WEBVIEW.has(msg.type)) return null;
  if (msg.type === 'setRange') {
    const days = Number(msg.days);
    return RANGES.includes(days) ? { type: 'setRange', days } : null;
  }
  if (msg.type === 'openSettings') {
    const key = typeof msg.key === 'string' ? msg.key : '';
    return SETTING_KEYS.has(key) ? { type: 'openSettings', key } : null;
  }
  return { type: msg.type };
}

function shortPath(p, home = os.homedir()) {
  if (typeof p !== 'string') return '';
  if (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))) return '~' + p.slice(home.length);
  return p;
}

function trimRows(rows, max = MAX_ROWS) {
  if (rows.length <= max) return { rows, more: 0 };
  return { rows: rows.slice(0, max), more: rows.length - max };
}

/**
 * The data message for the webview. Only numbers, dates, model ids and folder paths: no session text.
 * ctx: { tools, priceTable, ignoredPrices, files, scanning, home, allRows }
 */
function dataMessage(summary, ctx = {}) {
  const home = ctx.home !== undefined ? ctx.home : os.homedir();
  const projects = summary.perProject.map((r) => ({ ...r, name: shortPath(r.name, home) }));
  const p = ctx.allRows ? { rows: projects, more: 0 } : trimRows(projects);
  const m = ctx.allRows ? { rows: summary.perModel, more: 0 } : trimRows(summary.perModel);
  const limits = summary.limits
    ? { ts: summary.limits.ts, plan: summary.limits.plan, credits: summary.limits.credits, primary: limitView(summary.limits.primary, summary.now), secondary: limitView(summary.limits.secondary, summary.now) }
    : null;
  return {
    type: 'data',
    now: summary.now,
    days: summary.days,
    ranges: RANGES,
    tools: ctx.tools || { claude: true, codex: true },
    today: summary.today,
    range: summary.range,
    perDay: summary.perDay,
    perProject: p.rows, moreProjects: p.more,
    perModel: m.rows, moreModels: m.more,
    perTool: summary.perTool,
    block: summary.block,
    limits,
    unpricedModels: summary.unpricedModels,
    pricesTakenOn: PRICES_TAKEN_ON,
    priceTable: ctx.priceTable || {},
    ignoredPrices: ctx.ignoredPrices || [],
    files: ctx.files || 0,
    scanning: !!ctx.scanning,
  };
}

module.exports = { fromWebview, dataMessage, shortPath, RANGES, FROM_WEBVIEW, MAX_ROWS };
