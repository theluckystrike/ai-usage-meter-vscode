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

/**
 * Other Claude Code config folders in the home folder, for people who run several accounts with
 * CLAUDE_CONFIG_DIR (for example ~/.claude-work). Only folders that hold a projects folder count.
 */
function discoverClaudeDirs(home = os.homedir(), fsImpl = fs) {
  const out = [];
  const add = (d) => { try { if (fsImpl.statSync(path.join(d, 'projects')).isDirectory()) out.push(d); } catch { /* not a Claude folder */ } };
  add(path.join(home, '.claude'));
  add(path.join(home, '.config', 'claude'));
  let names = [];
  try { names = fsImpl.readdirSync(home); } catch { names = []; }
  for (const n of names.sort()) if (/^\.claude[-_.][\w.-]{1,60}$/.test(n) && !/\.(json|bak|old|lock|backup)$/i.test(n) && !/\.json\./.test(n)) add(path.join(home, n));
  return [...new Set(out)];
}

/** Short label for a Claude Code config folder: "~/.claude", "~/.claude-work". */
function accountLabel(dir, home = os.homedir()) {
  if (home && (dir === home || dir.startsWith(home + path.sep))) return '~' + dir.slice(home.length);
  return dir;
}

/**
 * Folder roots for each tool. Settings win; then CLAUDE_CONFIG_DIR / CODEX_HOME; then ~/.claude, ~/.codex and
 * ~/.gemini/tmp. With findClaudeAccounts on (the default) and no setting or env, other ~/.claude-* config
 * folders are read too. claudeConfigs lists the config folders (for the plan limits Claude Code saves there)
 * and claudeAccount maps each projects root to its label.
 */
function resolveRoots(settings = {}, env = process.env, home = os.homedir(), fsImpl = fs) {
  const clean = (a) => (Array.isArray(a) ? a.map((x) => expandHome(x, home)).filter(Boolean) : []);
  let claude = clean(settings.claudeRoots);
  let codex = clean(settings.codexRoots);
  let gemini = clean(settings.geminiRoots);
  let configs;
  if (claude.length) {
    configs = claude.map((r) => (path.basename(r) === 'projects' ? path.dirname(r) : r));
  } else {
    if (env.CLAUDE_CONFIG_DIR) configs = String(env.CLAUDE_CONFIG_DIR).split(',').map((d) => expandHome(d, home)).filter(Boolean);
    else {
      configs = settings.findClaudeAccounts === false ? [] : discoverClaudeDirs(home, fsImpl);
      if (!configs.length) configs = [path.join(home, '.claude')];
    }
    claude = configs.map((d) => path.join(d, 'projects'));
  }
  if (!codex.length) codex = [path.join(env.CODEX_HOME ? expandHome(env.CODEX_HOME, home) : path.join(home, '.codex'), 'sessions')];
  if (!gemini.length) gemini = [path.join(home, '.gemini', 'tmp')];
  const claudeAccount = {};
  claude.forEach((r, i) => { claudeAccount[r] = accountLabel(configs[i] || r, home); });
  const claudeConfigs = [...new Set(configs)].map((dir) => ({ dir, label: accountLabel(dir, home) }));
  return { claude: [...new Set(claude)], codex: [...new Set(codex)], gemini: [...new Set(gemini)], claudeConfigs, claudeAccount };
}

async function readdirSafe(dir) {
  try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
}
async function statSafe(file) {
  try { return await fs.promises.stat(file); } catch { return null; }
}

// Claude Code: <root>/<encoded-cwd>/<session>.jsonl, plus subagent files below a session folder.
async function walkClaude(dir, projectDir, depth, out, since, account) {
  if (depth > 4) return;
  for (const d of await readdirSafe(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walkClaude(p, projectDir || d.name, depth + 1, out, since, account);
    else if (d.isFile() && projectDir && d.name.endsWith('.jsonl')) {
      const st = await statSafe(p);
      if (st && st.size > 0 && st.mtimeMs >= since) out.push({ file: p, tool: 'claude', projectDir, account, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    }
  }
}

// Gemini CLI: <root>/<project>/chats/session-*.json (older and current) or session-*.jsonl.
async function walkGemini(dir, out, since) {
  for (const p of await readdirSafe(dir)) {
    if (!p.isDirectory()) continue;
    const chats = path.join(dir, p.name, 'chats');
    for (const d of await readdirSafe(chats)) {
      if (!d.isFile() || !/^session-.*\.jsonl?$/.test(d.name)) continue;
      const f = path.join(chats, d.name);
      const st = await statSafe(f);
      if (st && st.size > 0 && st.mtimeMs >= since) out.push({ file: f, tool: 'gemini', projectDir: p.name, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
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
 * Lists usage files changed since `since` (ms). tools: { claude, codex, gemini } booleans.
 * Each entry: { file, tool, projectDir?, account?, size, mtimeMs, ino }.
 */
async function listFiles(roots, tools = { claude: true, codex: true, gemini: true }, since = 0) {
  const out = [];
  const acct = roots.claudeAccount || {};
  if (tools.claude !== false) for (const r of roots.claude || []) await walkClaude(r, '', 0, out, since, acct[r] || '');
  if (tools.codex !== false) for (const r of roots.codex || []) await walkCodex(r, 0, out, since);
  if (tools.gemini !== false) for (const r of roots.gemini || []) await walkGemini(r, out, since);
  const seen = new Set();
  return out.filter((e) => (seen.has(e.file) ? false : (seen.add(e.file), true)));
}

/**
 * Gemini CLI keeps a map of project paths to folder names in <root>/../projects.json
 * ({ "projects": { "/path/to/repo": "repo" } }). Returns { folderName: path }. Missing or bad file: {}.
 */
async function geminiProjectNames(roots = []) {
  const out = {};
  for (const r of roots) {
    try {
      const st = await fs.promises.stat(path.join(r, '..', 'projects.json'));
      if (!st.isFile() || st.size > 8 * 1024 * 1024) continue;
      const d = JSON.parse(await fs.promises.readFile(path.join(r, '..', 'projects.json'), 'utf8'));
      const m = d && typeof d.projects === 'object' && d.projects ? d.projects : {};
      for (const [p, name] of Object.entries(m)) if (typeof name === 'string' && name && !out[name]) out[name] = p;
    } catch { /* no map: folder names are used */ }
  }
  return out;
}

/** Turns a Claude project folder name ("-Users-me-repo") into a readable fallback label. */
function projectLabelFromDir(name) {
  return typeof name === 'string' && name ? name.replace(/^-/, '/').replace(/-/g, '/') : '';
}

module.exports = { resolveRoots, listFiles, expandHome, projectLabelFromDir, discoverClaudeDirs, accountLabel, geminiProjectNames };
