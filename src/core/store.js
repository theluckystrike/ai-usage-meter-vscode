'use strict';
// Keeps usage entries in memory and reads only what was added to each file since the last read.
// Per file it remembers the byte offset after the last complete line, the inode and the Codex running totals.
const { readNewLines, parseLine } = require('./lines');
const { claudeEntry, codexStep, newCodexState, claudeWorth, codexWorth } = require('./usage');
const { projectLabelFromDir } = require('./roots');

const DAY_MS = 24 * 60 * 60 * 1000;

class UsageStore {
  /** @param {{ historyDays?: number, maxLineBytes?: number }} [opts] */
  constructor(opts = {}) {
    this.historyDays = opts.historyDays || 90;
    this.maxLineBytes = opts.maxLineBytes || 32 * 1024 * 1024;
    this.files = new Map(); // file -> { tool, offset, ino, projectDir, codex, keys: Set, entries: [] }
    this.claude = new Map(); // dedupe key -> entry
    this.limits = null; // newest Codex rate limits
    this.stats = { badLines: 0, longLines: 0, bytesRead: 0, filesRead: 0, scans: 0 };
  }

  cutoff(now) { return now - this.historyDays * DAY_MS; }

  forget(file) {
    const st = this.files.get(file);
    if (!st) return;
    for (const k of st.keys) {
      const e = this.claude.get(k);
      if (e && e.file === file) this.claude.delete(k);
    }
    this.files.delete(file);
  }

  /**
   * Reads new lines from the listed files. listing: entries from roots.listFiles.
   * Files that left the listing are forgotten. Returns { changed, filesRead, bytesRead }.
   */
  async update(listing, opts = {}) {
    const now = opts.now || Date.now();
    const isCancelled = opts.isCancelled || (() => false);
    const onProgress = opts.onProgress || (() => {});
    const cutoff = this.cutoff(now);
    let changed = false, filesRead = 0, bytesRead = 0;
    const listed = new Set(listing.map((f) => f.file));
    for (const file of [...this.files.keys()]) if (!listed.has(file)) { this.forget(file); changed = true; }
    // Oldest first, so the newest Codex rate limits win.
    const todo = listing.slice().sort((a, b) => a.mtimeMs - b.mtimeMs);
    let i = 0;
    for (const f of todo) {
      i++;
      if (isCancelled()) break;
      let st = this.files.get(f.file);
      if (st && (f.size < st.offset || (f.ino && st.ino && f.ino !== st.ino))) { this.forget(f.file); st = null; changed = true; }
      if (!st) {
        st = { tool: f.tool, offset: 0, ino: f.ino || 0, projectDir: f.projectDir || '', codex: newCodexState(), keys: new Set(), entries: [], line: 0 };
        this.files.set(f.file, st);
      }
      if (f.size <= st.offset) continue;
      const before = st.offset;
      const add = (line) => this.ingest(f.file, st, line, cutoff);
      try {
        const r = await readNewLines(f.file, st.offset, add, { end: f.size, maxLineBytes: this.maxLineBytes, isCancelled });
        st.offset = r.offset;
        this.stats.longLines += r.longLines;
      } catch {
        continue; // file vanished or unreadable: try again next time
      }
      if (st.offset > before) { changed = true; filesRead++; bytesRead += st.offset - before; }
      if (i % 25 === 0) onProgress(i, todo.length);
    }
    this.prune(now);
    this.stats.bytesRead += bytesRead;
    this.stats.filesRead += filesRead;
    this.stats.scans++;
    return { changed, filesRead, bytesRead };
  }

  ingest(file, st, line, cutoff) {
    st.line++;
    if (st.tool === 'claude') {
      if (!claudeWorth(line)) return;
      const rec = parseLine(line);
      if (!rec) { this.stats.badLines++; return; }
      const e = claudeEntry(rec, file + '#' + st.line);
      if (!e || e.ts < cutoff) return;
      e.tool = 'claude';
      e.file = file;
      e.project = e.cwd || projectLabelFromDir(st.projectDir);
      delete e.cwd;
      const old = this.claude.get(e.key);
      // The same message can be written several times while it streams; keep the most complete one.
      if (old && old.output + old.input + old.cacheWrite + old.cacheRead >= e.output + e.input + e.cacheWrite + e.cacheRead) return;
      this.claude.set(e.key, e);
      st.keys.add(e.key);
      return;
    }
    if (!codexWorth(line)) return;
    const rec = parseLine(line);
    if (!rec) { this.stats.badLines++; return; }
    const { entry, limits } = codexStep(rec, st.codex);
    if (limits && (!this.limits || limits.ts >= this.limits.ts)) this.limits = limits;
    if (entry && entry.ts >= cutoff) {
      entry.tool = 'codex';
      entry.project = entry.cwd || '';
      delete entry.cwd;
      st.entries.push(entry);
    }
  }

  prune(now) {
    const cutoff = this.cutoff(now);
    for (const [k, e] of this.claude) if (e.ts < cutoff) this.claude.delete(k);
    for (const st of this.files.values()) if (st.entries.length && st.entries[0].ts < cutoff) st.entries = st.entries.filter((e) => e.ts >= cutoff);
  }

  /** All entries (Claude Code and Codex). */
  *entries() {
    yield* this.claude.values();
    for (const st of this.files.values()) yield* st.entries;
  }

  get fileCount() { return this.files.size; }
}

module.exports = { UsageStore, DAY_MS };
