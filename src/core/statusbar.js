'use strict';
// Status bar text and tooltip. Pure, so tests can check them without VS Code.
const F = require('./format');
const { PRICES_TAKEN_ON } = require('./prices');

/**
 * summary: from aggregate.summarize. opts: { tools, showCost, showBlock, showLimits }
 * Returns { text, tooltip (markdown), warn }.
 */
function statusView(summary, opts = {}) {
  const tools = opts.tools || { claude: true, codex: true };
  const showCost = opts.showCost !== false;
  const parts = [];
  const md = [];
  let warn = false;
  const now = summary.now;
  md.push('**Today** (since local midnight)', '');
  if (tools.claude !== false) {
    const t = summary.today.claude;
    parts.push(`Claude ${F.tokens(t.total)}${showCost ? ' ' + F.money(t.cost) : ''}`);
    md.push(`- Claude Code: ${F.tokens(t.total)} tokens, ${F.money(t.cost)} est. (in ${F.tokens(t.input)} · out ${F.tokens(t.output)} · cache write ${F.tokens(t.cacheWrite)} · cache read ${F.tokens(t.cacheRead)})`);
  }
  if (tools.codex !== false) {
    const t = summary.today.codex;
    parts.push(`Codex ${F.tokens(t.total)}${showCost ? ' ' + F.money(t.cost) : ''}`);
    md.push(`- Codex: ${F.tokens(t.total)} tokens, ${F.money(t.cost)} est. (in ${F.tokens(t.input)} · out ${F.tokens(t.output)} · cache read ${F.tokens(t.cacheRead)})`);
  }
  if (tools.claude !== false && opts.showBlock !== false) {
    md.push('', '**Claude Code 5-hour block**', '');
    const b = summary.block;
    if (b) {
      parts.push(`$(clock) ${F.duration(b.resetsInMs)}`);
      md.push(`- ${F.tokens(b.totals.total)} tokens, ${F.money(b.totals.cost)} est. since ${F.clock(b.start)}`);
      md.push(`- Resets at ${F.clock(b.end)}, in ${F.duration(b.resetsInMs)}. Worked out from local timestamps.`);
    } else {
      md.push('- No active block. One starts with your next Claude Code message.');
    }
  }
  if (tools.codex !== false && opts.showLimits !== false) {
    const l = summary.limits;
    md.push('', '**Codex rate limits** (from the newest session file)', '');
    if (l) {
      const short = [];
      for (const w of [l.primary, l.secondary]) {
        const v = F.limitView(w, now);
        if (!v) continue;
        if (v.usedPercent === null) { md.push(`- ${v.name}: window has reset since Codex last wrote it`); continue; }
        short.push(`${v.name === 'week' ? 'wk' : v.name} ${v.usedPercent}%`);
        if (v.usedPercent >= 90) warn = true;
        md.push(`- ${v.name}: ${v.usedPercent}% used${v.resetsIn !== null ? `, resets in ${F.duration(v.resetsIn)} (${F.clock(v.resetsAt)})` : ''}`);
      }
      if (short.length) parts.push('Codex ' + short.join(' '));
      if (l.plan) md.push(`- Plan: ${l.plan}`);
    } else {
      md.push('- Codex has not written rate limits yet.');
    }
  }
  md.push('', `Costs are estimates from the price table in settings (built-in prices taken on ${PRICES_TAKEN_ON}). Click to open the dashboard.`);
  return { text: '$(pulse) ' + (parts.join(' · ') || 'AI usage'), tooltip: md.join('\n'), warn };
}

module.exports = { statusView };
