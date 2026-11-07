'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p)); else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('offline: no network modules, no fetch, no file writes in shipped code', () => {
  const root = path.join(__dirname, '..');
  for (const f of [...files(path.join(root, 'src')), ...files(path.join(root, 'media'))]) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /require\(['"](https?|net|tls|dgram|http2|child_process)['"]\)/, f);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/, f);
    assert.doesNotMatch(src, /writeFile|appendFile|createWriteStream|\.unlink|\.rm\(|rmSync|renameSync|\.rename\(/, f);
  }
});

test('manifest: id, name, keywords and the not-affiliated line', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(`${pkg.publisher}.${pkg.name}`, 'zovo.ai-usage-meter');
  assert.ok(pkg.displayName.length <= 45);
  assert.ok(pkg.displayName.startsWith('Claude Code Usage'));
  assert.ok(pkg.keywords.length <= 30);
  assert.match(pkg.description, /Not affiliated with Anthropic or OpenAI\./);
  assert.equal(pkg.version, '0.1.3');
});
