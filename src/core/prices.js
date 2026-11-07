'use strict';
// Estimated prices in US dollars per million tokens. The longest model-id prefix that matches wins.
// Built-in values were taken on PRICES_TAKEN_ON from the vendors' published API prices (Anthropic model docs;
// OpenAI prices from public price trackers). Subscription plans are not billed per token, so for them the
// number is what the same tokens would cost on the API. Users override any row in settings.

const PRICES_TAKEN_ON = '2026-11-06';

const DEFAULT_PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'gpt-6.1-sol': { input: 2, output: 10, cacheWrite: 0, cacheRead: 0.1 },
  'gpt-6.1-terra': { input: 1, output: 5, cacheWrite: 0, cacheRead: 0.05 },
  'gpt-5.3-codex': { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  'gpt-5.2-codex': { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  'gpt-5.1-codex-mini': { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 },
  'gpt-5.1-codex': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5-codex': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  // Gemini: Google's paid-tier API prices for prompts up to 200k tokens. Thinking tokens count as output.
  'gemini-3-pro': { input: 2, output: 12, cacheWrite: 0, cacheRead: 0.2 },
  'gemini-3-flash': { input: 0.5, output: 3, cacheWrite: 0, cacheRead: 0.05 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0.01 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.03 },
};

const FIELDS = ['input', 'output', 'cacheWrite', 'cacheRead'];

function validRow(r) {
  if (!r || typeof r !== 'object') return null;
  const out = {};
  for (const f of FIELDS) {
    const v = r[f];
    out[f] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return FIELDS.some((f) => typeof r[f] === 'number') ? out : null;
}

/** Built-in table plus valid user rows (user rows win). Bad rows are ignored and listed in `ignored`. */
function buildTable(user) {
  const table = {};
  for (const [k, v] of Object.entries(DEFAULT_PRICES)) table[k] = { ...v, source: 'built-in' };
  const ignored = [];
  if (user && typeof user === 'object' && !Array.isArray(user)) {
    for (const [k, v] of Object.entries(user)) {
      const key = String(k).trim().toLowerCase();
      const row = validRow(v);
      if (!key || !row) { ignored.push(k); continue; }
      table[key] = { ...row, source: 'settings' };
    }
  }
  return { table, ignored };
}

/** Finds the price row for a model id: exact, then the longest matching prefix. Strips "provider/" prefixes. */
function priceFor(table, model) {
  if (typeof model !== 'string' || !model) return null;
  let m = model.toLowerCase();
  if (m.includes('/')) m = m.slice(m.lastIndexOf('/') + 1);
  if (m.startsWith('anthropic.')) m = m.slice('anthropic.'.length);
  if (table[m]) return { key: m, row: table[m] };
  let best = null;
  for (const k of Object.keys(table)) {
    if (m.startsWith(k) && (m.length === k.length || /[-.@:_]/.test(m[k.length])) && (!best || k.length > best.length)) best = k;
  }
  return best ? { key: best, row: table[best] } : null;
}

/** Cost in dollars for token counts, or null when the model has no price row. */
function costOf(table, model, t) {
  const p = priceFor(table, model);
  if (!p) return null;
  const r = p.row;
  return ((t.input || 0) * r.input + (t.output || 0) * r.output + (t.cacheWrite || 0) * r.cacheWrite + (t.cacheRead || 0) * r.cacheRead) / 1e6;
}

module.exports = { DEFAULT_PRICES, PRICES_TAKEN_ON, buildTable, priceFor, costOf, FIELDS };
