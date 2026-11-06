'use strict';
// Usage-only readers for Claude Code and Codex session records.
// They read token counts, model ids, timestamps, the working folder and Codex rate limits. They never copy
// prompt, reply, tool or reasoning text out of a record, and they skip record types they do not know.

function num(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0; }

function timeMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v);
}

function cleanModel(m) {
  return typeof m === 'string' && m && !m.startsWith('<') ? m.slice(0, 80) : '';
}

// Quick text checks before JSON.parse: most lines (prompts, replies, tool output) are never parsed at all.
const CLAUDE_HINT = '"usage"';
const CODEX_HINTS = ['"token_count"', '"turn_context"', '"session_meta"'];

function claudeWorth(line) { return line.includes(CLAUDE_HINT) && line.includes('"assistant"'); }
function codexWorth(line) { return CODEX_HINTS.some((h) => line.includes(h)); }

/**
 * One Claude Code record -> a usage entry, or null.
 * Entry: { key, ts, model, cwd, input, output, cacheWrite, cacheRead }
 * key dedupes the same API message written more than once (streamed blocks, resumed sessions).
 */
function claudeEntry(rec, fallbackKey) {
  if (!rec || rec.type !== 'assistant') return null;
  const msg = rec.message;
  if (!msg || typeof msg !== 'object' || !msg.usage || typeof msg.usage !== 'object') return null;
  const ts = timeMs(rec.timestamp);
  if (!Number.isFinite(ts)) return null;
  if (msg.model === '<synthetic>') return null;
  const u = msg.usage;
  const e = {
    key: typeof msg.id === 'string' && msg.id ? msg.id + ':' + (typeof rec.requestId === 'string' ? rec.requestId : '') : fallbackKey,
    ts,
    model: cleanModel(msg.model),
    cwd: typeof rec.cwd === 'string' ? rec.cwd : '',
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
  };
  if (!e.input && !e.output && !e.cacheWrite && !e.cacheRead) return null;
  return e;
}

function readTotals(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    input: num(t.input_tokens),
    cached: num(t.cached_input_tokens),
    cacheWrite: num(t.cache_write_input_tokens),
    output: num(t.output_tokens),
  };
}

function readWindow(w, eventTs) {
  if (!w || typeof w !== 'object') return null;
  const used = typeof w.used_percent === 'number' && Number.isFinite(w.used_percent) ? w.used_percent : null;
  if (used === null) return null;
  let resetsAt = null;
  if (typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)) resetsAt = w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at;
  else if (typeof w.resets_in_seconds === 'number' && Number.isFinite(w.resets_in_seconds) && Number.isFinite(eventTs)) resetsAt = eventTs + w.resets_in_seconds * 1000;
  const windowMinutes = typeof w.window_minutes === 'number' && Number.isFinite(w.window_minutes) ? w.window_minutes : null;
  return { usedPercent: Math.max(0, Math.min(100, used)), resetsAt, windowMinutes };
}

/** Codex rate limits from a token_count payload. Returns null when both windows are missing. */
function codexLimits(rl, ts) {
  if (!rl || typeof rl !== 'object') return null;
  const primary = readWindow(rl.primary, ts);
  const secondary = readWindow(rl.secondary, ts);
  if (!primary && !secondary) return null;
  const credits = rl.credits && typeof rl.credits === 'object'
    ? { hasCredits: rl.credits.has_credits === true, unlimited: rl.credits.unlimited === true }
    : null;
  const plan = typeof rl.plan_type === 'string' ? rl.plan_type.slice(0, 40) : '';
  return { ts, primary, secondary, credits, plan };
}

function newCodexState() {
  return { model: '', cwd: '', prev: null };
}

/**
 * One Codex record. Updates `state` (model, cwd, last cumulative totals) and returns
 * { entry, limits } where either can be null. The token entry is the growth of total_token_usage since the
 * last token_count in the same file, so repeated token_count events are not counted twice.
 */
function codexStep(rec, state) {
  const out = { entry: null, limits: null };
  if (!rec || typeof rec !== 'object') return out;
  const p = rec.payload && typeof rec.payload === 'object' ? rec.payload : null;
  if (!p) return out;
  if (rec.type === 'session_meta') {
    if (typeof p.cwd === 'string' && !state.cwd) state.cwd = p.cwd;
    return out;
  }
  if (rec.type === 'turn_context') {
    const m = cleanModel(p.model);
    if (m) state.model = m;
    if (typeof p.cwd === 'string' && !state.cwd) state.cwd = p.cwd;
    return out;
  }
  if (rec.type !== 'event_msg' || p.type !== 'token_count') return out;
  const ts = timeMs(rec.timestamp);
  if (!Number.isFinite(ts)) return out;
  out.limits = codexLimits(p.rate_limits, ts);
  const info = p.info && typeof p.info === 'object' ? p.info : null;
  if (!info) return out;
  const total = readTotals(info.total_token_usage);
  let d = null;
  if (total) {
    const prev = state.prev;
    if (!prev) d = { ...total };
    else {
      d = { input: total.input - prev.input, cached: total.cached - prev.cached, cacheWrite: total.cacheWrite - prev.cacheWrite, output: total.output - prev.output };
      if (d.input < 0 || d.cached < 0 || d.output < 0 || d.cacheWrite < 0) d = readTotals(info.last_token_usage) || { input: 0, cached: 0, cacheWrite: 0, output: 0 };
    }
    state.prev = total;
  } else {
    d = readTotals(info.last_token_usage);
  }
  if (!d) return out;
  const cached = Math.min(d.cached, d.input);
  const entry = {
    ts,
    model: state.model || cleanModel(info.model) || '',
    cwd: state.cwd,
    input: Math.max(0, d.input - cached),
    output: Math.max(0, d.output),
    cacheWrite: Math.max(0, d.cacheWrite),
    cacheRead: Math.max(0, cached),
  };
  if (entry.input || entry.output || entry.cacheWrite || entry.cacheRead) out.entry = entry;
  return out;
}

module.exports = { claudeEntry, codexStep, codexLimits, newCodexState, claudeWorth, codexWorth, timeMs, num };
