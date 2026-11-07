'use strict';
// Writes synthetic Claude Code and Codex session folders. No real session is copied: every record is made
// up here. The prompt and reply text holds the marker PRIVATE-TEXT-MARKER so tests can prove it never leaks.
// Usage: node scripts/make-fixtures.js <outDir> [nowISO]
//   <outDir>/claude/projects/...      Claude Code root
//   <outDir>/codex/sessions/...       Codex root
//   <outDir>/claude/.claude.json      Claude Code config with saved plan limits
//   <outDir>/claude-work/...          a second Claude Code config folder (account)
//   <outDir>/gemini/tmp/...           Gemini CLI root, with <outDir>/gemini/projects.json
const fs = require('fs');
const path = require('path');

const MARK = 'PRIVATE-TEXT-MARKER';
const H = 3600 * 1000, M = 60 * 1000, DAY = 24 * H;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function uuid(r) {
  const h = () => Math.floor(r() * 16).toString(16);
  const part = (n) => Array.from({ length: n }, h).join('');
  return `${part(8)}-${part(4)}-4${part(3)}-a${part(3)}-${part(12)}`;
}

function iso(ms) { return new Date(ms).toISOString(); }

function claudeUser(ts, cwd, sid, text) {
  return { type: 'user', uuid: 'u' + ts, parentUuid: null, sessionId: sid, cwd, timestamp: iso(ts), message: { role: 'user', content: text } };
}
function claudeAssistant(ts, cwd, sid, id, model, u, extra = {}) {
  return {
    type: 'assistant', uuid: 'a' + ts + id, sessionId: sid, cwd, timestamp: iso(ts), requestId: 'req_' + id, ...extra,
    message: {
      id, type: 'message', role: 'assistant', model,
      content: [{ type: 'text', text: `Reply with ${MARK} inside.` }, { type: 'tool_use', id: 'tu' + id, name: 'Bash', input: { command: `echo ${MARK}` } }],
      usage: { input_tokens: u[0], output_tokens: u[1], cache_creation_input_tokens: u[2], cache_read_input_tokens: u[3] },
    },
  };
}

function write(file, records, tail) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
  fs.writeFileSync(file, lines.join('\n') + '\n' + (tail || ''));
  return file;
}

/**
 * Makes both folders. Returns paths and the exact expected numbers for the hand-built parts.
 * now: ms. The generated "today" holds a 5-hour block that started earlier and a new block that is active.
 */
function makeFixtures(outDir, now = Date.now()) {
  const r = rng(42);
  const claudeRoot = path.join(outDir, 'claude', 'projects');
  const codexRoot = path.join(outDir, 'codex', 'sessions');
  const files = [];
  const projects = [
    { dir: '-Users-demo-shop-api', cwd: '/Users/demo/shop-api' },
    { dir: '-Users-demo-blog-engine', cwd: '/Users/demo/blog-engine' },
    { dir: '-Users-demo-data-pipeline', cwd: '/Users/demo/data-pipeline' },
  ];
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-haiku-5-5'];
  let msgN = 0;

  // Normal days: 29 past days, 1-3 sessions each, a few messages per session.
  for (let back = 29; back >= 1; back--) {
    if (back % 7 === 3) continue; // a quiet day now and then
    const sessions = 1 + Math.floor(r() * 3);
    for (let s = 0; s < sessions; s++) {
      const p = projects[Math.floor(r() * projects.length)];
      const sid = uuid(r);
      const start = now - back * DAY - 10 * H + Math.floor(r() * 8) * H;
      const recs = [{ type: 'summary', summary: `Session about ${MARK}`, leafUuid: uuid(r) }];
      const model = models[Math.floor(r() * models.length)];
      const n = 3 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const ts = start + i * 7 * M;
        recs.push(claudeUser(ts, p.cwd, sid, `Prompt ${i} ${MARK}`));
        const id = 'msg_' + (++msgN);
        recs.push(claudeAssistant(ts + M, p.cwd, sid, id, model, [
          Math.floor(200 + r() * 3000), Math.floor(300 + r() * 4000), Math.floor(r() * 20000), Math.floor(5000 + r() * 90000),
        ]));
      }
      files.push(write(path.join(claudeRoot, p.dir, sid + '.jsonl'), recs));
    }
  }

  // Today: block A (ended), gap, block B (active). Exact numbers are returned for the tests.
  const sidA = '11111111-1111-4111-a111-111111111111';
  const pA = projects[0];
  const blockATimes = [now - 9 * H, now - 8 * H, now - 7.5 * H];
  const blockBTimes = [now - 2 * H - 10 * M, now - 70 * M, now - 20 * M];
  const today = [];
  const usageOf = (k) => [1000 * (k + 1), 2000 * (k + 1), 3000, 40000];
  const recsA = [];
  let k = 0;
  for (const ts of [...blockATimes, ...blockBTimes]) {
    recsA.push(claudeUser(ts - M, pA.cwd, sidA, `Today prompt ${MARK}`));
    const id = 'msg_today_' + k;
    // Streamed: the same message written twice, the first time with a partial output count.
    const u = usageOf(k);
    recsA.push(claudeAssistant(ts - 30 * 1000, pA.cwd, sidA, id, 'claude-opus-5-5', [u[0], 1, u[2], u[3]]));
    recsA.push(claudeAssistant(ts, pA.cwd, sidA, id, 'claude-opus-5-5', u));
    today.push({ ts, u });
    k++;
  }
  // Unknown record types and odd shapes: skipped, never fatal.
  recsA.push({ type: 'mystery-record', sessionId: sidA, timestamp: iso(now - 15 * M), payload: { x: MARK } });
  recsA.push({ type: 'assistant', sessionId: sidA, timestamp: iso(now - 14 * M), message: { id: 'odd', usage: 'not-an-object', content: MARK } });
  recsA.push({ type: 'assistant', sessionId: sidA, timestamp: 'not a date', message: { id: 'odd2', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 5 } } });
  recsA.push({ type: 'assistant', sessionId: sidA, timestamp: iso(now - 13 * M), message: { id: 'synthetic', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [] } });
  recsA.push('{"type":"assistant","message":{"usage":{"input_tokens":12'); // corrupt line
  recsA.push('not json at all ' + MARK);
  recsA.push(claudeAssistant(now - 10 * M, pA.cwd, sidA, 'msg_unpriced', 'claude-experimental-x', [100, 200, 0, 0]));
  files.push(write(path.join(claudeRoot, pA.dir, sidA + '.jsonl'), recsA));

  // Subagent file below a session folder: counted, and a copy of a parent message is not counted twice.
  const sub = [claudeAssistant(now - 30 * M, pA.cwd, sidA, 'msg_sub_1', 'claude-haiku-5-5', [500, 600, 0, 7000], { isSidechain: true }),
    claudeAssistant(today[5].ts, pA.cwd, sidA, 'msg_today_5', 'claude-opus-5-5', usageOf(5), { isSidechain: true })];
  files.push(write(path.join(claudeRoot, pA.dir, sidA, 'subagents', 'agent-a1.jsonl'), sub));

  // Codex: one session per few days, cumulative token_count events with rate limits.
  const codexModels = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-5.3-codex'];
  const codexFile = (ts, id) => {
    const d = new Date(ts);
    const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
    return path.join(codexRoot, String(y), mo, da, `rollout-${y}-${mo}-${da}T10-00-00-${id}.jsonl`);
  };
  for (let back = 28; back >= 1; back -= 2) {
    const start = now - back * DAY - 6 * H;
    const id = uuid(r);
    const p = projects[(back / 2) % projects.length | 0];
    const recs = [
      { timestamp: iso(start), type: 'session_meta', payload: { id, timestamp: iso(start), cwd: p.cwd, originator: 'codex_cli_rs', cli_version: '0.200.0', base_instructions: { text: MARK } } },
      { timestamp: iso(start), type: 'turn_context', payload: { cwd: p.cwd, model: codexModels[back % 3], approval_policy: 'on-request' } },
    ];
    let tot = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
    const turns = 2 + Math.floor(r() * 4);
    for (let i = 0; i < turns; i++) {
      const ts = start + i * 9 * M;
      recs.push({ timestamp: iso(ts), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Codex prompt ${MARK}` }] } });
      const last = { input_tokens: Math.floor(20000 + r() * 80000), output_tokens: Math.floor(500 + r() * 4000) };
      last.cached_input_tokens = Math.floor(last.input_tokens * 0.8);
      tot = {
        input_tokens: tot.input_tokens + last.input_tokens, cached_input_tokens: tot.cached_input_tokens + last.cached_input_tokens,
        cache_write_input_tokens: 0, output_tokens: tot.output_tokens + last.output_tokens, reasoning_output_tokens: 0,
        total_tokens: tot.total_tokens + last.input_tokens + last.output_tokens,
      };
      recs.push({ timestamp: iso(ts + M), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { ...tot }, last_token_usage: last, model_context_window: 400000 }, rate_limits: { primary: { used_percent: 10 + i, window_minutes: 300, resets_at: Math.floor((ts + 3 * H) / 1000) }, secondary: { used_percent: 30, window_minutes: 10080, resets_at: Math.floor((ts + 4 * DAY) / 1000) }, credits: null, plan_type: 'plus' } } });
    }
    files.push(write(codexFile(start, id), recs));
  }

  // Codex today: exact numbers, a repeated token_count, a null info and null rate_limits, unknown types.
  const cid = '22222222-2222-4222-a222-222222222222';
  const c0 = now - 3 * H;
  const t1 = { input_tokens: 50000, cached_input_tokens: 40000, cache_write_input_tokens: 0, output_tokens: 3000, reasoning_output_tokens: 1000, total_tokens: 53000 };
  const t2 = { input_tokens: 120000, cached_input_tokens: 100000, cache_write_input_tokens: 0, output_tokens: 7000, reasoning_output_tokens: 2000, total_tokens: 127000 };
  const limitsToday = { limit_id: 'codex', primary: { used_percent: 42.5, window_minutes: 300, resets_at: Math.floor((now + 95 * M) / 1000) }, secondary: { used_percent: 71, window_minutes: 10080, resets_at: Math.floor((now + 2 * DAY + 3 * H) / 1000) }, credits: { has_credits: false, unlimited: false, balance: '0' }, plan_type: 'pro' };
  const codexToday = [
    { timestamp: iso(c0), type: 'session_meta', payload: { id: cid, timestamp: iso(c0), cwd: '/Users/demo/shop-api', base_instructions: { text: MARK } } },
    { timestamp: iso(c0), type: 'turn_context', payload: { cwd: '/Users/demo/shop-api', model: 'gpt-6.1-sol' } },
    { timestamp: iso(c0 + M), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: MARK }] } },
    { timestamp: iso(c0 + 2 * M), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: null, secondary: null, credits: null, plan_type: null } } },
    { timestamp: iso(c0 + 3 * M), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: t1, last_token_usage: t1 }, rate_limits: null } },
    { timestamp: iso(c0 + 3 * M + 500), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: t1, last_token_usage: t1 }, rate_limits: null } },
    { timestamp: iso(c0 + 4 * M), type: 'event_msg', payload: { type: 'brand_new_event', data: MARK } },
    { timestamp: iso(c0 + 5 * M), type: 'never_seen_top_level', payload: { text: MARK } },
    '{"timestamp":"broken',
    { timestamp: iso(c0 + 6 * M), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: t2, last_token_usage: { input_tokens: 70000, cached_input_tokens: 60000, output_tokens: 4000 } }, rate_limits: limitsToday } },
  ];
  files.push(write(codexFile(c0, cid), codexToday));

  // Older Codex format: resets_in_seconds instead of resets_at, a week ago.
  const old = now - 7 * DAY;
  const oid = '33333333-3333-4333-a333-333333333333';
  files.push(write(codexFile(old, oid), [
    { timestamp: iso(old), type: 'turn_context', payload: { cwd: '/Users/demo/blog-engine', model: 'gpt-5.1-codex' } },
    { timestamp: iso(old + M), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 9000, cached_input_tokens: 0, output_tokens: 900, total_tokens: 9900 } }, rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_in_seconds: 3600 } } } },
  ]));

  // Claude Code saved plan limits. The file also holds account fields with the marker: they must never show.
  const claudeLimits = {
    five_hour: { utilization: 34, resets_at: iso(now + 2 * H + 13 * M) },
    seven_day: { utilization: 61, resets_at: iso(now + 3 * DAY + 5 * H) },
    seven_day_opus: { utilization: 22, resets_at: iso(now + 3 * DAY + 5 * H) },
    seven_day_sonnet: null,
    some_future_window: { utilization: 99, resets_at: iso(now + H) },
  };
  const claudeConfig = path.join(outDir, 'claude', '.claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify({
    numStartups: 12, theme: 'dark',
    oauthAccount: { emailAddress: `${MARK}@example.com`, organizationName: MARK, accountUuid: 'acct-' + MARK },
    projects: { '/Users/demo/shop-api': { lastPrompt: MARK } },
    cachedUsageUtilization: { fetchedAtMs: now - 4 * M, accountUuid: 'acct-' + MARK, utilization: claudeLimits },
  }, null, 2));
  files.push(claudeConfig);

  // A second Claude Code config folder (another account), with an older saved reading.
  const workRoot = path.join(outDir, 'claude-work', 'projects');
  const wsid = '44444444-4444-4444-a444-444444444444';
  const workMsgs = [];
  for (let i = 0; i < 4; i++) {
    const ts = now - 5 * H + i * 20 * M;
    workMsgs.push(claudeUser(ts - M, '/Users/demo/client-portal', wsid, `Work prompt ${MARK}`));
    workMsgs.push(claudeAssistant(ts, '/Users/demo/client-portal', wsid, 'msg_work_' + i, 'claude-sonnet-5-5', [800, 1500, 4000, 30000]));
  }
  files.push(write(path.join(workRoot, '-Users-demo-client-portal', wsid + '.jsonl'), workMsgs));
  const workConfig = path.join(outDir, 'claude-work', '.claude.json');
  fs.writeFileSync(workConfig, JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: now - 3 * H, utilization: { five_hour: { utilization: 12, resets_at: iso(now - 30 * M) }, seven_day: { utilization: 18, resets_at: iso(now + 5 * DAY) } } } }));
  files.push(workConfig);

  // Gemini CLI: one JSON session today (with a message saved twice), older sessions, and a JSONL session.
  const geminiRoot = path.join(outDir, 'gemini', 'tmp');
  fs.mkdirSync(path.join(outDir, 'gemini'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gemini', 'projects.json'), JSON.stringify({ projects: { '/Users/demo/data-pipeline': 'data-pipeline', '/Users/demo/blog-engine': 'blog-engine' } }));
  const gMsg = (id, ts, model, tk) => ({ id, timestamp: typeof ts === 'string' ? ts : iso(ts), type: 'gemini', content: `Gemini reply ${MARK}`, thoughts: [{ subject: MARK, description: MARK }], tokens: tk, model });
  const gUser = (id, ts) => ({ id, timestamp: iso(ts), type: 'user', content: `Gemini prompt ${MARK}` });
  const g0 = now - 4 * H;
  const geminiToday = { input: 60000, cached: 40000, output: 2500, thoughts: 1500, tool: 0 };
  const gToday = {
    sessionId: 'g-today', projectHash: 'abc', startTime: iso(g0), lastUpdated: iso(g0 + 10 * M), kind: 'main',
    messages: [
      gUser('gu1', g0),
      gMsg('gm1', g0 + M, 'gemini-3-flash-preview', { input: 20000, output: 1000, cached: 0, thoughts: 500, tool: 0, total: 21500 }),
      gUser('gu2', g0 + 5 * M),
      gMsg('gm2', g0 + 6 * M, 'gemini-3-flash-preview', { input: 40000, output: 1500, cached: 40000, thoughts: 1000, tool: 0, total: 42500 }),
      { id: 'info1', timestamp: iso(g0 + 7 * M), type: 'info', content: MARK },
      gMsg('gm-bad', 'not a date', 'gemini-3-flash-preview', { input: 5, output: 5 }),
    ],
  };
  files.push(write(path.join(geminiRoot, 'data-pipeline', 'chats', `session-${iso(g0).slice(0, 16).replace(':', '-')}-gtoday.json`), [gToday]));
  for (let back = 12; back >= 1; back -= 3) {
    const t = now - back * DAY - 3 * H;
    const sess = { sessionId: 'g' + back, projectHash: 'abc', startTime: iso(t), lastUpdated: iso(t + 30 * M), kind: 'main', messages: [] };
    for (let i = 0; i < 3; i++) {
      sess.messages.push(gUser('u' + back + i, t + i * 5 * M));
      const inp = Math.floor(30000 + r() * 50000), cached = Math.floor(inp * 0.6);
      sess.messages.push(gMsg('m' + back + i, t + i * 5 * M + M, back % 2 ? 'gemini-2.5-pro' : 'gemini-3-pro-preview', { input: inp, output: Math.floor(500 + r() * 3000), cached, thoughts: Math.floor(r() * 2000), tool: 0, total: 0 }));
    }
    files.push(write(path.join(geminiRoot, 'blog-engine', 'chats', `session-${iso(t).slice(0, 16).replace(':', '-')}-g${back}.json`), [sess]));
  }
  const gl = now - 2 * DAY;
  files.push(write(path.join(geminiRoot, 'f3a9c1d2e4b5', 'chats', 'session-jsonl-format.jsonl'), [
    { sessionId: 'gl', projectHash: 'f3a9c1d2e4b5', startTime: iso(gl), kind: 'main' },
    gUser('lu1', gl),
    gMsg('lm1', gl + M, 'gemini-2.5-flash', { input: 10000, output: 800, cached: 2000, thoughts: 200, tool: 100, total: 11100 }),
    gMsg('lm1', gl + M, 'gemini-2.5-flash', { input: 10000, output: 900, cached: 2000, thoughts: 200, tool: 100, total: 11200 }),
    '{"broken',
  ]));

  return {
    claudeRoot, codexRoot, geminiRoot, workRoot, claudeConfig, workConfig, files, now, mark: MARK,
    expect: {
      claudeToday: today, blockBStart: blockBTimes[0] - (blockBTimes[0] % H),
      codexToday: { input: t2.input_tokens - t2.cached_input_tokens, cacheRead: t2.cached_input_tokens, output: t2.output_tokens },
      limitsToday,
      claudeLimits,
      geminiToday: { input: 20000 + 0, cacheRead: 40000, output: 1000 + 500 + 1500 + 1000 },
      geminiJsonl: { input: 8000 + 100, cacheRead: 2000, output: 900 + 200 },
    },
  };
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/make-fixtures.js <outDir> [nowISO]'); process.exit(2); }
  const now = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
  const res = makeFixtures(path.resolve(out), now);
  console.log(`Wrote ${res.files.length} files under ${path.resolve(out)}`);
}

module.exports = { makeFixtures, MARK };
