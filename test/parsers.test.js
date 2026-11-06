'use strict';
const { NOW } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/core/usage');

const iso = (ms) => new Date(ms).toISOString();

test('claude: assistant usage becomes an entry with a dedupe key and no text', () => {
  const rec = { type: 'assistant', timestamp: iso(NOW), cwd: '/w/p', requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'SECRET' }], usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } } };
  const e = U.claudeEntry(rec, 'fb');
  assert.deepEqual(e, { key: 'm1:r1', ts: NOW, model: 'claude-opus-5-5', cwd: '/w/p', input: 10, output: 20, cacheWrite: 30, cacheRead: 40 });
  assert.ok(!JSON.stringify(e).includes('SECRET'));
});

test('claude: user records, unknown types, bad usage, bad times and synthetic messages give null', () => {
  assert.equal(U.claudeEntry({ type: 'user', message: { usage: {} } }), null);
  assert.equal(U.claudeEntry({ type: 'mystery' }), null);
  assert.equal(U.claudeEntry({ type: 'assistant', timestamp: iso(NOW), message: { usage: 'x' } }), null);
  assert.equal(U.claudeEntry({ type: 'assistant', timestamp: 'nope', message: { usage: { input_tokens: 1 } } }), null);
  assert.equal(U.claudeEntry({ type: 'assistant', timestamp: iso(NOW), message: { model: '<synthetic>', usage: { input_tokens: 1 } } }), null);
  assert.equal(U.claudeEntry({ type: 'assistant', timestamp: iso(NOW), message: { usage: { input_tokens: 0, output_tokens: 0 } } }), null);
  assert.equal(U.claudeEntry(null), null);
  const noId = U.claudeEntry({ type: 'assistant', timestamp: iso(NOW), message: { usage: { input_tokens: 1, output_tokens: -5 } } }, 'file#3');
  assert.equal(noId.key, 'file#3');
  assert.equal(noId.output, 0, 'negative counts are ignored');
});

test('claude: the quick check skips lines without usage before JSON.parse', () => {
  assert.equal(U.claudeWorth('{"type":"user","message":{"content":"hi"}}'), false);
  assert.equal(U.claudeWorth('{"type":"assistant","message":{"usage":{}}}'), true);
});

const tc = (ts, info, rl) => ({ timestamp: iso(ts), type: 'event_msg', payload: { type: 'token_count', info, rate_limits: rl } });

test('codex: token entries are the growth of the running total; repeats count once', () => {
  const st = U.newCodexState();
  U.codexStep({ type: 'session_meta', payload: { cwd: '/w/a', base_instructions: { text: 'SECRET' } } }, st);
  U.codexStep({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd: '/other' } }, st);
  assert.equal(st.cwd, '/w/a');
  assert.equal(st.model, 'gpt-6.1-sol');
  const a = U.codexStep(tc(NOW, { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } }), st).entry;
  assert.deepEqual(a, { ts: NOW, model: 'gpt-6.1-sol', cwd: '/w/a', input: 40, output: 10, cacheWrite: 0, cacheRead: 60 });
  assert.equal(U.codexStep(tc(NOW + 1, { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } }), st).entry, null);
  const b = U.codexStep(tc(NOW + 2, { total_token_usage: { input_tokens: 250, cached_input_tokens: 160, output_tokens: 25 } }), st).entry;
  assert.deepEqual([b.input, b.cacheRead, b.output], [50, 100, 15]);
});

test('codex: a total that goes down falls back to last_token_usage', () => {
  const st = U.newCodexState();
  U.codexStep(tc(NOW, { total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 } }), st);
  const e = U.codexStep(tc(NOW + 1, { total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 5 }, last_token_usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 } }), st).entry;
  assert.deepEqual([e.input, e.cacheRead, e.output], [40, 10, 5]);
});

test('codex: null info and null or empty rate_limits are fine', () => {
  const st = U.newCodexState();
  assert.deepEqual(U.codexStep(tc(NOW, null, null), st), { entry: null, limits: null });
  assert.deepEqual(U.codexStep(tc(NOW, null, { primary: null, secondary: null, credits: null, plan_type: null }), st), { entry: null, limits: null });
  assert.deepEqual(U.codexStep({ type: 'event_msg', payload: { type: 'brand_new' } }, st), { entry: null, limits: null });
  assert.deepEqual(U.codexStep({ type: 'whatever' }, st), { entry: null, limits: null });
  assert.deepEqual(U.codexStep('x', st), { entry: null, limits: null });
});

test('codex: rate limits read resets_at (seconds) and resets_in_seconds', () => {
  const l = U.codexLimits({ primary: { used_percent: 42.5, window_minutes: 300, resets_at: NOW / 1000 + 600 }, secondary: { used_percent: 120, window_minutes: 10080, resets_in_seconds: 60 }, plan_type: 'pro', credits: { has_credits: true } }, NOW);
  assert.equal(l.primary.usedPercent, 42.5);
  assert.equal(l.primary.resetsAt, NOW + 600000);
  assert.equal(l.secondary.usedPercent, 100, 'clamped');
  assert.equal(l.secondary.resetsAt, NOW + 60000);
  assert.equal(l.plan, 'pro');
  assert.deepEqual(l.credits, { hasCredits: true, unlimited: false });
});
