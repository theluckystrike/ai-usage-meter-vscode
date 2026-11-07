'use strict';
// Claude Code plan limits, read offline. Claude Code saves its own last reading of your plan usage (the
// numbers on claude.ai/settings/usage) as `cachedUsageUtilization` in its config file: ~/.claude.json for
// the default folder, <CLAUDE_CONFIG_DIR>/.claude.json otherwise. This module reads only that key. It never
// keeps the account id, the email or anything else from the file, and it makes no network call.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 64 * 1024 * 1024;
const KEY = '"cachedUsageUtilization"';
// Known windows and their short names, in display order. Unknown keys are skipped.
const WINDOWS = [
  ['five_hour', '5h', '5-hour'],
  ['seven_day', 'wk', 'weekly'],
  ['seven_day_opus', 'wk Opus', 'weekly Opus'],
  ['seven_day_sonnet', 'wk Sonnet', 'weekly Sonnet'],
];

function timeMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

/** The config files Claude Code may use for a config folder, most likely first. */
function configFiles(dir, home = os.homedir()) {
  const out = [path.join(dir, '.claude.json')];
  if (path.resolve(dir) === path.resolve(home, '.claude')) out.unshift(path.join(home, '.claude.json'));
  return out;
}

/** Parsed config object -> { fetchedAt, windows: [{ key, name, label, usedPercent, resetsAt }] } or null. */
function parseLimits(obj) {
  const c = obj && typeof obj === 'object' ? obj.cachedUsageUtilization : null;
  if (!c || typeof c !== 'object') return null;
  const u = c.utilization && typeof c.utilization === 'object' ? c.utilization : null;
  if (!u) return null;
  const windows = [];
  for (const [key, name, label] of WINDOWS) {
    const w = u[key];
    if (!w || typeof w !== 'object') continue;
    const v = typeof w.utilization === 'number' && Number.isFinite(w.utilization) ? w.utilization : null;
    if (v === null) continue;
    windows.push({ key, name, label, usedPercent: Math.max(0, Math.min(100, v)), resetsAt: timeMs(w.resets_at) });
  }
  // Newer Claude Code versions also save a `limits` list. Team plans leave seven_day empty and keep their
  // weekly limit there, scoped to one model, so read it for anything the windows above did not give.
  if (Array.isArray(u.limits)) {
    const have = new Set(windows.map((w) => w.key));
    for (const l of u.limits) {
      if (!l || typeof l !== 'object' || typeof l.percent !== 'number' || !Number.isFinite(l.percent)) continue;
      let key, name, label;
      if (l.kind === 'session') [key, name, label] = WINDOWS[0];
      else if (l.kind === 'weekly_all') [key, name, label] = WINDOWS[1];
      else if (l.kind === 'weekly_scoped') {
        const m = l.scope && typeof l.scope === 'object' && l.scope.model && typeof l.scope.model === 'object' ? l.scope.model.display_name : null;
        if (typeof m !== 'string' || !/^[\w .-]{1,40}$/.test(m)) continue;
        key = 'seven_day_' + m.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        name = 'wk ' + m; label = 'weekly ' + m;
      } else continue;
      if (have.has(key)) continue;
      have.add(key);
      windows.push({ key, name, label, usedPercent: Math.max(0, Math.min(100, l.percent)), resetsAt: timeMs(l.resets_at) });
    }
  }
  if (!windows.length) return null;
  return { fetchedAt: timeMs(c.fetchedAtMs), windows };
}

/** A window for display at `now`: null percent when the window has reset since Claude Code saved it. */
function windowView(w, now) {
  const reset = typeof w.resetsAt === 'number' && w.resetsAt <= now;
  return { key: w.key, name: w.name, label: w.label, usedPercent: reset ? null : Math.round(w.usedPercent), resetsAt: w.resetsAt, resetsIn: w.resetsAt ? Math.max(0, w.resetsAt - now) : null, reset };
}

/** Reads limits for config folders, re-reading a file only when its size or time changed. */
class ClaudeLimitsReader {
  constructor(opts = {}) {
    this.cache = new Map(); // file -> { size, mtimeMs, limits }
    this.home = opts.home || os.homedir();
    this.fs = opts.fs || fs;
  }

  async readFile(file) {
    let st;
    try { st = await this.fs.promises.stat(file); } catch { this.cache.delete(file); return null; }
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return null;
    const old = this.cache.get(file);
    if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) return old.limits;
    let limits = null;
    try {
      const text = await this.fs.promises.readFile(file, 'utf8');
      if (text.includes(KEY)) limits = parseLimits(JSON.parse(text));
    } catch { limits = null; } // half-written or not JSON: try again next time
    this.cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, limits });
    return limits;
  }

  /** configs: [{ dir, label }]. Returns [{ account, fetchedAt, windows }], newest reading first. */
  async read(configs) {
    const out = [];
    for (const c of configs || []) {
      let best = null;
      for (const f of configFiles(c.dir, this.home)) {
        const l = await this.readFile(f);
        if (l && (!best || (l.fetchedAt || 0) > (best.fetchedAt || 0))) best = l;
      }
      if (best) out.push({ account: c.label, fetchedAt: best.fetchedAt, windows: best.windows });
    }
    return out.sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0));
  }
}

module.exports = { ClaudeLimitsReader, parseLimits, windowView, configFiles, WINDOWS };
