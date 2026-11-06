'use strict';
// Turns usage entries into the numbers the status bar and the dashboard show. Pure: no VS Code, no I/O.
const { costOf } = require('./prices');

const HOUR_MS = 60 * 60 * 1000;
const BLOCK_MS = 5 * HOUR_MS;
const TOOLS = ['claude', 'codex'];
const TOOL_NAMES = { claude: 'Claude Code', codex: 'Codex' };

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of the day `back` days before the day of `now`. */
function dayStart(now, back = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

function zero() { return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, cost: 0, unpriced: 0, count: 0 }; }

function add(acc, e, cost) {
  acc.input += e.input; acc.output += e.output; acc.cacheWrite += e.cacheWrite; acc.cacheRead += e.cacheRead;
  acc.total += e.input + e.output + e.cacheWrite + e.cacheRead;
  acc.count++;
  if (cost === null) acc.unpriced += e.input + e.output + e.cacheWrite + e.cacheRead;
  else acc.cost += cost;
}

/**
 * Claude Code 5-hour blocks, the way Claude Code's own limits count them: a block starts at the hour of the
 * first message after a gap and lasts 5 hours. Only local timestamps are used. Returns the active block or null.
 */
function claudeBlock(entries, now, table) {
  const list = entries.filter((e) => e.tool === 'claude' && e.ts <= now && e.ts > now - 3 * 24 * HOUR_MS).sort((a, b) => a.ts - b.ts);
  let cur = null;
  for (const e of list) {
    if (!cur || e.ts >= cur.end || e.ts - cur.last >= BLOCK_MS) {
      const start = e.ts - (e.ts % HOUR_MS);
      cur = { start, end: start + BLOCK_MS, last: e.ts, totals: zero() };
    }
    cur.last = e.ts;
    add(cur.totals, e, costOf(table, e.model, e));
  }
  if (!cur || now >= cur.end) return null;
  const elapsed = Math.max(1, now - cur.start);
  return {
    start: cur.start, end: cur.end, last: cur.last,
    resetsInMs: cur.end - now,
    totals: cur.totals,
    // Tokens per minute so far in this block, for a rough burn rate.
    perMinute: Math.round(cur.totals.total / (elapsed / 60000)),
  };
}

function sortRows(map) {
  return [...map.values()].sort((a, b) => (b.cost - a.cost) || (b.total - a.total) || String(a.name).localeCompare(String(b.name)));
}

/**
 * opts: { now, table, days (range for tables and chart), tools: { claude, codex }, limits }
 */
function summarize(entries, opts) {
  const now = opts.now;
  const table = opts.table;
  const days = Math.max(1, Math.min(3650, opts.days || 30));
  const show = opts.tools || { claude: true, codex: true };
  const all = [];
  for (const e of entries) if (show[e.tool] !== false) all.push(e);
  const todayStart = dayStart(now, 0);
  const rangeStart = dayStart(now, days - 1);

  const today = { claude: zero(), codex: zero() };
  const dayMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(dayStart(now, i) + HOUR_MS * 12);
    dayMap.set(k, { day: k, name: k, claude: zero(), codex: zero(), ...zero() });
  }
  const projects = new Map(), models = new Map(), tools = new Map();
  const unpricedModels = new Set();
  const range = zero();
  for (const e of all) {
    if (e.ts < rangeStart || e.ts > now + HOUR_MS) continue;
    const cost = costOf(table, e.model, e);
    if (cost === null) unpricedModels.add(e.model || '(no model id)');
    if (e.ts >= todayStart) add(today[e.tool], e, cost);
    add(range, e, cost);
    const d = dayMap.get(dayKey(e.ts));
    if (d) { add(d, e, cost); add(d[e.tool], e, cost); }
    const pk = e.project || '(unknown folder)';
    if (!projects.has(pk)) projects.set(pk, { name: pk, tools: [], ...zero() });
    const p = projects.get(pk);
    add(p, e, cost);
    if (!p.tools.includes(e.tool)) p.tools.push(e.tool);
    const mk = e.tool + '|' + (e.model || '(no model id)');
    if (!models.has(mk)) models.set(mk, { name: e.model || '(no model id)', tool: e.tool, priced: cost !== null, ...zero() });
    add(models.get(mk), e, cost);
    if (!tools.has(e.tool)) tools.set(e.tool, { name: TOOL_NAMES[e.tool], tool: e.tool, ...zero() });
    add(tools.get(e.tool), e, cost);
  }
  return {
    now,
    days,
    today,
    range,
    perDay: [...dayMap.values()],
    perProject: sortRows(projects),
    perModel: sortRows(models),
    perTool: sortRows(tools),
    block: show.claude !== false ? claudeBlock(all, now, table) : null,
    limits: show.codex !== false ? opts.limits || null : null,
    unpricedModels: [...unpricedModels].sort(),
  };
}

module.exports = { summarize, claudeBlock, dayKey, dayStart, TOOLS, TOOL_NAMES, BLOCK_MS, HOUR_MS };
