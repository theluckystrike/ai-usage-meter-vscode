'use strict';
// Finds usage files. Read-only: readdir and stat only. Based on the Agent Session Viewer root finder.
const fs = require('fs');
const path = require('path');
const os = require('os');

function expandHome(p, home = os.homedir()) {
  if (typeof p !== 'string' || !p.trim()) return '';
  p = p.trim();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

/** Folder roots for each tool. Settings win; then CLAUDE_CONFIG_DIR / CODEX_HOME; then ~/.claude and ~/.codex. */
function resolveRoots(settings = {}, env = process.env, home = os.homedir()) {
  const clean = (a) => (Array.isArray(a) ? a.map((x) => expandHome(x, home)).filter(Boolean) : []);
  let claude = clean(settings.claudeRoots);
  let codex = clean(settings.codexRoots);
  if (!claude.length) {
    const dirs = env.CLAUDE_CONFIG_DIR ? String(env.CLAUDE_CONFIG_DIR).split(',').map((d) => expandHome(d, home)).filter(Boolean) : [path.join(home, '.claude')];
    claude = dirs.map((d) => path.join(d, 'projects'));
  }
  if (!codex.length) codex = [path.join(env.CODEX_HOME ? expandHome(env.CODEX_HOME, home) : path.join(home, '.codex'), 'sessions')];
  return { claude: [...new Set(claude)], codex: [...new Set(codex)] };
}

async function readdirSafe(dir) {
  try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
}
async function statSafe(file) {
  try { return await fs.promises.stat(file); } catch { return null; }
}

// Claude Code: <root>/<encoded-cwd>/<session>.jsonl, plus subagent files below a session folder.
async function walkClaude(dir, projectDir, depth, out, since) {
  if (depth > 4) return;
  for (const d of await readdirSafe(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walkClaude(p, projectDir || d.name, depth + 1, out, since);
    else if (d.isFile() && projectDir && d.name.endsWith('.jsonl')) {
      const st = await statSafe(p);
      if (st && st.size > 0 && st.mtimeMs >= since) out.push({ file: p, tool: 'claude', projectDir, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    }
  }
}

async function walkCodex(dir, depth, out, since) {
  if (depth > 5) return;
  for (const d of await readdirSafe(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walkCodex(p, depth + 1, out, since);
    else if (d.isFile() && /^rollout-.*\.jsonl$/.test(d.name)) {
      const st = await statSafe(p);
      if (st && st.size > 0 && st.mtimeMs >= since) out.push({ file: p, tool: 'codex', size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    }
  }
}

/**
 * Lists usage files changed since `since` (ms). tools: { claude: bool, codex: bool }.
 * Each entry: { file, tool, projectDir?, size, mtimeMs, ino }.
 */
async function listFiles(roots, tools = { claude: true, codex: true }, since = 0) {
  const out = [];
  if (tools.claude !== false) for (const r of roots.claude || []) await walkClaude(r, '', 0, out, since);
  if (tools.codex !== false) for (const r of roots.codex || []) await walkCodex(r, 0, out, since);
  const seen = new Set();
  return out.filter((e) => (seen.has(e.file) ? false : (seen.add(e.file), true)));
}

/** Turns a Claude project folder name ("-Users-me-repo") into a readable fallback label. */
function projectLabelFromDir(name) {
  return typeof name === 'string' && name ? name.replace(/^-/, '/').replace(/-/g, '/') : '';
}

module.exports = { resolveRoots, listFiles, expandHome, projectLabelFromDir };
