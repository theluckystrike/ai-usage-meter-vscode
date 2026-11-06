'use strict';
// Short number, money and time formats for the status bar and its tooltip.

function tokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
  return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
}

function money(n) {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 100) return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString('en-US');
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function windowName(minutes) {
  if (minutes === 300) return '5h';
  if (minutes === 10080) return 'week';
  if (!minutes) return 'limit';
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** A Codex limit window for display, or null when the window has already reset (the file is older than it). */
function limitView(w, now) {
  if (!w) return null;
  const reset = typeof w.resetsAt === 'number' && w.resetsAt <= now;
  return {
    name: windowName(w.windowMinutes),
    usedPercent: reset ? null : Math.round(w.usedPercent),
    resetsAt: w.resetsAt,
    resetsIn: w.resetsAt ? Math.max(0, w.resetsAt - now) : null,
    reset,
  };
}

module.exports = { tokens, money, duration, clock, windowName, limitView };
