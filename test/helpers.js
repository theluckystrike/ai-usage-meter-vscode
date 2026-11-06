'use strict';
process.env.TZ = 'UTC';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeFixtures } = require('../scripts/make-fixtures');

// Fixed clock for every test: 2026-11-06 18:00 UTC.
const NOW = Date.UTC(2026, 10, 6, 18, 0, 0);

/** Makes a fresh fixture folder under the OS temp folder. Call cleanup() in the test teardown. */
function fixtures(now = NOW) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-meter-test-'));
  const fx = makeFixtures(dir, now);
  fx.dir = dir;
  fx.cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return fx;
}

module.exports = { NOW, fixtures };
