// Dashboard webview. Builds everything with DOM APIs and textContent, so no file content is ever parsed as HTML.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const TOOL_NAMES = { claude: 'Claude Code', codex: 'Codex' };
  let data = null;
  let measure = (vscode.getState() || {}).measure === 'cost' ? 'cost' : 'tokens';
  let rendered = false;

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function sv(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function tok(n) {
    if (!isFinite(n) || n <= 0) return '0';
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
    return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  }
  function full(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function money(n) {
    if (!isFinite(n) || n <= 0) return '$0';
    if (n < 0.01) return '<$0.01';
    if (n < 100) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function dur(ms) {
    if (!isFinite(ms) || ms <= 0) return '0m';
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return d + 'd ' + (h % 24) + 'h';
    return h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  }
  function clock(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function shortDay(k) {
    const p = k.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function costCell(r) {
    if (r.unpriced && r.unpriced >= r.total) return 'no price';
    return money(r.cost) + (r.unpriced ? ' +' : '');
  }

  // ---------------------------------------------------------------- tiles
  function tile(label, value, sub, extra) {
    const t = el('div', { class: 'tile' + (extra && extra.cls ? ' ' + extra.cls : '') });
    t.appendChild(el('div', { class: 'tile-label' }, label));
    t.appendChild(el('div', { class: 'tile-value' }, value));
    if (sub) for (const s of [].concat(sub)) t.appendChild(el('div', { class: 'tile-sub' }, s));
    if (extra && typeof extra.meter === 'number') {
      const m = el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(extra.meter), 'aria-label': label });
      const f = el('div', { class: 'meter-fill' + (extra.meter >= 90 ? ' hot' : '') });
      f.style.width = Math.max(0, Math.min(100, extra.meter)) + '%';
      m.appendChild(f);
      t.appendChild(m);
    }
    return t;
  }

  function renderTiles() {
    const box = $('tiles');
    box.replaceChildren();
    const tools = data.tools;
    for (const k of ['claude', 'codex']) {
      if (tools[k] === false) continue;
      const t = data.today[k];
      box.appendChild(tile(TOOL_NAMES[k] + ' today', tok(t.total) + ' tokens', [money(t.cost) + ' estimated', 'in ' + tok(t.input) + ' · out ' + tok(t.output) + ' · cache ' + tok(t.cacheWrite + t.cacheRead)], { cls: 'tool-' + k }));
    }
    if (tools.claude !== false) {
      const b = data.block;
      if (b) {
        const pct = Math.round(((data.now - b.start) / (b.end - b.start)) * 100);
        box.appendChild(tile('Claude Code 5-hour block', 'resets in ' + dur(b.resetsInMs), [tok(b.totals.total) + ' tokens · ' + money(b.totals.cost) + ' since ' + clock(b.start), 'ends at ' + clock(b.end)], { meter: pct }));
      } else box.appendChild(tile('Claude Code 5-hour block', 'no active block', ['Starts with your next Claude Code message']));
    }
    if (tools.codex !== false) {
      const l = data.limits;
      if (!l) box.appendChild(tile('Codex limits', 'not reported', ['Codex writes them during a session']));
      else for (const w of [l.primary, l.secondary]) {
        if (!w) continue;
        const label = 'Codex ' + (w.name === 'week' ? 'weekly' : w.name) + ' limit';
        if (w.usedPercent === null) box.appendChild(tile(label, 'reset', ['The window ended after Codex last wrote it']));
        else box.appendChild(tile(label, w.usedPercent + '% used', [w.resetsIn !== null ? 'resets in ' + dur(w.resetsIn) + ' (' + clock(w.resetsAt) + ')' : 'reset time not reported'], { meter: w.usedPercent }));
      }
    }
  }

  // ---------------------------------------------------------------- chart
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function renderChart() {
    const box = $('chart');
    box.replaceChildren();
    const series = ['claude', 'codex'].filter((k) => data.tools[k] !== false);
    $('chart-title').textContent = (measure === 'cost' ? 'Estimated cost' : 'Tokens') + ' per day, last ' + data.days + ' days';
    $('m-tokens').setAttribute('aria-checked', String(measure === 'tokens'));
    $('m-cost').setAttribute('aria-checked', String(measure === 'cost'));
    const legend = $('legend');
    legend.replaceChildren();
    if (series.length > 1) for (const k of series) {
      const it = el('span', { class: 'lg' });
      it.appendChild(el('span', { class: 'sw s-' + k }));
      it.appendChild(document.createTextNode(TOOL_NAMES[k]));
      legend.appendChild(it);
    }
    const val = (d, k) => (measure === 'cost' ? d[k].cost : d[k].total);
    const days = data.perDay;
    const maxV = niceMax(Math.max(0, ...days.map((d) => series.reduce((s, k) => s + val(d, k), 0))));
    lastW = box.clientWidth || lastW;
    const W = Math.max(280, box.clientWidth || 720), H = 220, L = 52, R = 8, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': $('chart-title').textContent + '. The By day table below has the same numbers.' });
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i, y = T + ph - (v / maxV) * ph;
      svg.appendChild(sv('line', { x1: L, x2: W - R, y1: y, y2: y, class: i ? 'grid' : 'axis' }));
      const t = sv('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      t.textContent = measure === 'cost' ? money(v) : tok(v);
      svg.appendChild(t);
    }
    const n = days.length, slot = pw / n, bw = Math.max(2, Math.min(28, slot * 0.7));
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(pw / 56)));
    days.forEach((d, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      let y0 = T + ph;
      const stack = series.filter((k) => val(d, k) > 0);
      stack.forEach((k, j) => {
        const h = (val(d, k) / maxV) * ph;
        const top = j === stack.length - 1;
        const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
        const y = y0 - h, hh = Math.max(0, h - gap);
        if (hh > 0) {
          if (top && hh > 4) {
            const r = Math.min(4, bw / 2);
            svg.appendChild(sv('path', { class: 'bar s-' + k, d: `M${x},${y0 - gap}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y0 - gap}Z` }));
          } else svg.appendChild(sv('rect', { class: 'bar s-' + k, x, y, width: bw, height: hh }));
        }
        y0 = y;
      });
      // Labels count back from the last day, so the newest day always has one and none collide.
      if ((n - 1 - i) % labelEvery === 0) {
        const cx = L + slot * i + slot / 2;
        const last = i === n - 1 && cx + 24 > W - R; // keep the newest day's label inside the chart
        const t = sv('text', { x: last ? W - R : cx, y: H - 8, 'text-anchor': last ? 'end' : 'middle', class: 'tick' });
        t.textContent = shortDay(d.day);
        svg.appendChild(t);
      }
      const hit = sv('rect', { x: L + slot * i, y: T, width: slot, height: ph, class: 'hit', tabindex: '0' });
      const show = (ev) => tipFor(d, series, ev, L + slot * i + slot / 2);
      hit.addEventListener('mousemove', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('blur', hideTip);
      svg.appendChild(hit);
    });
    box.appendChild(svg);
  }

  function tipFor(d, series, ev, cx) {
    const tip = $('tip');
    tip.replaceChildren();
    tip.appendChild(el('div', { class: 'tip-h' }, shortDay(d.day)));
    for (const k of series) {
      const row = el('div', { class: 'tip-r' });
      row.appendChild(el('span', { class: 'sw s-' + k }));
      row.appendChild(el('span', null, TOOL_NAMES[k] + ': ' + tok(d[k].total) + ' tokens · ' + money(d[k].cost)));
      tip.appendChild(row);
    }
    tip.hidden = false;
    const card = $('chart').getBoundingClientRect();
    const left = Math.min(Math.max(0, cx + 12), card.width - tip.offsetWidth - 4);
    tip.style.left = left + 'px';
    tip.style.top = '8px';
  }
  function hideTip() { $('tip').hidden = true; }

  // ---------------------------------------------------------------- tables
  function table(host, cols, rows, more, emptyText) {
    host.replaceChildren();
    if (!rows.length) { host.appendChild(el('p', { class: 'empty' }, emptyText)); return; }
    const wrap = el('div', { class: 'tw' });
    const t = el('table');
    const thead = el('thead'), hr = el('tr');
    for (const c of cols) hr.appendChild(el('th', { class: c.num ? 'num' : '', scope: 'col' }, c.label));
    thead.appendChild(hr);
    t.appendChild(thead);
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      for (const c of cols) {
        const td = el('td', { class: c.num ? 'num' : '' }, c.get(r));
        if (c.title) td.title = c.title(r);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    host.appendChild(wrap);
    if (more) {
      const b = el('button', { type: 'button', class: 'link' }, 'Show ' + more + ' more');
      b.addEventListener('click', () => vscode.postMessage({ type: 'moreRows' }));
      host.appendChild(b);
    }
  }
  const NUMS = [
    { label: 'Input', num: true, get: (r) => tok(r.input), title: (r) => full(r.input) },
    { label: 'Output', num: true, get: (r) => tok(r.output), title: (r) => full(r.output) },
    { label: 'Cache write', num: true, get: (r) => tok(r.cacheWrite), title: (r) => full(r.cacheWrite) },
    { label: 'Cache read', num: true, get: (r) => tok(r.cacheRead), title: (r) => full(r.cacheRead) },
    { label: 'Total', num: true, get: (r) => tok(r.total), title: (r) => full(r.total) },
    { label: 'Est. cost', num: true, get: costCell },
  ];
  function renderTables() {
    table($('t-tool'), [{ label: 'Tool', get: (r) => r.name }].concat(NUMS), data.perTool, 0, 'No usage in this range.');
    table($('t-project'), [{ label: 'Folder', get: (r) => r.name, title: (r) => r.name }, { label: 'Tools', get: (r) => r.tools.map((k) => TOOL_NAMES[k]).join(', ') }].concat(NUMS), data.perProject, data.moreProjects, 'No usage in this range.');
    table($('t-model'), [{ label: 'Model', get: (r) => r.name }, { label: 'Tool', get: (r) => TOOL_NAMES[r.tool] }].concat(NUMS), data.perModel, data.moreModels, 'No usage in this range.');
    const daysDesc = data.perDay.slice().reverse().filter((d) => d.total > 0);
    table($('t-day'), [{ label: 'Day', get: (r) => shortDay(r.day) }].concat(NUMS), daysDesc, 0, 'No usage in this range.');
  }

  function renderNotes() {
    const parts = ['Costs are estimates: token counts times the price table (US dollars per million tokens). Built-in prices were taken on ' + data.pricesTakenOn + '; edit them with "Edit prices". On a subscription plan you are not billed per token, so read the cost as what the same tokens would cost on the API.'];
    if (data.unpricedModels.length) parts.push('No price for: ' + data.unpricedModels.join(', ') + '. Their tokens are counted, their cost is not ("+" marks a partial cost).');
    if (data.ignoredPrices.length) parts.push('Ignored price rows with no numbers: ' + data.ignoredPrices.join(', ') + '.');
    $('cost-note').textContent = parts.join(' ');
    $('status').textContent = (data.scanning ? 'Reading usage files… ' : '') + 'Read from ' + data.files + ' local session file' + (data.files === 1 ? '' : 's') + '. Updated ' + clock(data.now) + '. Only token counts, model ids, times and folders are read; prompts and replies are not.';
  }

  function renderRange() {
    const sel = $('range');
    if (!sel.options.length) for (const r of data.ranges) sel.appendChild(el('option', { value: String(r) }, r + ' days'));
    sel.value = String(data.days);
  }

  function render() {
    if (!data) return;
    renderRange();
    renderTiles();
    renderChart();
    renderTables();
    renderNotes();
    if (!rendered) { rendered = true; vscode.postMessage({ type: 'rendered' }); }
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'data') { data = m; render(); }
    else if (m.type === 'status' && typeof m.text === 'string') $('status').textContent = m.text;
  });
  $('range').addEventListener('change', (e) => vscode.postMessage({ type: 'setRange', days: Number(e.target.value) }));
  $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('prices').addEventListener('click', () => vscode.postMessage({ type: 'openSettings', key: 'prices' }));
  const setMeasure = (m) => { measure = m; vscode.setState({ measure }); if (data) renderChart(); };
  $('m-tokens').addEventListener('click', () => setMeasure('tokens'));
  $('m-cost').addEventListener('click', () => setMeasure('cost'));
  // Redraw the chart when its box changes width (editor resized, sidebar toggled, window resized).
  let rt = null, lastW = 0;
  const redraw = () => { clearTimeout(rt); rt = setTimeout(() => { const w = $('chart').clientWidth; if (data && w && Math.abs(w - lastW) > 2) { lastW = w; renderChart(); } }, 100); };
  window.addEventListener('resize', redraw);
  if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe($('chart'));
  vscode.postMessage({ type: 'ready' });
})();
