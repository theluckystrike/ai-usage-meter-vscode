'use strict';
// Dashboard HTML with a strict Content-Security-Policy: no remote content, one nonce'd local script.
const { footerHtml, FOOTER_CSS } = require('./support');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// For the CSP attribute: built from fixed text and the webview's cspSource, inside double quotes.
function escAttr(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function makeNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function csp(cspSource, nonce) {
  return [
    "default-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `img-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** o: { cspSource, scriptUri, styleUri, nonce?, showSupportLinks? } */
function buildHtml(o) {
  const nonce = o.nonce || makeNonce();
  const footer = footerHtml('aiUsageMeter', o.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escAttr(csp(o.cspSource, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(o.styleUri)}">
${footer ? `<style nonce="${nonce}">${FOOTER_CSS}\n.zovo-support{padding:12px 0 4px}</style>` : ''}
<title>AI Usage</title>
</head>
<body>
<header class="top">
  <h1>Claude Code &amp; Codex usage</h1>
  <div class="controls">
    <label for="range">Range</label>
    <select id="range" aria-label="Days to show"></select>
    <button id="refresh" type="button" class="secondary">Refresh</button>
    <button id="prices" type="button" class="secondary">Edit prices</button>
  </div>
</header>
<p class="note" id="status">Reading usage files…</p>
<section class="tiles" id="tiles" aria-label="Today"></section>
<section class="card">
  <div class="card-head"><h2 id="chart-title">Tokens per day</h2>
    <div class="seg" role="radiogroup" aria-label="Chart measure">
      <button type="button" id="m-tokens" role="radio" aria-checked="true">Tokens</button>
      <button type="button" id="m-cost" role="radio" aria-checked="false">Est. cost</button>
    </div>
  </div>
  <div class="legend" id="legend"></div>
  <div class="chart" id="chart"></div>
  <div class="tip" id="tip" role="tooltip" hidden></div>
</section>
<section class="card"><h2>By tool</h2><div id="t-tool"></div></section>
<section class="card"><h2>By project folder</h2><div id="t-project"></div></section>
<section class="card"><h2>By model</h2><div id="t-model"></div></section>
<section class="card"><h2>By day</h2><div id="t-day"></div></section>
<p class="note" id="cost-note"></p>
${footer}
<script nonce="${nonce}" src="${esc(o.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, esc, makeNonce, csp };
