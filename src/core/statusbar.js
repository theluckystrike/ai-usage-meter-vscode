'use strict';
// Status bar text and tooltip. Pure, so tests can check them without VS Code.
const F = require('./format');
const { PRICES_TAKEN_ON } = require('./prices');
const { windowView } = require('./claudeLimits');

function ago(ms) {
  if (!Number.isFinite(ms) || ms < 60000) return 'just now';
  return F.duration(ms) + ' ago';
}

/**
 * summary: from aggregate.summarize. opts: { tools, showCost, showBlock, showLimits }
 * tools.claude and tools.codex show unless false; tools.gemini shows only when true (it is optional).
 * Returns { text, tooltip (markdown), warn }.
 */
function statusView(summary, opts = {}) {
  const tools = opts.tools || { claude: true, codex: true };
  const showCost = opts.showCost !== false;
  // One segment per tool, each with its own limits: "Claude 1.2M $3.40 5h 34% wk 61% · Codex …".
  const seg = { claude: '', codex: '', gemini: '' };
  const md = [];
  let warn = false;
  const now = summary.now;
  md.push('**Today** (since local midnight)', '');
  if (tools.claude !== false) {
    const t = summary.today.claude;
    seg.claude = `Claude ${F.tokens(t.total)}${showCost ? ' ' + F.money(t.cost) : ''}`;
    md.push(`- Claude Code: ${F.tokens(t.total)} tokens, ${F.money(t.cost)} est. (in ${F.tokens(t.input)} · out ${F.tokens(t.output)} · cache write ${F.tokens(t.cacheWrite)} · cache read ${F.tokens(t.cacheRead)})`);
  }
  if (tools.codex !== false) {
    const t = summary.today.codex;
    seg.codex = `Codex ${F.tokens(t.total)}${showCost ? ' ' + F.money(t.cost) : ''}`;
    md.push(`- Codex: ${F.tokens(t.total)} tokens, ${F.money(t.cost)} est. (in ${F.tokens(t.input)} · out ${F.tokens(t.output)} · cache read ${F.tokens(t.cacheRead)})`);
  }
  if (tools.gemini === true && summary.today.gemini) {
    const t = summary.today.gemini;
    seg.gemini = `Gemini ${F.tokens(t.total)}${showCost ? ' ' + F.money(t.cost) : ''}`;
    md.push(`- Gemini CLI: ${F.tokens(t.total)} tokens, ${F.money(t.cost)} est. (in ${F.tokens(t.input)} · out ${F.tokens(t.output)} · cache read ${F.tokens(t.cacheRead)})`);
  }
  // Claude Code plan limits that Claude Code saved itself. The newest reading goes in the status bar.
  // Newest reading first; other accounts only while one of their windows is still open (at most 4 in all).
  const cl = (tools.claude !== false && opts.showLimits !== false ? summary.claudeLimits || [] : [])
    .filter((a, i) => i === 0 || a.windows.some((w) => !(typeof w.resetsAt === 'number' && w.resetsAt <= now))).slice(0, 4);
  let has5h = false;
  if (cl.length) {
    md.push('', '**Claude Code plan limits** (as Claude Code last saved them)', '');
    cl.forEach((acct, i) => {
      const views = acct.windows.map((w) => windowView(w, now));
      const short = [];
      const head = cl.length > 1 ? `${acct.account}: ` : '';
      for (const v of views) {
        if (v.usedPercent === null) { md.push(`- ${head}${v.label}: window has reset since Claude Code saved it`); continue; }
        if (i === 0 && (v.key === 'five_hour' || v.key === 'seven_day')) { short.push(`${v.name} ${v.usedPercent}%`); if (v.key === 'five_hour') has5h = true; }
        if (v.usedPercent >= 90) warn = true;
        md.push(`- ${head}${v.label}: ${v.usedPercent}% used${v.resetsIn !== null ? `, resets in ${F.duration(v.resetsIn)} (${F.clock(v.resetsAt)})` : ''}`);
      }
      if (acct.fetchedAt) md.push(`- ${head}saved ${ago(now - acct.fetchedAt)}. Claude Code updates it while you use it.`);
      if (i === 0 && short.length) seg.claude = (seg.claude || 'Claude') + ' ' + short.join(' ');
    });
  }
  if (tools.claude !== false && opts.showBlock !== false) {
    md.push('', '**Claude Code 5-hour block**', '');
    const b = summary.block;
    if (b) {
      if (!has5h) seg.claude = (seg.claude || 'Claude') + ` $(clock) ${F.duration(b.resetsInMs)}`;
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
      if (short.length) seg.codex = (seg.codex || 'Codex') + ' ' + short.join(' ');
      if (l.plan) md.push(`- Plan: ${l.plan}`);
    } else {
      md.push('- Codex has not written rate limits yet.');
    }
  }
  md.push('', `Costs are estimates from the price table in settings (built-in prices taken on ${PRICES_TAKEN_ON}). Click to open the dashboard.`);
  const parts = [seg.claude, seg.codex, seg.gemini].filter(Boolean);
  return { text: '$(pulse) ' + (parts.join(' · ') || 'AI usage'), tooltip: md.join('\n'), warn };
}

module.exports = { statusView };
